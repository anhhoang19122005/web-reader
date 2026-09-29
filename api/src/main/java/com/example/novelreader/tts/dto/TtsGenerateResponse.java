package com.example.novelreader.tts.dto;

public record TtsGenerateResponse(String audioUrl, String mimeType, int durationMs, int chunkIndex, int startCharacter, int endCharacter, boolean cached) {
}
