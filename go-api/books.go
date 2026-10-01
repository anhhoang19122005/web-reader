package readerapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const maxBookBytes = 50 << 20

type bookSummary struct {
	ID              uuid.UUID  `json:"id"`
	Title           string     `json:"title"`
	Author          string     `json:"author"`
	FileType        string     `json:"fileType"`
	HasCover        bool       `json:"hasCover"`
	ChapterCount    int        `json:"chapterCount"`
	CreatedAt       time.Time  `json:"createdAt"`
	ProgressPercent int        `json:"progressPercent"`
	LastReadAt      *time.Time `json:"lastReadAt"`
}

type chapterSummary struct {
	ID            uuid.UUID `json:"id"`
	ChapterNumber int       `json:"chapterNumber"`
	Title         string    `json:"title"`
}

type bookDetail struct {
	ID        uuid.UUID        `json:"id"`
	Title     string           `json:"title"`
	Author    string           `json:"author"`
	FileType  string           `json:"fileType"`
	HasCover  bool             `json:"hasCover"`
	CreatedAt time.Time        `json:"createdAt"`
	Chapters  []chapterSummary `json:"chapters"`
}

type chapterDetail struct {
	ID            uuid.UUID `json:"id"`
	ChapterNumber int       `json:"chapterNumber"`
	Title         string    `json:"title"`
	ContentHTML   string    `json:"contentHtml"`
	PlainText     string    `json:"plainText"`
}

type uploadResponse struct {
	ID           uuid.UUID `json:"id"`
	Title        string    `json:"title"`
	ChapterCount int       `json:"chapterCount"`
}

func (a *App) uploadBook(w http.ResponseWriter, r *http.Request) *apiError {
	r.Body = http.MaxBytesReader(w, r.Body, maxBookBytes+1)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		return newAPIError(http.StatusRequestEntityTooLarge, "FILE_TOO_LARGE", "Tệp vượt quá giới hạn 50 MB.")
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		return newAPIError(http.StatusBadRequest, "EMPTY_FILE", "Tệp sách không có nội dung.")
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, maxBookBytes+1))
	if err != nil {
		return newAPIError(http.StatusBadRequest, "UPLOAD_FAILED", "Không thể nhận tệp EPUB hoặc PDF.")
	}
	if len(content) == 0 {
		return newAPIError(http.StatusBadRequest, "EMPTY_FILE", "Tệp sách không có nội dung.")
	}
	if len(content) > maxBookBytes {
		return newAPIError(http.StatusRequestEntityTooLarge, "FILE_TOO_LARGE", "Tệp vượt quá giới hạn 50 MB.")
	}
	return a.saveBook(w, r.Context(), header.Filename, content)
}

func (a *App) signUpload(w http.ResponseWriter, r *http.Request) *apiError {
	store, ok := a.store.(signedUploadStore)
	if !ok {
		return newAPIError(http.StatusBadRequest, "DIRECT_UPLOAD_UNAVAILABLE", "Upload trực tiếp chỉ dùng khi cấu hình Supabase Storage.")
	}
	var request struct {
		Filename string `json:"filename"`
	}
	if err := decodeJSON(r, &request); err != nil || fileType(request.Filename) == "" {
		return newAPIError(http.StatusBadRequest, "UNSUPPORTED_FILE_TYPE", "Chỉ hỗ trợ tệp EPUB hoặc PDF.")
	}
	key := "incoming/" + uuid.NewString() + fileType(request.Filename)
	token, err := store.CreateSignedUpload(r.Context(), key)
	if err != nil {
		return newAPIError(http.StatusBadGateway, "STORAGE_FAILED", "Không thể tạo URL upload.")
	}
	writeJSON(w, http.StatusOK, map[string]string{"path": key, "token": token, "bucket": a.config.SupabaseBucket})
	return nil
}

func (a *App) importBook(w http.ResponseWriter, r *http.Request) *apiError {
	var request struct {
		StorageKey string `json:"storageKey"`
	}
	if err := decodeJSON(r, &request); err != nil || !strings.HasPrefix(request.StorageKey, "incoming/") || fileType(request.StorageKey) == "" {
		return newAPIError(http.StatusBadRequest, "INVALID_STORAGE_KEY", "Tệp upload không hợp lệ.")
	}
	defer a.store.Delete(r.Context(), request.StorageKey)
	content, err := a.store.Get(r.Context(), request.StorageKey)
	if err != nil || len(content) == 0 || len(content) > maxBookBytes {
		return newAPIError(http.StatusBadRequest, "UPLOAD_FAILED", "Không thể đọc tệp vừa upload.")
	}
	return a.saveBook(w, r.Context(), path.Base(request.StorageKey), content)
}

func (a *App) saveBook(w http.ResponseWriter, ctx context.Context, filename string, content []byte) *apiError {
	book, parseErr := parseBook(filename, content)
	if parseErr != nil {
		return parseErr
	}
	bookID := uuid.New()
	sourceKey := "books/" + bookID.String() + "/source" + fileType(filename)
	if err := a.store.Put(ctx, sourceKey, content, contentType(sourceKey)); err != nil {
		return newAPIError(http.StatusInternalServerError, "STORAGE_FAILED", "Không thể lưu tệp.")
	}
	coverKey := ""
	if len(book.Cover) > 0 {
		coverKey = "books/" + bookID.String() + "/cover" + book.CoverExtension
		if err := a.store.Put(ctx, coverKey, book.Cover, contentType(coverKey)); err != nil {
			_ = a.store.Delete(ctx, sourceKey)
			return newAPIError(http.StatusInternalServerError, "STORAGE_FAILED", "Không thể lưu ảnh bìa.")
		}
	}
	if err := a.insertBook(ctx, bookID, sourceKey, coverKey, strings.TrimPrefix(strings.ToUpper(fileType(filename)), "."), book); err != nil {
		_ = a.store.Delete(ctx, coverKey)
		_ = a.store.Delete(ctx, sourceKey)
		return databaseError(err)
	}
	writeJSON(w, http.StatusCreated, uploadResponse{ID: bookID, Title: book.Title, ChapterCount: len(book.Chapters)})
	return nil
}

func (a *App) insertBook(ctx context.Context, bookID uuid.UUID, sourceKey, coverKey, fileKind string, book parsedBook) error {
	document := mongoBook{
		ID:                     bookID.String(),
		UserID:                 singleUserID,
		Title:                  book.Title,
		Author:                 book.Author,
		CoverStorageKey:        coverKey,
		OriginalFileStorageKey: sourceKey,
		FileType:               fileKind,
		Language:               "vi",
		CreatedAt:              time.Now().UTC(),
		ChapterCount:           len(book.Chapters),
	}
	chapters := make([]any, 0, len(book.Chapters))
	for index, chapter := range book.Chapters {
		chapters = append(chapters, mongoChapter{
			ID:            uuid.NewString(),
			BookID:        bookID.String(),
			ChapterNumber: index + 1,
			Title:         chapter.Title,
			ContentHTML:   chapter.ContentHTML,
			PlainText:     chapter.PlainText,
			ContentHash:   hash(chapter.PlainText),
		})
	}
	_, err := a.collection(booksCollection).InsertOne(ctx, document)
	if err != nil {
		return err
	}
	if len(chapters) == 0 {
		return nil
	}
	if _, err := a.collection(chapterCollection).InsertMany(ctx, chapters); err != nil {
		_, _ = a.collection(booksCollection).DeleteOne(ctx, bson.M{"_id": document.ID, "userId": singleUserID})
		return err
	}
	return nil
}

func (a *App) listBooks(w http.ResponseWriter, r *http.Request) *apiError {
	cursor, err := a.collection(booksCollection).Find(r.Context(), bson.M{"userId": singleUserID}, options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}))
	if err != nil {
		return databaseError(err)
	}
	defer cursor.Close(r.Context())
	books := []bookSummary{}
	for cursor.Next(r.Context()) {
		var document mongoBook
		if err := cursor.Decode(&document); err != nil {
			return databaseError(err)
		}
		if document.ChapterCount == 0 {
			count, err := a.collection(chapterCollection).CountDocuments(r.Context(), bson.M{"bookId": document.ID})
			if err != nil {
				return databaseError(err)
			}
			document.ChapterCount = int(count)
			if count == 0 {
				document.ChapterCount = len(document.Chapters)
			}
			if _, err := a.collection(booksCollection).UpdateOne(r.Context(), bson.M{"_id": document.ID, "userId": singleUserID}, bson.M{"$set": bson.M{"chapterCount": document.ChapterCount}}); err != nil {
				return databaseError(err)
			}
		}
		id, err := mongoID(document.ID)
		if err != nil {
			return databaseError(err)
		}
		book := bookSummary{ID: id, Title: document.Title, Author: document.Author, FileType: document.FileType, HasCover: document.CoverStorageKey != "", ChapterCount: document.ChapterCount, CreatedAt: document.CreatedAt}
		var progress mongoProgress
		progressErr := a.collection(progressCollection).FindOne(r.Context(), bson.M{"userId": singleUserID, "bookId": document.ID}).Decode(&progress)
		if progressErr == nil {
			book.LastReadAt = &progress.UpdatedAt
			chapterID, err := mongoID(progress.ChapterID)
			if err != nil {
				return databaseError(err)
			}
			_, chapter, err := a.findChapter(r.Context(), id, chapterID)
			if err != nil && !errorsIsNoRows(err) {
				return databaseError(err)
			}
			if err == nil {
				position := float64(0)
				if length := len([]rune(chapter.PlainText)); length > 0 {
					position = min(1, float64(progress.CharacterPosition)/float64(length))
				}
				book.ProgressPercent = min(100, int((float64(chapter.ChapterNumber-1)+position)*100/float64(maxInt(1, document.ChapterCount))+0.5))
			}
		} else if !errorsIsNoRows(progressErr) {
			return databaseError(progressErr)
		}
		books = append(books, book)
	}
	if err := cursor.Err(); err != nil {
		return databaseError(err)
	}
	writeJSON(w, http.StatusOK, books)
	return nil
}

func (a *App) bookRoute(w http.ResponseWriter, r *http.Request, requestPath string) *apiError {
	parts := strings.Split(strings.Trim(requestPath, "/"), "/")
	if len(parts) < 2 {
		return newAPIError(http.StatusNotFound, "NOT_FOUND", "Không tìm thấy API.")
	}
	bookID, err := uuid.Parse(parts[1])
	if err != nil {
		return newAPIError(http.StatusBadRequest, "INVALID_BOOK_ID", "ID sách không hợp lệ.")
	}
	if len(parts) == 2 && r.Method == http.MethodGet {
		return a.getBook(w, r, bookID)
	}
	if len(parts) == 2 && r.Method == http.MethodDelete {
		return a.deleteBook(w, r, bookID)
	}
	if len(parts) == 4 && parts[2] == "chapters" && r.Method == http.MethodGet {
		chapterID, err := uuid.Parse(parts[3])
		if err != nil {
			return newAPIError(http.StatusBadRequest, "INVALID_CHAPTER_ID", "ID chapter không hợp lệ.")
		}
		return a.getChapter(w, r, bookID, chapterID)
	}
	return newAPIError(http.StatusNotFound, "NOT_FOUND", "Không tìm thấy API.")
}

func (a *App) getBook(w http.ResponseWriter, r *http.Request, bookID uuid.UUID) *apiError {
	document, err := a.findBook(r.Context(), bookID)
	if errorsIsNoRows(err) {
		return newAPIError(http.StatusNotFound, "BOOK_NOT_FOUND", "Không tìm thấy sách.")
	}
	if err != nil {
		return databaseError(err)
	}
	chapters, chapterErr := a.chapterSummariesForBook(r.Context(), document)
	if chapterErr != nil {
		return databaseError(chapterErr)
	}
	book := bookDetail{ID: bookID, Title: document.Title, Author: document.Author, FileType: document.FileType, HasCover: document.CoverStorageKey != "", CreatedAt: document.CreatedAt, Chapters: make([]chapterSummary, 0, len(chapters))}
	for _, chapter := range chapters {
		chapterID, err := mongoID(chapter.ID)
		if err != nil {
			return databaseError(err)
		}
		book.Chapters = append(book.Chapters, chapterSummary{ID: chapterID, ChapterNumber: chapter.ChapterNumber, Title: chapter.Title})
	}
	writeJSON(w, http.StatusOK, book)
	return nil
}

func (a *App) getChapter(w http.ResponseWriter, r *http.Request, bookID, chapterID uuid.UUID) *apiError {
	_, document, err := a.findChapter(r.Context(), bookID, chapterID)
	if errorsIsNoRows(err) {
		return newAPIError(http.StatusNotFound, "CHAPTER_NOT_FOUND", "Không tìm thấy chapter.")
	}
	if err != nil {
		return databaseError(err)
	}
	chapter := chapterDetail{ID: chapterID, ChapterNumber: document.ChapterNumber, Title: document.Title, ContentHTML: document.ContentHTML, PlainText: document.PlainText}
	writeJSON(w, http.StatusOK, chapter)
	return nil
}

func (a *App) deleteBook(w http.ResponseWriter, r *http.Request, bookID uuid.UUID) *apiError {
	document, err := a.findBook(r.Context(), bookID)
	if errorsIsNoRows(err) {
		return newAPIError(http.StatusNotFound, "BOOK_NOT_FOUND", "Không tìm thấy sách.")
	}
	if err != nil {
		return databaseError(err)
	}
	if _, err := a.collection(booksCollection).DeleteOne(r.Context(), bson.M{"_id": bookID.String(), "userId": singleUserID}); err != nil {
		return databaseError(err)
	}
	chapters, chapterErr := a.chapterSummariesForBook(r.Context(), document)
	if chapterErr != nil {
		return databaseError(chapterErr)
	}
	chapterIDs := make([]string, 0, len(chapters))
	for _, chapter := range chapters {
		chapterIDs = append(chapterIDs, chapter.ID)
	}
	if len(chapterIDs) > 0 {
		_, _ = a.collection(audioCollection).DeleteMany(r.Context(), bson.M{"chapterId": bson.M{"$in": chapterIDs}})
	}
	_, _ = a.collection(chapterCollection).DeleteMany(r.Context(), bson.M{"bookId": bookID.String()})
	_, _ = a.collection(progressCollection).DeleteOne(r.Context(), bson.M{"userId": singleUserID, "bookId": bookID.String()})
	_, _ = a.collection(bookmarkCollection).DeleteMany(r.Context(), bson.M{"userId": singleUserID, "bookId": bookID.String()})
	_ = a.store.Delete(r.Context(), document.OriginalFileStorageKey)
	if document.CoverStorageKey != "" {
		_ = a.store.Delete(r.Context(), document.CoverStorageKey)
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (a *App) ownedBook(ctx context.Context, bookID uuid.UUID) *apiError {
	err := a.collection(booksCollection).FindOne(ctx, bson.M{"_id": bookID.String(), "userId": singleUserID}, options.FindOne().SetProjection(bson.M{"_id": 1})).Err()
	if err != nil {
		if errorsIsNoRows(err) {
			return newAPIError(http.StatusNotFound, "BOOK_NOT_FOUND", "Không tìm thấy sách.")
		}
		return databaseError(err)
	}
	return nil
}

func fileType(filename string) string {
	switch {
	case strings.HasSuffix(strings.ToLower(filename), ".epub"):
		return ".epub"
	case strings.HasSuffix(strings.ToLower(filename), ".pdf"):
		return ".pdf"
	default:
		return ""
	}
}

func contentType(key string) string {
	switch strings.ToLower(path.Ext(key)) {
	case ".epub":
		return "application/epub+zip"
	case ".pdf":
		return "application/pdf"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	default:
		return "application/octet-stream"
	}
}

func hash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func min[T ~int | ~float64](left, right T) T {
	if left < right {
		return left
	}
	return right
}

func (a *App) ensureChapter(ctx context.Context, bookID, chapterID uuid.UUID) *apiError {
	_, _, err := a.findChapter(ctx, bookID, chapterID)
	if err == nil {
		return nil
	}
	if errorsIsNoRows(err) {
		return newAPIError(http.StatusNotFound, "CHAPTER_NOT_FOUND", "Không tìm thấy chapter.")
	}
	return databaseError(err)
}
