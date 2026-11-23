package readerapi

import (
	"bytes"
	"context"
	"encoding/binary"
	"math"
	"os/exec"
	"testing"
)

func testWAV(rate, seconds int) []byte {
	pcm := make([]byte, 2*rate*seconds)
	for i := 0; i < rate*seconds; i++ {
		tone := 6000*math.Sin(2*math.Pi*220*float64(i)/float64(rate)) + 3000*math.Sin(2*math.Pi*1700*float64(i)/float64(rate))
		binary.LittleEndian.PutUint16(pcm[2*i:], uint16(int16(tone)))
	}
	header := make([]byte, 44)
	copy(header, "RIFF")
	binary.LittleEndian.PutUint32(header[4:], uint32(36+len(pcm)))
	copy(header[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(header[16:], 16)
	binary.LittleEndian.PutUint16(header[20:], 1)
	binary.LittleEndian.PutUint16(header[22:], 1)
	binary.LittleEndian.PutUint32(header[24:], uint32(rate))
	binary.LittleEndian.PutUint32(header[28:], uint32(rate*2))
	binary.LittleEndian.PutUint16(header[32:], 2)
	binary.LittleEndian.PutUint16(header[34:], 16)
	copy(header[36:], "data")
	binary.LittleEndian.PutUint32(header[40:], uint32(len(pcm)))
	return append(header, pcm...)
}

func withFFmpeg(t *testing.T, path string) {
	t.Helper()
	ffmpegOnce.Do(func() {})
	previous := ffmpegPath
	ffmpegPath = path
	t.Cleanup(func() { ffmpegPath = previous })
}

// Without ffmpeg, or when it fails, playback must keep working with the WAV.
func TestCompressAudioFallsBackToWAV(t *testing.T) {
	wav := testWAV(24000, 1)
	for name, binary := range map[string]string{"missing": "", "not executable": "no-such-ffmpeg-binary"} {
		withFFmpeg(t, binary)
		if out, mime := compressAudio(context.Background(), wav, "audio/wav"); mime != "audio/wav" || !bytes.Equal(out, wav) {
			t.Fatalf("%s: must stay WAV, got %q (%d bytes)", name, mime, len(out))
		}
	}
	withFFmpeg(t, "whatever")
	if out, mime := compressAudio(context.Background(), []byte("mp3"), "audio/mpeg"); mime != "audio/mpeg" || string(out) != "mp3" {
		t.Fatal("audio that is already MP3 must pass through")
	}
}

func TestCompressAudioWithFFmpeg(t *testing.T) {
	path, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}
	withFFmpeg(t, path)
	wav := testWAV(24000, 4)
	out, mime := compressAudio(context.Background(), wav, "audio/wav")
	if mime != "audio/mpeg" || len(out) == 0 {
		t.Fatalf("mime=%q len=%d", mime, len(out))
	}
	if len(out)*5 > len(wav) {
		t.Fatalf("%d -> %d bytes, expected ~6x smaller", len(wav), len(out))
	}
}
