package com.example.novelreader.tts;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.novelreader.tts.service.TextChunk;
import com.example.novelreader.tts.service.TextChunker;
import java.util.List;
import org.junit.jupiter.api.Test;

class TextChunkerTest {

	@Test
	void keepsVietnameseTextOrderedWithBoundedOffsets() {
		String text = "Chương một bắt đầu. Trời đã tối!\n\nLâm Phong bước vào đại điện, rồi nhìn quanh.";
		List<TextChunk> chunks = new TextChunker().chunk(text);

		assertFalse(chunks.isEmpty());
		assertEquals(0, chunks.getFirst().chunkIndex());
		for (int index = 0; index < chunks.size(); index++) {
			TextChunk chunk = chunks.get(index);
			assertEquals(index, chunk.chunkIndex());
			assertTrue(chunk.text().length() <= 800);
			assertTrue(chunk.startCharacter() >= 0 && chunk.endCharacter() <= text.length());
			assertTrue(chunk.startCharacter() < chunk.endCharacter());
			if (index > 0) assertTrue(chunk.startCharacter() >= chunks.get(index - 1).endCharacter());
		}
		assertTrue(chunks.getFirst().text().startsWith("Chương một bắt đầu."));
	}
}
