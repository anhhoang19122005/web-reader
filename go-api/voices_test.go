package readerapi

import (
	"context"
	"net/http"
	"testing"
	"time"
)

type stalledVoiceTransport struct{ calls int }

func (s *stalledVoiceTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	s.calls++
	<-r.Context().Done()
	return nil, r.Context().Err()
}

func TestVoiceListFallsBackWithoutRepeatedWaits(t *testing.T) {
	previous := http.DefaultTransport
	transport := &stalledVoiceTransport{}
	http.DefaultTransport = transport
	defer func() { http.DefaultTransport = previous }()
	a := &App{config: Config{SaydiKeys: []string{"test-key"}, EdgeEnabled: true, PiperEnabled: true}, saydiKeys: newSaydiKeyManager([]string{"test-key"})}
	start := time.Now()
	voices := a.availableVoices(context.Background())
	if time.Since(start) > 7*time.Second || len(voices) != 5 {
		t.Fatalf("fallback took %v, voices=%v", time.Since(start), voices)
	}
	start = time.Now()
	if len(a.availableVoices(context.Background())) != 5 || transport.calls != 1 || time.Since(start) > time.Second {
		t.Fatal("provider failure was not cached")
	}
}
