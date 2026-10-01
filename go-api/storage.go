package readerapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Storage interface {
	Put(context.Context, string, []byte, string) error
	Get(context.Context, string) ([]byte, error)
	Delete(context.Context, string) error
}

type signedUploadStore interface {
	CreateSignedUpload(context.Context, string) (string, error)
}

type localStorage struct{ root string }

type supabaseStorage struct {
	baseURL string
	key     string
	bucket  string
	client  *http.Client
}

func newStorage(config Config) (Storage, error) {
	if config.StorageProvider != "supabase" {
		return &localStorage{root: config.StoragePath}, nil
	}
	if config.SupabaseURL == "" || config.SupabaseKey == "" || config.SupabaseBucket == "" {
		return nil, fmt.Errorf("thiếu cấu hình Supabase Storage")
	}
	return &supabaseStorage{
		baseURL: config.SupabaseURL,
		key:     config.SupabaseKey,
		bucket:  config.SupabaseBucket,
		client:  &http.Client{Timeout: 90 * time.Second},
	}, nil
}

func (s *localStorage) Put(_ context.Context, key string, content []byte, _ string) error {
	path, err := s.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, content, 0o600)
}

func (s *localStorage) Get(_ context.Context, key string) ([]byte, error) {
	path, err := s.path(key)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(path)
}

func (s *localStorage) Delete(_ context.Context, key string) error {
	path, err := s.path(key)
	if err != nil {
		return err
	}
	err = os.Remove(path)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func (s *localStorage) path(key string) (string, error) {
	if !validStorageKey(key) {
		return "", fmt.Errorf("storage key không hợp lệ")
	}
	root, err := filepath.Abs(s.root)
	if err != nil {
		return "", err
	}
	path := filepath.Clean(filepath.Join(root, filepath.FromSlash(key)))
	if path != root && !strings.HasPrefix(path, root+string(os.PathSeparator)) {
		return "", fmt.Errorf("storage key không hợp lệ")
	}
	return path, nil
}

func (s *supabaseStorage) Put(ctx context.Context, key string, content []byte, contentType string) error {
	if !validStorageKey(key) {
		return fmt.Errorf("storage key không hợp lệ")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.objectURL(key), bytes.NewReader(content))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+s.key)
	request.Header.Set("apikey", s.key)
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("x-upsert", "true")
	return s.expectSuccess(request)
}

func (s *supabaseStorage) Get(ctx context.Context, key string) ([]byte, error) {
	if !validStorageKey(key) {
		return nil, fmt.Errorf("storage key không hợp lệ")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, s.objectURL(key), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+s.key)
	request.Header.Set("apikey", s.key)
	response, err := s.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return nil, fmt.Errorf("Supabase Storage trả về %d", response.StatusCode)
	}
	return io.ReadAll(io.LimitReader(response.Body, 51<<20))
}

func (s *supabaseStorage) Delete(ctx context.Context, key string) error {
	if !validStorageKey(key) {
		return fmt.Errorf("storage key không hợp lệ")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, s.objectURL(key), nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+s.key)
	request.Header.Set("apikey", s.key)
	response, err := s.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound || response.StatusCode/100 == 2 {
		return nil
	}
	return fmt.Errorf("Supabase Storage trả về %d", response.StatusCode)
}

func (s *supabaseStorage) CreateSignedUpload(ctx context.Context, key string) (string, error) {
	if !validStorageKey(key) {
		return "", fmt.Errorf("storage key không hợp lệ")
	}
	body := strings.NewReader(`{"upsert":false}`)
	endpoint := s.baseURL + "/storage/v1/object/upload/sign/" + url.PathEscape(s.bucket) + "/" + encodePath(key)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+s.key)
	request.Header.Set("apikey", s.key)
	request.Header.Set("Content-Type", "application/json")
	response, err := s.client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return "", fmt.Errorf("Supabase Storage trả về %d", response.StatusCode)
	}
	var payload struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil || payload.Token == "" {
		return "", fmt.Errorf("Supabase Storage không trả token upload")
	}
	return payload.Token, nil
}

func (s *supabaseStorage) objectURL(key string) string {
	return s.baseURL + "/storage/v1/object/" + url.PathEscape(s.bucket) + "/" + encodePath(key)
}

func (s *supabaseStorage) expectSuccess(request *http.Request) error {
	response, err := s.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode/100 == 2 {
		return nil
	}
	return fmt.Errorf("Supabase Storage trả về %d", response.StatusCode)
}

func encodePath(value string) string {
	segments := strings.Split(value, "/")
	for index, segment := range segments {
		segments[index] = url.PathEscape(segment)
	}
	return strings.Join(segments, "/")
}

func validStorageKey(key string) bool {
	return key != "" && !strings.HasPrefix(key, "/") && !strings.Contains(key, "..")
}
