package readerapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const singleUserID = "00000000-0000-0000-0000-000000000001"

type Config struct {
	AccessToken     string
	VieNeuURL       string
	MongoURI        string
	MongoDatabase   string
	StorageProvider string
	StoragePath     string
	SupabaseURL     string
	SupabaseKey     string
	SupabaseBucket  string
	SaydiKeys       []string
	SaydiVoiceID    string
	SaydiVoiceName  string
	AllowedOrigins  map[string]bool
	EdgeEnabled     bool
	// Piper TTS chạy trên Windows hoặc Docker Linux; Vercel Functions đặt false.
	PiperEnabled        bool
	PiperBin            string
	PiperEspeakData     string
	PiperSpeaker        int
	PiperDuyOryxModel   string
	PiperDuyOryxConfig  string
	PiperNgocNganModel  string
	PiperNgocNganConfig string
}

type App struct {
	client        *mongo.Client
	db            *mongo.Database
	store         Storage
	config        Config
	saydiKeys     *saydiKeyManager
	saydiVoicesMu sync.Mutex
	saydiVoices   []ttsVoice
	saydiVoicesAt time.Time
}

type apiError struct {
	Status  int               `json:"-"`
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Details map[string]string `json:"details"`
}

func (e *apiError) Error() string { return e.Message }

func newAPIError(status int, code, message string) *apiError {
	return &apiError{Status: status, Code: code, Message: message, Details: map[string]string{}}
}

func LoadConfig() Config {
	origins := map[string]bool{}
	for _, value := range strings.Split(env("CORS_ALLOWED_ORIGINS", "http://localhost:3000"), ",") {
		if origin := strings.TrimSpace(value); origin != "" {
			origins[origin] = true
		}
	}
	saydiKeys := parseSaydiKeys(os.Getenv("SAYDI_API_KEYS"))
	if len(saydiKeys) == 0 {
		saydiKeys = parseSaydiKeys(os.Getenv("SAYDI_API_KEY"))
	}
	return Config{
		AccessToken:     os.Getenv("READER_ACCESS_TOKEN"),
		VieNeuURL:       strings.TrimRight(os.Getenv("VIENEU_API_URL"), "/"),
		MongoURI:        env("MONGODB_URI", "mongodb://localhost:27017"),
		MongoDatabase:   env("MONGODB_DATABASE", "novel_reader"),
		StorageProvider: env("STORAGE_PROVIDER", "local"),
		StoragePath:     env("STORAGE_LOCAL_PATH", "../data"),
		SupabaseURL:     strings.TrimRight(os.Getenv("SUPABASE_URL"), "/"),
		SupabaseKey:     os.Getenv("SUPABASE_SERVICE_ROLE_KEY"),
		SupabaseBucket:  env("SUPABASE_STORAGE_BUCKET", "reader"),
		SaydiKeys:       saydiKeys,
		SaydiVoiceID:    env("SAYDI_VOICE_ID", "vi-adam"),
		SaydiVoiceName:  env("SAYDI_VOICE_NAME", "Adam · SaydiVoice"),
		AllowedOrigins:  origins,
		EdgeEnabled:     env("EDGE_TTS_ENABLED", "true") != "false",
		// Local Piper: đường dẫn mặc định tương đối từ go-api/ tới repo-root/tools/piper.
		PiperEnabled:        env("PIPER_ENABLED", "true") != "false",
		PiperBin:            env("PIPER_BIN", "../tools/piper/piper.exe"),
		PiperEspeakData:     env("PIPER_ESPEAK_DATA", "../tools/piper/espeak-ng-data"),
		PiperSpeaker:        envInt("PIPER_SPEAKER", 0),
		PiperDuyOryxModel:   env("PIPER_DUYORYX_MODEL", "../tools/piper/voices/duy_oryx.onnx"),
		PiperDuyOryxConfig:  env("PIPER_DUYORYX_CONFIG", "../tools/piper/voices/duy_oryx.onnx.json"),
		PiperNgocNganModel:  env("PIPER_NGOCNGAN_MODEL", "../tools/piper/voices/ngoc_ngan.onnx"),
		PiperNgocNganConfig: env("PIPER_NGOCNGAN_CONFIG", "../tools/piper/voices/ngoc_ngan.onnx.json"),
	}
}

func NewApp(ctx context.Context) (*App, error) {
	config := LoadConfig()
	client, err := mongo.Connect(options.Client().ApplyURI(config.MongoURI).SetMaxPoolSize(4))
	if err != nil {
		return nil, err
	}
	if err := client.Ping(ctx, nil); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, fmt.Errorf("không thể kết nối MongoDB Atlas: %w", err)
	}
	store, err := newStorage(config)
	if err != nil {
		_ = client.Disconnect(context.Background())
		return nil, err
	}
	return &App{client: client, db: client.Database(config.MongoDatabase), store: store, config: config, saydiKeys: newSaydiKeyManager(config.SaydiKeys)}, nil
}

func (a *App) Close() error { return a.client.Disconnect(context.Background()) }

func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if a.config.AccessToken != "" && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Reader-Token")), []byte(a.config.AccessToken)) != 1 {
		writeJSON(w, http.StatusUnauthorized, newAPIError(http.StatusUnauthorized, "UNAUTHORIZED", "Không có quyền truy cập API."))
		return
	}
	if !a.allowCORS(w, r) {
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api")
	if rewrittenPath := r.URL.Query().Get("__vercel_path"); rewrittenPath != "" {
		path = rewrittenPath
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	if path == "" {
		path = "/"
	}

	var err *apiError
	switch {
	case r.Method == http.MethodGet && path == "/health":
		writeJSON(w, http.StatusOK, map[string]string{"status": "UP"})
		return
	case (r.Method == http.MethodGet || r.Method == http.MethodPatch) && path == "/reader/preferences":
		err = a.preferencesRoute(w, r)
	case r.Method == http.MethodPost && path == "/books/upload":
		err = a.uploadBook(w, r)
	case r.Method == http.MethodPost && path == "/books/import":
		err = a.importBook(w, r)
	case r.Method == http.MethodPost && path == "/uploads/sign":
		err = a.signUpload(w, r)
	case r.Method == http.MethodGet && path == "/books":
		err = a.listBooks(w, r)
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/books/"):
		err = a.bookRoute(w, r, path)
	case r.Method == http.MethodDelete && strings.HasPrefix(path, "/books/"):
		err = a.bookRoute(w, r, path)
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/reader/progress/"):
		err = a.getProgress(w, r, path)
	case r.Method == http.MethodPut && strings.HasPrefix(path, "/reader/progress/"):
		err = a.saveProgress(w, r, path)
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/reader/bookmarks/"):
		err = a.bookmarkRoute(w, r, path)
	case r.Method == http.MethodPost && strings.HasPrefix(path, "/reader/bookmarks/"):
		err = a.bookmarkRoute(w, r, path)
	case r.Method == http.MethodDelete && strings.HasPrefix(path, "/reader/bookmarks/"):
		err = a.bookmarkRoute(w, r, path)
	case r.Method == http.MethodGet && path == "/tts/voices":
		writeJSON(w, http.StatusOK, a.availableVoices(r.Context()))
		return
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/tts/chunks/"):
		err = a.ttsChunks(w, r, path)
	case r.Method == http.MethodPost && path == "/tts/generate":
		err = a.generateTTS(w, r)
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/tts/audio/"):
		err = a.ttsAudio(w, r, path)
	default:
		err = newAPIError(http.StatusNotFound, "NOT_FOUND", "Không tìm thấy API.")
	}
	if err != nil {
		writeJSON(w, err.Status, err)
	}
}

func (a *App) allowCORS(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin != "" && a.config.AllowedOrigins[origin] {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	}
	if r.Method == http.MethodOptions {
		if origin != "" && !a.config.AllowedOrigins[origin] {
			writeJSON(w, http.StatusForbidden, newAPIError(http.StatusForbidden, "CORS_FORBIDDEN", "Origin không được phép."))
		} else {
			w.WriteHeader(http.StatusNoContent)
		}
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func decodeJSON(r *http.Request, value any) *apiError {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	if err := decoder.Decode(value); err != nil {
		return newAPIError(http.StatusBadRequest, "VALIDATION_ERROR", "Dữ liệu không hợp lệ.")
	}
	return nil
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envInt(name string, fallback int) int {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			return parsed
		}
	}
	return fallback
}

func databaseError(err error) *apiError {
	if errors.Is(err, mongo.ErrNoDocuments) {
		return newAPIError(http.StatusNotFound, "NOT_FOUND", "Không tìm thấy dữ liệu.")
	}
	log.Printf("MongoDB operation failed: %T: %v", err, err)
	if strings.Contains(strings.ToLower(err.Error()), "bson") && strings.Contains(strings.ToLower(err.Error()), "16") {
		return newAPIError(http.StatusRequestEntityTooLarge, "DOCUMENT_TOO_LARGE", "Dữ liệu sách vượt giới hạn MongoDB.")
	}
	return newAPIError(http.StatusInternalServerError, "DATABASE_ERROR", "Không thể lưu dữ liệu.")
}
