package com.example.novelreader.reader.controller;

import com.example.novelreader.reader.dto.ReadingProgressRequest;
import com.example.novelreader.reader.dto.ReadingProgressResponse;
import com.example.novelreader.reader.service.ReadingProgressService;
import jakarta.validation.Valid;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/reader/progress")
@RequiredArgsConstructor
public class ReadingProgressController {

	private final ReadingProgressService readingProgressService;

	@GetMapping("/{bookId}")
	public ReadingProgressResponse get(@PathVariable UUID bookId) {
		return readingProgressService.get(bookId);
	}

	@PutMapping("/{bookId}")
	public ReadingProgressResponse save(@PathVariable UUID bookId, @Valid @RequestBody ReadingProgressRequest request) {
		return readingProgressService.save(bookId, request);
	}
}
