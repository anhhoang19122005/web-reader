package com.example.novelreader.reader.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

public record BookmarkRequest(@NotNull UUID chapterId, @Min(0) int characterPosition, @Size(max = 1000) String note) {
}
