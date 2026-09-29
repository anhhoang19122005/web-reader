package com.example.novelreader.reader.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record ReadingProgressRequest(@NotNull UUID chapterId, @Min(0) int characterPosition) {
}
