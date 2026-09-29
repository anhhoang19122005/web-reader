package com.example.novelreader.tts.provider;

public record TtsRequest(String text, String voiceId, String language, double speakingRate, double pitch, double volume) {
}
