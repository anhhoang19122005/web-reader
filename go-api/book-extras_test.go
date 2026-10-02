package readerapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestBookmarkExcerptUTF16(t *testing.T) {
	text := strings.Repeat("🙂", 40) + "đoạn đánh dấu" + strings.Repeat("x", 100)
	value := bookmarkExcerpt(text, 80)
	if !strings.Contains(value, "đoạn đánh dấu") || len([]rune(value)) > 60 || strings.ContainsRune(value, '\uFFFD') {
		t.Fatalf("bad UTF16 excerpt: %q", value)
	}
}

func TestBookExtrasMongoIntegration(t *testing.T) {
	if os.Getenv("READER_INTEGRATION_TEST") != "true" {
		t.Skip("requires isolated Mongo integration")
	}
	ctx, done := context.WithTimeout(context.Background(), 40*time.Second)
	defer done()
	a, err := NewApp(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	a.db = a.client.Database("rbe_" + strings.ReplaceAll(uuid.NewString(), "-", ""))
	a.store = &localStorage{root: t.TempDir()}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := a.db.Drop(cleanup); err != nil {
			t.Error(err)
		}
	}()
	id := uuid.New()
	if err := a.insertBook(ctx, id, "source.epub", "cover.png", "EPUB", parsedBook{Title: "Test", Chapters: []parsedChapter{{Title: "Chương thử", PlainText: strings.Repeat("🙂", 40) + "đoạn đánh dấu"}}}); err != nil {
		t.Fatal(err)
	}
	book, err := a.findBook(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	chapters, err := a.chapterSummariesForBook(ctx, book)
	if err != nil {
		t.Fatal(err)
	}
	chapter := chapters[0].ID
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=")
	if err := a.store.Put(ctx, "cover.png", png, "image/png"); err != nil {
		t.Fatal(err)
	}
	call := func(method, path, body string, status int) []byte {
		r := httptest.NewRequest(method, "/api"+path, strings.NewReader(body)).WithContext(ctx)
		r.Header.Set("X-Reader-Token", a.config.AccessToken)
		w := httptest.NewRecorder()
		a.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
		}
		return w.Body.Bytes()
	}
	call("GET", "/books/"+id.String()+"/cover", "", 200)
	if err := a.store.Put(ctx, "cover.png", []byte("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"), "image/svg+xml"); err != nil {
		t.Fatal(err)
	}
	call("GET", "/books/"+id.String()+"/cover", "", 415)
	var saved bookmark
	if err := json.Unmarshal(call("POST", "/reader/bookmarks/"+id.String(), `{"chapterId":"`+chapter+`","characterPosition":80}`, 201), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.ChapterTitle != "Chương thử" || !strings.Contains(saved.Excerpt, "đoạn đánh dấu") {
		t.Fatalf("bookmark lacks context: %+v", saved)
	}
	call("POST", "/reader/bookmarks/"+id.String(), `{"chapterId":"`+chapter+`","characterPosition":999}`, 400)
	call("DELETE", "/books/"+id.String(), "", 204)
	call("GET", "/books/"+id.String(), "", 404)
	call("POST", "/books/"+id.String()+"/restore", "", 204)
	call("GET", "/books/"+id.String(), "", 200)
	call("DELETE", "/books/"+id.String(), "", 204)
	expired := time.Now().UTC().Add(-undoBookWindow - time.Second)
	if _, err := a.collection(booksCollection).UpdateOne(ctx, bson.M{"_id": id.String()}, bson.M{"$set": bson.M{"deletedAt": expired}}); err != nil {
		t.Fatal(err)
	}
	call("POST", "/books/"+id.String()+"/restore", "", 410)
	if err := a.PurgeDeletedBooks(ctx); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{booksCollection, chapterCollection, bookmarkCollection} {
		count, err := a.collection(name).CountDocuments(ctx, bson.M{})
		if err != nil || count != 0 {
			t.Fatalf("purge left %s: %d %v", name, count, err)
		}
	}
}
