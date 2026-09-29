package com.example.novelreader.tts.provider;

import com.example.novelreader.common.exception.ApiException;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class FptSpeechTtsProvider implements TtsProvider {

	private static final Pattern ASYNC_URL = Pattern.compile("\"async\"\\s*:\\s*\"([^\"]+)\"");
	private final String apiKey;
	private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

	public FptSpeechTtsProvider(@Value("${app.tts.fpt-api-key:}") String apiKey) {
		this.apiKey = apiKey;
	}

	@Override
	public String id() {
		return "fpt";
	}

	@Override
	public List<TtsVoice> voices() {
		if (apiKey.isBlank()) return List.of();
		return List.of(
			new TtsVoice("banmai", id(), "Ban Mai · nữ miền Bắc", "vi-VN", "female", "narrator"),
			new TtsVoice("lannhi", id(), "Lan Nhi · nữ miền Nam", "vi-VN", "female", "soft"),
			new TtsVoice("leminh", id(), "Lê Minh · nam miền Bắc", "vi-VN", "male", "narrator"),
			new TtsVoice("giahuy", id(), "Gia Huy · nam miền Trung", "vi-VN", "male", "deep")
		);
	}

	@Override
	public TtsResult synthesize(TtsRequest request) {
		if (apiKey.isBlank()) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "TTS_PROVIDER_UNAVAILABLE", "FPT.AI chưa được cấu hình.");
		HttpRequest generate = HttpRequest.newBuilder(URI.create("https://api.fpt.ai/hmi/tts/v5"))
			.timeout(Duration.ofSeconds(30))
			.header("api_key", apiKey)
			.header("voice", request.voiceId())
			.header("speed", Integer.toString(speed(request.speakingRate())))
			.header("format", "mp3")
			.header("Content-Type", "text/plain; charset=utf-8")
			.POST(HttpRequest.BodyPublishers.ofString(request.text()))
			.build();
		try {
			HttpResponse<String> response = client.send(generate, HttpResponse.BodyHandlers.ofString());
			if (response.statusCode() / 100 != 2) throw new ApiException(HttpStatus.BAD_GATEWAY, "TTS_GENERATION_FAILED", "FPT.AI không tạo được audio.");
			String audioUrl = asyncUrl(response.body());
			byte[] audio = download(audioUrl);
			return new TtsResult(audio, "audio/mpeg", Math.max(800, request.text().length() * 35));
		} catch (InterruptedException exception) {
			Thread.currentThread().interrupt();
			throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "TTS_PROVIDER_UNAVAILABLE", "Yêu cầu FPT.AI bị gián đoạn.");
		} catch (IOException exception) {
			throw new ApiException(HttpStatus.BAD_GATEWAY, "TTS_GENERATION_FAILED", "Không thể kết nối FPT.AI.");
		}
	}

	private byte[] download(String audioUrl) throws IOException, InterruptedException {
		HttpRequest request = HttpRequest.newBuilder(URI.create(audioUrl)).timeout(Duration.ofSeconds(10)).GET().build();
		for (int attempt = 0; attempt < 20; attempt++) {
			HttpResponse<byte[]> response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
			String contentType = response.headers().firstValue("content-type").orElse("");
			if (response.statusCode() / 100 == 2 && !contentType.contains("text") && response.body().length > 100) return response.body();
			Thread.sleep(2_000);
		}
		throw new ApiException(HttpStatus.GATEWAY_TIMEOUT, "TTS_GENERATION_FAILED", "FPT.AI tạo audio quá lâu.");
	}

	private String asyncUrl(String body) {
		Matcher matcher = ASYNC_URL.matcher(body);
		if (!matcher.find()) throw new ApiException(HttpStatus.BAD_GATEWAY, "TTS_GENERATION_FAILED", "FPT.AI không trả về đường dẫn audio.");
		return matcher.group(1);
	}

	private int speed(double speakingRate) {
		return Math.max(-3, Math.min(3, (int) Math.round((speakingRate - 1) * 3)));
	}
}
