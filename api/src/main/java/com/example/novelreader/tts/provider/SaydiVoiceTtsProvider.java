package com.example.novelreader.tts.provider;

import com.example.novelreader.common.exception.ApiException;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class SaydiVoiceTtsProvider implements TtsProvider {

	private final String apiKey;
	private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

	public SaydiVoiceTtsProvider(@Value("${app.tts.saydi-api-key:}") String apiKey) {
		this.apiKey = apiKey;
	}

	@Override
	public String id() {
		return "saydi";
	}

	@Override
	public List<TtsVoice> voices() {
		if (apiKey.isBlank()) return List.of();
		return List.of(new TtsVoice("vi-adam", id(), "Adam · giọng Việt tự nhiên", "vi-VN", "male", "narrator"));
	}

	@Override
	public TtsResult synthesize(TtsRequest request) {
		if (apiKey.isBlank()) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "TTS_PROVIDER_UNAVAILABLE", "SaydiVoice chưa được cấu hình.");
		String body = "{\"model\":\"tts-1\",\"voice\":\"" + escape(request.voiceId()) + "\",\"input\":\"" + escape(request.text()) + "\",\"response_format\":\"mp3\",\"speed\":" + request.speakingRate() + "}";
		HttpRequest httpRequest = HttpRequest.newBuilder(URI.create("https://voice.saydi.ai/api/v1/audio/speech"))
			.timeout(Duration.ofSeconds(180))
			.header("Authorization", "Bearer " + apiKey)
			.header("Content-Type", "application/json")
			.POST(HttpRequest.BodyPublishers.ofString(body))
			.build();
		try {
			HttpResponse<byte[]> response = client.send(httpRequest, HttpResponse.BodyHandlers.ofByteArray());
			if (response.statusCode() / 100 != 2) throw new ApiException(response.statusCode() == 429 ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.BAD_GATEWAY, "TTS_GENERATION_FAILED", "SaydiVoice không tạo được audio.");
			int durationMs = response.headers().firstValue("X-Audio-Duration").map(this::durationMs).orElse(Math.max(800, request.text().length() * 35));
			return new TtsResult(response.body(), "audio/mpeg", durationMs);
		} catch (InterruptedException exception) {
			Thread.currentThread().interrupt();
			throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "TTS_PROVIDER_UNAVAILABLE", "Yêu cầu SaydiVoice bị gián đoạn.");
		} catch (IOException exception) {
			throw new ApiException(HttpStatus.BAD_GATEWAY, "TTS_GENERATION_FAILED", "Không thể kết nối SaydiVoice.");
		}
	}

	private int durationMs(String value) {
		try {
			return (int) Math.round(Double.parseDouble(value) * 1_000);
		} catch (NumberFormatException exception) {
			return 800;
		}
	}

	private String escape(String value) {
		return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\r", "\\r").replace("\n", "\\n");
	}
}
