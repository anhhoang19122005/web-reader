package readerapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPrivateAPI(t *testing.T) {
	app := &App{config: Config{AccessToken: "private-test-token"}}
	for _, token := range []string{"", "wrong", "private-test-token"} {
		r := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		r.Header.Set("X-Reader-Token", token)
		w := httptest.NewRecorder()
		app.ServeHTTP(w, r)
		want := http.StatusUnauthorized
		if token == "private-test-token" {
			want = http.StatusOK
		}
		if w.Code != want {
			t.Fatalf("token %q: got %d, want %d", token, w.Code, want)
		}
	}
}
