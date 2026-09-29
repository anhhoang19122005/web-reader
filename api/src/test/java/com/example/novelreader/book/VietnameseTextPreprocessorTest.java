package com.example.novelreader.book;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.example.novelreader.book.parser.VietnameseTextPreprocessor;
import org.junit.jupiter.api.Test;

class VietnameseTextPreprocessorTest {

	@Test
	void keepsVietnameseDiacriticsAndParagraphBreaks() {
		VietnameseTextPreprocessor preprocessor = new VietnameseTextPreprocessor();

		assertEquals("Chương 10. Lâm Phong bước vào.", preprocessor.normalizeInline("Chương 10.\n Lâm Phong bước vào."));
		assertEquals("Trời đã tối.\n\nLâm Phong bước vào.", preprocessor.normalizeParagraphs("Trời đã tối.\r\n\r\nLâm Phong bước vào."));
	}
}
