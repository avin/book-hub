package db_test

import (
	"context"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"book-hub/internal/storage"
	"book-hub/internal/storage/contract"
	"book-hub/internal/storage/db"
	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const testDatabaseURLEnv = "BOOK_HUB_TEST_DATABASE_URL"

func TestStoreContract(t *testing.T) {
	databaseURL := os.Getenv(testDatabaseURLEnv)
	if databaseURL == "" {
		t.Skipf("set %s to run the PostgreSQL storage contract", testDatabaseURLEnv)
	}

	contract.Run(t, func(t *testing.T) storage.Store {
		ctx := context.Background()
		schema := "storage_contract_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		admin, err := pgx.Connect(ctx, databaseURL)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := admin.Exec(ctx, "create schema "+schema); err != nil {
			admin.Close(ctx)
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_, _ = admin.Exec(context.Background(), "drop schema if exists "+schema+" cascade")
			admin.Close(context.Background())
		})

		testURL := withSearchPath(t, databaseURL, schema)
		applyMigrations(t, testURL)
		store, err := db.Open(ctx, testURL)
		if err != nil {
			t.Fatal(err)
		}
		return store
	})
}

func withSearchPath(t *testing.T, databaseURL, schema string) string {
	t.Helper()
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func applyMigrations(t *testing.T, databaseURL string) {
	t.Helper()
	migrationsPath, err := filepath.Abs(filepath.Join("..", "..", "..", "migrations"))
	if err != nil {
		t.Fatal(err)
	}
	m, err := migrate.New("file://"+filepath.ToSlash(migrationsPath), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		t.Fatal(err)
	}
}
