package readerapi

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"
)

const (
	vieNeuVoiceID        = "vieneu-thien-tam-duc"
	vieNeuHaiDangVoiceID = "vieneu-hai-dang"
)

// preset phải khớp chính xác tên giọng trên server VieNeu.
var vieNeuVoices = []struct{ id, preset, gender string }{
	{vieNeuVoiceID, "Thiền Tâm Đức", "male"},
	{vieNeuHaiDangVoiceID, "Hải Đăng", "male"},
	{"vieneu-thien-minh", "Thiện Minh", "male"},
	{"vieneu-thanh-binh", "Thanh Bình", "male"},
	{"vieneu-thai-son", "Thái Sơn", "male"},
	{"vieneu-ngoc-linh", "Ngọc Linh", "female"},
	{"vieneu-thuc-doan", "Thục Đoan", "female"},
}

func vieNeuPreset(voiceID string) (string, bool) {
	for _, voice := range vieNeuVoices {
		if voice.id == voiceID {
			return voice.preset, true
		}
	}
	return "", false
}

func (a *App) offlineVoices() []ttsVoice {
	voices := localVoices(a.config.PiperEnabled)
	if a.config.VieNeuURL != "" {
		for _, voice := range vieNeuVoices {
			voices = append(voices, ttsVoice{ID: voice.id, Provider: "vieneu", Name: voice.preset + " · VieNeu Local", Language: "vi-VN", Gender: voice.gender, Style: "narrator"})
		}
	}
	return voices
}

// vieNeuPartCharacters is the smallest text worth its own stream: a sentence or
// two, the unit VieNeu already synthesizes independently inside one request.
const vieNeuPartCharacters = 140

// vieNeuAudio synthesizes one reader chunk. A GPU server runs each stream at
// about real time but serves several at once, so the chunk is split at
// sentence boundaries and the parts are generated in parallel.
func (a *App) vieNeuAudio(ctx context.Context, voiceID, text string) ([]byte, string, int, *apiError) {
	preset, ok := vieNeuPreset(voiceID)
	if !ok {
		return nil, "", 0, newAPIError(400, "TTS_VOICE_NOT_FOUND", "Không tìm thấy giọng VieNeu.")
	}
	if a.config.VieNeuURL == "" {
		return nil, "", 0, newAPIError(503, "TTS_PROVIDER_UNAVAILABLE", "Chưa cấu hình VIENEU_API_URL.")
	}
	ctx, cancel := context.WithTimeout(ctx, 240*time.Second)
	defer cancel()
	parts := splitVieNeuText(text, a.vieNeuStreams())
	audio := make([][]byte, len(parts))
	failures := make([]*apiError, len(parts))
	var group sync.WaitGroup
	for index, part := range parts {
		group.Add(1)
		go func() {
			defer group.Done()
			if audio[index], failures[index] = a.vieNeuPCM(ctx, preset, part); failures[index] != nil {
				cancel()
			}
		}()
	}
	group.Wait()
	size := 0
	for index := range parts {
		if failures[index] != nil {
			// Report the part that failed first, not the ones cancelled because of it.
			for _, failure := range failures {
				if failure != nil && failure.Code != "TTS_PROVIDER_UNAVAILABLE" {
					return nil, "", 0, failure
				}
			}
			return nil, "", 0, failures[index]
		}
		size += len(audio[index])
	}
	// PCM has no streaming WAV sentinel sizes: build a complete, seekable WAV.
	const limit = 64 * 1024 * 1024
	if size < 2 || size > limit {
		return nil, "", 0, newAPIError(502, "TTS_GENERATION_FAILED", "VieNeu trả về audio không hợp lệ hoặc quá dài.")
	}
	wav := make([]byte, 44, 44+size)
	copy(wav, "RIFF")
	binary.LittleEndian.PutUint32(wav[4:], uint32(36+size))
	copy(wav[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(wav[16:], 16)
	binary.LittleEndian.PutUint16(wav[20:], 1)
	binary.LittleEndian.PutUint16(wav[22:], 1)
	binary.LittleEndian.PutUint32(wav[24:], 24000)
	binary.LittleEndian.PutUint32(wav[28:], 48000)
	binary.LittleEndian.PutUint16(wav[32:], 2)
	binary.LittleEndian.PutUint16(wav[34:], 16)
	copy(wav[36:], "data")
	binary.LittleEndian.PutUint32(wav[40:], uint32(size))
	for _, pcm := range audio {
		wav = append(wav, pcm...)
	}
	return wav, "audio/wav", size * 1000 / 48000, nil
}

func (a *App) vieNeuStreams() int {
	return min(max(a.config.VieNeuStreams, 1), 16)
}

// vieNeuPCM synthesizes one part as 24 kHz mono s16le, holding one of the
// server's stream slots so prefetched chunks queue here instead of being refused.
func (a *App) vieNeuPCM(ctx context.Context, preset, text string) ([]byte, *apiError) {
	a.vieNeuOnce.Do(func() { a.vieNeuSlots = make(chan struct{}, a.vieNeuStreams()) })
	select {
	case a.vieNeuSlots <- struct{}{}:
		defer func() { <-a.vieNeuSlots }()
	case <-ctx.Done():
		return nil, newAPIError(503, "TTS_PROVIDER_UNAVAILABLE", "VieNeu đang bận quá lâu. Hãy thử lại.")
	}
	body, _ := json.Marshal(map[string]any{"input": text, "voice": preset, "response_format": "pcm", "sample_rate": 24000})
	var response *http.Response
	for {
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, a.config.VieNeuURL+"/audio/speech", bytes.NewReader(body))
		if err != nil {
			return nil, newAPIError(503, "TTS_PROVIDER_UNAVAILABLE", "Địa chỉ VieNeu không hợp lệ.")
		}
		request.Header.Set("Content-Type", "application/json")
		response, err = http.DefaultClient.Do(request)
		if err != nil {
			return nil, newAPIError(503, "TTS_PROVIDER_UNAVAILABLE", "Không kết nối được VieNeu. Hãy chạy start-reader-vieneu.ps1.")
		}
		if response.StatusCode != http.StatusTooManyRequests {
			break
		}
		// Another client may hold the server's slots; wait instead of failing,
		// or prefetched chunks are lost and playback stalls.
		response.Body.Close()
		if waitWithContext(ctx, time.Second) != nil {
			return nil, newAPIError(503, "TTS_PROVIDER_UNAVAILABLE", "VieNeu đang bận quá lâu. Hãy thử lại.")
		}
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, newAPIError(502, "TTS_GENERATION_FAILED", "VieNeu không tạo được audio. Kiểm tra model và giọng "+preset+".")
	}
	const limit = 32 * 1024 * 1024
	pcm, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil || len(pcm) < 2 || len(pcm) > limit || len(pcm)%2 != 0 {
		return nil, newAPIError(502, "TTS_GENERATION_FAILED", "VieNeu trả về audio không hợp lệ hoặc quá dài.")
	}
	return pcm, nil
}

// splitVieNeuText cuts text into at most `streams` parts of similar length,
// only ever between sentences.
func splitVieNeuText(text string, streams int) []string {
	segments := sentenceSegments([]rune(text))
	total := 0
	for _, segment := range segments {
		total += len(segment.text)
	}
	count := min(streams, min(total/vieNeuPartCharacters, len(segments)))
	if count < 2 {
		return []string{text}
	}
	parts := make([]string, 0, count)
	var pending []rune
	used := 0
	for index, segment := range segments {
		if len(pending) > 0 {
			pending = append(pending, ' ')
		}
		pending = append(pending, segment.text...)
		used += len(segment.text)
		// Close a part once the text so far reaches its share of the whole,
		// keeping one sentence for each part still to come.
		remaining := len(segments) - index - 1
		if len(parts) < count-1 && (used*count >= total*(len(parts)+1) || remaining == count-len(parts)-1) {
			parts = append(parts, string(pending))
			pending = nil
		}
	}
	if len(pending) > 0 {
		parts = append(parts, string(pending))
	}
	return parts
}
