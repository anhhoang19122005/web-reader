package readerapi

import (
	"context"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

func (a *App) Migrate(ctx context.Context) error {
	_, err := a.collection(booksCollection).Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "userId", Value: 1}, {Key: "createdAt", Value: -1}}},
	})
	if err != nil {
		return err
	}
	_, err = a.collection(chapterCollection).Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "bookId", Value: 1}, {Key: "chapterNumber", Value: 1}},
	})
	if err != nil {
		return err
	}
	_, err = a.collection(progressCollection).Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "userId", Value: 1}, {Key: "bookId", Value: 1}},
		Options: options.Index().SetUnique(true),
	})
	if err != nil {
		return err
	}
	_, err = a.collection(bookmarkCollection).Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "userId", Value: 1}, {Key: "bookId", Value: 1}, {Key: "createdAt", Value: -1}},
	})
	if err != nil {
		return err
	}
	_, err = a.collection(audioCollection).Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{
			{Key: "chapterId", Value: 1}, {Key: "chunkIndex", Value: 1}, {Key: "voiceId", Value: 1},
			{Key: "speakingRate", Value: 1}, {Key: "pitch", Value: 1}, {Key: "volume", Value: 1}, {Key: "textHash", Value: 1},
		},
	})
	return err
}
