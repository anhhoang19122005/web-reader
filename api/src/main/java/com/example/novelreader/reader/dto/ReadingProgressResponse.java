package com.example.novelreader.reader.dto;

import java.time.Instant;
import java.util.UUID;

public record ReadingProgressResponse(UUID bookId, UUID chapterId, int characterPosition, Instant updatedAt) {
}
