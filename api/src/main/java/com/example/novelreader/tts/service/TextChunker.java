package com.example.novelreader.tts.service;

import java.text.BreakIterator;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class TextChunker {

	private static final int MAX_CHARACTERS = 800;

	public List<TextChunk> chunk(String text) {
		List<String> drafts = new ArrayList<>();
		String pending = "";
		for (String paragraph : text.trim().split("\\R\\s*\\R")) {
			String value = paragraph.trim();
			if (value.isBlank()) {
				continue;
			}
			for (String sentence : sentences(value)) {
				if (sentence.length() > MAX_CHARACTERS) {
					if (!pending.isBlank()) {
						drafts.add(pending.trim());
						pending = "";
					}
					for (String part : words(sentence)) {
						drafts.add(part);
					}
				} else if (pending.length() + sentence.length() + 1 <= MAX_CHARACTERS) {
					pending = pending.isBlank() ? sentence : pending + " " + sentence;
				} else {
					drafts.add(pending.trim());
					pending = sentence;
				}
			}
			if (!pending.isBlank() && pending.length() >= 300) {
				drafts.add(pending.trim());
				pending = "";
			}
		}
		if (!pending.isBlank()) {
			drafts.add(pending.trim());
		}
		List<TextChunk> chunks = new ArrayList<>();
		int searchFrom = 0;
		for (int index = 0; index < drafts.size(); index++) {
			String draft = drafts.get(index);
			int start = text.indexOf(draft, searchFrom);
			if (start < 0) {
				start = searchFrom;
			}
			int end = Math.min(text.length(), start + draft.length());
			chunks.add(new TextChunk(index, draft, start, end));
			searchFrom = end;
		}
		return chunks;
	}

	private List<String> sentences(String paragraph) {
		List<String> result = new ArrayList<>();
		BreakIterator iterator = BreakIterator.getSentenceInstance(Locale.forLanguageTag("vi-VN"));
		iterator.setText(paragraph);
		int start = iterator.first();
		for (int end = iterator.next(); end != BreakIterator.DONE; start = end, end = iterator.next()) {
			String sentence = paragraph.substring(start, end).trim();
			if (!sentence.isBlank()) {
				result.add(sentence);
			}
		}
		return result.isEmpty() ? List.of(paragraph) : result;
	}

	private List<String> words(String sentence) {
		List<String> parts = new ArrayList<>();
		for (int start = 0; start < sentence.length(); start += MAX_CHARACTERS) {
			parts.add(sentence.substring(start, Math.min(sentence.length(), start + MAX_CHARACTERS)).trim());
		}
		return parts;
	}
}
