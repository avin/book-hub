package database_test

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"book-hub/internal/database"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func sqliteURL(path string) string {
	path = filepath.ToSlash(path)
	if runtime.GOOS == "windows" {
		path = "/" + path
	}
	return (&url.URL{Scheme: "sqlite", Path: path}).String()
}

func TestParse(t *testing.T) {
	for _, raw := range []string{"postgres://reader@localhost/books", "postgresql://reader@localhost/books?sslmode=disable"} {
		conn, err := database.Parse(raw)
		if err != nil || conn.Driver != "postgres" || conn.URL != raw {
			t.Fatalf("PostgreSQL URL compatibility: %+v %v", conn, err)
		}
	}
	path := filepath.Join(t.TempDir(), "Книги #100% ? .sqlite")
	conn, err := database.Parse(sqliteURL(path))
	if err != nil || conn.SQLitePath != path || conn.Driver != "sqlite" {
		t.Fatalf("escaped absolute path: %+v %v", conn, err)
	}
	for _, raw := range []string{"", "mysql://localhost/books", "sqlite:relative.sqlite", "sqlite://relative.sqlite", "sqlite:///", "sqlite://server/share/books.sqlite", "sqlite:///data/books.sqlite?_pragma=foreign_keys(0)", "sqlite:///data/books.sqlite#ignored", "sqlite:///:memory:", "postgres://reader:secret%ZZ@localhost/books"} {
		_, err := database.Parse(raw)
		if err == nil {
			t.Errorf("accepted unsupported URL %q", raw)
		}
		if err != nil && strings.Contains(err.Error(), "secret") {
			t.Error("parse error exposed credentials")
		}
	}
}

func TestMissingDatabaseIsNotCreated(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing.sqlite")
	raw := sqliteURL(path)
	if err := database.CheckSchema(context.Background(), raw); err == nil {
		t.Fatal("missing database accepted")
	}
	if _, err := database.OpenSQLite(context.Background(), raw, false); err == nil {
		t.Fatal("missing file opened")
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing file created: %v", err)
	}
}

func TestSchemaVersionValidation(t *testing.T) {
	t.Run("sqlite", func(t *testing.T) {
		raw := sqliteURL(filepath.Join(t.TempDir(), "new directory", "books.sqlite"))
		if err := database.Migrate(context.Background(), raw, "up"); err != nil {
			t.Fatal(err)
		}
		db, err := database.OpenSQLite(context.Background(), raw, false)
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		checkSchemaStates(t, raw, db)
	})
	t.Run("postgres", func(t *testing.T) {
		raw := os.Getenv("BOOK_HUB_TEST_DATABASE_URL")
		if raw == "" {
			t.Skip("set BOOK_HUB_TEST_DATABASE_URL for PostgreSQL schema validation")
		}
		ctx := context.Background()
		admin, err := pgx.Connect(ctx, raw)
		if err != nil {
			t.Fatal(err)
		}
		defer admin.Close(ctx)
		schema := "schema_validation_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		if _, err := admin.Exec(ctx, "create schema "+schema); err != nil {
			t.Fatal(err)
		}
		defer admin.Exec(ctx, "drop schema "+schema+" cascade")
		parsed, err := url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		q := parsed.Query()
		q.Set("search_path", schema)
		parsed.RawQuery = q.Encode()
		raw = parsed.String()
		if err := database.Migrate(ctx, raw, "up"); err != nil {
			t.Fatal(err)
		}
		db, err := sql.Open("pgx", raw)
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		checkSchemaStates(t, raw, db)
	})
}

func checkSchemaStates(t *testing.T, raw string, db *sql.DB) {
	t.Helper()
	ctx := context.Background()
	conn, err := database.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	expected, err := database.ExpectedVersion(conn.Driver)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.CheckSchema(ctx, raw); err != nil {
		t.Fatalf("current schema rejected: %v", err)
	}
	if err := database.Migrate(ctx, raw, "up"); err != nil {
		t.Fatalf("repeated up failed: %v", err)
	}
	for _, state := range []struct {
		name    string
		version uint
		dirty   bool
	}{
		{"old", expected - 1, false}, {"future", expected + 1, false}, {"dirty", expected, true},
	} {
		t.Run(state.name, func(t *testing.T) {
			if _, err := db.ExecContext(ctx, "update schema_migrations set version=$1, dirty=$2", state.version, state.dirty); err != nil {
				t.Fatal(err)
			}
			if err := database.CheckSchema(ctx, raw); err == nil {
				t.Fatalf("incompatible %s schema accepted", state.name)
			}
		})
	}
	if _, err := db.ExecContext(ctx, "delete from schema_migrations"); err != nil {
		t.Fatal(err)
	}
	if err := database.CheckSchema(ctx, raw); err == nil {
		t.Fatal("unversioned database accepted")
	}
}

func TestSQLiteMigrationRollbackAndReapply(t *testing.T) {
	raw := sqliteURL(filepath.Join(t.TempDir(), "books.sqlite"))
	ctx := context.Background()
	if err := database.Migrate(ctx, raw, "up"); err != nil {
		t.Fatal(err)
	}
	if err := database.Migrate(ctx, raw, "down"); err != nil {
		t.Fatal(err)
	}
	if err := database.CheckSchema(ctx, raw); err == nil {
		t.Fatal("rolled-back schema accepted")
	}
	if err := database.Migrate(ctx, raw, "up"); err != nil {
		t.Fatal(err)
	}
	if err := database.CheckSchema(ctx, raw); err != nil {
		t.Fatal(err)
	}
}

func TestUnicodeLowerRejectsNonTextWithoutPanicking(t *testing.T) {
	ctx := context.Background()
	raw := sqliteURL(filepath.Join(t.TempDir(), "books.sqlite"))
	if err := database.Migrate(ctx, raw, "up"); err != nil {
		t.Fatal(err)
	}
	db, err := database.OpenSQLite(ctx, raw, false)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var value string
	if err := db.QueryRowContext(ctx, "select bookhub_lower(?)", []byte("BLOB")).Scan(&value); err == nil {
		t.Fatal("non-text input unexpectedly accepted")
	}
}
