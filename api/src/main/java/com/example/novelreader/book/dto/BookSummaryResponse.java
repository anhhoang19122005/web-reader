package com.example.novelreader.book.dto;

import com.example.novelreader.book.entity.BookFileType;
import java.time.Instant;
import java.util.UUID;

public record BookSummaryResponse(UUID id, String title, String author, BookFileType fileType, boolean hasCover, int chapterCount, Instant createdAt, int progressPercent, Instant lastReadAt) {
}
