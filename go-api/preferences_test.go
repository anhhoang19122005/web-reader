package readerapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestValidatePreferences(t *testing.T) {
	for _, sample := range []struct {
		body  string
		valid bool
	}{
		{`{"theme":"sakura","font":"serif","fontSize":24,"lineHeight":1.8,"columnWidth":68,"leaves":false,"sound":"rain","ambientVolume":0.2}`, true},
		{`{"fontSize":16}`, true}, {`{"fontSize":28}`, true}, {`{"lineHeight":2.2}`, true},
		{`{}`, false}, {`{"fontSize":29}`, false}, {`{"fontSize":20.5}`, false}, {`{"lineHeight":1.85}`, false},
		{`{"columnWidth":70}`, false}, {`{"ambientVolume":0.31}`, false}, {`{"leaves":"true"}`, false},
		{`{"theme":"invalid"}`, false}, {`{"font":null}`, false}, {`{"enabled":true}`, false}, {`{"userId":"other"}`, false},
	} {
		var values map[string]json.RawMessage
		if err := json.Unmarshal([]byte(sample.body), &values); err != nil {
			t.Fatal(err)
		}
		set, valid := validatePreferences(values)
		if valid != sample.valid {
			t.Fatalf("%s: valid=%v", sample.body, valid)
		}
		if valid && len(set) != len(values) {
			t.Fatal("patch must update only submitted fields")
		}
	}
}

func TestPreferencesMongoIntegration(t *testing.T) {
	if os.Getenv("READER_INTEGRATION_TEST") != "true" {
		t.Skip("set READER_INTEGRATION_TEST=true with MongoDB credentials")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	app, err := NewApp(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	// A unique test database protects the real user's preferences and progress.
	app.db = app.client.Database("rpt_" + strings.ReplaceAll(uuid.NewString(), "-", ""))
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		if err := app.db.Drop(cleanup); err != nil {
			t.Error(err)
		}
	}()
	request := func(method, body string, status int) preferencesDocument {
		r := httptest.NewRequest(method, "/api/reader/preferences", strings.NewReader(body)).WithContext(ctx)
		r.Header.Set("X-Reader-Token", app.config.AccessToken)
		w := httptest.NewRecorder()
		app.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s: status=%d body=%s", method, w.Code, w.Body.String())
		}
		var result preferencesDocument
		if status == 200 && json.Unmarshal(w.Body.Bytes(), &result) != nil {
			t.Fatal("invalid response")
		}
		return result
	}
	if request(http.MethodGet, "", 200).Preferences != nil {
		t.Fatal("new user must have no preferences")
	}
	request(http.MethodPatch, `{"font":"serif","fontSize":24}`, 200)
	request(http.MethodPatch, `{"theme":"ocean"}`, 200)
	request(http.MethodPatch, `{"fontSize":99}`, 400)
	result := request(http.MethodGet, "", 200)
	if result.Preferences["font"] != "serif" || result.Preferences["theme"] != "ocean" || result.Preferences["fontSize"] != float64(24) || result.UpdatedAt == nil {
		t.Fatalf("partial patches lost fields: %+v", result)
	}
}
