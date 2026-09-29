package com.example.novelreader.book.service;

import com.example.novelreader.auth.CurrentUserService;
import com.example.novelreader.book.dto.BookDetailResponse;
import com.example.novelreader.book.dto.BookSummaryResponse;
import com.example.novelreader.book.dto.ChapterResponse;
import com.example.novelreader.book.dto.ChapterSummaryResponse;
import com.example.novelreader.book.entity.Book;
import com.example.novelreader.book.entity.Chapter;
import com.example.novelreader.book.repository.BookRepository;
import com.example.novelreader.book.repository.ChapterRepository;
import com.example.novelreader.common.exception.ApiException;
import com.example.novelreader.reader.entity.ReadingProgress;
import com.example.novelreader.reader.repository.ReadingProgressRepository;
import com.example.novelreader.storage.StorageProvider;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class BookService {

	private final CurrentUserService currentUserService;
	private final BookRepository bookRepository;
	private final ChapterRepository chapterRepository;
	private final ReadingProgressRepository readingProgressRepository;
	private final StorageProvider storageProvider;

	@Transactional(readOnly = true)
	public List<BookSummaryResponse> listBooks() {
		return bookRepository.findByUserIdOrderByCreatedAtDesc(currentUserService.currentUserId()).stream()
			.map(this::toSummary)
			.toList();
	}

	@Transactional(readOnly = true)
	public BookDetailResponse getBook(UUID bookId) {
		Book book = ownedBook(bookId);
		List<ChapterSummaryResponse> chapters = book.getChapters().stream()
			.map(chapter -> new ChapterSummaryResponse(chapter.getId(), chapter.getChapterNumber(), chapter.getTitle()))
			.toList();
		return new BookDetailResponse(
			book.getId(),
			book.getTitle(),
			book.getAuthor(),
			book.getFileType(),
			book.getCoverStorageKey() != null,
			book.getCreatedAt(),
			chapters
		);
	}

	@Transactional(readOnly = true)
	public ChapterResponse getChapter(UUID bookId, UUID chapterId) {
		ownedBook(bookId);
		Chapter chapter = chapterRepository.findByIdAndBookId(chapterId, bookId)
			.orElseThrow(() -> notFound("Không tìm thấy chapter."));
		return new ChapterResponse(chapter.getId(), chapter.getChapterNumber(), chapter.getTitle(), chapter.getContentHtml(), chapter.getPlainText());
	}

	@Transactional
	public void delete(UUID bookId) {
		Book book = ownedBook(bookId);
		bookRepository.delete(book);
		storageProvider.delete(book.getOriginalFileStorageKey());
		if (book.getCoverStorageKey() != null) storageProvider.delete(book.getCoverStorageKey());
	}

	private BookSummaryResponse toSummary(Book book) {
		ReadingProgress progress = readingProgressRepository.findByUserIdAndBookId(currentUserService.currentUserId(), book.getId()).orElse(null);
		int progressPercent = progress == null || book.getChapters().isEmpty() ? 0 : (int) Math.round(((progress.getChapter().getChapterNumber() - 1) + Math.min(1d, (double) progress.getCharacterPosition() / Math.max(1, progress.getChapter().getPlainText().length()))) * 100 / book.getChapters().size());
		return new BookSummaryResponse(
			book.getId(),
			book.getTitle(),
			book.getAuthor(),
			book.getFileType(),
			book.getCoverStorageKey() != null,
			book.getChapters().size(),
			book.getCreatedAt(),
			Math.min(100, progressPercent),
			progress == null ? null : progress.getUpdatedAt()
		);
	}

	private Book ownedBook(UUID bookId) {
		return bookRepository.findByIdAndUserId(bookId, currentUserService.currentUserId())
			.orElseThrow(() -> notFound("Không tìm thấy sách."));
	}

	private ApiException notFound(String message) {
		return new ApiException(HttpStatus.NOT_FOUND, "BOOK_NOT_FOUND", message);
	}
}
