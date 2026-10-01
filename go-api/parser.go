package readerapi

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	stdhtml "html"
	"io"
	"net/url"
	"os"
	"path"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/ledongthuc/pdf"
	"golang.org/x/net/html"
	"golang.org/x/text/unicode/norm"
)

const (
	maxArchiveEntries = 10_000
	maxExpandedBytes  = 100 << 20
)

var chapterHeading = regexp.MustCompile(`(?i)^(chương|chapter|chap\.?|phần|part)\s+\d+.*$`)

type parsedBook struct {
	Title          string
	Author         string
	Cover          []byte
	CoverExtension string
	Chapters       []parsedChapter
}

type parsedChapter struct {
	Title       string
	ContentHTML string
	PlainText   string
}

type epubContainer struct {
	Rootfiles []struct {
		FullPath string `xml:"full-path,attr"`
	} `xml:"rootfiles>rootfile"`
}

type epubPackage struct {
	Metadata struct {
		Title   []string `xml:"title"`
		Creator []string `xml:"creator"`
		Meta    []struct {
			Name    string `xml:"name,attr"`
			Content string `xml:"content,attr"`
		} `xml:"meta"`
	} `xml:"metadata"`
	Manifest []struct {
		ID         string `xml:"id,attr"`
		Href       string `xml:"href,attr"`
		MediaType  string `xml:"media-type,attr"`
		Properties string `xml:"properties,attr"`
	} `xml:"manifest>item"`
	Spine []struct {
		IDRef string `xml:"idref,attr"`
	} `xml:"spine>itemref"`
}

func parseBook(filename string, content []byte) (parsedBook, *apiError) {
	lower := strings.ToLower(filename)
	switch {
	case strings.HasSuffix(lower, ".epub"):
		book, err := parseEPUB(content)
		if err != nil {
			return parsedBook{}, err
		}
		return book, nil
	case strings.HasSuffix(lower, ".pdf"):
		book, err := parsePDF(content)
		if err != nil {
			return parsedBook{}, err
		}
		return book, nil
	default:
		return parsedBook{}, newAPIError(415, "UNSUPPORTED_FILE_TYPE", "Chỉ hỗ trợ tệp EPUB hoặc PDF.")
	}
}

func parseEPUB(content []byte) (parsedBook, *apiError) {
	reader, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		return parsedBook{}, newAPIError(400, "INVALID_EPUB", "Không thể đọc cấu trúc EPUB.")
	}
	if len(reader.File) > maxArchiveEntries {
		return parsedBook{}, newAPIError(400, "INVALID_EPUB", "EPUB có quá nhiều tệp nội bộ.")
	}
	var expanded uint64
	entries := make(map[string]*zip.File, len(reader.File))
	for _, file := range reader.File {
		expanded += file.UncompressedSize64
		if expanded > maxExpandedBytes {
			return parsedBook{}, newAPIError(400, "INVALID_EPUB", "EPUB vượt quá giới hạn nội dung có thể giải nén.")
		}
		entries[file.Name] = file
	}

	containerBytes, err := readZipEntry(entries, "META-INF/container.xml")
	if err != nil {
		return parsedBook{}, newAPIError(400, "INVALID_EPUB", "EPUB thiếu tệp container.xml hợp lệ.")
	}
	var container epubContainer
	if xml.Unmarshal(containerBytes, &container) != nil || len(container.Rootfiles) == 0 || container.Rootfiles[0].FullPath == "" {
		return parsedBook{}, newAPIError(400, "INVALID_EPUB", "EPUB thiếu đường dẫn package.")
	}
	packagePath := container.Rootfiles[0].FullPath
	packageBytes, err := readZipEntry(entries, packagePath)
	if err != nil {
		return parsedBook{}, newAPIError(400, "INVALID_EPUB", "EPUB thiếu package.")
	}
	var pkg epubPackage
	if xml.Unmarshal(packageBytes, &pkg) != nil {
		return parsedBook{}, newAPIError(400, "INVALID_EPUB", "Không thể đọc package EPUB.")
	}

	manifest := map[string]struct {
		Href, MediaType, Properties string
	}{}
	for _, item := range pkg.Manifest {
		if item.ID != "" && item.Href != "" {
			manifest[item.ID] = struct {
				Href, MediaType, Properties string
			}{item.Href, item.MediaType, item.Properties}
		}
	}
	chapters := make([]parsedChapter, 0, len(pkg.Spine))
	for _, ref := range pkg.Spine {
		item, exists := manifest[ref.IDRef]
		if !exists || !strings.Contains(item.MediaType, "html") {
			continue
		}
		entryName, ok := resolveEPUBPath(packagePath, item.Href)
		if !ok {
			return parsedBook{}, newAPIError(400, "INVALID_EPUB", "EPUB chứa đường dẫn tệp không hợp lệ.")
		}
		chapterBytes, err := readZipEntry(entries, entryName)
		if err != nil {
			return parsedBook{}, newAPIError(400, "INVALID_EPUB", "EPUB thiếu một chapter trong spine.")
		}
		chapter, chapterErr := htmlChapter(chapterBytes, len(chapters)+1)
		if chapterErr != nil {
			return parsedBook{}, chapterErr
		}
		chapters = append(chapters, chapter)
	}
	if len(chapters) == 0 {
		return parsedBook{}, newAPIError(400, "INVALID_EPUB", "EPUB không có chapter có thể đọc.")
	}

	book := parsedBook{
		Title:    firstNonEmpty(pkg.Metadata.Title, "Không có tiêu đề"),
		Author:   firstNonEmpty(pkg.Metadata.Creator, "Không rõ tác giả"),
		Chapters: chapters,
	}
	coverID := ""
	for id, item := range manifest {
		if strings.Contains(item.Properties, "cover-image") {
			coverID = id
			break
		}
	}
	if coverID == "" {
		for _, meta := range pkg.Metadata.Meta {
			if strings.EqualFold(meta.Name, "cover") {
				coverID = meta.Content
				break
			}
		}
	}
	if cover, exists := manifest[coverID]; exists && strings.HasPrefix(cover.MediaType, "image/") {
		if entryName, ok := resolveEPUBPath(packagePath, cover.Href); ok {
			if coverBytes, err := readZipEntry(entries, entryName); err == nil {
				book.Cover = coverBytes
				book.CoverExtension = fileExtension(entryName, ".jpg")
			}
		}
	}
	return book, nil
}

func parsePDF(content []byte) (parsedBook, *apiError) {
	file, err := os.CreateTemp("", "novel-reader-*.pdf")
	if err != nil {
		return parsedBook{}, newAPIError(500, "UPLOAD_FAILED", "Không thể xử lý PDF.")
	}
	name := file.Name()
	defer os.Remove(name)
	if _, err := file.Write(content); err != nil || file.Close() != nil {
		return parsedBook{}, newAPIError(500, "UPLOAD_FAILED", "Không thể xử lý PDF.")
	}
	pdfFile, reader, err := pdf.Open(name)
	if err != nil {
		return parsedBook{}, newAPIError(400, "INVALID_PDF", "Không thể đọc nội dung PDF.")
	}
	defer pdfFile.Close()
	var pages []string
	for pageNumber := 1; pageNumber <= reader.NumPage(); pageNumber++ {
		page := reader.Page(pageNumber)
		if page.V.IsNull() {
			continue
		}
		text, err := page.GetPlainText(nil)
		if err != nil {
			return parsedBook{}, newAPIError(400, "INVALID_PDF", "Không thể đọc nội dung PDF.")
		}
		pages = append(pages, text)
	}
	text := normalizeParagraphs(strings.Join(pages, "\n\n"))
	if text == "" {
		return parsedBook{}, newAPIError(400, "INVALID_PDF", "PDF không có lớp văn bản để đọc.")
	}
	info := reader.Trailer().Key("Info")
	title := normalizeInline(info.Key("Title").Text())
	author := normalizeInline(info.Key("Author").Text())
	if title == "" {
		title = "Tài liệu PDF"
	}
	if author == "" {
		author = "Không rõ tác giả"
	}
	chapters, chapterErr := splitPDFChapters(text)
	if chapterErr != nil {
		return parsedBook{}, chapterErr
	}
	return parsedBook{Title: title, Author: author, Chapters: chapters}, nil
}

func splitPDFChapters(text string) ([]parsedChapter, *apiError) {
	chapters := []parsedChapter{}
	title := "Chương 1"
	var content strings.Builder
	for _, line := range strings.Split(text, "\n") {
		normalized := strings.TrimSpace(line)
		if chapterHeading.MatchString(normalized) && strings.TrimSpace(content.String()) == "" {
			title = normalized
			continue
		}
		if chapterHeading.MatchString(normalized) {
			chapter, err := textChapter(title, content.String(), len(chapters)+1)
			if err != nil {
				return nil, err
			}
			chapters = append(chapters, chapter)
			title = normalized
			content.Reset()
			continue
		}
		content.WriteString(line)
		content.WriteByte('\n')
	}
	if strings.TrimSpace(content.String()) != "" {
		chapter, err := textChapter(title, content.String(), len(chapters)+1)
		if err != nil {
			return nil, err
		}
		chapters = append(chapters, chapter)
	}
	if len(chapters) == 0 {
		return nil, newAPIError(400, "INVALID_PDF", "PDF có chapter rỗng.")
	}
	return chapters, nil
}

func htmlChapter(content []byte, number int) (parsedChapter, *apiError) {
	document, err := html.Parse(bytes.NewReader(content))
	if err != nil {
		return parsedChapter{}, newAPIError(400, "INVALID_EPUB", "Một chapter EPUB không hợp lệ.")
	}
	title := ""
	paragraphs := []string{}
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode {
			switch strings.ToLower(node.Data) {
			case "h1", "h2", "h3", "h4", "h5", "h6":
				if title == "" {
					title = normalizeInline(nodeText(node))
				}
			case "p", "blockquote", "li":
				if value := normalizeInline(nodeText(node)); value != "" {
					paragraphs = append(paragraphs, value)
				}
				return
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(document)
	if len(paragraphs) == 0 {
		if value := normalizeInline(nodeText(document)); value != "" {
			paragraphs = []string{value}
		}
	}
	if len(paragraphs) == 0 {
		return parsedChapter{}, newAPIError(400, "INVALID_EPUB", "Một chapter EPUB không có nội dung văn bản.")
	}
	if title == "" {
		title = fmt.Sprintf("Chương %d", number)
	}
	return chapterFromParagraphs(title, paragraphs), nil
}

func textChapter(title, content string, number int) (parsedChapter, *apiError) {
	parts := regexp.MustCompile(`(?:\n\s*){2,}`).Split(strings.TrimSpace(content), -1)
	paragraphs := make([]string, 0, len(parts))
	for _, part := range parts {
		if value := normalizeInline(part); value != "" {
			paragraphs = append(paragraphs, value)
		}
	}
	if len(paragraphs) == 0 {
		return parsedChapter{}, newAPIError(400, "INVALID_PDF", "PDF có chapter rỗng.")
	}
	if strings.TrimSpace(title) == "" {
		title = fmt.Sprintf("Chương %d", number)
	}
	return chapterFromParagraphs(title, paragraphs), nil
}

func chapterFromParagraphs(title string, paragraphs []string) parsedChapter {
	htmlParts := make([]string, len(paragraphs))
	for index, paragraph := range paragraphs {
		htmlParts[index] = "<p>" + stdhtml.EscapeString(paragraph) + "</p>"
	}
	return parsedChapter{Title: title, ContentHTML: strings.Join(htmlParts, "\n"), PlainText: strings.Join(paragraphs, "\n\n")}
}

func readZipEntry(entries map[string]*zip.File, name string) ([]byte, error) {
	entry, exists := entries[name]
	if !exists {
		return nil, os.ErrNotExist
	}
	reader, err := entry.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	return io.ReadAll(reader)
}

func resolveEPUBPath(packagePath, href string) (string, bool) {
	withoutFragment := strings.SplitN(href, "#", 2)[0]
	decoded, err := url.PathUnescape(withoutFragment)
	if err != nil {
		return "", false
	}
	resolved := path.Clean(path.Join(path.Dir(packagePath), decoded))
	if resolved == "." || strings.HasPrefix(resolved, "../") || strings.HasPrefix(resolved, "/") {
		return "", false
	}
	return resolved, true
}

func firstNonEmpty(values []string, fallback string) string {
	for _, value := range values {
		if value = normalizeInline(value); value != "" {
			return value
		}
	}
	return fallback
}

func nodeText(node *html.Node) string {
	var output strings.Builder
	var walk func(*html.Node)
	walk = func(current *html.Node) {
		if current.Type == html.TextNode {
			output.WriteString(current.Data)
		}
		for child := current.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(node)
	return output.String()
}

func normalizeInline(value string) string {
	return strings.Join(strings.Fields(norm.NFC.String(value)), " ")
}

func normalizeParagraphs(value string) string {
	value = norm.NFC.String(strings.ReplaceAll(value, "\r\n", "\n"))
	return strings.TrimSpace(regexp.MustCompile(`\n[ \t]*\n+`).ReplaceAllString(value, "\n\n"))
}

func fileExtension(name, fallback string) string {
	index := strings.LastIndex(name, ".")
	if index < 0 || index < strings.LastIndex(name, "/") {
		return fallback
	}
	extension := strings.ToLower(name[index:])
	if utf8.RuneCountInString(extension) > 10 || !regexp.MustCompile(`^\.[a-z0-9]+$`).MatchString(extension) {
		return fallback
	}
	return extension
}
