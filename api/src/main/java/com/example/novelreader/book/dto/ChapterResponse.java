package com.example.novelreader.book.dto;

import java.util.UUID;

public record ChapterResponse(UUID id, int chapterNumber, String title, String contentHtml, String plainText) {
}
