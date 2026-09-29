package com.example.novelreader.tts.provider;

import java.util.List;

public interface TtsProvider {

	String id();

	List<TtsVoice> voices();

	TtsResult synthesize(TtsRequest request);
}
