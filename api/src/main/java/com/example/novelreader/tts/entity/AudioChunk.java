package com.example.novelreader.tts.entity;

import com.example.novelreader.book.entity.Chapter;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "audio_chunks")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AudioChunk {

	@Id
	private UUID id;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "chapter_id", nullable = false)
	private Chapter chapter;

	@Column(name = "chunk_index", nullable = false)
	private int chunkIndex;

	@Column(name = "text_hash", nullable = false, length = 64)
	private String textHash;

	@Column(nullable = false, columnDefinition = "text")
	private String text;

	@Column(name = "voice_id", nullable = false, length = 100)
	private String voiceId;

	@Column(name = "speaking_rate", nullable = false)
	private double speakingRate;

	@Column(nullable = false)
	private double pitch;

	@Column(nullable = false)
	private double volume;

	@Column(name = "start_character", nullable = false)
	private int startCharacter;

	@Column(name = "end_character", nullable = false)
	private int endCharacter;

	@Column(name = "audio_storage_key", nullable = false, length = 1000)
	private String audioStorageKey;

	@Column(name = "mime_type", nullable = false, length = 100)
	private String mimeType;

	@Column(name = "duration_ms", nullable = false)
	private int durationMs;

	@Column(name = "created_at", nullable = false)
	private Instant createdAt;

	public AudioChunk(UUID id, Chapter chapter, int chunkIndex, String textHash, String text, String voiceId, double speakingRate, double pitch, double volume, int startCharacter, int endCharacter, String audioStorageKey, String mimeType, int durationMs) {
		this.id = id;
		this.chapter = chapter;
		this.chunkIndex = chunkIndex;
		this.textHash = textHash;
		this.text = text;
		this.voiceId = voiceId;
		this.speakingRate = speakingRate;
		this.pitch = pitch;
		this.volume = volume;
		this.startCharacter = startCharacter;
		this.endCharacter = endCharacter;
		this.audioStorageKey = audioStorageKey;
		this.mimeType = mimeType;
		this.durationMs = durationMs;
		this.createdAt = Instant.now();
	}
}
