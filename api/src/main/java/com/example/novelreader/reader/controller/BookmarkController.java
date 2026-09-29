package com.example.novelreader.reader.controller;

import com.example.novelreader.reader.dto.BookmarkRequest;
import com.example.novelreader.reader.dto.BookmarkResponse;
import com.example.novelreader.reader.service.BookmarkService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/reader/bookmarks")
@RequiredArgsConstructor
public class BookmarkController {

	private final BookmarkService bookmarkService;

	@GetMapping("/{bookId}")
	public List<BookmarkResponse> list(@PathVariable UUID bookId) {
		return bookmarkService.list(bookId);
	}

	@PostMapping("/{bookId}")
	@ResponseStatus(HttpStatus.CREATED)
	public BookmarkResponse create(@PathVariable UUID bookId, @Valid @RequestBody BookmarkRequest request) {
		return bookmarkService.create(bookId, request);
	}

	@DeleteMapping("/{bookId}/{bookmarkId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void delete(@PathVariable UUID bookId, @PathVariable UUID bookmarkId) {
		bookmarkService.delete(bookId, bookmarkId);
	}
}
