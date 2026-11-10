package readerapi

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
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
	body, _ := json.Marshal(map[string]any{"input": text, "voice": preset, "response_format": "pcm", "sample_rate": 24000})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, a.config.VieNeuURL+"/audio/speech", bytes.NewReader(body))
	if err != nil {
		return nil, "", 0, newAPIError(503, "TTS_PROVIDER_UNAVAILABLE", "Địa chỉ VieNeu không hợp lệ.")
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, "", 0, newAPIError(503, "TTS_PROVIDER_UNAVAILABLE", "Không kết nối được VieNeu. Hãy chạy start-reader-vieneu.ps1.")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, "", 0, newAPIError(502, "TTS_GENERATION_FAILED", "VieNeu không tạo được audio. Kiểm tra model và giọng "+preset+".")
	}
	// PCM has no streaming WAV sentinel sizes: build a complete, seekable WAV.
	const limit = 32 * 1024 * 1024
	pcm, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil || len(pcm) < 2 || len(pcm) > limit || len(pcm)%2 != 0 {
		return nil, "", 0, newAPIError(502, "TTS_GENERATION_FAILED", "VieNeu trả về audio không hợp lệ hoặc quá dài.")
	}
	wav := make([]byte, 44+len(pcm))
	copy(wav, "RIFF")
	binary.LittleEndian.PutUint32(wav[4:], uint32(len(wav)-8))
	copy(wav[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(wav[16:], 16)
	binary.LittleEndian.PutUint16(wav[20:], 1)
	binary.LittleEndian.PutUint16(wav[22:], 1)
	binary.LittleEndian.PutUint32(wav[24:], 24000)
	binary.LittleEndian.PutUint32(wav[28:], 48000)
	binary.LittleEndian.PutUint16(wav[32:], 2)
	binary.LittleEndian.PutUint16(wav[34:], 16)
	copy(wav[36:], "data")
	binary.LittleEndian.PutUint32(wav[40:], uint32(len(pcm)))
	copy(wav[44:], pcm)
	return wav, "audio/wav", len(pcm) * 1000 / 48000, nil
}
