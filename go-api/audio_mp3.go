package readerapi

import (
	"bytes"
	"encoding/binary"

	"github.com/braheezy/shine-mp3/pkg/mp3"
)

// Local voices (VieNeu, Piper) produce 16-bit mono WAV, 48 KB per second at 24 kHz.
// Stored as-is that is ~2.6 MB per reader chunk, so it is encoded as MP3 first.
// 64 kbps CBR is plenty for speech and ~6x smaller.
const mp3Bitrate = 64

// compressAudio returns MP3 for PCM WAV input. Anything it cannot handle is
// returned unchanged: storing a big file is better than failing playback.
func compressAudio(audio []byte, mimeType string) ([]byte, string) {
	if mimeType != "audio/wav" {
		return audio, mimeType
	}
	if encoded, ok := wavToMP3(audio); ok {
		return encoded, "audio/mpeg"
	}
	return audio, mimeType
}

func wavToMP3(wav []byte) (encoded []byte, ok bool) {
	defer func() {
		if recover() != nil {
			encoded, ok = nil, false
		}
	}()
	rate, samples, ok := parseMonoPCM16(wav)
	// Only MPEG-2 rates (22.05/24/16 kHz) have 64 kbps in the encoder's table at
	// index 8; other rates are left as WAV rather than guess a frame layout.
	if !ok || len(samples) == 0 || (rate != 22050 && rate != 24000 && rate != 16000) {
		return nil, false
	}
	encoder := mp3.NewEncoder(rate, 1)
	// NewEncoder always configures 128 kbps; derive the 64 kbps frame layout.
	encoder.Mpeg.Bitrate = mp3Bitrate
	encoder.Mpeg.BitrateIndex = mp3Bitrate / 8
	slots := float64(encoder.Mpeg.GranulesPerFrame) * mp3.GRANULE_SIZE / float64(rate) * (mp3Bitrate * 1000 / float64(encoder.Mpeg.BitsPerSlot))
	encoder.Mpeg.WholeSlotsPerFrame = int64(slots)
	encoder.Mpeg.FracSlotsPerFrame = slots - float64(encoder.Mpeg.WholeSlotsPerFrame)
	encoder.Mpeg.SlotLag = -encoder.Mpeg.FracSlotsPerFrame
	encoder.Mpeg.Padding = 0

	var out bytes.Buffer
	if err := encoder.Write(&out, samples); err != nil || out.Len() == 0 {
		return nil, false
	}
	return out.Bytes(), true
}

// parseMonoPCM16 reads a 16-bit mono PCM WAV. A data size that is zero or larger
// than the file (streaming sentinel) means "until the end".
func parseMonoPCM16(wav []byte) (rate int, samples []int16, ok bool) {
	if len(wav) < 12 || string(wav[0:4]) != "RIFF" || string(wav[8:12]) != "WAVE" {
		return 0, nil, false
	}
	formatOK := false
	for offset := 12; offset+8 <= len(wav); {
		id, size := string(wav[offset:offset+4]), int(binary.LittleEndian.Uint32(wav[offset+4:offset+8]))
		body := offset + 8
		switch id {
		case "fmt ":
			if size < 16 || body+16 > len(wav) {
				return 0, nil, false
			}
			format := binary.LittleEndian.Uint16(wav[body:])
			channels := binary.LittleEndian.Uint16(wav[body+2:])
			rate = int(binary.LittleEndian.Uint32(wav[body+4:]))
			bits := binary.LittleEndian.Uint16(wav[body+14:])
			formatOK = format == 1 && channels == 1 && bits == 16
		case "data":
			if !formatOK {
				return 0, nil, false
			}
			end := body + size
			if size == 0 || end > len(wav) {
				end = len(wav)
			}
			end -= (end - body) % 2
			samples = make([]int16, (end-body)/2)
			for i := range samples {
				samples[i] = int16(binary.LittleEndian.Uint16(wav[body+2*i:]))
			}
			return rate, samples, true
		}
		offset = body + size + size%2
	}
	return 0, nil, false
}
