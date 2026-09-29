package com.example.novelreader.tts.provider;

import com.example.novelreader.common.exception.ApiException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "app.tts.edge-enabled", havingValue = "true")
public class EdgeTtsProvider implements TtsProvider {

	private final String pythonCommand;

	public EdgeTtsProvider(@Value("${app.tts.edge-python-command:python}") String pythonCommand) {
		this.pythonCommand = pythonCommand;
	}

	@Override
	public String id() {
		return "edge";
	}

	@Override
	public List<TtsVoice> voices() {
		return List.of(
			new TtsVoice("vi-VN-HoaiMyNeural", id(), "Hoài My · Edge", "vi-VN", "female", "narrator"),
			new TtsVoice("vi-VN-NamMinhNeural", id(), "Nam Minh · Edge", "vi-VN", "male", "narrator")
		);
	}

	@Override
	public TtsResult synthesize(TtsRequest request) {
		for (int attempt = 1; attempt <= 2; attempt++) {
			try {
				return synthesizeOnce(request);
			} catch (ApiException exception) {
				if (attempt == 2 || (exception.getStatus() != HttpStatus.BAD_GATEWAY && exception.getStatus() != HttpStatus.GATEWAY_TIMEOUT)) {
					throw exception;
				}
				try {
					Thread.sleep(500);
				} catch (InterruptedException interrupted) {
					Thread.currentThread().interrupt();
					throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "TTS_PROVIDER_UNAVAILABLE", "Yêu cầu Edge-TTS bị gián đoạn.");
				}
			}
		}
		throw new ApiException(HttpStatus.BAD_GATEWAY, "TTS_GENERATION_FAILED", "Edge-TTS không tạo được audio.");
	}

	private TtsResult synthesizeOnce(TtsRequest request) {
		Path input = null;
		Path output = null;
		try {
			input = Files.createTempFile("novel-reader-edge-", ".txt");
			output = Files.createTempFile("novel-reader-edge-", ".mp3");
			Files.writeString(input, request.text(), StandardCharsets.UTF_8);
			Process process = new ProcessBuilder(
				pythonCommand, "-m", "edge_tts",
				"--voice", request.voiceId(),
				"--file", input.toString(),
				"--rate=" + rate(request.speakingRate()),
				"--volume=" + volume(request.volume()),
				"--pitch=" + pitch(request.pitch()),
				"--write-media", output.toString()
			).redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start();
			if (!process.waitFor(Duration.ofSeconds(180).toMillis(), TimeUnit.MILLISECONDS)) {
				process.destroyForcibly();
				throw new ApiException(HttpStatus.GATEWAY_TIMEOUT, "TTS_GENERATION_FAILED", "Edge-TTS tạo audio quá lâu.");
			}
			if (process.exitValue() != 0 || !Files.exists(output) || Files.size(output) == 0) {
				throw new ApiException(HttpStatus.BAD_GATEWAY, "TTS_GENERATION_FAILED", "Edge-TTS không tạo được audio. Hãy kiểm tra Python và kết nối mạng.");
			}
			return new TtsResult(Files.readAllBytes(output), "audio/mpeg", Math.max(800, request.text().length() * 35));
		} catch (IOException exception) {
			throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "TTS_PROVIDER_UNAVAILABLE", "Chưa cài edge-tts hoặc không tìm thấy Python.");
		} catch (InterruptedException exception) {
			Thread.currentThread().interrupt();
			throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "TTS_PROVIDER_UNAVAILABLE", "Yêu cầu Edge-TTS bị gián đoạn.");
		} finally {
			if (input != null) {
				try {
					Files.deleteIfExists(input);
				} catch (IOException ignored) {
					// Temporary input can be cleaned by the operating system.
				}
			}
			if (output != null) {
				try {
					Files.deleteIfExists(output);
				} catch (IOException ignored) {
					// Temporary output can be cleaned by the operating system.
				}
			}
		}
	}

	private String rate(double speakingRate) {
		return signedPercent((speakingRate - 1) * 100);
	}

	private String volume(double value) {
		return signedPercent((value - 1) * 100);
	}

	private String pitch(double value) {
		return signed(Math.round(value)) + "Hz";
	}

	private String signedPercent(double value) {
		return signed(Math.round(value)) + "%";
	}

	private String signed(long value) {
		return value >= 0 ? "+" + value : Long.toString(value);
	}
}
