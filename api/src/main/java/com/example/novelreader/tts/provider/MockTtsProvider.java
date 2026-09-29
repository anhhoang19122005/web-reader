package com.example.novelreader.tts.provider;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class MockTtsProvider implements TtsProvider {

	private static final int SAMPLE_RATE = 8_000;

	@Override
	public String id() {
		return "mock";
	}

	@Override
	public List<TtsVoice> voices() {
		return List.of(
			new TtsVoice("vi-mock-narrator", id(), "Người kể chuyện (demo)", "vi-VN", "neutral", "narrator")
		);
	}

	@Override
	public TtsResult synthesize(TtsRequest request) {
		int durationMs = Math.max(800, request.text().length() * 35);
		return new TtsResult(wavSilence(durationMs), "audio/wav", durationMs);
	}

	private byte[] wavSilence(int durationMs) {
		int sampleCount = SAMPLE_RATE * durationMs / 1_000;
		int dataLength = sampleCount * 2;
		try (ByteArrayOutputStream output = new ByteArrayOutputStream(44 + dataLength)) {
			output.writeBytes("RIFF".getBytes());
			writeInt(output, 36 + dataLength);
			output.writeBytes("WAVEfmt ".getBytes());
			writeInt(output, 16);
			writeShort(output, (short) 1);
			writeShort(output, (short) 1);
			writeInt(output, SAMPLE_RATE);
			writeInt(output, SAMPLE_RATE * 2);
			writeShort(output, (short) 2);
			writeShort(output, (short) 16);
			output.writeBytes("data".getBytes());
			writeInt(output, dataLength);
			output.write(new byte[dataLength]);
			return output.toByteArray();
		} catch (IOException exception) {
			throw new IllegalStateException("Không thể tạo audio demo.", exception);
		}
	}

	private void writeInt(ByteArrayOutputStream output, int value) {
		output.write(value & 0xff);
		output.write((value >>> 8) & 0xff);
		output.write((value >>> 16) & 0xff);
		output.write((value >>> 24) & 0xff);
	}

	private void writeShort(ByteArrayOutputStream output, short value) {
		output.write(value & 0xff);
		output.write((value >>> 8) & 0xff);
	}
}
