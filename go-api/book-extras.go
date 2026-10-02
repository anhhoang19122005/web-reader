package readerapi

import (
	"bytes"
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const undoBookWindow = 30 * time.Second

func bookmarkExcerpt(text string, position int) string {
	runes := []rune(text)
	offset, index := 0, 0
	for index < len(runes) && offset < position {
		offset += utf16Length(runes[index : index+1])
		index++
	}
	start := max(0, index-20)
	end := min(len(runes), start+60)
	return strings.Join(strings.Fields(string(runes[start:end])), " ")
}

func (a *App) bookCover(w http.ResponseWriter, r *http.Request, id uuid.UUID) *apiError {
	book, err := a.findBook(r.Context(), id)
	if err != nil && !errorsIsNoRows(err) {
		return databaseError(err)
	}
	if err != nil || book.CoverStorageKey == "" {
		return newAPIError(404, "COVER_NOT_FOUND", "Sách chưa có bìa.")
	}
	data, err := a.store.Get(r.Context(), book.CoverStorageKey)
	if err != nil {
		return newAPIError(502, "STORAGE_FAILED", "Không tải được bìa sách.")
	}
	mime := http.DetectContentType(data)
	// Untrusted EPUB images must never execute HTML/SVG in the app origin.
	if !strings.HasPrefix(mime, "image/") || mime == "image/svg+xml" {
		return newAPIError(415, "INVALID_COVER", "Định dạng bìa không hỗ trợ.")
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, "cover", book.CreatedAt, bytes.NewReader(data))
	return nil
}

func (a *App) restoreBook(w http.ResponseWriter, r *http.Request, id uuid.UUID) *apiError {
	result, err := a.collection(booksCollection).UpdateOne(r.Context(), bson.M{"_id": id.String(), "userId": singleUserID, "deletedAt": bson.M{"$gte": time.Now().UTC().Add(-undoBookWindow)}}, bson.M{"$unset": bson.M{"deletedAt": ""}})
	if err != nil {
		return databaseError(err)
	}
	if result.MatchedCount == 0 {
		return newAPIError(410, "UNDO_EXPIRED", "Thời gian hoàn tác đã hết.")
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// Purging runs on the local API ticker and library reads (serverless compatible).
// Markers remain until every dependent collection/storage object is cleaned up.
func (a *App) PurgeDeletedBooks(ctx context.Context) error {
	cursor, err := a.collection(booksCollection).Find(ctx, bson.M{"userId": singleUserID, "deletedAt": bson.M{"$lt": time.Now().UTC().Add(-undoBookWindow)}}, options.Find().SetLimit(10))
	if err != nil {
		return err
	}
	defer cursor.Close(ctx)
	for cursor.Next(ctx) {
		var book mongoBook
		if err := cursor.Decode(&book); err != nil {
			return err
		}
		chapters, err := a.chapterSummariesForBook(ctx, book)
		if err != nil {
			return err
		}
		for _, chapter := range chapters {
			chunks, err := a.collection(audioCollection).Find(ctx, bson.M{"chapterId": chapter.ID})
			if err != nil {
				return err
			}
			for chunks.Next(ctx) {
				var audio mongoAudioChunk
				if err := chunks.Decode(&audio); err != nil {
					chunks.Close(ctx)
					return err
				}
				if err := a.store.Delete(ctx, audio.AudioStorageKey); err != nil {
					chunks.Close(ctx)
					return err
				}
				// Commit each cleaned audio so a timeout resumes instead of restarting.
				if _, err := a.collection(audioCollection).DeleteOne(ctx, bson.M{"_id": audio.ID}); err != nil {
					chunks.Close(ctx)
					return err
				}
			}
			err = chunks.Err()
			chunks.Close(ctx)
			if err != nil {
				return err
			}
		}
		for _, key := range []string{book.OriginalFileStorageKey, book.CoverStorageKey} {
			if key != "" {
				if err := a.store.Delete(ctx, key); err != nil {
					return err
				}
			}
		}
		for _, name := range []string{chapterCollection, progressCollection, bookmarkCollection} {
			if _, err := a.collection(name).DeleteMany(ctx, bson.M{"bookId": book.ID}); err != nil {
				return err
			}
		}
		if _, err := a.collection(booksCollection).DeleteOne(ctx, bson.M{"_id": book.ID, "userId": singleUserID, "deletedAt": book.DeletedAt}); err != nil {
			return err
		}
	}
	return cursor.Err()
}
