package readerapi

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestPurgeStaleAudio(t *testing.T) {
	if os.Getenv("READER_INTEGRATION_TEST") != "true" {
		t.Skip("requires MongoDB credentials; uses an isolated test database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	a, err := NewApp(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	a.db = a.client.Database("rpt_" + strings.ReplaceAll(uuid.NewString(), "-", ""))
	a.store = &localStorage{root: t.TempDir()}
	defer func() {
		if err := a.db.Drop(context.Background()); err != nil {
			t.Error(err)
		}
	}()
	a.config = Config{AudioCacheMaxAgeDays: 30}
	old := time.Now().UTC().AddDate(0, 0, -60)
	recent := time.Now().UTC().AddDate(0, 0, -1)
	add := func(id string, created, used time.Time) {
		t.Helper()
		key := "tts/" + id + ".wav"
		if err := a.store.Put(ctx, key, []byte("audio"), "audio/wav"); err != nil {
			t.Fatal(err)
		}
		if _, err := a.collection(audioCollection).InsertOne(ctx, mongoAudioChunk{ID: id, AudioStorageKey: key, CreatedAt: created, LastUsedAt: used}); err != nil {
			t.Fatal(err)
		}
	}
	add("unused-old", old, old)
	add("legacy-old", old, time.Time{}) // written before lastUsedAt existed
	add("old-but-replayed", old, recent)
	add("fresh", recent, recent)

	removed, err := a.PurgeStaleAudio(ctx)
	if err != nil || removed != 2 {
		t.Fatalf("removed=%d err=%v, want 2", removed, err)
	}
	for id, want := range map[string]bool{"unused-old": false, "legacy-old": false, "old-but-replayed": true, "fresh": true} {
		count, err := a.collection(audioCollection).CountDocuments(ctx, bson.M{"_id": id})
		if err != nil || (count == 1) != want {
			t.Fatalf("%s: record kept=%v want %v (err %v)", id, count == 1, want, err)
		}
		if _, err := a.store.Get(ctx, "tts/"+id+".wav"); (err == nil) != want {
			t.Fatalf("%s: file kept=%v want %v", id, err == nil, want)
		}
	}

	a.config = Config{} // 0 days disables the purge
	add("kept-forever", old, old)
	if removed, err := a.PurgeStaleAudio(ctx); err != nil || removed != 0 {
		t.Fatalf("disabled purge removed=%d err=%v", removed, err)
	}
}
