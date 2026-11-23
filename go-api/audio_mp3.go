package readerapi

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"sync"
	"time"
)

// Local voices (VieNeu, Piper) produce 16-bit mono WAV, 48 KB per second at 24 kHz.
// Stored as-is that is ~2.6 MB per reader chunk, so it is encoded as MP3 first.
// 64 kbps CBR is plenty for speech and ~6x smaller.
//
// The encoder is ffmpeg (libmp3lame). A pure Go encoder (shine-mp3) was tried and
// rejected: Chrome refuses its streams ("mpa: huffman decode overrun"), even though
// lenient decoders accept them. Without ffmpeg the WAV is stored unchanged.
const mp3Bitrate = "64k"

var (
	ffmpegOnce sync.Once
	ffmpegPath string
)

// ffmpegBinary returns the ffmpeg to use: FFMPEG_PATH, else the first one on PATH.
func ffmpegBinary() string {
	ffmpegOnce.Do(func() {
		if configured := os.Getenv("FFMPEG_PATH"); configured != "" {
			ffmpegPath = configured
		} else if found, err := exec.LookPath("ffmpeg"); err == nil {
			ffmpegPath = found
		}
	})
	return ffmpegPath
}

// compressAudio returns MP3 for WAV input. Anything it cannot encode is returned
// unchanged: storing a big file is better than failing playback.
func compressAudio(ctx context.Context, audio []byte, mimeType string) ([]byte, string) {
	if mimeType != "audio/wav" || len(audio) < 44 {
		return audio, mimeType
	}
	binary := ffmpegBinary()
	if binary == "" {
		return audio, mimeType
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "-hide_banner", "-loglevel", "error", "-nostdin",
		"-i", "pipe:0", "-vn", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", mp3Bitrate, "-f", "mp3", "pipe:1")
	command.Stdin = bytes.NewReader(audio)
	var output bytes.Buffer
	command.Stdout = &output
	if err := command.Run(); err != nil || output.Len() == 0 {
		return audio, mimeType
	}
	return output.Bytes(), "audio/mpeg"
}
