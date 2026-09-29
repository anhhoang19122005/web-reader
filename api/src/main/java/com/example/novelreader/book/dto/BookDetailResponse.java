package com.example.novelreader.book.dto;

import com.example.novelreader.book.entity.BookFileType;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record BookDetailResponse(UUID id, String title, String author, BookFileType fileType, boolean hasCover, Instant createdAt, List<ChapterSummaryResponse> chapters) {
}
