package readerapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type readingProgress struct {
	BookID            uuid.UUID  `json:"bookId"`
	ChapterID         *uuid.UUID `json:"chapterId"`
	CharacterPosition int        `json:"characterPosition"`
	UpdatedAt         *time.Time `json:"updatedAt"`
}

type bookmark struct {
	ID                uuid.UUID `json:"id"`
	ChapterID         uuid.UUID `json:"chapterId"`
	CharacterPosition int       `json:"characterPosition"`
	Note              *string   `json:"note"`
	Excerpt           string    `json:"excerpt"`
	ChapterTitle      string    `json:"chapterTitle"`
	CreatedAt         time.Time `json:"createdAt"`
}

func (a *App) getProgress(w http.ResponseWriter, r *http.Request, requestPath string) *apiError {
	bookID, err := pathID(requestPath, "/reader/progress/")
	if err != nil {
		return newAPIError(http.StatusBadRequest, "INVALID_BOOK_ID", "ID sách không hợp lệ.")
	}
	if owned := a.ownedBook(r.Context(), bookID); owned != nil {
		return owned
	}
	progress := readingProgress{BookID: bookID}
	var document mongoProgress
	err = a.collection(progressCollection).FindOne(r.Context(), bson.M{"userId": singleUserID, "bookId": bookID.String()}).Decode(&document)
	if errorsIsNoRows(err) {
		writeJSON(w, http.StatusOK, progress)
		return nil
	}
	if err != nil {
		return databaseError(err)
	}
	chapterID, err := uuid.Parse(document.ChapterID)
	if err != nil {
		return databaseError(err)
	}
	progress.ChapterID = &chapterID
	progress.CharacterPosition = document.CharacterPosition
	progress.UpdatedAt = &document.UpdatedAt
	writeJSON(w, http.StatusOK, progress)
	return nil
}

func (a *App) saveProgress(w http.ResponseWriter, r *http.Request, requestPath string) *apiError {
	bookID, err := pathID(requestPath, "/reader/progress/")
	if err != nil {
		return newAPIError(http.StatusBadRequest, "INVALID_BOOK_ID", "ID sách không hợp lệ.")
	}
	var request struct {
		ChapterID         uuid.UUID `json:"chapterId"`
		CharacterPosition int       `json:"characterPosition"`
	}
	if decodeErr := decodeJSON(r, &request); decodeErr != nil || request.ChapterID == uuid.Nil || request.CharacterPosition < 0 {
		return newAPIError(http.StatusBadRequest, "VALIDATION_ERROR", "Dữ liệu không hợp lệ.")
	}
	_, chapter, err := a.findChapter(r.Context(), bookID, request.ChapterID)
	if errorsIsNoRows(err) {
		return newAPIError(http.StatusNotFound, "CHAPTER_NOT_FOUND", "Không tìm thấy chapter.")
	}
	if err != nil {
		return databaseError(err)
	}
	document, err := a.advanceProgress(r.Context(), bookID, chapter, request.CharacterPosition)
	if err != nil {
		return databaseError(err)
	}
	chapterID, err := uuid.Parse(document.ChapterID)
	if err != nil {
		return databaseError(err)
	}
	writeJSON(w, http.StatusOK, readingProgress{BookID: bookID, ChapterID: &chapterID, CharacterPosition: document.CharacterPosition, UpdatedAt: &document.UpdatedAt})
	return nil
}

func (a *App) advanceProgress(ctx context.Context, bookID uuid.UUID, chapter mongoChapter, position int) (mongoProgress, error) {
	filter := bson.M{"userId": singleUserID, "bookId": bookID.String()}
	for {
		var saved mongoProgress
		err := a.collection(progressCollection).FindOne(ctx, filter).Decode(&saved)
		next := mongoProgress{ID: singleUserID + ":" + bookID.String(), UserID: singleUserID, BookID: bookID.String(), ChapterID: chapter.ID, CharacterPosition: position, UpdatedAt: time.Now().UTC().Truncate(time.Millisecond)}
		if errorsIsNoRows(err) {
			_, err = a.collection(progressCollection).InsertOne(ctx, next)
			if mongo.IsDuplicateKeyError(err) {
				continue
			}
			return next, err
		}
		if err != nil {
			return mongoProgress{}, err
		}
		next.ID = saved.ID
		savedNumber := chapter.ChapterNumber
		if saved.ChapterID != chapter.ID {
			id, err := uuid.Parse(saved.ChapterID)
			if err != nil {
				return mongoProgress{}, err
			}
			_, previous, err := a.findChapter(ctx, bookID, id)
			if err != nil {
				return mongoProgress{}, err
			}
			savedNumber = previous.ChapterNumber
		}
		if chapter.ChapterNumber < savedNumber || (chapter.ChapterNumber == savedNumber && position <= saved.CharacterPosition) {
			return saved, nil
		}
		// Only replace the position we compared; retry if another request advanced it.
		result, err := a.collection(progressCollection).ReplaceOne(ctx, bson.M{
			"userId": singleUserID, "bookId": bookID.String(), "chapterId": saved.ChapterID, "characterPosition": saved.CharacterPosition,
		}, next)
		if err != nil {
			return mongoProgress{}, err
		}
		if result.MatchedCount != 0 {
			return next, nil
		}
	}
}

func (a *App) bookmarkRoute(w http.ResponseWriter, r *http.Request, requestPath string) *apiError {
	parts := strings.Split(strings.Trim(requestPath, "/"), "/")
	if len(parts) < 3 {
		return newAPIError(http.StatusNotFound, "NOT_FOUND", "Không tìm thấy API.")
	}
	bookID, err := uuid.Parse(parts[2])
	if err != nil {
		return newAPIError(http.StatusBadRequest, "INVALID_BOOK_ID", "ID sách không hợp lệ.")
	}
	switch {
	case r.Method == http.MethodGet && len(parts) == 3:
		return a.listBookmarks(w, r, bookID)
	case r.Method == http.MethodPost && len(parts) == 3:
		return a.createBookmark(w, r, bookID)
	case r.Method == http.MethodDelete && len(parts) == 4:
		bookmarkID, err := uuid.Parse(parts[3])
		if err != nil {
			return newAPIError(http.StatusBadRequest, "INVALID_BOOKMARK_ID", "ID bookmark không hợp lệ.")
		}
		return a.deleteBookmark(w, r, bookID, bookmarkID)
	default:
		return newAPIError(http.StatusNotFound, "NOT_FOUND", "Không tìm thấy API.")
	}
}

func (a *App) listBookmarks(w http.ResponseWriter, r *http.Request, bookID uuid.UUID) *apiError {
	if owned := a.ownedBook(r.Context(), bookID); owned != nil {
		return owned
	}
	cursor, err := a.collection(bookmarkCollection).Find(r.Context(), bson.M{"userId": singleUserID, "bookId": bookID.String()}, options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}))
	if err != nil {
		return databaseError(err)
	}
	defer cursor.Close(r.Context())
	bookmarks := []bookmark{}
	legacyChapters := map[string]mongoChapter{}
	for cursor.Next(r.Context()) {
		var document mongoBookmark
		if err := cursor.Decode(&document); err != nil {
			return databaseError(err)
		}
		bookmarkID, err := uuid.Parse(document.ID)
		chapterID, chapterErr := uuid.Parse(document.ChapterID)
		if err != nil || chapterErr != nil {
			if err != nil {
				return databaseError(err)
			}
			return databaseError(chapterErr)
		}
		if document.Excerpt == "" {
			chapter, loaded := legacyChapters[document.ChapterID]
			var chapterErr error
			if !loaded {
				_, chapter, chapterErr = a.findChapter(r.Context(), bookID, chapterID)
				if chapterErr == nil {
					legacyChapters[document.ChapterID] = chapter
				}
			}
			if chapterErr == nil {
				document.Excerpt = bookmarkExcerpt(chapter.PlainText, document.CharacterPosition)
				document.ChapterTitle = chapter.Title
			}
		}
		bookmarks = append(bookmarks, bookmark{ID: bookmarkID, ChapterID: chapterID, CharacterPosition: document.CharacterPosition, Note: document.Note, Excerpt: document.Excerpt, ChapterTitle: document.ChapterTitle, CreatedAt: document.CreatedAt})
	}
	if err := cursor.Err(); err != nil {
		return databaseError(err)
	}
	writeJSON(w, http.StatusOK, bookmarks)
	return nil
}

func (a *App) createBookmark(w http.ResponseWriter, r *http.Request, bookID uuid.UUID) *apiError {
	var request struct {
		ChapterID         uuid.UUID `json:"chapterId"`
		CharacterPosition int       `json:"characterPosition"`
		Note              *string   `json:"note"`
	}
	if decodeErr := decodeJSON(r, &request); decodeErr != nil || request.ChapterID == uuid.Nil || request.CharacterPosition < 0 || (request.Note != nil && len([]rune(*request.Note)) > 1000) {
		return newAPIError(http.StatusBadRequest, "VALIDATION_ERROR", "Dữ liệu không hợp lệ.")
	}
	_, chapter, chapterErr := a.findChapter(r.Context(), bookID, request.ChapterID)
	if chapterErr != nil {
		return newAPIError(404, "CHAPTER_NOT_FOUND", "Không tìm thấy chương.")
	}
	if request.CharacterPosition > utf16Length([]rune(chapter.PlainText)) {
		return newAPIError(400, "VALIDATION_ERROR", "Vị trí vượt quá nội dung chương.")
	}
	createdAt := time.Now().UTC()
	value := bookmark{ID: uuid.New(), ChapterID: request.ChapterID, CharacterPosition: request.CharacterPosition, Note: request.Note, Excerpt: bookmarkExcerpt(chapter.PlainText, request.CharacterPosition), ChapterTitle: chapter.Title, CreatedAt: createdAt}
	document := mongoBookmark{ID: value.ID.String(), UserID: singleUserID, BookID: bookID.String(), ChapterID: value.ChapterID.String(), CharacterPosition: value.CharacterPosition, Note: value.Note, Excerpt: value.Excerpt, ChapterTitle: value.ChapterTitle, CreatedAt: value.CreatedAt}
	if _, err := a.collection(bookmarkCollection).InsertOne(r.Context(), document); err != nil {
		return databaseError(err)
	}
	writeJSON(w, http.StatusCreated, value)
	return nil
}

func (a *App) deleteBookmark(w http.ResponseWriter, r *http.Request, bookID, bookmarkID uuid.UUID) *apiError {
	result, err := a.collection(bookmarkCollection).DeleteOne(r.Context(), bson.M{"_id": bookmarkID.String(), "userId": singleUserID, "bookId": bookID.String()})
	if err != nil {
		return databaseError(err)
	}
	if result.DeletedCount == 0 {
		return newAPIError(http.StatusNotFound, "BOOKMARK_NOT_FOUND", "Không tìm thấy bookmark.")
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func pathID(requestPath, prefix string) (uuid.UUID, error) {
	return uuid.Parse(strings.TrimPrefix(requestPath, prefix))
}
