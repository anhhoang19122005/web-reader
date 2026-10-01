package readerapi

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf16"
)

func TestParseEPUBKeepsVietnameseParagraphs(t *testing.T) {
	var content bytes.Buffer
	archive := zip.NewWriter(&content)
	write := func(name, value string) {
		entry, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	write("META-INF/container.xml", `<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`)
	write("OEBPS/content.opf", `<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Truyện tiếng Việt</dc:title><dc:creator>Tác giả thử nghiệm</dc:creator></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`)
	write("OEBPS/chapter.xhtml", `<html><body><h1>Chương 1</h1><p>Trời đã tối.</p><p>Lâm Phong bước vào đại điện.</p></body></html>`)
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}

	book, err := parseBook("truyen.epub", content.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if book.Title != "Truyện tiếng Việt" || book.Author != "Tác giả thử nghiệm" || len(book.Chapters) != 1 {
		t.Fatalf("unexpected parsed book: %+v", book)
	}
	if got := book.Chapters[0].PlainText; got != "Trời đã tối.\n\nLâm Phong bước vào đại điện." {
		t.Fatalf("paragraphs changed: %q", got)
	}
}

func TestChunkTextUsesBrowserUTF16Offsets(t *testing.T) {
	text := "Trời đã tối.\n\nLâm Phong bước vào. 😀"
	chunks := chunkText(text)
	if len(chunks) != 1 || !strings.Contains(chunks[0].Text, "Lâm Phong") {
		t.Fatalf("unexpected chunks: %+v", chunks)
	}
	if chunks[0].StartCharacter != 0 || chunks[0].EndCharacter != len(utf16.Encode([]rune(text))) {
		t.Fatalf("unexpected UTF-16 offsets: %+v", chunks[0])
	}
}

func TestVoicesExposeSaydiWhenConfigured(t *testing.T) {
	app := &App{config: Config{EdgeEnabled: false, SaydiKeys: []string{"test-key"}, SaydiVoiceID: "vi-custom", SaydiVoiceName: "Giọng tùy chỉnh"}}
	voices := app.voices()
	if len(voices) != 1 || voices[0].Provider != "saydi" || voices[0].ID != "vi-custom" || voices[0].Name != "Giọng tùy chỉnh" {
		t.Fatalf("unexpected Saydi voices: %+v", voices)
	}
}

func TestParseSaydiKeysTrimsAndDropsEmptyValues(t *testing.T) {
	keys := parseSaydiKeys(" key-1, ,key-2 ,, ")
	if strings.Join(keys, ",") != "key-1,key-2" {
		t.Fatalf("unexpected keys: %#v", keys)
	}
}

func TestLoadConfigFallsBackToLegacySaydiKey(t *testing.T) {
	t.Setenv("SAYDI_API_KEYS", "")
	t.Setenv("SAYDI_API_KEY", " legacy-key ")
	if got := LoadConfig().SaydiKeys; len(got) != 1 || got[0] != "legacy-key" {
		t.Fatalf("unexpected fallback keys: %#v", got)
	}
}

func TestLoadConfigPrefersMultipleSaydiKeys(t *testing.T) {
	t.Setenv("SAYDI_API_KEYS", " key-1, key-2 ")
	t.Setenv("SAYDI_API_KEY", "legacy-key")
	if got := LoadConfig().SaydiKeys; strings.Join(got, ",") != "key-1,key-2" {
		t.Fatalf("unexpected configured keys: %#v", got)
	}
}

func TestSaydiRequestRotatesOnRateLimit(t *testing.T) {
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("Authorization")
		calls = append(calls, key)
		if key == "Bearer key-1" {
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = io.WriteString(w, `{"error":{"code":"rate_limit","message":"slow down"}}`)
			return
		}
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer server.Close()
	app := &App{config: Config{SaydiKeys: []string{"key-1", "key-2"}}, saydiKeys: newSaydiKeyManager([]string{"key-1", "key-2"})}
	body, _, failure := app.saydiRequest(context.Background(), http.MethodGet, server.URL, nil, 1024)
	if failure != nil || string(body) != `{"ok":true}` || strings.Join(calls, ",") != "Bearer key-1,Bearer key-2" {
		t.Fatalf("rotation failed: body=%s failure=%v calls=%v", body, failure, calls)
	}
}

func TestSaydiRequestRotatesOnPaymentRequired(t *testing.T) {
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("Authorization")
		calls = append(calls, key)
		if key == "Bearer key-1" {
			w.WriteHeader(http.StatusPaymentRequired)
			_, _ = io.WriteString(w, `{"error":{"code":"insufficient_quota","message":"quota exceeded"}}`)
			return
		}
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer server.Close()
	app := &App{config: Config{SaydiKeys: []string{"key-1", "key-2"}}, saydiKeys: newSaydiKeyManager([]string{"key-1", "key-2"})}
	body, _, failure := app.saydiRequest(context.Background(), http.MethodGet, server.URL, nil, 1024)
	if failure != nil || string(body) != `{"ok":true}` || strings.Join(calls, ",") != "Bearer key-1,Bearer key-2" {
		t.Fatalf("payment-required rotation failed: body=%s failure=%v calls=%v", body, failure, calls)
	}
}

func TestSaydiRequestDoesNotRotateOnBadRequest(t *testing.T) {
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.Header.Get("Authorization"))
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = io.WriteString(w, `{"error":{"message":"invalid voice"}}`)
	}))
	defer server.Close()
	app := &App{config: Config{SaydiKeys: []string{"key-1", "key-2"}}, saydiKeys: newSaydiKeyManager([]string{"key-1", "key-2"})}
	_, _, failure := app.saydiRequest(context.Background(), http.MethodGet, server.URL, nil, 1024)
	if failure == nil || failure.Status != http.StatusUnprocessableEntity || len(calls) != 1 || calls[0] != "Bearer key-1" {
		t.Fatalf("unexpected 422 handling: failure=%v calls=%v", failure, calls)
	}
}

func TestSaydiRequestReportsExhaustedKeysWithoutSecrets(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":{"message":"invalid key"}}`)
	}))
	defer server.Close()
	app := &App{config: Config{SaydiKeys: []string{"secret-1", "secret-2"}}, saydiKeys: newSaydiKeyManager([]string{"secret-1", "secret-2"})}
	_, _, failure := app.saydiRequest(context.Background(), http.MethodGet, server.URL, nil, 1024)
	if failure == nil || failure.Code != "SAYDI_KEYS_EXHAUSTED" || strings.Contains(failure.Message, "secret") {
		t.Fatalf("unexpected exhausted-key error: %+v", failure)
	}
}

func TestParseSaydiVoices(t *testing.T) {
	voices, err := parseSaydiVoices([]byte(`[{"voice_id":"vi-adam","display_name":"Adam","locale":"vi-VN","gender":"male","use_case":"narrator"}]`))
	if err != nil || len(voices) != 1 || voices[0].ID != "vi-adam" || voices[0].Name != "Adam" {
		t.Fatalf("unexpected Saydi voice list: voices=%+v err=%v", voices, err)
	}
}

func TestSaydiErrorDetail(t *testing.T) {
	if got := saydiErrorDetail([]byte(`{"error":{"message":"quota exceeded"}}`)); got != "quota exceeded" {
		t.Fatalf("unexpected Saydi error detail: %q", got)
	}
}
