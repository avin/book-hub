package database

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	sqlite "modernc.org/sqlite"
)

type Connection struct {
	Driver     string
	URL        string
	SQLitePath string
}

func Parse(rawURL string) (Connection, error) {
	if rawURL == "" {
		return Connection{}, errors.New("BOOK_HUB_DATABASE_URL is required")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return Connection{}, errors.New("invalid BOOK_HUB_DATABASE_URL")
	}
	conn := Connection{URL: rawURL}
	switch parsed.Scheme {
	case "postgres", "postgresql":
		conn.Driver = "postgres"
	case "sqlite":
		if parsed.Host != "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || !strings.HasPrefix(rawURL, "sqlite:///") {
			return Connection{}, errors.New("SQLite URL must contain only an absolute local file path")
		}
		path := parsed.Path
		if runtime.GOOS == "windows" && len(path) >= 4 && path[0] == '/' && path[2] == ':' {
			path = path[1:]
		}
		path = filepath.FromSlash(path)
		if !filepath.IsAbs(path) || strings.ContainsRune(path, '\x00') || strings.HasPrefix(path, `\\`) || filepath.Dir(filepath.Clean(path)) == filepath.Clean(path) || strings.HasSuffix(path, string(filepath.Separator)) || filepath.Base(path) == ":memory:" {
			return Connection{}, errors.New("SQLite requires an absolute local file path")
		}
		conn.Driver, conn.SQLitePath = "sqlite", filepath.Clean(path)
	default:
		return Connection{}, errors.New("BOOK_HUB_DATABASE_URL must use postgres://, postgresql:// or sqlite://")
	}
	return conn, nil
}

func init() {
	sqlite.MustRegisterDeterministicScalarFunction("bookhub_lower", 1, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		if args[0] == nil {
			return nil, nil
		}
		text, ok := args[0].(string)
		if !ok {
			return nil, errors.New("bookhub_lower requires text")
		}
		return strings.ToLower(text), nil
	})
	sqlite.MustRegisterScalarFunction("bookhub_now", 0, func(_ *sqlite.FunctionContext, _ []driver.Value) (driver.Value, error) {
		return time.Now().UTC().Format("2006-01-02 15:04:05.000000000-07:00"), nil
	})
}

// OpenSQLite configures every physical connection. Only the migrator may create files.
func OpenSQLite(ctx context.Context, rawURL string, create bool) (*sql.DB, error) {
	conn, err := Parse(rawURL)
	if err != nil {
		return nil, err
	}
	if conn.Driver != "sqlite" {
		return nil, errors.New("expected SQLite URL")
	}
	if create {
		if err := os.MkdirAll(filepath.Dir(conn.SQLitePath), 0700); err != nil {
			return nil, fmt.Errorf("create SQLite directory: %w", err)
		}
	} else {
		info, err := os.Stat(conn.SQLitePath)
		if err != nil {
			return nil, fmt.Errorf("SQLite database is missing or inaccessible; check path and run migrations: %w", err)
		}
		if !info.Mode().IsRegular() {
			return nil, errors.New("SQLite database must be a regular file")
		}
	}
	mode := "rw"
	if create {
		mode = "rwc"
	}
	path := filepath.ToSlash(conn.SQLitePath)
	if runtime.GOOS == "windows" {
		path = "/" + path
	}
	uri := url.URL{Scheme: "file", Path: path}
	q := url.Values{"mode": {mode}, "_txlock": {"immediate"}, "_pragma": {"busy_timeout(25)", "journal_mode(WAL)", "foreign_keys(1)", "synchronous(FULL)"}}
	uri.RawQuery = q.Encode()
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("open SQLite database: %w", err)
	}
	var journal string
	if err := db.QueryRowContext(ctx, "pragma journal_mode").Scan(&journal); err != nil || journal != "wal" {
		db.Close()
		return nil, fmt.Errorf("SQLite requires WAL mode (got %q): %v", journal, err)
	}
	return db, nil
}
