package db_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"book-hub/internal/storage"
	"book-hub/internal/storage/contract"
	"book-hub/internal/storage/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestOriginalPersistenceAndIndependentConnections(t *testing.T) {
	adminURL := os.Getenv(testDatabaseURLEnv)
	if adminURL == "" {
		t.Skipf("set %s to run PostgreSQL original lifecycle", testDatabaseURLEnv)
	}
	contract.RunOriginalPersistence(t, func(t *testing.T) func() storage.Store {
		ctx := context.Background()
		schema := "originals_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		admin, err := pgx.Connect(ctx, adminURL)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := admin.Exec(ctx, "create schema "+schema); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_, _ = admin.Exec(context.Background(), "drop schema if exists "+schema+" cascade")
			admin.Close(context.Background())
		})
		rawURL := withSearchPath(t, adminURL, schema)
		applyMigrations(t, rawURL)
		return func() storage.Store {
			store, err := db.Open(ctx, rawURL)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(store.Close)
			return store
		}
	})
}
