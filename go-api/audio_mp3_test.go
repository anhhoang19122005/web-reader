package readerapi

import (
	"bytes"
	"encoding/binary"
	"io"
	"math"
	"testing"

	gomp3 "github.com/hajimehoshi/go-mp3"
)

func testWAV(rate, channels, seconds int) []byte {
	n := rate * seconds * channels
	pcm := make([]byte, 2*n)
	for i := 0; i < n; i++ {
		tone := 6000*math.Sin(2*math.Pi*220*float64(i/channels)/float64(rate)) + 3000*math.Sin(2*math.Pi*1700*float64(i/channels)/float64(rate))
		binary.LittleEndian.PutUint16(pcm[2*i:], uint16(int16(tone)))
	}
	header := make([]byte, 44)
	copy(header, "RIFF")
	binary.LittleEndian.PutUint32(header[4:], uint32(36+len(pcm)))
	copy(header[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(header[16:], 16)
	binary.LittleEndian.PutUint16(header[20:], 1)
	binary.LittleEndian.PutUint16(header[22:], uint16(channels))
	binary.LittleEndian.PutUint32(header[24:], uint32(rate))
	binary.LittleEndian.PutUint32(header[28:], uint32(rate*channels*2))
	binary.LittleEndian.PutUint16(header[32:], uint16(channels*2))
	binary.LittleEndian.PutUint16(header[34:], 16)
	copy(header[36:], "data")
	binary.LittleEndian.PutUint32(header[40:], uint32(len(pcm)))
	return append(header, pcm...)
}

// The 64 kbps frame layout is derived by hand on top of the encoder, so verify it
// with an independent decoder: it must play, at the right length and sample rate.
func TestCompressAudioProducesPlayableMP3(t *testing.T) {
	for _, rate := range []int{24000, 22050, 16000} {
		wav := testWAV(rate, 1, 4)
		out, mime := compressAudio(wav, "audio/wav")
		if mime != "audio/mpeg" || len(out) == 0 {
			t.Fatalf("rate %d: mime=%q len=%d", rate, mime, len(out))
		}
		// 16-bit mono PCM is rate*16 bits per second against 64 kbps.
		if want := float64(rate) * 16 / (mp3Bitrate * 1000); float64(len(wav))/float64(len(out)) < want*0.9 {
			t.Fatalf("rate %d: %d -> %d bytes, expected ~%.1fx smaller", rate, len(wav), len(out), want)
		}
		decoder, err := gomp3.NewDecoder(bytes.NewReader(out))
		if err != nil {
			t.Fatalf("rate %d: %v", rate, err)
		}
		pcm, err := io.ReadAll(decoder)
		if err != nil || decoder.SampleRate() != rate {
			t.Fatalf("rate %d: decoded rate %d, err %v", rate, decoder.SampleRate(), err)
		}
		seconds := float64(len(pcm)) / 4 / float64(rate) // decoder emits 16-bit stereo
		if math.Abs(seconds-4) > 0.1 {
			t.Fatalf("rate %d: decoded %.2fs, want 4s", rate, seconds)
		}
	}
}

func TestCompressAudioKeepsWhatItCannotEncode(t *testing.T) {
	stereo := testWAV(24000, 2, 1)
	highRate := testWAV(44100, 1, 1)
	cases := map[string][]byte{"stereo": stereo, "44.1 kHz": highRate, "not a wav": []byte("garbage that is long enough to look like data"), "empty": nil}
	for name, input := range cases {
		if out, mime := compressAudio(input, "audio/wav"); mime != "audio/wav" || !bytes.Equal(out, input) {
			t.Fatalf("%s must stay WAV, got %q (%d bytes)", name, mime, len(out))
		}
	}
	if out, mime := compressAudio([]byte("mp3"), "audio/mpeg"); mime != "audio/mpeg" || string(out) != "mp3" {
		t.Fatal("audio that is already MP3 must pass through")
	}
	// A streaming WAV header (data size 0 or too large) means "until the end".
	streaming := testWAV(24000, 1, 1)
	binary.LittleEndian.PutUint32(streaming[40:], 0xFFFFFFFF)
	if _, mime := compressAudio(streaming, "audio/wav"); mime != "audio/mpeg" {
		t.Fatal("streaming-size WAV must still be encoded")
	}
}
