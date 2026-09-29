package com.example.novelreader.book.service;

import com.example.novelreader.auth.CurrentUserService;
import com.example.novelreader.book.dto.BookUploadResponse;
import com.example.novelreader.book.entity.Book;
import com.example.novelreader.book.entity.BookFileType;
import com.example.novelreader.book.parser.BookParser;
import com.example.novelreader.book.parser.ParsedBook;
import com.example.novelreader.common.exception.ApiException;
import com.example.novelreader.storage.StorageProvider;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
@RequiredArgsConstructor
public class BookUploadService {

	private final CurrentUserService currentUserService;
	private final List<BookParser> bookParsers;
	private final StorageProvider storageProvider;
	private final BookPersistenceService bookPersistenceService;

	public BookUploadResponse upload(MultipartFile file) {
		if (file.isEmpty()) {
			throw new ApiException(HttpStatus.BAD_REQUEST, "EMPTY_FILE", "Tệp sách không có nội dung.");
		}

		BookFileType fileType = BookFileType.fromFilename(file.getOriginalFilename());
		UUID userId = currentUserService.currentUserId();
		UUID bookId = UUID.randomUUID();
		Path temporaryFile = null;
		String originalFileStorageKey = null;
		String coverStorageKey = null;
		try {
			temporaryFile = Files.createTempFile("novel-reader-", ".upload");
			file.transferTo(temporaryFile);
			ParsedBook parsedBook = parserFor(fileType).parse(temporaryFile);

			String extension = fileType == BookFileType.PDF ? ".pdf" : ".epub";
			originalFileStorageKey = storageProvider.store(temporaryFile, "books/" + bookId + "/source" + extension);
			if (parsedBook.cover() != null && parsedBook.cover().length > 0) {
				coverStorageKey = storageProvider.store(parsedBook.cover(), "books/" + bookId + "/cover" + parsedBook.coverExtension());
			}

			Book book = bookPersistenceService.save(userId, bookId, parsedBook, fileType, originalFileStorageKey, coverStorageKey);
			return new BookUploadResponse(book.getId(), book.getTitle(), book.getChapters().size());
		} catch (IOException exception) {
			deleteStoredFiles(coverStorageKey, originalFileStorageKey);
			throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "UPLOAD_FAILED", "Không thể nhận tệp EPUB hoặc PDF.");
		} catch (RuntimeException exception) {
			deleteStoredFiles(coverStorageKey, originalFileStorageKey);
			throw exception;
		} finally {
			deleteTemporaryFile(temporaryFile);
		}
	}

	private BookParser parserFor(BookFileType fileType) {
		return bookParsers.stream()
			.filter(parser -> parser.fileType() == fileType)
			.findFirst()
			.orElseThrow(() -> new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_FILE_TYPE", "Chưa có parser cho định dạng này."));
	}

	private void deleteStoredFiles(String coverStorageKey, String originalFileStorageKey) {
		deleteQuietly(coverStorageKey);
		deleteQuietly(originalFileStorageKey);
	}

	private void deleteQuietly(String key) {
		if (key == null) {
			return;
		}
		try {
			storageProvider.delete(key);
		} catch (ApiException ignored) {
			// The original upload error is more useful than a cleanup error.
		}
	}

	private void deleteTemporaryFile(Path temporaryFile) {
		if (temporaryFile == null) {
			return;
		}
		try {
			Files.deleteIfExists(temporaryFile);
		} catch (IOException ignored) {
			// The operating system will eventually clean its temporary directory.
		}
	}
}
