package com.example.novelreader.tts.service;

import com.example.novelreader.auth.CurrentUserService;
import com.example.novelreader.book.entity.Book;
import com.example.novelreader.book.entity.Chapter;
import com.example.novelreader.book.repository.BookRepository;
import com.example.novelreader.book.repository.ChapterRepository;
import com.example.novelreader.common.exception.ApiException;
import com.example.novelreader.storage.StorageProvider;
import com.example.novelreader.tts.dto.TtsChunkResponse;
import com.example.novelreader.tts.dto.TtsGenerateRequest;
import com.example.novelreader.tts.dto.TtsGenerateResponse;
import com.example.novelreader.tts.dto.TtsVoiceResponse;
import com.example.novelreader.tts.entity.AudioChunk;
import com.example.novelreader.tts.provider.TtsProvider;
import com.example.novelreader.tts.provider.TtsRequest;
import com.example.novelreader.tts.provider.TtsResult;
import com.example.novelreader.tts.provider.TtsVoice;
import com.example.novelreader.tts.repository.AudioChunkRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class TtsService {

	private final CurrentUserService currentUserService;
	private final BookRepository bookRepository;
	private final ChapterRepository chapterRepository;
	private final AudioChunkRepository audioChunkRepository;
	private final StorageProvider storageProvider;
	private final List<TtsProvider> providers;
	private final TextChunker textChunker = new TextChunker();

	public List<TtsVoiceResponse> voices() {
		return providers.stream().flatMap(provider -> provider.voices().stream()).map(this::toVoiceResponse).toList();
	}

	@Transactional(readOnly = true)
	public List<TtsChunkResponse> chunks(UUID chapterId) {
		Chapter chapter = ownedChapter(chapterId);
		return textChunker.chunk(chapter.getPlainText()).stream().map(chunk -> new TtsChunkResponse(chunk.chunkIndex(), chunk.text(), chunk.startCharacter(), chunk.endCharacter())).toList();
	}

	@Transactional
	public TtsGenerateResponse generate(TtsGenerateRequest request) {
		Chapter chapter = ownedChapter(request.chapterId());
		TextChunk chunk = textChunker.chunk(chapter.getPlainText()).stream()
			.filter(value -> value.chunkIndex() == request.chunkIndex())
			.findFirst()
			.orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST, "TTS_CHUNK_NOT_FOUND", "Không tìm thấy đoạn đọc."));
		TtsVoice voice = voices().stream().map(this::toProviderVoice).filter(value -> value.id().equals(request.voiceId())).findFirst()
			.orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST, "TTS_VOICE_NOT_FOUND", "Không tìm thấy voice tiếng Việt."));
		String textHash = hash(chunk.text() + voice.id() + request.speakingRate() + request.pitch() + request.volume());
		return audioChunkRepository.findByChapterIdAndChunkIndexAndVoiceIdAndSpeakingRateAndPitchAndVolumeAndTextHash(chapter.getId(), chunk.chunkIndex(), voice.id(), request.speakingRate(), request.pitch(), request.volume(), textHash)
			.map(value -> response(value, true))
			.orElseGet(() -> createAudio(chapter, chunk, voice, request, textHash));
	}

	@Transactional(readOnly = true)
	public AudioChunk audio(UUID audioChunkId) {
		AudioChunk chunk = audioChunkRepository.findById(audioChunkId)
			.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "AUDIO_NOT_FOUND", "Không tìm thấy audio."));
		ownedBook(chunk.getChapter().getBook().getId());
		return chunk;
	}

	private TtsGenerateResponse createAudio(Chapter chapter, TextChunk chunk, TtsVoice voice, TtsGenerateRequest request, String textHash) {
		TtsProvider provider = providers.stream().filter(value -> value.id().equals(voice.provider())).findFirst()
			.orElseThrow(() -> new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "TTS_PROVIDER_UNAVAILABLE", "Không tìm thấy TTS provider."));
		TtsResult result = provider.synthesize(new TtsRequest(chunk.text(), voice.id(), voice.language(), request.speakingRate(), request.pitch(), request.volume()));
		UUID audioId = UUID.randomUUID();
		String extension = result.mimeType().contains("wav") ? ".wav" : ".mp3";
		String storageKey = "tts/" + audioId + extension;
		storageProvider.store(result.audio(), storageKey);
		AudioChunk audio = new AudioChunk(audioId, chapter, chunk.chunkIndex(), textHash, chunk.text(), voice.id(), request.speakingRate(), request.pitch(), request.volume(), chunk.startCharacter(), chunk.endCharacter(), storageKey, result.mimeType(), result.durationMs());
		return response(audioChunkRepository.save(audio), false);
	}

	private Chapter ownedChapter(UUID chapterId) {
		Chapter chapter = chapterRepository.findById(chapterId)
			.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "CHAPTER_NOT_FOUND", "Không tìm thấy chapter."));
		ownedBook(chapter.getBook().getId());
		return chapter;
	}

	private Book ownedBook(UUID bookId) {
		return bookRepository.findByIdAndUserId(bookId, currentUserService.currentUserId())
			.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "BOOK_NOT_FOUND", "Không tìm thấy sách."));
	}

	private TtsVoiceResponse toVoiceResponse(TtsVoice voice) {
		return new TtsVoiceResponse(voice.id(), voice.provider(), voice.name(), voice.language(), voice.gender(), voice.style());
	}

	private TtsVoice toProviderVoice(TtsVoiceResponse voice) {
		return new TtsVoice(voice.id(), voice.provider(), voice.name(), voice.language(), voice.gender(), voice.style());
	}

	private TtsGenerateResponse response(AudioChunk audio, boolean cached) {
		return new TtsGenerateResponse("/tts/audio/" + audio.getId(), audio.getMimeType(), audio.getDurationMs(), audio.getChunkIndex(), audio.getStartCharacter(), audio.getEndCharacter(), cached);
	}

	private String hash(String value) {
		try {
			return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
		} catch (NoSuchAlgorithmException exception) {
			throw new IllegalStateException("SHA-256 is unavailable.", exception);
		}
	}
}
