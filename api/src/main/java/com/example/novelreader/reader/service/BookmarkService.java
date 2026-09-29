package com.example.novelreader.reader.service;

import com.example.novelreader.auth.CurrentUserService;
import com.example.novelreader.auth.ReaderUser;
import com.example.novelreader.auth.ReaderUserRepository;
import com.example.novelreader.book.entity.Book;
import com.example.novelreader.book.entity.Chapter;
import com.example.novelreader.book.repository.BookRepository;
import com.example.novelreader.book.repository.ChapterRepository;
import com.example.novelreader.common.exception.ApiException;
import com.example.novelreader.reader.dto.BookmarkRequest;
import com.example.novelreader.reader.dto.BookmarkResponse;
import com.example.novelreader.reader.entity.Bookmark;
import com.example.novelreader.reader.repository.BookmarkRepository;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class BookmarkService {

	private final CurrentUserService currentUserService;
	private final ReaderUserRepository readerUserRepository;
	private final BookRepository bookRepository;
	private final ChapterRepository chapterRepository;
	private final BookmarkRepository bookmarkRepository;

	@Transactional(readOnly = true)
	public List<BookmarkResponse> list(UUID bookId) {
		UUID userId = currentUserService.currentUserId();
		ownedBook(bookId, userId);
		return bookmarkRepository.findByUserIdAndBookIdOrderByCreatedAtDesc(userId, bookId).stream().map(this::response).toList();
	}

	@Transactional
	public BookmarkResponse create(UUID bookId, BookmarkRequest request) {
		UUID userId = currentUserService.currentUserId();
		Book book = ownedBook(bookId, userId);
		Chapter chapter = chapterRepository.findByIdAndBookId(request.chapterId(), bookId)
			.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "CHAPTER_NOT_FOUND", "Không tìm thấy chapter."));
		return response(bookmarkRepository.save(new Bookmark(UUID.randomUUID(), readerUserRepository.getReferenceById(userId), book, chapter, request.characterPosition(), request.note())));
	}

	@Transactional
	public void delete(UUID bookId, UUID bookmarkId) {
		Bookmark bookmark = bookmarkRepository.findByIdAndUserIdAndBookId(bookmarkId, currentUserService.currentUserId(), bookId)
			.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "BOOKMARK_NOT_FOUND", "Không tìm thấy bookmark."));
		bookmarkRepository.delete(bookmark);
	}

	private Book ownedBook(UUID bookId, UUID userId) {
		return bookRepository.findByIdAndUserId(bookId, userId)
			.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "BOOK_NOT_FOUND", "Không tìm thấy sách."));
	}

	private BookmarkResponse response(Bookmark bookmark) {
		return new BookmarkResponse(bookmark.getId(), bookmark.getChapter().getId(), bookmark.getCharacterPosition(), bookmark.getNote(), bookmark.getCreatedAt());
	}
}
