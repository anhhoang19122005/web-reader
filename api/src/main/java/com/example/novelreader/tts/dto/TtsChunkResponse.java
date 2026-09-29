package com.example.novelreader.tts.dto;

public record TtsChunkResponse(int chunkIndex, String text, int startCharacter, int endCharacter) {
}
