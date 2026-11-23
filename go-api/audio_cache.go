package readerapi

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// Generated audio is only a cache: a missing entry is synthesized again on the
// next listen. Without a purge the files (WAV from VieNeu is ~2.4 MB a chunk)
// grow forever, so entries nobody has played for AUDIO_CACHE_MAX_AGE_DAYS go.
const (
	// Hits refresh lastUsedAt at most this often, so listening is not a write per request.
	audioTouchInterval = time.Hour
	audioPurgeBatch    = 200
)

// audioLastUsed is when the entry was last played; records written before the
// field existed fall back to their creation time.
func audioLastUsed(audio mongoAudioChunk) time.Time {
	if audio.LastUsedAt.IsZero() {
		return audio.CreatedAt
	}
	return audio.LastUsedAt
}

// touchAudio marks an entry as recently played. Best effort: failing to record
// a hit must never fail playback.
func (a *App) touchAudio(ctx context.Context, audio mongoAudioChunk) {
	if a.config.AudioCacheMaxAgeDays <= 0 || time.Since(audioLastUsed(audio)) < audioTouchInterval {
		return
	}
	_, _ = a.collection(audioCollection).UpdateOne(ctx, bson.M{"_id": audio.ID}, bson.M{"$set": bson.M{"lastUsedAt": time.Now().UTC()}})
}

// PurgeStaleAudio deletes cached audio, file first then record, that was last
// played before the retention window. It returns how many entries were removed.
// A file whose record delete fails is simply synthesized again later.
func (a *App) PurgeStaleAudio(ctx context.Context) (int, error) {
	if a.config.AudioCacheMaxAgeDays <= 0 {
		return 0, nil
	}
	cutoff := time.Now().UTC().AddDate(0, 0, -a.config.AudioCacheMaxAgeDays)
	filter := bson.M{"$or": bson.A{
		bson.M{"lastUsedAt": bson.M{"$lt": cutoff}},
		bson.M{"lastUsedAt": bson.M{"$exists": false}, "createdAt": bson.M{"$lt": cutoff}},
	}}
	removed := 0
	for {
		cursor, err := a.collection(audioCollection).Find(ctx, filter, options.Find().SetLimit(audioPurgeBatch))
		if err != nil {
			return removed, err
		}
		var batch []mongoAudioChunk
		if err := cursor.All(ctx, &batch); err != nil {
			return removed, err
		}
		for _, audio := range batch {
			if err := a.store.Delete(ctx, audio.AudioStorageKey); err != nil {
				return removed, err
			}
			// Commit each one so a timeout resumes instead of restarting.
			if _, err := a.collection(audioCollection).DeleteOne(ctx, bson.M{"_id": audio.ID}); err != nil {
				return removed, err
			}
			removed++
		}
		if len(batch) < audioPurgeBatch {
			return removed, nil
		}
	}
}
