package httpapi_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"book-hub/internal/config"
	"book-hub/internal/domain"
	"book-hub/internal/httpapi"
	"book-hub/internal/storage"
	"book-hub/internal/storage/files"
	"book-hub/internal/storage/memory"
	"github.com/google/uuid"
)

func TestUnavailableStoragePreservesSessionAndDoesNotRetry(t *testing.T) {
	for _, test := range []struct {
		name, operation, method, path, body string
	}{
		{"login lookup", "GetUserByLogin", http.MethodPost, "/v1/auth/login", `{"login":"reader","password":"password"}`},
		{"login session creation", "CreateSession", http.MethodPost, "/v1/auth/login", `{"login":"reader","password":"password"}`},
		{"session lookup", "GetSession", http.MethodGet, "/v1/me", ""},
		{"current user lookup", "GetUser", http.MethodGet, "/v1/me", ""},
		{"logout", "RevokeSession", http.MethodPost, "/v1/auth/logout", ""},
		{"book query", "QueryBooks", http.MethodPost, "/v1/books/query", `{}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := &unavailableStore{Store: memory.New()}
			store.operation.Store("")
			root := t.TempDir()
			cfg := config.Config{
				BasePath: "/", RegistrationEnabled: true, RegistrationAutoActivate: true,
				SessionSecret: "01234567890123456789012345678901", SessionTTL: time.Hour,
				DefaultQuotaBytes: 1024 * 1024,
			}
			server := httptest.NewServer(httpapi.New(cfg, store, files.New(root), slog.New(slog.NewTextHandler(io.Discard, nil))))
			t.Cleanup(server.Close)
			app := testApp{server: server, storageRoot: root}
			client := app.client(t)
			csrf := app.csrf(t, client)
			app.register(t, client, csrf, "reader", "password", http.StatusCreated)
			app.login(t, client, csrf, "reader", "password", http.StatusOK)
			cookieURL, err := url.Parse(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			before := client.Jar.Cookies(cookieURL)
			store.operation.Store(test.operation)
			response := app.requestRaw(t, client, test.method, test.path, csrf, strings.NewReader(test.body), http.StatusServiceUnavailable)
			var body map[string]string
			if err := json.Unmarshal(response.body, &body); err != nil {
				t.Fatal(err)
			}
			if body["code"] != "service_unavailable" || body["request_id"] == "" || body["request_id"] != response.header.Get("X-Request-Id") {
				t.Fatalf("unexpected unavailable response: %#v", body)
			}
			if cookies := response.header.Values("Set-Cookie"); len(cookies) != 0 {
				t.Fatalf("failure must preserve session cookie, got %v", cookies)
			}
			if got := store.calls.Load(); got != 1 {
				t.Fatalf("expected one failed operation without retry, got %d", got)
			}
			if after := client.Jar.Cookies(cookieURL); fmt.Sprint(after) != fmt.Sprint(before) {
				t.Fatalf("session cookies changed: before=%v after=%v", before, after)
			}
			store.operation.Store("")
			app.requestJSON(t, client, http.MethodGet, "/v1/me", "", nil, http.StatusOK)
		})
	}
}

type unavailableStore struct {
	storage.Store
	operation atomic.Value
	calls     atomic.Int32
}

func (s *unavailableStore) fail(operation string) error {
	if s.operation.Load() == operation {
		s.calls.Add(1)
		return fmt.Errorf("%s: %w", operation, storage.ErrUnavailable)
	}
	return nil
}

func (s *unavailableStore) GetUserByLogin(ctx context.Context, login string) (domain.UserWithPassword, error) {
	if err := s.fail("GetUserByLogin"); err != nil {
		return domain.UserWithPassword{}, err
	}
	return s.Store.GetUserByLogin(ctx, login)
}

func (s *unavailableStore) CreateSession(ctx context.Context, userID uuid.UUID, tokenHash string, ttlSeconds int64) error {
	if err := s.fail("CreateSession"); err != nil {
		return err
	}
	return s.Store.CreateSession(ctx, userID, tokenHash, ttlSeconds)
}

func (s *unavailableStore) GetSession(ctx context.Context, tokenHash string) (uuid.UUID, error) {
	if err := s.fail("GetSession"); err != nil {
		return uuid.Nil, err
	}
	return s.Store.GetSession(ctx, tokenHash)
}

func (s *unavailableStore) GetUser(ctx context.Context, userID uuid.UUID) (domain.UserWithPassword, error) {
	if err := s.fail("GetUser"); err != nil {
		return domain.UserWithPassword{}, err
	}
	return s.Store.GetUser(ctx, userID)
}

func (s *unavailableStore) RevokeSession(ctx context.Context, tokenHash string) error {
	if err := s.fail("RevokeSession"); err != nil {
		return err
	}
	return s.Store.RevokeSession(ctx, tokenHash)
}

func (s *unavailableStore) QueryBooks(ctx context.Context, userID uuid.UUID, query domain.BookQuery) (domain.BookPage, error) {
	if err := s.fail("QueryBooks"); err != nil {
		return domain.BookPage{}, err
	}
	return s.Store.QueryBooks(ctx, userID, query)
}
