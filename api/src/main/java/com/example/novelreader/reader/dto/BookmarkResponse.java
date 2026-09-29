package com.example.novelreader.reader.dto;

import java.time.Instant;
import java.util.UUID;

public record BookmarkResponse(UUID id, UUID chapterId, int characterPosition, String note, Instant createdAt) {
}
