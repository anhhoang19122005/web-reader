package com.example.novelreader.book.dto;

import java.util.UUID;

public record BookUploadResponse(UUID id, String title, int chapterCount) {
}
