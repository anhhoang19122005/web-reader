package readerapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestChapterSummaries(t *testing.T) {
	if os.Getenv("READER_INTEGRATION_TEST") != "true" {
		t.Skip("set READER_INTEGRATION_TEST=true with MongoDB credentials and an imported book")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	a, err := NewApp(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	var book mongoBook
	if err := a.collection(booksCollection).FindOne(ctx, bson.M{"userId": singleUserID}).Decode(&book); err != nil {
		t.Fatal(err)
	}
	chapters, err := a.chapterSummariesForBook(ctx, book)
	if err != nil {
		t.Fatal(err)
	}
	if len(chapters) == 0 {
		t.Fatal("import a book with chapters first")
	}
	for i, chapter := range chapters {
		if chapter.ContentHTML != "" || chapter.PlainText != "" || chapter.ContentHash != "" {
			t.Fatal("summary fetched chapter contents")
		}
		if i > 0 && chapter.ChapterNumber < chapters[i-1].ChapterNumber {
			t.Fatal("chapters are unsorted")
		}
	}
	bookID, err := mongoID(book.ID)
	if err != nil {
		t.Fatal(err)
	}
	chapterID, err := mongoID(chapters[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	_, full, err := a.findChapter(ctx, bookID, chapterID)
	if err != nil {
		t.Fatal(err)
	}
	if chapters[0].PlainTextLength != len([]rune(full.PlainText)) {
		t.Fatal("summary changed text length used for progress")
	}
}

func TestLibraryChapterCountAndProgress(t *testing.T) {
	if os.Getenv("READER_INTEGRATION_TEST") != "true" {
		t.Skip("set READER_INTEGRATION_TEST=true with MongoDB credentials")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	a, err := NewApp(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	bookID := uuid.New()
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		for _, name := range []string{progressCollection, chapterCollection} {
			if _, err := a.collection(name).DeleteMany(cleanup, bson.M{"bookId": bookID.String()}); err != nil {
				t.Error(err)
			}
		}
		if _, err := a.collection(booksCollection).DeleteOne(cleanup, bson.M{"_id": bookID.String()}); err != nil {
			t.Error(err)
		}
	}()
	parsed := parsedBook{Title: "library test", Chapters: []parsedChapter{{PlainText: "abcd"}, {PlainText: "abcd"}, {PlainText: "abcd"}}}
	if err := a.insertBook(ctx, bookID, "", "", "EPUB", parsed); err != nil {
		t.Fatal(err)
	}
	book, err := a.findBook(ctx, bookID)
	if err != nil {
		t.Fatal(err)
	}
	if book.ChapterCount != 3 {
		t.Fatalf("import saved count %d", book.ChapterCount)
	}
	cursor, err := a.collection(chapterCollection).Find(ctx, bson.M{"bookId": bookID.String()})
	if err != nil {
		t.Fatal(err)
	}
	var chapters []mongoChapter
	if err := cursor.All(ctx, &chapters); err != nil {
		t.Fatal(err)
	}
	var current mongoChapter
	for _, chapter := range chapters {
		if chapter.ChapterNumber == 2 {
			current = chapter
		}
	}
	if _, err := a.advanceProgress(ctx, bookID, current, 2); err != nil {
		t.Fatal(err)
	}
	check := func() {
		t.Helper()
		w := httptest.NewRecorder()
		if err := a.listBooks(w, httptest.NewRequest(http.MethodGet, "/api/books", nil).WithContext(ctx)); err != nil {
			t.Fatal(err)
		}
		var books []bookSummary
		if err := json.Unmarshal(w.Body.Bytes(), &books); err != nil {
			t.Fatal(err)
		}
		found := false
		for _, summary := range books {
			if summary.ID == bookID {
				found = true
				if summary.ChapterCount != 3 || summary.ProgressPercent != 50 || summary.LastReadAt == nil {
					t.Fatalf("wrong summary: %+v", summary)
				}
			}
		}
		if !found {
			t.Fatal("book missing from library")
		}
		book, err := a.findBook(ctx, bookID)
		if err != nil {
			t.Fatal(err)
		}
		if book.ChapterCount != 3 {
			t.Fatal("missing count was not saved")
		}
	}
	check()
	if _, err := a.collection(booksCollection).UpdateOne(ctx, bson.M{"_id": bookID.String()}, bson.M{"$unset": bson.M{"chapterCount": ""}}); err != nil {
		t.Fatal(err)
	}
	check() // Existing books with separate chapters.
	if _, err := a.collection(booksCollection).UpdateOne(ctx, bson.M{"_id": bookID.String()}, bson.M{"$unset": bson.M{"chapterCount": ""}, "$set": bson.M{"chapters": chapters}}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.collection(chapterCollection).DeleteMany(ctx, bson.M{"bookId": bookID.String()}); err != nil {
		t.Fatal(err)
	}
	check() // Existing books with embedded chapters.
}
