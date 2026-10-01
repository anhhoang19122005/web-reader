package readerapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestProgressNeverDecreases(t *testing.T) {
	if os.Getenv("READER_INTEGRATION_TEST") != "true" {
		t.Skip("set READER_INTEGRATION_TEST=true with MongoDB credentials")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	a, err := NewApp(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	for _, legacy := range []bool{false, true} {
		t.Run(fmt.Sprintf("legacy=%v", legacy), func(t *testing.T) {
			bookID := uuid.New()
			chapters := []mongoChapter{
				{ID: uuid.NewString(), BookID: bookID.String(), ChapterNumber: 1, PlainText: strings.Repeat("a", 1000)},
				{ID: uuid.NewString(), BookID: bookID.String(), ChapterNumber: 2, PlainText: strings.Repeat("b", 1000)},
			}
			book := mongoBook{ID: bookID.String(), UserID: singleUserID, Title: "progress test"}
			if legacy {
				book.Chapters = chapters
			}
			if _, err := a.collection(booksCollection).InsertOne(ctx, book); err != nil {
				t.Fatal(err)
			}
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
			if !legacy {
				if _, err := a.collection(chapterCollection).InsertMany(ctx, []any{chapters[0], chapters[1]}); err != nil {
					t.Fatal(err)
				}
			}
			save := func(chapter int, position int) (readingProgress, error) {
				body := fmt.Sprintf(`{"chapterId":%q,"characterPosition":%d}`, chapters[chapter].ID, position)
				r := httptest.NewRequest(http.MethodPut, "/api/reader/progress/"+bookID.String(), strings.NewReader(body)).WithContext(ctx)
				w := httptest.NewRecorder()
				if err := a.saveProgress(w, r, "/reader/progress/"+bookID.String()); err != nil {
					return readingProgress{}, err
				}
				var result readingProgress
				err := json.Unmarshal(w.Body.Bytes(), &result)
				return result, err
			}
			var previous readingProgress
			for _, step := range []struct{ chapter, position, wantChapter, wantPosition int }{
				{0, 100, 0, 100}, {0, 50, 0, 100}, {0, 100, 0, 100},
				{0, 500, 0, 500}, {1, 0, 1, 0}, {0, 900, 1, 0}, {1, 100, 1, 100},
			} {
				got, err := save(step.chapter, step.position)
				if err != nil {
					t.Fatal(err)
				}
				if got.ChapterID == nil || got.ChapterID.String() != chapters[step.wantChapter].ID || got.CharacterPosition != step.wantPosition {
					t.Fatalf("step %+v: got %+v", step, got)
				}
				if previous.UpdatedAt != nil && *got.ChapterID == *previous.ChapterID && got.CharacterPosition == previous.CharacterPosition && !got.UpdatedAt.Equal(*previous.UpdatedAt) {
					t.Fatal("ignored request changed updatedAt")
				}
				previous = got
			}
			var wg sync.WaitGroup
			errors := make(chan error, 10)
			for i := 0; i < 10; i++ {
				wg.Add(1)
				go func(position int) {
					defer wg.Done()
					_, err := save(1, position)
					if err != nil {
						errors <- err
					}
				}(i * 100)
			}
			wg.Wait()
			close(errors)
			for err := range errors {
				t.Error(err)
			}
			got, err := save(0, 1000)
			if err != nil {
				t.Fatal(err)
			}
			if got.ChapterID.String() != chapters[1].ID || got.CharacterPosition != 900 {
				t.Fatalf("concurrent requests lowered progress: %+v", got)
			}
		})
	}
}
