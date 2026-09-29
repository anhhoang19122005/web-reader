package com.example.novelreader.tts.controller;

import com.example.novelreader.storage.StorageProvider;
import com.example.novelreader.tts.dto.TtsChunkResponse;
import com.example.novelreader.tts.dto.TtsGenerateRequest;
import com.example.novelreader.tts.dto.TtsGenerateResponse;
import com.example.novelreader.tts.dto.TtsVoiceResponse;
import com.example.novelreader.tts.entity.AudioChunk;
import com.example.novelreader.tts.service.TtsService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/tts")
@RequiredArgsConstructor
public class TtsController {

	private final TtsService ttsService;
	private final StorageProvider storageProvider;

	@GetMapping("/voices")
	public List<TtsVoiceResponse> voices() {
		return ttsService.voices();
	}

	@GetMapping("/chunks/{chapterId}")
	public List<TtsChunkResponse> chunks(@PathVariable UUID chapterId) {
		return ttsService.chunks(chapterId);
	}

	@PostMapping("/generate")
	public TtsGenerateResponse generate(@Valid @RequestBody TtsGenerateRequest request) {
		return ttsService.generate(request);
	}

	@GetMapping("/audio/{audioChunkId}")
	public ResponseEntity<byte[]> audio(@PathVariable UUID audioChunkId) {
		AudioChunk chunk = ttsService.audio(audioChunkId);
		return ResponseEntity.ok().contentType(MediaType.parseMediaType(chunk.getMimeType())).body(storageProvider.read(chunk.getAudioStorageKey()));
	}
}
