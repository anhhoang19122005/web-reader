package readerapi

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestVieNeuAudio(t *testing.T) {
	wantPreset := "Thiền Tâm Đức"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if r.URL.Path != "/v1/audio/speech" || body["voice"] != wantPreset || body["response_format"] != "pcm" {
			t.Errorf("unexpected speech request: %v", body)
		}
		_, _ = w.Write(make([]byte, 48000))
	}))
	defer server.Close()
	app := &App{config: Config{VieNeuURL: server.URL + "/v1"}}
	wav, mime, duration, err := app.vieNeuAudio(context.Background(), vieNeuVoiceID, "Xin chào")
	if err != nil || mime != "audio/wav" || duration != 1000 || len(wav) != 48044 || string(wav[:4]) != "RIFF" || binary.LittleEndian.Uint32(wav[40:44]) != 48000 {
		t.Fatalf("invalid WAV: mime=%s duration=%d err=%v", mime, duration, err)
	}
	voices := app.offlineVoices()
	if len(voices) != 7 || voices[0].ID != vieNeuVoiceID || voices[1].ID != vieNeuHaiDangVoiceID {
		t.Fatalf("missing VieNeu voice: %v", voices)
	}
	genders := map[string]string{}
	for _, voice := range voices {
		genders[voice.ID] = voice.Gender
	}
	if genders["vieneu-thien-minh"] != "male" || genders["vieneu-ngoc-linh"] != "female" || genders["vieneu-thuc-doan"] != "female" {
		t.Fatalf("wrong VieNeu voice genders: %v", genders)
	}
	wantPreset = "Hải Đăng"
	if _, _, _, err := app.vieNeuAudio(context.Background(), vieNeuHaiDangVoiceID, "Xin chào"); err != nil {
		t.Fatalf("Hải Đăng synthesis failed: %v", err)
	}
	if _, _, _, err := app.vieNeuAudio(context.Background(), "vieneu-unknown", "Xin chào"); err == nil {
		t.Fatal("unknown VieNeu voice must be rejected")
	}
}

func TestVieNeuAudioWaitsWhenServerBusy(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		_, _ = w.Write(make([]byte, 48000))
	}))
	defer server.Close()
	app := &App{config: Config{VieNeuURL: server.URL + "/v1"}}
	if _, _, duration, err := app.vieNeuAudio(context.Background(), vieNeuVoiceID, "Xin chào"); err != nil || duration != 1000 || calls != 2 {
		t.Fatalf("busy server must be retried: calls=%d duration=%d err=%v", calls, duration, err)
	}
	// A caller that gives up must not wait forever on a busy server.
	calls = -1 << 30
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, _, err := app.vieNeuAudio(ctx, vieNeuVoiceID, "Xin chào"); err == nil {
		t.Fatal("cancelled request must fail")
	}
}

func TestVieNeuAudioSplitsAcrossStreams(t *testing.T) {
	var mu sync.Mutex
	inputs := map[string]bool{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		mu.Lock()
		inputs[body["input"]] = true
		mu.Unlock()
		// One second of PCM tagged with the part's first byte, to check the order.
		pcm := make([]byte, 48000)
		pcm[0] = body["input"][0]
		_, _ = w.Write(pcm)
	}))
	defer server.Close()
	text := "A " + strings.Repeat("một hai ba bốn năm sáu bảy tám chín mười ", 5) + ". B " + strings.Repeat("một hai ba bốn năm sáu bảy tám chín mười ", 5) + ". C " + strings.Repeat("một hai ba bốn năm sáu bảy tám chín mười ", 5) + "."
	app := &App{config: Config{VieNeuURL: server.URL + "/v1", VieNeuStreams: 8}}
	wav, _, duration, err := app.vieNeuAudio(context.Background(), vieNeuVoiceID, text)
	if err != nil || len(inputs) != 3 || duration != 3000 || len(wav) != 44+3*48000 || binary.LittleEndian.Uint32(wav[40:44]) != 3*48000 {
		t.Fatalf("parts=%d duration=%d len=%d err=%v", len(inputs), duration, len(wav), err)
	}
	if wav[44] != 'A' || wav[44+48000] != 'B' || wav[44+96000] != 'C' {
		t.Fatal("parts were joined out of order")
	}
	if parts := splitVieNeuText(text, 1); len(parts) != 1 || parts[0] != text {
		t.Fatalf("a single stream must keep the text whole: %d parts", len(parts))
	}
	if parts := splitVieNeuText("Ngắn thôi. Hết rồi.", 8); len(parts) != 1 {
		t.Fatalf("short text must not be split: %v", parts)
	}
	// No sentence may be dropped or reordered, whatever the stream count.
	for streams := 2; streams <= 16; streams++ {
		if joined := strings.Join(splitVieNeuText(text, streams), " "); joined != strings.Join(strings.Fields(text), " ") {
			t.Fatalf("streams=%d changed the text: %q", streams, joined)
		}
	}
}

// Explicit opt-in: synthesizes standalone audio without books or progress writes.
func TestVieNeuLocalIntegration(t *testing.T) {
	url := os.Getenv("VIENEU_INTEGRATION_URL")
	if url == "" {
		t.Skip("set VIENEU_INTEGRATION_URL to test the local model")
	}
	// VIENEU_MAX_STREAMS > 1 also exercises the parallel split on a GPU server.
	app := &App{config: Config{VieNeuURL: url, VieNeuStreams: envInt("VIENEU_MAX_STREAMS", 1)}}
	text := strings.Repeat("Đêm hôm ấy trời không trăng, gió thổi qua rừng trúc nghe như tiếng ai than khóc. Lão già chống gậy bước ra sân, khẽ hỏi: Ngươi thật sự muốn đi sao? ", 8)
	started := time.Now()
	wav, _, duration, err := app.vieNeuAudio(context.Background(), vieNeuVoiceID, text)
	if err != nil || duration <= 0 {
		t.Fatalf("local synthesis failed: %v", err)
	}
	t.Logf("%d characters in %d parts: %.1fs of audio generated in %.1fs", len([]rune(text)), len(splitVieNeuText(text, app.vieNeuStreams())), float64(duration)/1000, time.Since(started).Seconds())
	if path := os.Getenv("VIENEU_TEST_OUTPUT"); path != "" {
		if err := os.WriteFile(path, wav, 0600); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("generated WAV: %d bytes, %d ms", len(wav), duration)
}
