package httpapi_test

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"book-hub/internal/auth"
	"book-hub/internal/config"
	"book-hub/internal/httpapi"
	"book-hub/internal/storage"
	"book-hub/internal/storage/files"
	"book-hub/internal/storage/memory"
	"github.com/google/uuid"
)

func passwordTestApp(t *testing.T, algorithm string, store storage.Store, iterations int) testApp {
	t.Helper()
	cfg := config.Config{
		BasePath: "/", SessionSecret: "01234567890123456789012345678901", SessionTTL: time.Hour,
		PasswordAlgorithm: algorithm, PBKDF2Iterations: iterations, RegistrationEnabled: true, RegistrationAutoActivate: true, DefaultQuotaBytes: 1024,
	}
	server := httptest.NewServer(httpapi.New(cfg, store, files.New(t.TempDir()), slog.New(slog.NewTextHandler(io.Discard, nil))))
	t.Cleanup(server.Close)
	return testApp{server: server}
}

func TestPBKDF2RegistrationAndPasswordChange(t *testing.T) {
	ctx := context.Background()
	store := memory.New()
	app := passwordTestApp(t, auth.PasswordPBKDF2SHA256, store, 10000)
	client := app.client(t)
	csrf := app.csrf(t, client)
	app.register(t, client, csrf, "reader", "password", http.StatusCreated)
	user, err := store.GetUserByLogin(ctx, "reader")
	if err != nil || !strings.HasPrefix(user.PasswordHash, "$pbkdf2-sha256$i=10000$") {
		t.Fatalf("registered user's password algorithm: %v", err)
	}
	app.login(t, client, csrf, "reader", "password", http.StatusOK)
	other := app.client(t)
	otherCSRF := app.csrf(t, other)
	app.login(t, other, otherCSRF, "reader", "password", http.StatusOK)
	app.requestJSON(t, client, http.MethodPut, "/v1/me/password", csrf,
		map[string]string{"current_password": "password", "new_password": "replacement"}, http.StatusNoContent)
	app.requestJSON(t, client, http.MethodGet, "/v1/me", "", nil, http.StatusOK)
	app.requestJSON(t, other, http.MethodGet, "/v1/me", "", nil, http.StatusUnauthorized)
	user, err = store.GetUser(ctx, user.ID)
	if err != nil || !strings.HasPrefix(user.PasswordHash, "$pbkdf2-sha256$i=10000$") || !auth.VerifyPassword("replacement", user.PasswordHash) {
		t.Fatalf("changed user's password: %v", err)
	}
	app.login(t, other, otherCSRF, "reader", "password", http.StatusUnauthorized)
	app.login(t, other, otherCSRF, "reader", "replacement", http.StatusOK)
}

func TestLoginMigratesPasswordAlgorithm(t *testing.T) {
	for _, target := range []string{auth.PasswordPBKDF2SHA256, auth.PasswordArgon2id} {
		t.Run(target, func(t *testing.T) {
			ctx := context.Background()
			store := memory.New()
			source := auth.PasswordArgon2id
			if target == source {
				source = auth.PasswordPBKDF2SHA256
			}
			hash, err := auth.HashPasswordWithAlgorithm("password", source, 0)
			if err != nil {
				t.Fatal(err)
			}
			user, err := store.CreateUser(ctx, "reader", hash, false, 1024)
			if err != nil {
				t.Fatal(err)
			}
			app := passwordTestApp(t, target, store, 0)
			client := app.client(t)
			csrf := app.csrf(t, client)
			app.login(t, client, csrf, "reader", "wrong", http.StatusUnauthorized)
			app.login(t, client, csrf, "reader", "password", http.StatusForbidden)
			unchanged, err := store.GetUser(ctx, user.ID)
			if err != nil || unchanged.PasswordHash != hash {
				t.Fatalf("failed/inactive login changed password hash: %v", err)
			}
			if err := store.SetUserActive(ctx, user.ID, true); err != nil {
				t.Fatal(err)
			}
			if err := store.CreateSession(ctx, user.ID, "existing-session", 60); err != nil {
				t.Fatal(err)
			}
			app.login(t, client, csrf, "reader", "password", http.StatusOK)
			migrated, err := store.GetUser(ctx, user.ID)
			if err != nil || auth.NeedsPasswordRehash(migrated.PasswordHash, target, 0) || !auth.VerifyPassword("password", migrated.PasswordHash) {
				t.Fatalf("password was not migrated: %v", err)
			}
			if _, err := store.GetSession(ctx, "existing-session"); err != nil {
				t.Fatalf("rehash revoked an existing session: %v", err)
			}
			app.requestJSON(t, client, http.MethodGet, "/v1/me", "", nil, http.StatusOK)
			app.login(t, client, csrf, "reader", "password", http.StatusOK)
			again, err := store.GetUser(ctx, user.ID)
			if err != nil || again.PasswordHash != migrated.PasswordHash {
				t.Fatalf("subsequent login unnecessarily rehashed password: %v", err)
			}
		})
	}
}

type passwordChangedDuringLogin struct{ storage.Store }

func TestLoginMigratesPBKDF2IterationCount(t *testing.T) {
	for _, target := range []int{10000, 600000} {
		t.Run(fmt.Sprint(target), func(t *testing.T) {
			ctx := context.Background()
			store := memory.New()
			source := 600000
			if target == source {
				source = 10000
			}
			hash, err := auth.HashPasswordWithAlgorithm("password", auth.PasswordPBKDF2SHA256, source)
			if err != nil {
				t.Fatal(err)
			}
			user, err := store.CreateUser(ctx, "reader", hash, true, 1024)
			if err != nil {
				t.Fatal(err)
			}
			if err := store.CreateSession(ctx, user.ID, "existing", 60); err != nil {
				t.Fatal(err)
			}
			app := passwordTestApp(t, auth.PasswordPBKDF2SHA256, store, target)
			client := app.client(t)
			csrf := app.csrf(t, client)
			app.login(t, client, csrf, "reader", "wrong", http.StatusUnauthorized)
			unchanged, err := store.GetUser(ctx, user.ID)
			if err != nil || unchanged.PasswordHash != hash {
				t.Fatalf("failed login changed hash: %v", err)
			}
			app.login(t, client, csrf, "reader", "password", http.StatusOK)
			migrated, err := store.GetUser(ctx, user.ID)
			if err != nil || auth.NeedsPasswordRehash(migrated.PasswordHash, auth.PasswordPBKDF2SHA256, target) || !auth.VerifyPassword("password", migrated.PasswordHash) {
				t.Fatalf("iteration count was not migrated: %v", err)
			}
			if _, err := store.GetSession(ctx, "existing"); err != nil {
				t.Fatalf("iteration migration revoked session: %v", err)
			}
			app.login(t, client, csrf, "reader", "password", http.StatusOK)
			again, err := store.GetUser(ctx, user.ID)
			if err != nil || again.PasswordHash != migrated.PasswordHash {
				t.Fatalf("subsequent login rehashed password: %v", err)
			}
		})
	}
}

func (s passwordChangedDuringLogin) RehashUserPassword(ctx context.Context, userID uuid.UUID, previousHash, passwordHash string) (bool, error) {
	if err := s.Store.SetUserPassword(ctx, userID, "concurrently-reset-password"); err != nil {
		return false, err
	}
	return s.Store.RehashUserPassword(ctx, userID, previousHash, passwordHash)
}

func TestLoginRehashDoesNotOverwriteConcurrentPasswordReset(t *testing.T) {
	ctx := context.Background()
	store := memory.New()
	hash, err := auth.HashPassword("password")
	if err != nil {
		t.Fatal(err)
	}
	user, err := store.CreateUser(ctx, "reader", hash, true, 1024)
	if err != nil {
		t.Fatal(err)
	}
	app := passwordTestApp(t, auth.PasswordPBKDF2SHA256, passwordChangedDuringLogin{Store: store}, 0)
	client := app.client(t)
	csrf := app.csrf(t, client)
	app.login(t, client, csrf, "reader", "password", http.StatusUnauthorized)
	app.requestJSON(t, client, http.MethodGet, "/v1/me", "", nil, http.StatusUnauthorized)
	current, err := store.GetUser(ctx, user.ID)
	if err != nil || current.PasswordHash != "concurrently-reset-password" {
		t.Fatalf("concurrent password reset overwritten: %v", err)
	}
}
