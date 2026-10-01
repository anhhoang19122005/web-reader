package readerapi

// Provider TTS local offline (Piper) — cộng thêm, không thay đổi Edge/Saydi/mock.
// Hai giọng Việt miễn phí:
//   - local-duyoryx-sieutram: Duy Siêu Trầm, uy nghiêm quyền lực (kiểu Tào Tháo).
//   - local-ngocngan-kechuyen: Ngọc Ngạn, trầm ấm kể chuyện.
// Windows: start-reader-go.ps1 tải piper.exe; Docker: cài Piper Linux + models.
// Vercel Functions dùng PIPER_ENABLED=false; deploy container dùng true.

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// piperSem giới hạn số tiến trình Piper chạy đồng thời để không nghẽn CPU
// khi prefetch đoạn kế chồng với lần phát hiện tại.
var piperSem = make(chan struct{}, 2)

const (
	localDuyOryxID   = "local-duyoryx-sieutram"
	localNgocNganID  = "local-ngocngan-kechuyen"
	piperCommandTime = 120 * time.Second
)

func localVoices(enabled bool) []ttsVoice {
	if !enabled {
		return nil
	}
	return []ttsVoice{
		{ID: localDuyOryxID, Provider: "local", Name: "Duy Siêu Trầm · Local", Language: "vi-VN", Gender: "male", Style: "narrator"},
		{ID: localNgocNganID, Provider: "local", Name: "Ngọc Ngạn · Local", Language: "vi-VN", Gender: "male", Style: "narrator"},
	}
}

func isLocalVoiceID(voiceID string) bool {
	return voiceID == localDuyOryxID || voiceID == localNgocNganID
}

// piperModelFiles trả về file model/config cho từng voice local.
func (a *App) piperModelFiles(voiceID string) (model, config string) {
	switch voiceID {
	case localDuyOryxID:
		return a.config.PiperDuyOryxModel, a.config.PiperDuyOryxConfig
	case localNgocNganID:
		return a.config.PiperNgocNganModel, a.config.PiperNgocNganConfig
	default:
		return "", ""
	}
}

// piperAvailable kiểm tra binary + model đã được script tải về chưa.
func (a *App) piperAvailable(voiceID string) bool {
	if !a.config.PiperEnabled {
		return false
	}
	model, config := a.piperModelFiles(voiceID)
	if model == "" || config == "" {
		return false
	}
	for _, path := range []string{a.config.PiperBin, model, config, a.config.PiperEspeakData} {
		if _, err := os.Stat(path); err != nil {
			return false
		}
	}
	return true
}

// piperAudio tổng hợp giọng local offline qua binary Piper.
// Piper không hỗ trợ pitch/volume: pitch đã chuẩn hóa 0 và volume xử lý ở
// player (giống Saydi), ở đây chỉ map speakingRate -> length_scale.
func (a *App) piperAudio(ctx context.Context, voiceID, text string, rate float64) ([]byte, string, int, *apiError) {
	if !a.config.PiperEnabled {
		return nil, "", 0, newAPIError(http.StatusServiceUnavailable, "TTS_PROVIDER_UNAVAILABLE", "Giọng local chưa được bật (PIPER_ENABLED=false).")
	}
	model, config := a.piperModelFiles(voiceID)
	if model == "" {
		return nil, "", 0, newAPIError(http.StatusBadRequest, "TTS_VOICE_NOT_FOUND", "Không tìm thấy voice local.")
	}
	for _, path := range []string{a.config.PiperBin, model, config, a.config.PiperEspeakData} {
		if _, err := os.Stat(path); err != nil {
			return nil, "", 0, newAPIError(http.StatusServiceUnavailable, "TTS_PROVIDER_UNAVAILABLE", "Giọng local chưa được cài. Hãy chạy lại start-reader-go.ps1 để tự tải Piper.")
		}
	}
	if rate < 0.5 {
		rate = 0.5
	}
	if rate > 2 {
		rate = 2
	}
	lengthScale := 1 / rate

	outputDir := os.TempDir()
	outputFile := filepath.Join(outputDir, fmt.Sprintf("piper-%d.wav", time.Now().UnixNano()))
	defer os.Remove(outputFile)

	commandCtx, cancel := context.WithTimeout(ctx, piperCommandTime)
	defer cancel()

	select {
	case piperSem <- struct{}{}:
		defer func() { <-piperSem }()
	case <-commandCtx.Done():
		return nil, "", 0, newAPIError(http.StatusServiceUnavailable, "TTS_PROVIDER_UNAVAILABLE", "Yêu cầu giọng local bị gián đoạn.")
	}

	args := []string{
		"--model", model,
		"--config", config,
		"--espeak_data", a.config.PiperEspeakData,
		"--output_file", outputFile,
		"--speaker", strconv.Itoa(a.config.PiperSpeaker),
		"--length_scale", strconv.FormatFloat(lengthScale, 'f', 4, 64),
		"--sentence_silence", "0.2",
	}
	command := exec.CommandContext(commandCtx, a.config.PiperBin, args...)
	command.Stdin = strings.NewReader(text)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		detail := strings.Join(strings.Fields(stderr.String()), " ")
		if len(detail) > 200 {
			detail = detail[:200]
		}
		if commandCtx.Err() != nil {
			return nil, "", 0, newAPIError(http.StatusServiceUnavailable, "TTS_PROVIDER_UNAVAILABLE", "Yêu cầu giọng local bị gián đoạn.")
		}
		message := "Piper không tạo được audio."
		if detail != "" {
			message += " " + detail
		}
		return nil, "", 0, newAPIError(http.StatusBadGateway, "TTS_GENERATION_FAILED", message)
	}
	audio, err := os.ReadFile(outputFile)
	if err != nil || len(audio) < 44 || string(audio[0:4]) != "RIFF" {
		return nil, "", 0, newAPIError(http.StatusBadGateway, "TTS_GENERATION_FAILED", "Piper trả về audio không hợp lệ.")
	}
	return audio, "audio/wav", piperWavDurationMS(audio, len([]rune(text))), nil
}

// piperWavDurationMS đọc duration từ header WAV (16-bit PCM).
func piperWavDurationMS(audio []byte, fallbackRunes int) int {
	if len(audio) >= 44 {
		byteRate := int(binary.LittleEndian.Uint32(audio[28:32]))
		dataLen := int(binary.LittleEndian.Uint32(audio[40:44]))
		if byteRate > 0 && dataLen > 0 && dataLen <= len(audio) {
			if duration := dataLen * 1000 / byteRate; duration > 0 {
				return duration
			}
		}
	}
	return maxInt(800, fallbackRunes*35)
}
