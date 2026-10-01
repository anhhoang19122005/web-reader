package readerapi

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestVieNeuAudio(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if r.URL.Path != "/v1/audio/speech" || body["voice"] != "Thiền Tâm Đức" || body["response_format"] != "pcm" {
			t.Errorf("unexpected speech request: %v", body)
		}
		_, _ = w.Write(make([]byte, 48000))
	}))
	defer server.Close()
	app := &App{config: Config{VieNeuURL: server.URL + "/v1"}}
	wav, mime, duration, err := app.vieNeuAudio(context.Background(), "Xin chào")
	if err != nil || mime != "audio/wav" || duration != 1000 || len(wav) != 48044 || string(wav[:4]) != "RIFF" || binary.LittleEndian.Uint32(wav[40:44]) != 48000 {
		t.Fatalf("invalid WAV: mime=%s duration=%d err=%v", mime, duration, err)
	}
	if voices := app.offlineVoices(); len(voices) != 1 || voices[0].ID != vieNeuVoiceID {
		t.Fatalf("missing VieNeu voice: %v", voices)
	}
}

// Explicit opt-in: synthesizes standalone audio without books or progress writes.
func TestVieNeuLocalIntegration(t *testing.T) {
	url := os.Getenv("VIENEU_INTEGRATION_URL")
	if url == "" {
		t.Skip("set VIENEU_INTEGRATION_URL to test the local model")
	}
	app := &App{config: Config{VieNeuURL: url}}
	wav, _, duration, err := app.vieNeuAudio(context.Background(), "Xin chào. Đây là giọng Thiền Tâm Đức, đọc truyện trên máy tính của bạn.")
	if err != nil || duration <= 0 {
		t.Fatalf("local synthesis failed: %v", err)
	}
	if path := os.Getenv("VIENEU_TEST_OUTPUT"); path != "" {
		if err := os.WriteFile(path, wav, 0600); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("generated WAV: %d bytes, %d ms", len(wav), duration)
}
