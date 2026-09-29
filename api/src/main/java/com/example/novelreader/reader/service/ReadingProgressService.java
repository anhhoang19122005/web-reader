package com.example.novelreader.reader.service;

import com.example.novelreader.auth.CurrentUserService;
import com.example.novelreader.auth.ReaderUser;
import com.example.novelreader.auth.ReaderUserRepository;
import com.example.novelreader.book.entity.Book;
import com.example.novelreader.book.entity.Chapter;
import com.example.novelreader.book.repository.BookRepository;
import com.example.novelreader.book.repository.ChapterRepository;
import com.example.novelreader.common.exception.ApiException;
import com.example.novelreader.reader.dto.ReadingProgressRequest;
import com.example.novelreader.reader.dto.ReadingProgressResponse;
import com.example.novelreader.reader.entity.ReadingProgress;
import com.example.novelreader.reader.repository.ReadingProgressRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class ReadingProgressService {

	private final CurrentUserService currentUserService;
	private final ReaderUserRepository readerUserRepository;
	private final BookRepository bookRepository;
	private final ChapterRepository chapterRepository;
	private final ReadingProgressRepository readingProgressRepository;

	@Transactional(readOnly = true)
	public ReadingProgressResponse get(UUID bookId) {
		UUID userId = currentUserService.currentUserId();
		ownedBook(bookId, userId);
		return readingProgressRepository.findByUserIdAndBookId(userId, bookId)
			.map(this::toResponse)
			.orElse(new ReadingProgressResponse(bookId, null, 0, null));
	}

	@Transactional
	public ReadingProgressResponse save(UUID bookId, ReadingProgressRequest request) {
		UUID userId = currentUserService.currentUserId();
		Book book = ownedBook(bookId, userId);
		Chapter chapter = chapterRepository.findByIdAndBookId(request.chapterId(), bookId)
			.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "CHAPTER_NOT_FOUND", "Không tìm thấy chapter."));
		ReadingProgress progress = readingProgressRepository.findByUserIdAndBookId(userId, bookId)
			.map(existing -> {
				existing.update(chapter, request.characterPosition());
				return existing;
			})
			.orElseGet(() -> new ReadingProgress(UUID.randomUUID(), user(userId), book, chapter, request.characterPosition()));
		return toResponse(readingProgressRepository.save(progress));
	}

	private ReaderUser user(UUID userId) {
		return readerUserRepository.getReferenceById(userId);
	}

	private Book ownedBook(UUID bookId, UUID userId) {
		return bookRepository.findByIdAndUserId(bookId, userId)
			.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "BOOK_NOT_FOUND", "Không tìm thấy sách."));
	}

	private ReadingProgressResponse toResponse(ReadingProgress progress) {
		return new ReadingProgressResponse(progress.getBook().getId(), progress.getChapter().getId(), progress.getCharacterPosition(), progress.getUpdatedAt());
	}
}
