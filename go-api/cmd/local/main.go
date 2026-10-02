package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	readerapi "novel-reader-go"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	app, err := readerapi.NewApp(ctx)
	if err != nil {
		log.Fatal(err)
	}
	defer app.Close()
	if os.Getenv("AUTO_MIGRATE") == "true" {
		if err := app.Migrate(context.Background()); err != nil {
			log.Fatal(err)
		}
	}
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			cleanup, done := context.WithTimeout(context.Background(), 30*time.Second)
			if err := app.PurgeDeletedBooks(cleanup); err != nil {
				log.Printf("Purge deleted books: %v", err)
			}
			done()
		}
	}()
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}
	log.Printf("Go API: http://localhost:%s/api/health", port)
	log.Fatal(http.ListenAndServe(":"+port, app))
}
