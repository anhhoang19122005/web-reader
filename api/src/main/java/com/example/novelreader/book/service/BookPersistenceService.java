package com.example.novelreader.book.service;

import com.example.novelreader.auth.ReaderUser;
import com.example.novelreader.auth.ReaderUserRepository;
import com.example.novelreader.book.entity.Book;
import com.example.novelreader.book.entity.BookFileType;
import com.example.novelreader.book.entity.Chapter;
import com.example.novelreader.book.parser.ParsedBook;
import com.example.novelreader.book.parser.ParsedChapter;
import com.example.novelreader.book.repository.BookRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
class BookPersistenceService {

	private final BookRepository bookRepository;
	private final ReaderUserRepository readerUserRepository;

	@Transactional
	public Book save(UUID userId, UUID bookId, ParsedBook parsedBook, BookFileType fileType, String originalFileStorageKey, String coverStorageKey) {
		ReaderUser user = readerUserRepository.getReferenceById(userId);
		Book book = new Book(
			bookId,
			user,
			parsedBook.title(),
			parsedBook.author(),
			coverStorageKey,
			originalFileStorageKey,
			fileType,
			"vi"
		);
		int chapterNumber = 1;
		for (ParsedChapter parsedChapter : parsedBook.chapters()) {
			book.addChapter(new Chapter(
				UUID.randomUUID(),
				book,
				chapterNumber++,
				parsedChapter.title(),
				parsedChapter.contentHtml(),
				parsedChapter.plainText(),
				hash(parsedChapter.plainText())
			));
		}
		return bookRepository.save(book);
	}

	private String hash(String content) {
		try {
			return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content.getBytes(StandardCharsets.UTF_8)));
		} catch (NoSuchAlgorithmException exception) {
			throw new IllegalStateException("SHA-256 is unavailable.", exception);
		}
	}
}
