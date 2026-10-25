package httpapi_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"book-hub/internal/config"
	"book-hub/internal/httpapi"
	"book-hub/internal/storage/files"
	"book-hub/internal/storage/memory"
	"github.com/google/uuid"
)

func TestEveryStorageKeepsUploadedBooksCachedAcrossRestart(t *testing.T) {
	for _, mode := range []string{"directory", "ftp", "ftps-explicit", "ftps-implicit", "s3"} {
		t.Run(mode, func(t *testing.T) {
			cfg := cachedStorageConfig(t, mode)
			store := memory.New()
			var app testApp
			start := func() files.Store {
				if app.server != nil {
					app.server.Close()
				}
				fileStore, err := files.NewConfigured(cfg)
				if err != nil {
					t.Fatal(err)
				}
				if err := fileStore.Ensure(); err != nil {
					t.Fatal(err)
				}
				server := httptest.NewServer(httpapi.New(cfg, store, fileStore, slog.New(slog.NewTextHandler(io.Discard, nil))))
				t.Cleanup(server.Close)
				app = testApp{server: server, storageRoot: cfg.StorageDir}
				return fileStore
			}
			fileStore := start()
			owner := app.client(t)
			csrf := app.csrf(t, owner)
			app.register(t, owner, csrf, "owner", "password", http.StatusCreated)
			app.login(t, owner, csrf, "owner", "password", http.StatusOK)
			content := []byte("%PDF-whole original with embedded image\x00\xff")
			id := app.uploadBook(t, owner, csrf, "book.pdf", content)
			app.uploadCover(t, owner, csrf, id, "cover.png", testPNG(t, 20, 30), http.StatusNoContent)
			hash := sha256.Sum256(content)
			location := fileStore.Books.BookPath(hex.EncodeToString(hash[:]), "pdf")
			reader, err := fileStore.Books.Open(context.Background(), location)
			if err != nil {
				t.Fatal(err)
			}
			persisted, err := io.ReadAll(reader)
			closeErr := reader.Close()
			if err != nil || closeErr != nil || !bytes.Equal(persisted, content) {
				t.Fatalf("persistent original: %q %v %v", persisted, err, closeErr)
			}
			// Loss of the original cannot be hidden by a pass-through cache implementation.
			if err := fileStore.Books.Delete(context.Background(), location); err != nil {
				t.Fatal(err)
			}
			start()
			app.requestRaw(t, owner, http.MethodGet, "/readyz", "", nil, http.StatusOK)
			for _, suffix := range []string{"", "?download=1"} {
				response := app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+id+"/file"+suffix, "", nil, http.StatusOK)
				if !bytes.Equal(response.body, content) {
					t.Fatalf("cached bytes after restart: %q", response.body)
				}
			}
			app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+id+"/cover", "", nil, http.StatusOK)
			app.requestRaw(t, app.client(t), http.MethodGet, "/v1/books/"+id+"/file", "", nil, http.StatusUnauthorized)
			// Restore the test's persistent object so deletion checks the real adapter too.
			input := filepath.Join(t.TempDir(), "original.pdf")
			if err := os.WriteFile(input, content, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := fileStore.Books.MoveBook(context.Background(), input, hex.EncodeToString(hash[:]), "pdf"); err != nil {
				t.Fatal(err)
			}
			app.requestRaw(t, owner, http.MethodDelete, "/v1/books/"+id, csrf, nil, http.StatusNoContent)
			if err := store.ProcessOriginalDeletions(context.Background(), fileStore.Books.Delete); err != nil {
				t.Fatal(err)
			}
			app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+id+"/file", "", nil, http.StatusNotFound)
			if empty, err := fileStore.Books.(files.OriginalNamespace).Empty(context.Background()); err != nil || !empty {
				t.Fatalf("original not deleted: empty=%t %v", empty, err)
			}
		})
	}
}

func cachedStorageConfig(t *testing.T, mode string) config.Config {
	t.Helper()
	root := t.TempDir()
	cfg := config.Config{BookStorage: mode, StorageDir: filepath.Join(root, "storage"), CacheDir: filepath.Join(root, "cache"), CacheMaxBytes: 1 << 20, BasePath: "/", DefaultQuotaBytes: 1 << 20, RegistrationEnabled: true, RegistrationAutoActivate: true, SessionSecret: strings.Repeat("s", 32), SessionTTL: time.Hour, MaxUploadBytes: 1 << 20, MaxCoverUploadBytes: 1 << 20}
	if mode == "s3" {
		cfg.S3Endpoint = os.Getenv("BOOK_HUB_TEST_S3_ENDPOINT")
		if cfg.S3Endpoint == "" {
			t.Skip("set BOOK_HUB_TEST_S3_ENDPOINT for the real S3 cache lifecycle")
		}
		cfg.S3Region, cfg.S3Bucket, cfg.S3Prefix = "garage", "bookhub-test", "cache-"+uuid.NewString()
		cfg.S3AccessKeyID, cfg.S3SecretAccessKey = "GK00000000000000000000000000000001", "codex-bookhub-s3-test-secret-000000000000000000000000000000000000"
	} else if mode != "directory" {
		env := map[string]string{"ftp": "BOOK_HUB_TEST_FTP_ADDR", "ftps-explicit": "BOOK_HUB_TEST_FTPS_EXPLICIT_ADDR", "ftps-implicit": "BOOK_HUB_TEST_FTPS_IMPLICIT_ADDR"}[mode]
		cfg.FTPAddr = os.Getenv(env)
		if cfg.FTPAddr == "" {
			t.Skip("set " + env + " for the real cache lifecycle")
		}
		cfg.FTPUser, cfg.FTPPassword, cfg.FTPRoot = "bookhub", "bookhub-test-password", "/books/cache-"+uuid.NewString()
		if mode != "ftp" {
			cfg.FTPCAFile = os.Getenv("BOOK_HUB_TEST_FTPS_CA_FILE")
		}
	}
	return cfg
}
