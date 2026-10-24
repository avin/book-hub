package httpapi_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"book-hub/internal/config"
	"book-hub/internal/httpapi"
	"book-hub/internal/storage/files"
	"book-hub/internal/storage/memory"
	"github.com/google/uuid"
)

func TestFTPOriginalLifecycleThroughHTTP(t *testing.T) {
	address := os.Getenv("BOOK_HUB_TEST_FTP_ADDR")
	if address == "" {
		t.Skip("set BOOK_HUB_TEST_FTP_ADDR to run the real FTP lifecycle")
	}
	t.Setenv("BOOK_HUB_SESSION_SECRET", "01234567890123456789012345678901")
	t.Setenv("BOOK_HUB_STORAGE_DIR", t.TempDir())
	t.Setenv("BOOK_HUB_BOOK_STORAGE", "ftp")
	t.Setenv("BOOK_HUB_FTP_ADDR", address)
	t.Setenv("BOOK_HUB_FTP_USER", "bookhub")
	t.Setenv("BOOK_HUB_FTP_PASSWORD", "bookhub-test-password")
	t.Setenv("BOOK_HUB_FTP_ROOT", "/books/http-"+uuid.NewString())
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	fileStore, err := files.NewConfigured(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := fileStore.Ensure(); err != nil {
		t.Fatal(err)
	}
	namespace := fileStore.Books.(files.OriginalNamespace)
	if empty, err := namespace.Empty(context.Background()); err != nil || !empty {
		t.Fatalf("initial namespace: empty=%t err=%v", empty, err)
	}
	store := memory.New()
	server := httptest.NewServer(httpapi.New(config.Config{
		BasePath: "/", DefaultQuotaBytes: 1 << 20, RegistrationEnabled: true, RegistrationAutoActivate: true,
		SessionSecret: cfg.SessionSecret, SessionTTL: cfg.SessionTTL,
		MaxUploadBytes: 1 << 20, MaxCoverUploadBytes: 1 << 20,
	}, store, fileStore, slog.New(slog.NewTextHandler(io.Discard, nil))))
	t.Cleanup(server.Close)
	app := testApp{server: server, storageRoot: cfg.StorageDir}
	first := app.client(t)
	firstCSRF := app.csrf(t, first)
	app.register(t, first, firstCSRF, "first", "password", http.StatusCreated)
	app.login(t, first, firstCSRF, "first", "password", http.StatusOK)
	second := app.client(t)
	secondCSRF := app.csrf(t, second)
	app.register(t, second, secondCSRF, "second", "password", http.StatusCreated)
	app.login(t, second, secondCSRF, "second", "password", http.StatusOK)
	content := []byte("%PDF-original\x00embedded-image\xff")
	one := app.uploadBookWithTitle(t, first, firstCSRF, "book.pdf", content, "Книга")
	two := app.uploadBook(t, second, secondCSRF, "book.pdf", content)
	app.uploadCover(t, first, firstCSRF, one, "cover.png", testPNG(t, 20, 30), http.StatusNoContent)
	response := app.requestRaw(t, first, http.MethodGet, "/v1/books/"+one+"/file?download=1", "", nil, http.StatusOK)
	if !bytes.Equal(response.body, content) || response.header.Get("Content-Type") != "application/pdf" {
		t.Fatalf("FTP HTTP original: %q %v", response.body, response.header)
	}
	app.requestRaw(t, app.client(t), http.MethodGet, "/v1/books/"+one+"/file", "", nil, http.StatusUnauthorized)
	app.requestRaw(t, second, http.MethodGet, "/v1/books/"+one+"/file", "", nil, http.StatusNotFound)
	images, err := filepath.Glob(filepath.Join(cfg.StorageDir, "covers", "*"))
	if err != nil || len(images) != 2 {
		t.Fatalf("local images: %v %v", images, err)
	}
	hash := sha256.Sum256(content)
	location := fileStore.Books.BookPath(hex.EncodeToString(hash[:]), "pdf")
	// A real FTP transfer of a truncated original must never become a partial HTTP success.
	corrupt := filepath.Join(t.TempDir(), "truncated.pdf")
	if err := os.WriteFile(corrupt, content[:8], 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := fileStore.Books.MoveBook(context.Background(), corrupt, hex.EncodeToString(hash[:]), "pdf"); err != nil {
		t.Fatal(err)
	}
	app.requestRaw(t, first, http.MethodGet, "/v1/books/"+one+"/file", "", nil, http.StatusServiceUnavailable)
	work, err := os.ReadDir(filepath.Join(cfg.StorageDir, "tmp"))
	if err != nil || len(work) != 0 {
		t.Fatalf("failed FTP retrieval retained workspace: %v %v", work, err)
	}
	if err := os.WriteFile(corrupt, content, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := fileStore.Books.MoveBook(context.Background(), corrupt, hex.EncodeToString(hash[:]), "pdf"); err != nil {
		t.Fatal(err)
	}
	app.requestRaw(t, first, http.MethodGet, "/v1/books/"+one+"/file", "", nil, http.StatusOK)
	// A login failure does not confirm a new upload or invalidate the HTTP session.
	badCfg := cfg
	badCfg.FTPPassword = "incorrect-password"
	badFiles, err := files.NewConfigured(badCfg)
	if err != nil {
		t.Fatal(err)
	}
	badServer := httptest.NewServer(httpapi.New(config.Config{BasePath: "/", SessionSecret: cfg.SessionSecret, SessionTTL: cfg.SessionTTL, MaxUploadBytes: 1 << 20}, store, badFiles, slog.New(slog.NewTextHandler(io.Discard, nil))))
	t.Cleanup(badServer.Close)
	badApp := testApp{server: badServer}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, _ := writer.CreateFormFile("file", "new.pdf")
	part.Write([]byte("%PDF-unsaved"))
	writer.Close()
	request, _ := http.NewRequest(http.MethodPost, badServer.URL+"/api/v1/books", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("X-CSRF-Token", firstCSRF)
	failed, err := first.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, failed.Body)
	failed.Body.Close()
	if failed.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("failed FTP persistence status: %d", failed.StatusCode)
	}
	badApp.requestJSON(t, first, http.MethodGet, "/v1/me", "", nil, http.StatusOK)
	app.requestRaw(t, first, http.MethodDelete, "/v1/books/"+one, firstCSRF, nil, http.StatusNoContent)
	if err := store.ProcessOriginalDeletions(context.Background(), fileStore.Books.Delete); err != nil {
		t.Fatal(err)
	}
	app.requestRaw(t, second, http.MethodGet, "/v1/books/"+two+"/file", "", nil, http.StatusOK)
	app.requestRaw(t, second, http.MethodDelete, "/v1/books/"+two, secondCSRF, nil, http.StatusNoContent)
	if err := store.ProcessOriginalDeletions(context.Background(), fileStore.Books.Delete); err != nil {
		t.Fatal(err)
	}
	if reader, err := fileStore.Books.Open(context.Background(), location); err == nil {
		reader.Close()
		t.Fatal("last-owner original remains on FTP")
	}
	if err := fileStore.Books.Delete(context.Background(), location); err != nil {
		t.Fatalf("already absent original: %v", err)
	}
	if empty, err := namespace.Empty(context.Background()); err != nil || !empty {
		t.Fatalf("final namespace: empty=%t err=%v", empty, err)
	}
}
