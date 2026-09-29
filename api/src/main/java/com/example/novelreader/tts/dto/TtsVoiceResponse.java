package com.example.novelreader.tts.dto;

public record TtsVoiceResponse(String id, String provider, String name, String language, String gender, String style) {
}
