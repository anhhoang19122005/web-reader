package readerapi

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"

	edgetts "github.com/foresturquhart/edge-tts"
	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
)

const maxTTSCharacters = 800
const saydiVoiceCacheTTL = 5 * time.Minute

type ttsVoice struct {
	ID       string `json:"id"`
	Provider string `json:"provider"`
	Name     string `json:"name"`
	Language string `json:"language"`
	Gender   string `json:"gender"`
	Style    string `json:"style"`
}

type ttsChunk struct {
	ChunkIndex     int    `json:"chunkIndex"`
	Text           string `json:"text"`
	StartCharacter int    `json:"startCharacter"`
	EndCharacter   int    `json:"endCharacter"`
}

type ttsResponse struct {
	AudioURL       string `json:"audioUrl"`
	MimeType       string `json:"mimeType"`
	DurationMS     int    `json:"durationMs"`
	ChunkIndex     int    `json:"chunkIndex"`
	StartCharacter int    `json:"startCharacter"`
	EndCharacter   int    `json:"endCharacter"`
	Cached         bool   `json:"cached"`
}

type chapterForTTS struct {
	ID        uuid.UUID
	BookID    uuid.UUID
	PlainText string
}

func (a *App) voices() []ttsVoice {
	voices := edgeVoices(a.config.EdgeEnabled)
	if len(a.config.SaydiKeys) > 0 {
		voices = append(voices, a.configuredSaydiVoice())
	}
	// Cộng thêm giọng local offline, giữ nguyên thứ tự Edge/Saydi cũ.
	voices = append(voices, a.offlineVoices()...)
	if len(voices) == 0 {
		return []ttsVoice{{ID: "vi-mock-narrator", Provider: "mock", Name: "Demo · giọng im lặng", Language: "vi-VN", Gender: "neutral", Style: "narrator"}}
	}
	return voices
}

func (a *App) configuredSaydiVoice() ttsVoice {
	voiceID := a.config.SaydiVoiceID
	if voiceID == "" {
		voiceID = "vi-adam"
	}
	voiceName := a.config.SaydiVoiceName
	if voiceName == "" {
		voiceName = "Adam · SaydiVoice"
	}
	return ttsVoice{ID: voiceID, Provider: "saydi", Name: voiceName, Language: "vi-VN", Gender: "male", Style: "narrator"}
}

type saydiSampleVoice struct {
	VoiceID     string `json:"voice_id"`
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	Gender      string `json:"gender"`
	Locale      string `json:"locale"`
	Language    string `json:"language"`
	UseCase     string `json:"use_case"`
	Category    string `json:"category"`
}

type saydiFailure struct {
	Status  int
	Code    string
	Message string
}

func (e *saydiFailure) Error() string { return e.Message }

func (e *saydiFailure) shouldRotate() bool {
	value := strings.ToLower(e.Code + " " + e.Message)
	return e.Status == http.StatusUnauthorized || e.Status == http.StatusForbidden || e.Status == http.StatusPaymentRequired || e.Status == http.StatusTooManyRequests || strings.Contains(value, "quota")
}

func (e *saydiFailure) permanent() bool {
	value := strings.ToLower(e.Code + " " + e.Message)
	return e.Status == http.StatusUnauthorized || e.Status == http.StatusForbidden || e.Status == http.StatusPaymentRequired || strings.Contains(value, "quota")
}

func (a *App) saydiKeyStore() *saydiKeyManager {
	if a.saydiKeys == nil {
		a.saydiKeys = newSaydiKeyManager(a.config.SaydiKeys)
	}
	return a.saydiKeys
}

func (a *App) saydiRequest(ctx context.Context, method, endpoint string, payload []byte, maxBytes int64) ([]byte, http.Header, *saydiFailure) {
	requestCtx, cancel := context.WithTimeout(ctx, 180*time.Second)
	defer cancel()
	client := &http.Client{Timeout: 180 * time.Second}
	manager := a.saydiKeyStore()
	for {
		keyIndex, key, ok := manager.next()
		if !ok {
			return nil, nil, &saydiFailure{Status: http.StatusTooManyRequests, Code: "SAYDI_KEYS_EXHAUSTED", Message: "Tất cả Saydi API key đã hết quota hoặc đang tạm khóa."}
		}
		for attempt := 0; attempt < 2; attempt++ {
			var body io.Reader
			if payload != nil {
				body = bytes.NewReader(payload)
			}
			request, err := http.NewRequestWithContext(requestCtx, method, endpoint, body)
			if err != nil {
				return nil, nil, &saydiFailure{Status: http.StatusBadGateway, Code: "SAYDI_REQUEST_FAILED", Message: "Không thể tạo yêu cầu SaydiVoice."}
			}
			request.Header.Set("Authorization", "Bearer "+key)
			if payload != nil {
				request.Header.Set("Content-Type", "application/json")
			}
			response, err := client.Do(request)
			if err != nil {
				if requestCtx.Err() != nil {
					return nil, nil, &saydiFailure{Status: http.StatusServiceUnavailable, Code: "SAYDI_PROVIDER_UNAVAILABLE", Message: "Yêu cầu SaydiVoice bị gián đoạn."}
				}
				return nil, nil, &saydiFailure{Status: http.StatusBadGateway, Code: "SAYDI_CONNECTION_FAILED", Message: "Không thể kết nối SaydiVoice."}
			}
			if response.StatusCode/100 == 2 {
				result, readErr := io.ReadAll(io.LimitReader(response.Body, maxBytes))
				header := response.Header.Clone()
				response.Body.Close()
				if readErr != nil {
					return nil, nil, &saydiFailure{Status: http.StatusBadGateway, Code: "SAYDI_RESPONSE_FAILED", Message: "SaydiVoice trả về dữ liệu không hợp lệ."}
				}
				return result, header, nil
			}
			bodyBytes, _ := io.ReadAll(io.LimitReader(response.Body, 8<<10))
			header := response.Header.Clone()
			status := response.StatusCode
			response.Body.Close()
			message, code := saydiErrorInfo(bodyBytes)
			failure := &saydiFailure{Status: status, Code: code, Message: message}
			if failure.Message == "" {
				failure.Message = fmt.Sprintf("SaydiVoice trả về HTTP %d.", status)
			}
			if status >= 500 && attempt == 0 {
				if err := waitWithContext(requestCtx, saydiRetryDelay(header)); err != nil {
					return nil, nil, &saydiFailure{Status: http.StatusServiceUnavailable, Code: "SAYDI_PROVIDER_UNAVAILABLE", Message: "Yêu cầu SaydiVoice bị gián đoạn."}
				}
				continue
			}
			if failure.shouldRotate() {
				manager.fail(keyIndex, failure.permanent())
				break
			}
			return nil, nil, failure
		}
	}
}

func waitWithContext(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (a *App) availableVoices(ctx context.Context) []ttsVoice {
	if len(a.config.SaydiKeys) == 0 {
		return a.voices()
	}

	a.saydiVoicesMu.Lock()
	if len(a.saydiVoices) > 0 && time.Since(a.saydiVoicesAt) < saydiVoiceCacheTTL {
		voices := append([]ttsVoice(nil), a.saydiVoices...)
		a.saydiVoicesMu.Unlock()
		// Cộng thêm giọng local offline, giữ nguyên thứ tự Edge/Saydi cũ.
		return append(append(edgeVoices(a.config.EdgeEnabled), voices...), a.offlineVoices()...)
	}
	a.saydiVoicesMu.Unlock()

	listCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	voices, err := a.fetchSaydiVoices(listCtx)
	a.saydiVoicesMu.Lock()
	if err == nil && len(voices) > 0 {
		configured := a.configuredSaydiVoice()
		found := false
		for _, voice := range voices {
			if voice.ID == configured.ID {
				found = true
				break
			}
		}
		if !found {
			voices = append(voices, configured)
		}
		a.saydiVoices = voices
		a.saydiVoicesAt = time.Now()
	}
	if err != nil || len(voices) == 0 {
		if len(a.saydiVoices) == 0 {
			a.saydiVoices = []ttsVoice{a.configuredSaydiVoice()}
		}
		// Cache provider failures briefly so every chapter does not wait on Saydi.
		a.saydiVoicesAt = time.Now().Add(30*time.Second - saydiVoiceCacheTTL)
	}
	cached := append([]ttsVoice(nil), a.saydiVoices...)
	a.saydiVoicesMu.Unlock()
	if len(cached) > 0 {
		// Cộng thêm giọng local offline, giữ nguyên thứ tự Edge/Saydi cũ.
		return append(append(edgeVoices(a.config.EdgeEnabled), cached...), a.offlineVoices()...)
	}
	return a.voices()
}

func edgeVoices(enabled bool) []ttsVoice {
	if !enabled {
		return nil
	}
	return []ttsVoice{
		{ID: "vi-VN-HoaiMyNeural", Provider: "edge", Name: "Hoài My · Edge", Language: "vi-VN", Gender: "female", Style: "narrator"},
		{ID: "vi-VN-NamMinhNeural", Provider: "edge", Name: "Nam Minh · Edge", Language: "vi-VN", Gender: "male", Style: "narrator"},
	}
}

func (a *App) fetchSaydiVoices(ctx context.Context) ([]ttsVoice, error) {
	body, _, failure := a.saydiRequest(ctx, http.MethodGet, "https://voice.saydi.ai/api/samples?lang=vi&limit=100", nil, 2<<20)
	if failure != nil {
		return nil, failure
	}
	return parseSaydiVoices(body)
}

func parseSaydiVoices(body []byte) ([]ttsVoice, error) {
	var samples []saydiSampleVoice
	if err := json.Unmarshal(body, &samples); err != nil {
		return nil, err
	}
	voices := make([]ttsVoice, 0, len(samples))
	for _, sample := range samples {
		if sample.VoiceID == "" {
			continue
		}
		name := firstNonEmpty([]string{sample.DisplayName, sample.Name, sample.VoiceID}, "")
		language := firstNonEmpty([]string{sample.Locale, sample.Language}, "")
		style := firstNonEmpty([]string{sample.UseCase, sample.Category}, "")
		voices = append(voices, ttsVoice{ID: sample.VoiceID, Provider: "saydi", Name: name, Language: language, Gender: sample.Gender, Style: style})
	}
	return voices, nil
}

func (a *App) ttsChunks(w http.ResponseWriter, r *http.Request, requestPath string) *apiError {
	chapterID, err := pathID(requestPath, "/tts/chunks/")
	if err != nil {
		return newAPIError(http.StatusBadRequest, "INVALID_CHAPTER_ID", "ID chapter không hợp lệ.")
	}
	chapter, chapterErr := a.ownedChapter(r.Context(), chapterID)
	if chapterErr != nil {
		return chapterErr
	}
	writeJSON(w, http.StatusOK, chunkText(chapter.PlainText))
	return nil
}

func (a *App) generateTTS(w http.ResponseWriter, r *http.Request) *apiError {
	var request struct {
		ChapterID    uuid.UUID `json:"chapterId"`
		ChunkIndex   int       `json:"chunkIndex"`
		VoiceID      string    `json:"voiceId"`
		SpeakingRate float64   `json:"speakingRate"`
		Pitch        float64   `json:"pitch"`
		Volume       float64   `json:"volume"`
	}
	if err := decodeJSON(r, &request); err != nil || request.ChapterID == uuid.Nil || request.ChunkIndex < 0 || request.VoiceID == "" || request.SpeakingRate < 0.5 || request.SpeakingRate > 2 || request.Pitch < -20 || request.Pitch > 20 || request.Volume < 0 || request.Volume > 1 {
		return newAPIError(http.StatusBadRequest, "VALIDATION_ERROR", "Dữ liệu không hợp lệ.")
	}
	chapter, chapterErr := a.ownedChapter(r.Context(), request.ChapterID)
	if chapterErr != nil {
		return chapterErr
	}
	chunks := chunkText(chapter.PlainText)
	if request.ChunkIndex >= len(chunks) {
		return newAPIError(http.StatusBadRequest, "TTS_CHUNK_NOT_FOUND", "Không tìm thấy đoạn đọc.")
	}
	chunk := chunks[request.ChunkIndex]
	// Piper local không hỗ trợ pitch và volume xử lý ở player (giống Saydi bỏ
	// pitch): chuẩn hóa trước khi hash/cache để cùng đoạn văn không sinh doc trùng.
	// Edge/Saydi giữ nguyên giá trị request như cũ.
	effectivePitch, effectiveVolume := request.Pitch, request.Volume
	if request.VoiceID == vieNeuVoiceID {
		request.SpeakingRate, effectivePitch, effectiveVolume = 1, 0, 1
	}
	if isLocalVoiceID(request.VoiceID) {
		effectivePitch, effectiveVolume = 0, 1
	}
	textHash := hash(fmt.Sprintf("%s|%s|%.4f|%.4f|%.4f", chunk.Text, request.VoiceID, request.SpeakingRate, effectivePitch, effectiveVolume))
	var cached mongoAudioChunk
	err := a.collection(audioCollection).FindOne(r.Context(), bson.M{
		"chapterId": chapter.ID.String(), "chunkIndex": chunk.ChunkIndex, "voiceId": request.VoiceID,
		"speakingRate": request.SpeakingRate, "pitch": effectivePitch, "volume": effectiveVolume, "textHash": textHash,
	}).Decode(&cached)
	if err == nil {
		cachedID, parseErr := uuid.Parse(cached.ID)
		if parseErr != nil {
			return databaseError(parseErr)
		}
		writeJSON(w, http.StatusOK, ttsResponse{AudioURL: "/tts/audio/" + cachedID.String(), MimeType: cached.MimeType, DurationMS: cached.DurationMS, ChunkIndex: cached.ChunkIndex, StartCharacter: cached.StartCharacter, EndCharacter: cached.EndCharacter, Cached: true})
		return nil
	}
	if !errorsIsNoRows(err) {
		return databaseError(err)
	}
	var voice *ttsVoice
	for _, candidate := range a.availableVoices(r.Context()) {
		if candidate.ID == request.VoiceID {
			value := candidate
			voice = &value
			break
		}
	}
	if voice == nil {
		return newAPIError(http.StatusBadRequest, "TTS_VOICE_NOT_FOUND", "Không tìm thấy voice tiếng Việt.")
	}

	audio, mimeType, durationMS, synthesisErr := a.synthesize(r.Context(), *voice, chunk.Text, request.SpeakingRate, effectivePitch, effectiveVolume)
	if synthesisErr != nil {
		return synthesisErr
	}
	audioID := uuid.New()
	storageKey := "tts/" + audioID.String() + map[bool]string{true: ".wav", false: ".mp3"}[mimeType == "audio/wav"]
	if err := a.store.Put(r.Context(), storageKey, audio, mimeType); err != nil {
		return newAPIError(http.StatusInternalServerError, "STORAGE_FAILED", "Không thể lưu audio.")
	}
	_, err = a.collection(audioCollection).InsertOne(r.Context(), mongoAudioChunk{
		ID: audioID.String(), ChapterID: chapter.ID.String(), ChunkIndex: chunk.ChunkIndex, TextHash: textHash, Text: chunk.Text,
		VoiceID: voice.ID, SpeakingRate: request.SpeakingRate, Pitch: effectivePitch, Volume: effectiveVolume,
		StartCharacter: chunk.StartCharacter, EndCharacter: chunk.EndCharacter, AudioStorageKey: storageKey,
		MimeType: mimeType, DurationMS: durationMS, CreatedAt: time.Now().UTC(),
	})
	if err != nil {
		_ = a.store.Delete(r.Context(), storageKey)
		return databaseError(err)
	}
	writeJSON(w, http.StatusOK, ttsResponse{AudioURL: "/tts/audio/" + audioID.String(), MimeType: mimeType, DurationMS: durationMS, ChunkIndex: chunk.ChunkIndex, StartCharacter: chunk.StartCharacter, EndCharacter: chunk.EndCharacter})
	return nil
}

func (a *App) ttsAudio(w http.ResponseWriter, r *http.Request, requestPath string) *apiError {
	audioID, err := pathID(requestPath, "/tts/audio/")
	if err != nil {
		return newAPIError(http.StatusBadRequest, "INVALID_AUDIO_ID", "ID audio không hợp lệ.")
	}
	var audio mongoAudioChunk
	err = a.collection(audioCollection).FindOne(r.Context(), bson.M{"_id": audioID.String()}).Decode(&audio)
	if errorsIsNoRows(err) {
		return newAPIError(http.StatusNotFound, "AUDIO_NOT_FOUND", "Không tìm thấy audio.")
	}
	if err != nil {
		return databaseError(err)
	}
	chapterID, parseErr := uuid.Parse(audio.ChapterID)
	if parseErr != nil {
		return databaseError(parseErr)
	}
	if _, _, err := a.ownedChapterDocument(r.Context(), chapterID); errorsIsNoRows(err) {
		return newAPIError(http.StatusNotFound, "AUDIO_NOT_FOUND", "Không tìm thấy audio.")
	} else if err != nil {
		return databaseError(err)
	}
	content, err := a.store.Get(r.Context(), audio.AudioStorageKey)
	if err != nil {
		return newAPIError(http.StatusNotFound, "STORAGE_NOT_FOUND", "Không tìm thấy tệp âm thanh.")
	}
	w.Header().Set("Content-Type", audio.MimeType)
	http.ServeContent(w, r, audio.AudioStorageKey, audio.CreatedAt, bytes.NewReader(content))
	return nil
}

func (a *App) ownedChapter(ctx context.Context, chapterID uuid.UUID) (chapterForTTS, *apiError) {
	book, chapterDocument, err := a.ownedChapterDocument(ctx, chapterID)
	if errorsIsNoRows(err) {
		return chapterForTTS{}, newAPIError(http.StatusNotFound, "CHAPTER_NOT_FOUND", "Không tìm thấy chapter.")
	}
	if err != nil {
		return chapterForTTS{}, databaseError(err)
	}
	bookID, parseErr := uuid.Parse(book.ID)
	if parseErr != nil {
		return chapterForTTS{}, databaseError(parseErr)
	}
	return chapterForTTS{ID: chapterID, BookID: bookID, PlainText: chapterDocument.PlainText}, nil
}

func (a *App) synthesize(ctx context.Context, voice ttsVoice, text string, rate, pitch, volume float64) ([]byte, string, int, *apiError) {
	duration := maxInt(800, len([]rune(text))*35)
	if voice.Provider == "mock" {
		return mockAudio(duration), "audio/wav", duration, nil
	}
	if voice.Provider == "vieneu" {
		return a.vieNeuAudio(ctx, text)
	}
	if voice.Provider == "local" || isLocalVoiceID(voice.ID) {
		return a.piperAudio(ctx, voice.ID, text, rate)
	}
	if voice.Provider == "saydi" {
		return a.saydiAudio(ctx, text, voice.ID, rate, duration)
	}
	for attempt := 0; attempt < 2; attempt++ {
		audio, err := edgeAudio(ctx, text, voice.ID, rate, pitch, volume)
		if err == nil && len(audio) > 0 {
			return audio, "audio/mpeg", duration, nil
		}
		if attempt == 0 {
			select {
			case <-ctx.Done():
				return nil, "", 0, newAPIError(http.StatusServiceUnavailable, "TTS_PROVIDER_UNAVAILABLE", "Yêu cầu Edge-TTS bị gián đoạn.")
			case <-time.After(500 * time.Millisecond):
			}
		}
	}
	return nil, "", 0, newAPIError(http.StatusBadGateway, "TTS_GENERATION_FAILED", "Edge-TTS không tạo được audio. Hãy kiểm tra kết nối mạng.")
}

func (a *App) saydiAudio(ctx context.Context, text, voice string, rate float64, fallbackDuration int) ([]byte, string, int, *apiError) {
	if len(a.config.SaydiKeys) == 0 {
		return nil, "", 0, newAPIError(http.StatusServiceUnavailable, "TTS_PROVIDER_UNAVAILABLE", "SaydiVoice chưa được cấu hình.")
	}
	payload, err := json.Marshal(struct {
		Model          string  `json:"model"`
		Voice          string  `json:"voice"`
		Input          string  `json:"input"`
		ResponseFormat string  `json:"response_format"`
		Speed          float64 `json:"speed"`
	}{Model: "tts-1", Voice: voice, Input: text, ResponseFormat: "mp3", Speed: rate})
	if err != nil {
		return nil, "", 0, newAPIError(http.StatusInternalServerError, "TTS_REQUEST_FAILED", "Không thể tạo yêu cầu SaydiVoice.")
	}
	audio, headers, failure := a.saydiRequest(ctx, http.MethodPost, "https://voice.saydi.ai/api/v1/audio/speech", payload, 50<<20)
	if failure != nil {
		status := failure.Status
		if status < 400 || status > 499 {
			status = http.StatusBadGateway
		}
		return nil, "", 0, newAPIError(status, "TTS_GENERATION_FAILED", "SaydiVoice không tạo được audio. "+failure.Message)
	}
	duration := fallbackDuration
	if header := headers.Get("X-Audio-Duration"); header != "" {
		if seconds, parseErr := strconv.ParseFloat(header, 64); parseErr == nil && seconds > 0 {
			duration = int(math.Round(seconds * 1000))
		}
	}
	if len(audio) == 0 {
		return nil, "", 0, newAPIError(http.StatusBadGateway, "TTS_GENERATION_FAILED", "SaydiVoice trả về audio không hợp lệ.")
	}
	return audio, "audio/mpeg", duration, nil
}

func saydiRetryDelay(header http.Header) time.Duration {
	seconds, err := strconv.Atoi(strings.TrimSpace(header.Get("Retry-After")))
	if err != nil || seconds < 1 {
		seconds = 1
	}
	if seconds > 10 {
		seconds = 10
	}
	return time.Duration(seconds) * time.Second
}

func saydiErrorInfo(body []byte) (string, string) {
	var envelope struct {
		Detail string `json:"detail"`
		Code   string `json:"code"`
		Error  struct {
			Message string `json:"message"`
			Code    string `json:"code"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &envelope) == nil {
		if envelope.Error.Message != "" {
			return envelope.Error.Message, firstNonEmpty([]string{envelope.Error.Code, envelope.Code}, "")
		}
		if envelope.Detail != "" {
			return envelope.Detail, envelope.Code
		}
	}
	detail := strings.Join(strings.Fields(string(body)), " ")
	if len(detail) > 240 {
		return detail[:240], ""
	}
	return detail, ""
}

func saydiErrorDetail(body []byte) string {
	detail, _ := saydiErrorInfo(body)
	return detail
}

func edgeAudio(ctx context.Context, text, voice string, rate, pitch, volume float64) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 180*time.Second)
	defer cancel()
	config := edgetts.DefaultConfig()
	config.Voice = voice
	config.Rate = signedPercent((rate - 1) * 100)
	config.Volume = signedPercent((volume - 1) * 100)
	config.Pitch = signedNumber(pitch) + "Hz"
	communicate, err := edgetts.NewCommunicate(text, config)
	if err != nil {
		return nil, err
	}
	var output bytes.Buffer
	err = communicate.Stream(ctx, func(chunk edgetts.TTSChunk) error {
		if chunk.Type == edgetts.ChunkTypeAudio {
			_, err := output.Write(chunk.Data)
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func chunkText(text string) []ttsChunk {
	runes := []rune(text)
	segments := sentenceSegments(runes)
	chunks := []ttsChunk{}
	var pending []rune
	pendingStart, pendingEnd := 0, 0
	flush := func() {
		if len(pending) == 0 {
			return
		}
		chunks = append(chunks, ttsChunk{ChunkIndex: len(chunks), Text: string(pending), StartCharacter: utf16Length(runes[:pendingStart]), EndCharacter: utf16Length(runes[:pendingEnd])})
		pending = nil
	}
	for _, segment := range segments {
		if utf16Length(segment.text) > maxTTSCharacters {
			flush()
			for _, part := range splitLongSegment(segment) {
				chunks = append(chunks, ttsChunk{ChunkIndex: len(chunks), Text: string(part.text), StartCharacter: utf16Length(runes[:part.start]), EndCharacter: utf16Length(runes[:part.end])})
			}
			continue
		}
		if len(pending) == 0 {
			pending, pendingStart, pendingEnd = append([]rune(nil), segment.text...), segment.start, segment.end
			continue
		}
		if utf16Length(pending)+1+utf16Length(segment.text) <= maxTTSCharacters {
			pending = append(pending, ' ')
			pending = append(pending, segment.text...)
			pendingEnd = segment.end
		} else {
			flush()
			pending, pendingStart, pendingEnd = append([]rune(nil), segment.text...), segment.start, segment.end
		}
		if segment.paragraphEnd && utf16Length(pending) >= 300 {
			flush()
		}
	}
	flush()
	return chunks
}

type textSegment struct {
	text         []rune
	start, end   int
	paragraphEnd bool
}

func sentenceSegments(runes []rune) []textSegment {
	segments := []textSegment{}
	start := 0
	for start < len(runes) {
		for start < len(runes) && unicode.IsSpace(runes[start]) {
			start++
		}
		if start == len(runes) {
			break
		}
		end := start
		paragraphEnd := false
		for end < len(runes) {
			if isSentenceEnd(runes[end]) {
				end++
				break
			}
			if runes[end] == '\n' && end+1 < len(runes) && runes[end+1] == '\n' {
				paragraphEnd = true
				break
			}
			end++
		}
		trimmedEnd := end
		for trimmedEnd > start && unicode.IsSpace(runes[trimmedEnd-1]) {
			trimmedEnd--
		}
		if trimmedEnd > start {
			segments = append(segments, textSegment{text: runes[start:trimmedEnd], start: start, end: trimmedEnd, paragraphEnd: paragraphEnd})
		}
		start = end
		if paragraphEnd {
			for start < len(runes) && unicode.IsSpace(runes[start]) {
				start++
			}
		}
	}
	return segments
}

func splitLongSegment(segment textSegment) []textSegment {
	parts := []textSegment{}
	start := 0
	for start < len(segment.text) {
		end := start
		units := 0
		for end < len(segment.text) {
			next := utf16Length([]rune{segment.text[end]})
			if units+next > maxTTSCharacters {
				break
			}
			units += next
			end++
		}
		parts = append(parts, textSegment{text: segment.text[start:end], start: segment.start + start, end: segment.start + end})
		start = end
	}
	return parts
}

func isSentenceEnd(value rune) bool {
	return value == '.' || value == '!' || value == '?' || value == '…'
}

func utf16Length(runes []rune) int { return len(utf16.Encode(runes)) }

func signedPercent(value float64) string { return signedNumber(value) + "%" }

func signedNumber(value float64) string {
	rounded := int(math.Round(value))
	if value >= 0 {
		return "+" + strconv.Itoa(rounded)
	}
	return strconv.Itoa(rounded)
}

func mockAudio(durationMS int) []byte {
	const sampleRate = 16_000
	dataLength := sampleRate * durationMS / 1000 * 2
	output := make([]byte, 44+dataLength)
	copy(output[0:], "RIFF")
	binary.LittleEndian.PutUint32(output[4:], uint32(36+dataLength))
	copy(output[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(output[16:], 16)
	binary.LittleEndian.PutUint16(output[20:], 1)
	binary.LittleEndian.PutUint16(output[22:], 1)
	binary.LittleEndian.PutUint32(output[24:], sampleRate)
	binary.LittleEndian.PutUint32(output[28:], sampleRate*2)
	binary.LittleEndian.PutUint16(output[32:], 2)
	binary.LittleEndian.PutUint16(output[34:], 16)
	copy(output[36:], "data")
	binary.LittleEndian.PutUint32(output[40:], uint32(dataLength))
	return output
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}
