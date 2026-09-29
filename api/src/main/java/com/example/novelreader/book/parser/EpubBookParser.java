package com.example.novelreader.book.parser;

import com.example.novelreader.book.entity.BookFileType;
import com.example.novelreader.common.exception.ApiException;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.nodes.Entities;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.w3c.dom.NodeList;
import org.xml.sax.SAXException;

@Component
public class EpubBookParser implements BookParser {

	private static final int MAX_ARCHIVE_ENTRIES = 10_000;
	private static final long MAX_EXPANDED_BYTES = 100L * 1024 * 1024;
	private final VietnameseTextPreprocessor textPreprocessor = new VietnameseTextPreprocessor();

	@Override
	public BookFileType fileType() {
		return BookFileType.EPUB;
	}

	@Override
	public ParsedBook parse(Path file) {
		try (ZipFile zipFile = new ZipFile(file.toFile(), StandardCharsets.UTF_8)) {
			validateArchive(zipFile);
			String packagePath = rootFilePath(zipFile);
			org.w3c.dom.Document packageDocument = readXml(zipFile, packagePath);
			Map<String, ManifestItem> manifest = readManifest(packageDocument);
			List<ParsedChapter> chapters = readChapters(zipFile, packagePath, packageDocument, manifest);
			if (chapters.isEmpty()) {
				throw invalidEpub("EPUB không có chapter có thể đọc.");
			}

			Cover cover = readCover(zipFile, packagePath, packageDocument, manifest);
			return new ParsedBook(
				firstText(packageDocument, "title", "Không có tiêu đề"),
				firstText(packageDocument, "creator", "Không rõ tác giả"),
				cover.content(),
				cover.extension(),
				chapters
			);
		} catch (ApiException exception) {
			throw exception;
		} catch (IOException | ParserConfigurationException | SAXException exception) {
			throw invalidEpub("Không thể đọc cấu trúc EPUB.");
		}
	}

	private void validateArchive(ZipFile zipFile) {
		long expandedBytes = 0;
		int entryCount = 0;
		Enumeration<? extends ZipEntry> entries = zipFile.entries();
		while (entries.hasMoreElements()) {
			ZipEntry entry = entries.nextElement();
			if (++entryCount > MAX_ARCHIVE_ENTRIES) {
				throw invalidEpub("EPUB có quá nhiều tệp nội bộ.");
			}
			if (entry.getSize() > 0) {
				expandedBytes += entry.getSize();
			}
			if (expandedBytes > MAX_EXPANDED_BYTES) {
				throw invalidEpub("EPUB vượt quá giới hạn nội dung có thể giải nén.");
			}
		}
	}

	private String rootFilePath(ZipFile zipFile) throws IOException, ParserConfigurationException, SAXException {
		org.w3c.dom.Document container = readXml(zipFile, "META-INF/container.xml");
		NodeList rootFiles = elements(container, "rootfile");
		if (rootFiles.getLength() == 0) {
			throw invalidEpub("EPUB thiếu tệp container.xml hợp lệ.");
		}
		String path = ((org.w3c.dom.Element) rootFiles.item(0)).getAttribute("full-path");
		if (path.isBlank()) {
			throw invalidEpub("EPUB thiếu đường dẫn package.");
		}
		return path;
	}

	private Map<String, ManifestItem> readManifest(org.w3c.dom.Document packageDocument) {
		Map<String, ManifestItem> manifest = new HashMap<>();
		NodeList items = elements(packageDocument, "item");
		for (int index = 0; index < items.getLength(); index++) {
			org.w3c.dom.Element item = (org.w3c.dom.Element) items.item(index);
			String id = item.getAttribute("id");
			String href = item.getAttribute("href");
			if (!id.isBlank() && !href.isBlank()) {
				manifest.put(id, new ManifestItem(href, item.getAttribute("media-type"), item.getAttribute("properties")));
			}
		}
		return manifest;
	}

	private List<ParsedChapter> readChapters(ZipFile zipFile, String packagePath, org.w3c.dom.Document packageDocument, Map<String, ManifestItem> manifest) throws IOException {
		List<ParsedChapter> chapters = new ArrayList<>();
		NodeList itemReferences = elements(packageDocument, "itemref");
		for (int index = 0; index < itemReferences.getLength(); index++) {
			org.w3c.dom.Element itemReference = (org.w3c.dom.Element) itemReferences.item(index);
			ManifestItem item = manifest.get(itemReference.getAttribute("idref"));
			if (item == null || !item.mediaType().contains("html")) {
				continue;
			}
			String entryName = resolveEntry(packagePath, item.href());
			ZipEntry entry = zipFile.getEntry(entryName);
			if (entry == null) {
				throw invalidEpub("EPUB thiếu một chapter trong spine.");
			}
			chapters.add(toChapter(readText(zipFile, entry), chapters.size() + 1));
		}
		return chapters;
	}

	private Cover readCover(ZipFile zipFile, String packagePath, org.w3c.dom.Document packageDocument, Map<String, ManifestItem> manifest) throws IOException {
		ManifestItem coverItem = manifest.values().stream()
			.filter(item -> item.properties().contains("cover-image"))
			.findFirst()
			.orElseGet(() -> coverFromMetadata(packageDocument, manifest));
		if (coverItem == null || !coverItem.mediaType().startsWith("image/")) {
			return Cover.none();
		}

		String entryName = resolveEntry(packagePath, coverItem.href());
		ZipEntry entry = zipFile.getEntry(entryName);
		if (entry == null) {
			return Cover.none();
		}
		try (InputStream input = zipFile.getInputStream(entry)) {
			return new Cover(input.readAllBytes(), extensionOf(entryName));
		}
	}

	private ManifestItem coverFromMetadata(org.w3c.dom.Document packageDocument, Map<String, ManifestItem> manifest) {
		NodeList metadata = elements(packageDocument, "meta");
		for (int index = 0; index < metadata.getLength(); index++) {
			org.w3c.dom.Element meta = (org.w3c.dom.Element) metadata.item(index);
			if ("cover".equalsIgnoreCase(meta.getAttribute("name"))) {
				return manifest.get(meta.getAttribute("content"));
			}
		}
		return null;
	}

	private ParsedChapter toChapter(String xhtml, int chapterNumber) {
		Document document = Jsoup.parse(xhtml);
		Element heading = document.selectFirst("h1, h2, h3, h4, h5, h6");
		String title = heading == null ? "Chương " + chapterNumber : textPreprocessor.normalizeInline(heading.text());
		List<String> paragraphs = document.select("p, blockquote, li").stream()
			.map(Element::text)
			.map(textPreprocessor::normalizeInline)
			.filter(text -> !text.isBlank())
			.toList();
		if (paragraphs.isEmpty()) {
			String text = textPreprocessor.normalizeInline(document.body().text());
			if (!text.isBlank()) {
				paragraphs = List.of(text);
			}
		}
		if (paragraphs.isEmpty()) {
			throw invalidEpub("Một chapter EPUB không có nội dung văn bản.");
		}

		Document.OutputSettings outputSettings = new Document.OutputSettings().escapeMode(Entities.EscapeMode.xhtml);
		String contentHtml = paragraphs.stream()
			.map(paragraph -> "<p>" + Entities.escape(paragraph, outputSettings) + "</p>")
			.reduce((first, second) -> first + "\n" + second)
			.orElseThrow();
		return new ParsedChapter(title.isBlank() ? "Chương " + chapterNumber : title, contentHtml, String.join("\n\n", paragraphs));
	}

	private org.w3c.dom.Document readXml(ZipFile zipFile, String entryName) throws IOException, ParserConfigurationException, SAXException {
		ZipEntry entry = zipFile.getEntry(entryName);
		if (entry == null) {
			throw invalidEpub("EPUB thiếu tệp bắt buộc: " + entryName);
		}
		DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
		factory.setNamespaceAware(true);
		factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
		factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
		factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
		factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
		factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
		factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
		try (InputStream input = zipFile.getInputStream(entry)) {
			return factory.newDocumentBuilder().parse(input);
		}
	}

	private String readText(ZipFile zipFile, ZipEntry entry) throws IOException {
		try (InputStream input = zipFile.getInputStream(entry)) {
			return new String(input.readAllBytes(), StandardCharsets.UTF_8);
		}
	}

	private String resolveEntry(String packagePath, String href) {
		String fileReference = href.substring(0, href.indexOf('#') >= 0 ? href.indexOf('#') : href.length());
		String packageDirectory = packagePath.contains("/") ? packagePath.substring(0, packagePath.lastIndexOf('/') + 1) : "";
		Path resolved = Path.of(packageDirectory).resolve(URLDecoder.decode(fileReference, StandardCharsets.UTF_8)).normalize();
		String entryName = resolved.toString().replace('\\', '/');
		if (resolved.isAbsolute() || entryName.startsWith("../") || entryName.equals("..")) {
			throw invalidEpub("EPUB chứa đường dẫn tệp không hợp lệ.");
		}
		return entryName;
	}

	private NodeList elements(org.w3c.dom.Document document, String localName) {
		NodeList namespaced = document.getElementsByTagNameNS("*", localName);
		return namespaced.getLength() > 0 ? namespaced : document.getElementsByTagName(localName);
	}

	private String firstText(org.w3c.dom.Document document, String localName, String fallback) {
		NodeList nodes = elements(document, localName);
		for (int index = 0; index < nodes.getLength(); index++) {
			String value = textPreprocessor.normalizeInline(nodes.item(index).getTextContent());
			if (!value.isBlank()) {
				return value;
			}
		}
		return fallback;
	}

	private String extensionOf(String path) {
		int extensionIndex = path.lastIndexOf('.');
		if (extensionIndex < path.lastIndexOf('/')) {
			return ".jpg";
		}
		String extension = path.substring(extensionIndex).toLowerCase(Locale.ROOT);
		return extension.matches("\\.[a-z0-9]{1,10}") ? extension : ".jpg";
	}

	private ApiException invalidEpub(String message) {
		return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_EPUB", message);
	}

	private record ManifestItem(String href, String mediaType, String properties) {
	}

	private record Cover(byte[] content, String extension) {
		private static Cover none() {
			return new Cover(null, null);
		}
	}
}
