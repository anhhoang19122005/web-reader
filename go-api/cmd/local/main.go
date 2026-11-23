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
	go func() {
		// Shortly after start (the API may have been off for days), then every 6 hours.
		timer := time.NewTimer(time.Minute)
		defer timer.Stop()
		for range timer.C {
			cleanup, done := context.WithTimeout(context.Background(), 5*time.Minute)
			if removed, err := app.PurgeStaleAudio(cleanup); err != nil {
				log.Printf("Purge stale audio: %v", err)
			} else if removed > 0 {
				log.Printf("Purge stale audio: removed %d cached chunks", removed)
			}
			done()
			timer.Reset(6 * time.Hour)
		}
	}()
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}
	log.Printf("Go API: http://localhost:%s/api/health", port)
	log.Fatal(http.ListenAndServe(":"+port, app))
}
