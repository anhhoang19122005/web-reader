package handler

import (
	"context"
	"net/http"
	"sync"
	"time"

	readerapi "novel-reader-go"
)

var (
	app     *readerapi.App
	appErr  error
	appOnce sync.Once
)

func Handler(w http.ResponseWriter, r *http.Request) {
	appOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		app, appErr = readerapi.NewApp(ctx)
	})
	if appErr != nil {
		http.Error(w, "Không thể khởi tạo API.", http.StatusInternalServerError)
		return
	}
	app.ServeHTTP(w, r)
}
