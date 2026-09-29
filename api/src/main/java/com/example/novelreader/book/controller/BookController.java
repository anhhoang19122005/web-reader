package com.example.novelreader.book.controller;

import com.example.novelreader.book.dto.BookDetailResponse;
import com.example.novelreader.book.dto.BookSummaryResponse;
import com.example.novelreader.book.dto.BookUploadResponse;
import com.example.novelreader.book.dto.ChapterResponse;
import com.example.novelreader.book.service.BookService;
import com.example.novelreader.book.service.BookUploadService;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/books")
@RequiredArgsConstructor
public class BookController {

	private final BookUploadService bookUploadService;
	private final BookService bookService;

	@PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
	@ResponseStatus(HttpStatus.CREATED)
	public BookUploadResponse upload(@RequestPart("file") MultipartFile file) {
		return bookUploadService.upload(file);
	}

	@GetMapping
	public List<BookSummaryResponse> listBooks() {
		return bookService.listBooks();
	}

	@GetMapping("/{bookId}")
	public BookDetailResponse getBook(@PathVariable UUID bookId) {
		return bookService.getBook(bookId);
	}

	@DeleteMapping("/{bookId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void delete(@PathVariable UUID bookId) {
		bookService.delete(bookId);
	}

	@GetMapping("/{bookId}/chapters/{chapterId}")
	public ChapterResponse getChapter(@PathVariable UUID bookId, @PathVariable UUID chapterId) {
		return bookService.getChapter(bookId, chapterId);
	}
}
