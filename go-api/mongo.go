package readerapi

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const (
	booksCollection    = "books"
	chapterCollection  = "chapters"
	progressCollection = "reading_progress"
	bookmarkCollection = "bookmarks"
	audioCollection    = "audio_chunks"
)

type mongoBook struct {
	ID                     string         `bson:"_id"`
	UserID                 string         `bson:"userId"`
	Title                  string         `bson:"title"`
	Author                 string         `bson:"author"`
	CoverStorageKey        string         `bson:"coverStorageKey,omitempty"`
	OriginalFileStorageKey string         `bson:"originalFileStorageKey"`
	FileType               string         `bson:"fileType"`
	Language               string         `bson:"language"`
	CreatedAt              time.Time      `bson:"createdAt"`
	Chapters               []mongoChapter `bson:"chapters,omitempty"` // legacy documents only
}

type mongoChapter struct {
	ID            string `bson:"id"`
	BookID        string `bson:"bookId"`
	ChapterNumber int    `bson:"chapterNumber"`
	Title         string `bson:"title"`
	ContentHTML   string `bson:"contentHtml"`
	PlainText     string `bson:"plainText"`
	ContentHash   string `bson:"contentHash"`
}

type mongoProgress struct {
	ID                string    `bson:"_id"`
	UserID            string    `bson:"userId"`
	BookID            string    `bson:"bookId"`
	ChapterID         string    `bson:"chapterId"`
	CharacterPosition int       `bson:"characterPosition"`
	UpdatedAt         time.Time `bson:"updatedAt"`
}

type mongoBookmark struct {
	ID                string    `bson:"_id"`
	UserID            string    `bson:"userId"`
	BookID            string    `bson:"bookId"`
	ChapterID         string    `bson:"chapterId"`
	CharacterPosition int       `bson:"characterPosition"`
	Note              *string   `bson:"note,omitempty"`
	CreatedAt         time.Time `bson:"createdAt"`
}

type mongoAudioChunk struct {
	ID              string    `bson:"_id"`
	ChapterID       string    `bson:"chapterId"`
	ChunkIndex      int       `bson:"chunkIndex"`
	TextHash        string    `bson:"textHash"`
	Text            string    `bson:"text"`
	VoiceID         string    `bson:"voiceId"`
	SpeakingRate    float64   `bson:"speakingRate"`
	Pitch           float64   `bson:"pitch"`
	Volume          float64   `bson:"volume"`
	StartCharacter  int       `bson:"startCharacter"`
	EndCharacter    int       `bson:"endCharacter"`
	AudioStorageKey string    `bson:"audioStorageKey"`
	MimeType        string    `bson:"mimeType"`
	DurationMS      int       `bson:"durationMs"`
	CreatedAt       time.Time `bson:"createdAt"`
}

func (a *App) collection(name string) *mongo.Collection {
	return a.db.Collection(name)
}

func (a *App) findBook(ctx context.Context, bookID uuid.UUID) (mongoBook, error) {
	var book mongoBook
	err := a.collection(booksCollection).FindOne(ctx, bson.M{"_id": bookID.String(), "userId": singleUserID}).Decode(&book)
	return book, err
}

func (a *App) findChapter(ctx context.Context, bookID, chapterID uuid.UUID) (mongoBook, mongoChapter, error) {
	book, err := a.findBook(ctx, bookID)
	if err != nil {
		return mongoBook{}, mongoChapter{}, err
	}
	var chapter mongoChapter
	err = a.collection(chapterCollection).FindOne(ctx, bson.M{"bookId": book.ID, "id": chapterID.String()}).Decode(&chapter)
	if err == nil {
		return book, chapter, nil
	}
	if !errorsIsNoRows(err) {
		return mongoBook{}, mongoChapter{}, err
	}
	// Keep reads compatible with books created by the first Mongo version.
	for _, chapter := range book.Chapters {
		if chapter.ID == chapterID.String() {
			return book, chapter, nil
		}
	}
	return mongoBook{}, mongoChapter{}, mongo.ErrNoDocuments
}

func (a *App) ownedChapterDocument(ctx context.Context, chapterID uuid.UUID) (mongoBook, mongoChapter, error) {
	var chapter mongoChapter
	err := a.collection(chapterCollection).FindOne(ctx, bson.M{"id": chapterID.String()}).Decode(&chapter)
	if err == nil {
		bookID, parseErr := uuid.Parse(chapter.BookID)
		if parseErr != nil {
			return mongoBook{}, mongoChapter{}, parseErr
		}
		book, bookErr := a.findBook(ctx, bookID)
		return book, chapter, bookErr
	}
	if !errorsIsNoRows(err) {
		return mongoBook{}, mongoChapter{}, err
	}
	// Keep reads compatible with books created by the first Mongo version.
	var book mongoBook
	err = a.collection(booksCollection).FindOne(ctx, bson.M{"userId": singleUserID, "chapters.id": chapterID.String()}).Decode(&book)
	if err != nil {
		return mongoBook{}, mongoChapter{}, err
	}
	for _, chapter := range book.Chapters {
		if chapter.ID == chapterID.String() {
			return book, chapter, nil
		}
	}
	return mongoBook{}, mongoChapter{}, mongo.ErrNoDocuments
}

func (a *App) chaptersForBook(ctx context.Context, book mongoBook) ([]mongoChapter, error) {
	cursor, err := a.collection(chapterCollection).Find(ctx, bson.M{"bookId": book.ID}, options.Find().SetSort(bson.D{{Key: "chapterNumber", Value: 1}}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	chapters := []mongoChapter{}
	for cursor.Next(ctx) {
		var chapter mongoChapter
		if err := cursor.Decode(&chapter); err != nil {
			return nil, err
		}
		chapters = append(chapters, chapter)
	}
	if err := cursor.Err(); err != nil {
		return nil, err
	}
	if len(chapters) == 0 {
		return book.Chapters, nil
	}
	return chapters, nil
}

func mongoID(value string) (uuid.UUID, error) { return uuid.Parse(value) }

func errorsIsNoRows(err error) bool { return errors.Is(err, mongo.ErrNoDocuments) }
