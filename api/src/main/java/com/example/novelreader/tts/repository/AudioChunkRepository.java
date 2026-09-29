package com.example.novelreader.tts.repository;

import com.example.novelreader.tts.entity.AudioChunk;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AudioChunkRepository extends JpaRepository<AudioChunk, UUID> {

	Optional<AudioChunk> findByChapterIdAndChunkIndexAndVoiceIdAndSpeakingRateAndPitchAndVolumeAndTextHash(UUID chapterId, int chunkIndex, String voiceId, double speakingRate, double pitch, double volume, String textHash);
}
