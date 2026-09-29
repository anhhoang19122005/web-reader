package com.example.novelreader.book;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import com.example.novelreader.book.entity.Book;
import com.example.novelreader.book.entity.Chapter;
import com.example.novelreader.book.repository.BookRepository;
import com.example.novelreader.book.repository.ChapterRepository;
import com.example.novelreader.tts.entity.AudioChunk;
import com.example.novelreader.tts.repository.AudioChunkRepository;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BookUploadIntegrationTests {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private BookRepository bookRepository;

	@Autowired
	private ChapterRepository chapterRepository;

	@Autowired
	private AudioChunkRepository audioChunkRepository;

	@Test
	void uploadsEpubAndKeepsVietnameseParagraphsAsChapters() throws Exception {
		MockMultipartFile file = new MockMultipartFile("file", "truyen-viet.epub", "application/epub+zip", epubBytes());

		mockMvc.perform(multipart("/api/books/upload").file(file).contextPath("/api"))
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.title").value("Truyện tiếng Việt"))
			.andExpect(jsonPath("$.chapterCount").value(2));

		mockMvc.perform(get("/api/books").contextPath("/api"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$[0].title").value("Truyện tiếng Việt"))
			.andExpect(jsonPath("$[0].chapterCount").value(2))
			.andExpect(jsonPath("$[0].hasCover").value(true));

		UUID bookId = bookRepository.findAll().stream().map(Book::getId).findFirst().orElseThrow();
		UUID chapterId = chapterRepository.findAll().stream().map(Chapter::getId).findFirst().orElseThrow();
		mockMvc.perform(get("/api/books/{bookId}/chapters/{chapterId}", bookId, chapterId).contextPath("/api"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.plainText").value("Trời đã tối.\n\nLâm Phong chậm rãi bước vào đại điện."))
			.andExpect(jsonPath("$.contentHtml").value("<p>Trời đã tối.</p>\n<p>Lâm Phong chậm rãi bước vào đại điện.</p>"));

		mockMvc.perform(put("/api/reader/progress/{bookId}", bookId).contextPath("/api")
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"chapterId\":\"" + chapterId + "\",\"characterPosition\":12}"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.chapterId").value(chapterId.toString()))
			.andExpect(jsonPath("$.characterPosition").value(12));

		mockMvc.perform(get("/api/reader/progress/{bookId}", bookId).contextPath("/api"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.characterPosition").value(12));

		mockMvc.perform(get("/api/tts/voices").contextPath("/api"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$[0].id").value("vi-mock-narrator"));

		mockMvc.perform(get("/api/tts/chunks/{chapterId}", chapterId).contextPath("/api"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$[0].text").value("Trời đã tối. Lâm Phong chậm rãi bước vào đại điện."));

		String ttsRequest = "{\"chapterId\":\"" + chapterId + "\",\"chunkIndex\":0,\"voiceId\":\"vi-mock-narrator\",\"speakingRate\":1.0,\"pitch\":0,\"volume\":1.0}";
		mockMvc.perform(post("/api/tts/generate").contextPath("/api").contentType(MediaType.APPLICATION_JSON).content(ttsRequest))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.cached").value(false))
			.andExpect(jsonPath("$.mimeType").value("audio/wav"));
		mockMvc.perform(post("/api/tts/generate").contextPath("/api").contentType(MediaType.APPLICATION_JSON).content(ttsRequest))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.cached").value(true));
		AudioChunk audio = audioChunkRepository.findAll().stream().findFirst().orElseThrow();
		mockMvc.perform(get("/api/tts/audio/{audioId}", audio.getId()).contextPath("/api"))
			.andExpect(status().isOk())
			.andExpect(result -> org.junit.jupiter.api.Assertions.assertTrue(result.getResponse().getContentType().startsWith("audio/wav")));

		mockMvc.perform(post("/api/reader/bookmarks/{bookId}", bookId).contextPath("/api").contentType(MediaType.APPLICATION_JSON)
				.content("{\"chapterId\":\"" + chapterId + "\",\"characterPosition\":12,\"note\":\"Cảnh mở đầu\"}"))
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.note").value("Cảnh mở đầu"));
		mockMvc.perform(get("/api/reader/bookmarks/{bookId}", bookId).contextPath("/api"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$[0].characterPosition").value(12));
	}

	@Test
	void uploadsTextPdfAndCreatesAChapter() throws Exception {
		MockMultipartFile file = new MockMultipartFile("file", "sample.pdf", "application/pdf", pdfBytes());

		mockMvc.perform(multipart("/api/books/upload").file(file).contextPath("/api"))
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.title").value("Tài liệu PDF thử nghiệm"))
			.andExpect(jsonPath("$.chapterCount").value(1));
	}

	private byte[] pdfBytes() throws IOException {
		try (PDDocument document = new PDDocument(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
			document.getDocumentInformation().setTitle("Tài liệu PDF thử nghiệm");
			PDPage page = new PDPage();
			document.addPage(page);
			try (PDPageContentStream content = new PDPageContentStream(document, page)) {
				content.beginText();
				content.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
				content.newLineAtOffset(72, 720);
				content.showText("Chapter 1");
				content.newLineAtOffset(0, -24);
				content.showText("The sky grew dark.");
				content.endText();
			}
			document.save(bytes);
			return bytes.toByteArray();
		}
	}

	private byte[] epubBytes() throws IOException {
		try (ByteArrayOutputStream bytes = new ByteArrayOutputStream(); ZipOutputStream zip = new ZipOutputStream(bytes)) {
			write(zip, "META-INF/container.xml", """
				<?xml version="1.0" encoding="UTF-8"?>
				<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
				  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
				</container>
				""");
			write(zip, "OEBPS/content.opf", """
				<?xml version="1.0" encoding="UTF-8"?>
				<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
				  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
				    <dc:title>Truyện tiếng Việt</dc:title>
				    <dc:creator>Tác giả thử nghiệm</dc:creator>
				  </metadata>
				  <manifest>
				    <item id="chapter-1" href="chapters/one.xhtml" media-type="application/xhtml+xml"/>
				    <item id="chapter-2" href="chapters/two.xhtml" media-type="application/xhtml+xml"/>
				    <item id="cover" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
				  </manifest>
				  <spine><itemref idref="chapter-1"/><itemref idref="chapter-2"/></spine>
				</package>
				""");
			write(zip, "OEBPS/chapters/one.xhtml", """
				<html><body><h1>Chương 1</h1><p>Trời đã tối.</p><p>Lâm Phong chậm rãi bước vào đại điện.</p></body></html>
				""");
			write(zip, "OEBPS/chapters/two.xhtml", """
				<html><body><h1>Chương 2</h1><p>— Ngươi cuối cùng cũng tới.</p></body></html>
				""");
			write(zip, "OEBPS/images/cover.jpg", "cover" );
			zip.finish();
			return bytes.toByteArray();
		}
	}

	private void write(ZipOutputStream zip, String name, String content) throws IOException {
		zip.putNextEntry(new ZipEntry(name));
		zip.write(content.getBytes(StandardCharsets.UTF_8));
		zip.closeEntry();
	}
}
