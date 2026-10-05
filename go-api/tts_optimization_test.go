package readerapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestLocalAudioRanges(t *testing.T) {
	store := &localStorage{root: t.TempDir()}
	content := []byte("0123456789abcdef")
	if err := store.Put(context.Background(), "tts/test.wav", content, "audio/wav"); err != nil {
		t.Fatal(err)
	}
	a := &App{store: store}
	for _, test := range []struct {
		method, rangeHeader string
		status              int
		body, contentRange  string
	}{
		{"GET", "", 200, string(content), ""},
		{"GET", "bytes=4-7", 206, "4567", "bytes 4-7/16"},
		{"GET", "bytes=-4", 206, "cdef", "bytes 12-15/16"},
		{"HEAD", "", 200, "", ""},
		{"GET", "bytes=100-200", 416, "", "bytes */16"},
	} {
		r := httptest.NewRequest(test.method, "/audio", nil)
		r.Header.Set("Range", test.rangeHeader)
		w := httptest.NewRecorder()
		if err := a.serveTTSAudio(w, r, mongoAudioChunk{AudioStorageKey: "tts/test.wav", MimeType: "audio/wav"}); err != nil {
			t.Fatal(err)
		}
		if w.Code != test.status || w.Header().Get("Content-Range") != test.contentRange {
			t.Fatalf("%+v: status=%d headers=%v", test, w.Code, w.Header())
		}
		if test.status != 416 && w.Body.String() != test.body {
			t.Fatalf("%+v: body=%q", test, w.Body.String())
		}
	}
	if err := a.serveTTSAudio(httptest.NewRecorder(), httptest.NewRequest("GET", "/audio", nil), mongoAudioChunk{AudioStorageKey: "../secret"}); err == nil {
		t.Fatal("unsafe storage path accepted")
	}
}

func TestConcurrentTTSGeneration(t *testing.T) {
	if os.Getenv("READER_INTEGRATION_TEST") != "true" {
		t.Skip("requires MongoDB credentials; uses an isolated test database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	a, err := NewApp(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	a.db = a.client.Database("tts_" + strings.ReplaceAll(uuid.NewString(), "-", ""))
	a.store = &localStorage{root: t.TempDir()}
	defer func() {
		if err := a.db.Drop(context.Background()); err != nil {
			t.Error(err)
		}
	}()
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			close(started)
		}
		select {
		case <-release:
		case <-ctx.Done():
		}
		w.Write(make([]byte, 48000))
	}))
	defer provider.Close()
	a.config = Config{VieNeuURL: provider.URL}
	bookID := uuid.New()
	if err := a.insertBook(ctx, bookID, "test.epub", "", "EPUB", parsedBook{Title: "TTS optimization test", Chapters: []parsedChapter{{Title: "Test", PlainText: "Xin chào. Đây là nội dung kiểm tra."}}}); err != nil {
		t.Fatal(err)
	}
	book, err := a.findBook(ctx, bookID)
	if err != nil {
		t.Fatal(err)
	}
	chapters, err := a.chapterSummariesForBook(ctx, book)
	if err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`{"chapterId":%q,"chunkIndex":0,"voiceId":%q,"speakingRate":1,"pitch":0,"volume":1}`, chapters[0].ID, vieNeuVoiceID)
	request := func(ctx context.Context) (ttsResponse, *apiError) {
		w := httptest.NewRecorder()
		err := a.generateTTS(w, httptest.NewRequest("POST", "/api/tts/generate", strings.NewReader(body)).WithContext(ctx))
		var response ttsResponse
		if err == nil {
			if e := json.Unmarshal(w.Body.Bytes(), &response); e != nil {
				return response, databaseError(e)
			}
		}
		return response, err
	}
	// Cancel the first listener while its provider work is still running.
	leaderCtx, cancelLeader := context.WithCancel(ctx)
	leaderDone := make(chan *apiError, 1)
	go func() { _, err := request(leaderCtx); leaderDone <- err }()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("provider never started")
	}
	cancelLeader()
	if err := <-leaderDone; err == nil || err.Code != "TTS_CANCELLED" {
		t.Fatalf("unexpected cancellation: %v", err)
	}
	var wg sync.WaitGroup
	results := make(chan ttsResponse, 8)
	failures := make(chan *apiError, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			response, err := request(ctx)
			if err != nil {
				failures <- err
			} else {
				results <- response
			}
		}()
	}
	// Join the still-blocked real request synchronously. This proves in-flight
	// sharing even if some of the HTTP listeners reach the persisted cache later.
	chunk := chunkText("Xin chào. Đây là nội dung kiểm tra.")[0]
	textHash := hash(fmt.Sprintf("%s|%s|%.4f|%.4f|%.4f", chunk.Text, vieNeuVoiceID, 1.0, 0.0, 1.0))
	key := fmt.Sprintf("%s|0|%s|1|0|1", chapters[0].ID, textHash)
	joined := a.ttsGeneration.DoChan(key, func() (any, error) {
		return nil, fmt.Errorf("failed to join in-flight generation")
	})
	close(release)
	wg.Wait()
	close(results)
	close(failures)
	for err := range failures {
		t.Error(err)
	}
	var audioURL string
	for response := range results {
		if audioURL == "" {
			audioURL = response.AudioURL
		}
		if response.AudioURL != audioURL {
			t.Error("concurrent listeners received duplicate audio")
		}
	}
	if audioURL == "" || calls.Load() != 1 {
		t.Fatalf("audio=%q provider calls=%d", audioURL, calls.Load())
	}
	shared := <-joined
	if shared.Err != nil || !shared.Shared || shared.Val.(ttsResponse).AudioURL != audioURL {
		t.Fatalf("in-flight listener did not share generation: %+v", shared)
	}
	count, err := a.collection(audioCollection).CountDocuments(ctx, bson.M{})
	if err != nil || count != 1 {
		t.Fatalf("persisted audio count=%d err=%v", count, err)
	}
	cached, apiErr := request(ctx)
	if apiErr != nil || !cached.Cached || cached.AudioURL != audioURL {
		t.Fatalf("cache miss: %+v %v", cached, apiErr)
	}
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/api"+audioURL, nil).WithContext(ctx)
	r.Header.Set("Range", "bytes=44-143")
	a.ServeHTTP(w, r)
	if w.Code != 206 || w.Body.Len() != 100 {
		t.Fatalf("generated audio seek failed: %d, %d bytes", w.Code, w.Body.Len())
	}
	t.Log("8 listeners + canceled leader: 1 provider call, 1 audio record, cache reuse and HTTP Range passed")

	t.Run("precise parameters do not coalesce", func(t *testing.T) {
		a.config = Config{}
		writes := make(chan struct{}, 2)
		unblock := make(chan struct{})
		defer close(unblock)
		a.store = &blockedTTSStorage{Storage: a.store, writes: writes, unblock: unblock}
		// Both values round to 1.0000 in the existing persisted text hash, but
		// exact synthesis settings remain distinct in MongoDB's cache query.
		responses := make(chan ttsResponse, 2)
		errors := make(chan *apiError, 2)
		for _, rate := range []float64{1.00001, 1.00002} {
			go func(rate float64) {
				payload := fmt.Sprintf(`{"chapterId":%q,"chunkIndex":0,"voiceId":"vi-mock-narrator","speakingRate":%g,"pitch":0,"volume":1}`, chapters[0].ID, rate)
				w := httptest.NewRecorder()
				if err := a.generateTTS(w, httptest.NewRequest("POST", "/api/tts/generate", strings.NewReader(payload)).WithContext(ctx)); err != nil {
					errors <- err
					return
				}
				var response ttsResponse
				if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
					errors <- databaseError(err)
					return
				}
				responses <- response
			}(rate)
		}
		for i := 0; i < 2; i++ {
			select {
			case <-writes:
			case err := <-errors:
				t.Fatal(err)
			case <-time.After(5 * time.Second):
				t.Fatal("distinct precise settings incorrectly joined the same in-flight audio")
			}
		}
		// Permit both overlapping requests to persist their distinct audio.
		unblock <- struct{}{}
		unblock <- struct{}{}
		nextResponse := func() ttsResponse {
			select {
			case response := <-responses:
				return response
			case err := <-errors:
				t.Fatal(err)
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			return ttsResponse{}
		}
		first := nextResponse()
		second := nextResponse()
		if first.AudioURL == second.AudioURL {
			t.Fatal("different exact settings received the same audio")
		}
		count, err := a.collection(audioCollection).CountDocuments(ctx, bson.M{"voiceId": "vi-mock-narrator"})
		if err != nil || count != 2 {
			t.Fatalf("distinct cache settings: count=%d err=%v", count, err)
		}
	})
}

type blockedTTSStorage struct {
	Storage
	writes  chan struct{}
	unblock chan struct{}
}

func (s *blockedTTSStorage) Put(ctx context.Context, key string, audio []byte, mimeType string) error {
	s.writes <- struct{}{}
	select {
	case <-s.unblock:
	case <-ctx.Done():
		return ctx.Err()
	}
	return s.Storage.Put(ctx, key, audio, mimeType)
}

type discardAudioResponse struct{ header http.Header }

func (w discardAudioResponse) Header() http.Header         { return w.header }
func (w discardAudioResponse) WriteHeader(int)             {}
func (w discardAudioResponse) Write(p []byte) (int, error) { return io.Discard.Write(p) }

func BenchmarkAudioRangeMemory(b *testing.B) {
	store := &localStorage{root: b.TempDir()}
	file, err := os.Create(filepath.Join(store.root, "audio.wav"))
	if err != nil {
		b.Fatal(err)
	}
	if err := file.Truncate(16 << 20); err != nil {
		b.Fatal(err)
	}
	file.Close()
	for _, mode := range []string{"read-entire-file", "stream-file"} {
		b.Run(mode, func(b *testing.B) {
			a := &App{store: store}
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				r := httptest.NewRequest("GET", "/audio", nil)
				r.Header.Set("Range", "bytes=0-65535")
				w := discardAudioResponse{header: make(http.Header)}
				if mode == "read-entire-file" {
					content, err := store.Get(context.Background(), "audio.wav")
					if err != nil {
						b.Fatal(err)
					}
					http.ServeContent(w, r, "audio.wav", time.Time{}, bytes.NewReader(content))
				} else if err := a.serveTTSAudio(w, r, mongoAudioChunk{AudioStorageKey: "audio.wav", MimeType: "audio/wav"}); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
