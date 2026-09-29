package com.example.novelreader.tts.provider;

import com.example.novelreader.common.exception.ApiException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class AzureSpeechTtsProvider implements TtsProvider {

	private final String key;
	private final String region;
	private final HttpClient client = HttpClient.newHttpClient();

	public AzureSpeechTtsProvider(@Value("${app.tts.azure-key:}") String key, @Value("${app.tts.azure-region:}") String region) {
		this.key = key;
		this.region = region;
	}

	@Override
	public String id() {
		return "azure";
	}

	@Override
	public List<TtsVoice> voices() {
		if (key.isBlank() || region.isBlank()) {
			return List.of();
		}
		return List.of(
			new TtsVoice("vi-VN-HoaiMyNeural", id(), "Hoài My", "vi-VN", "female", "narrator"),
			new TtsVoice("vi-VN-NamMinhNeural", id(), "Nam Minh", "vi-VN", "male", "narrator")
		);
	}

	@Override
	public TtsResult synthesize(TtsRequest request) {
		if (key.isBlank() || region.isBlank()) {
			throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "TTS_PROVIDER_UNAVAILABLE", "Azure Speech chưa được cấu hình.");
		}
		String escaped = request.text().replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
		String ssml = "<speak version='1.0' xml:lang='vi-VN' xmlns='http://www.w3.org/2001/10/synthesis'><voice name='" + request.voiceId() + "'><prosody rate='" + Math.round((request.speakingRate() - 1) * 100) + "%' pitch='" + Math.round(request.pitch()) + "st' volume='" + Math.round(request.volume() * 100) + "%'>" + escaped + "</prosody></voice></speak>";
		HttpRequest httpRequest = HttpRequest.newBuilder(URI.create("https://" + region + ".tts.speech.microsoft.com/cognitiveservices/v1"))
			.header("Ocp-Apim-Subscription-Key", key)
			.header("Content-Type", "application/ssml+xml")
			.header("X-Microsoft-OutputFormat", "audio-24khz-96kbitrate-mono-mp3")
			.POST(HttpRequest.BodyPublishers.ofString(ssml))
			.build();
		try {
			HttpResponse<byte[]> response = client.send(httpRequest, HttpResponse.BodyHandlers.ofByteArray());
			if (response.statusCode() / 100 != 2) {
				throw new ApiException(HttpStatus.BAD_GATEWAY, "TTS_GENERATION_FAILED", "Azure Speech không tạo được audio.");
			}
			return new TtsResult(response.body(), "audio/mpeg", Math.max(800, request.text().length() * 35));
		} catch (InterruptedException exception) {
			Thread.currentThread().interrupt();
			throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "TTS_PROVIDER_UNAVAILABLE", "Yêu cầu Azure Speech bị gián đoạn.");
		} catch (java.io.IOException exception) {
			throw new ApiException(HttpStatus.BAD_GATEWAY, "TTS_GENERATION_FAILED", "Không thể kết nối Azure Speech.");
		}
	}
}
