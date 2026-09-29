package com.example.novelreader.tts.provider;

public record TtsResult(byte[] audio, String mimeType, int durationMs) {
}
