package main

import (
	"context"
	"log"
	"time"

	readerapi "novel-reader-go"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	app, err := readerapi.NewApp(ctx)
	if err != nil {
		log.Fatal(err)
	}
	defer app.Close()
	if err := app.Migrate(ctx); err != nil {
		log.Fatal(err)
	}
	log.Print("Đã tạo index MongoDB Atlas.")
}
