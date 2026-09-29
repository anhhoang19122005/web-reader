package com.example.novelreader.book.parser;

import com.example.novelreader.book.entity.BookFileType;
import com.example.novelreader.common.exception.ApiException;
import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.jsoup.nodes.Entities;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class PdfBookParser implements BookParser {

	private final VietnameseTextPreprocessor textPreprocessor = new VietnameseTextPreprocessor();

	@Override
	public BookFileType fileType() {
		return BookFileType.PDF;
	}

	@Override
	public ParsedBook parse(Path file) {
		try (PDDocument document = Loader.loadPDF(file.toFile())) {
			if (document.isEncrypted() && !document.getCurrentAccessPermission().canExtractContent()) {
				throw invalidPdf("PDF bị mã hóa và không cho phép trích xuất văn bản.");
			}
			PDFTextStripper stripper = new PDFTextStripper();
			stripper.setSortByPosition(true);
			String text = textPreprocessor.normalizeParagraphs(stripper.getText(document).replace("\u0000", ""));
			if (text.isBlank()) {
				throw invalidPdf("PDF không có lớp văn bản để đọc.");
			}
			var information = document.getDocumentInformation();
			return new ParsedBook(
				information.getTitle() == null || information.getTitle().isBlank() ? "Tài liệu PDF" : information.getTitle().trim(),
				information.getAuthor() == null || information.getAuthor().isBlank() ? "Không rõ tác giả" : information.getAuthor().trim(),
				null,
				null,
				splitChapters(text)
			);
		} catch (ApiException exception) {
			throw exception;
		} catch (IOException | RuntimeException exception) {
			throw invalidPdf("Không thể đọc nội dung PDF.");
		}
	}

	private List<ParsedChapter> splitChapters(String text) {
		List<ParsedChapter> chapters = new ArrayList<>();
		String title = "Chương 1";
		StringBuilder content = new StringBuilder();
		for (String line : text.split("\\R")) {
			String normalized = line.trim();
			if (isChapterHeading(normalized) && content.toString().isBlank()) {
				title = normalized;
				continue;
			}
			if (isChapterHeading(normalized) && !content.toString().isBlank()) {
				chapters.add(toChapter(title, content.toString(), chapters.size() + 1));
				title = normalized;
				content.setLength(0);
				continue;
			}
			content.append(line).append('\n');
		}
		if (!content.toString().isBlank()) {
			chapters.add(toChapter(title, content.toString(), chapters.size() + 1));
		}
		return chapters;
	}

	private boolean isChapterHeading(String line) {
		return line.matches("(?i)^(chương|chapter|chap\\.?|phần|part)\\s+\\d+.*$");
	}

	private ParsedChapter toChapter(String title, String content, int number) {
		List<String> paragraphs = List.of(content.trim().split("(?:\\R\\s*){2,}"))
			.stream()
			.map(textPreprocessor::normalizeInline)
			.filter(value -> !value.isBlank())
			.toList();
		if (paragraphs.isEmpty()) {
			throw invalidPdf("PDF có chapter rỗng.");
		}
		String plainText = String.join("\n\n", paragraphs);
		String contentHtml = paragraphs.stream()
			.map(value -> "<p>" + Entities.escape(value) + "</p>")
			.reduce((first, second) -> first + "\n" + second)
			.orElseThrow();
		return new ParsedChapter(title.isBlank() ? "Chương " + number : title, contentHtml, plainText);
	}

	private ApiException invalidPdf(String message) {
		return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_PDF", message);
	}
}
