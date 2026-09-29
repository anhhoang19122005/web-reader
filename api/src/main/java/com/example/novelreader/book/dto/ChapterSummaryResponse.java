package com.example.novelreader.book.dto;

import java.util.UUID;

public record ChapterSummaryResponse(UUID id, int chapterNumber, String title) {
}
