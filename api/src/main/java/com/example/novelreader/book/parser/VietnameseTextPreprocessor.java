package com.example.novelreader.book.parser;

import java.text.Normalizer;

/** Keeps Unicode Vietnamese text intact while removing layout-only whitespace. */
public final class VietnameseTextPreprocessor {

	public String normalizeInline(String value) {
		return Normalizer.normalize(value, Normalizer.Form.NFC).replaceAll("\\s+", " ").trim();
	}

	public String normalizeParagraphs(String value) {
		return Normalizer.normalize(value, Normalizer.Form.NFC).replace("\r\n", "\n").replaceAll("\\n[ \\t]*\\n+", "\n\n").trim();
	}
}
