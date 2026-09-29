package com.example.novelreader.tts.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record TtsGenerateRequest(
	@NotNull UUID chapterId,
	@Min(0) int chunkIndex,
	@NotBlank String voiceId,
	@DecimalMin("0.5") @DecimalMax("2.0") double speakingRate,
	@DecimalMin("-20") @DecimalMax("20") double pitch,
	@DecimalMin("0.0") @DecimalMax("1.0") double volume
) {
}
