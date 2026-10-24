package backup

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"book-hub/internal/database"
	"github.com/google/uuid"
)

func TestSQLiteBackupRestoreIncludesWALAndStorage(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	options := Options{DatabaseURL: sqliteURL(filepath.Join(root, "db", "book-hub.sqlite")), StorageDir: filepath.Join(root, "books")}
	if err := database.Migrate(ctx, options.DatabaseURL, "up"); err != nil {
		t.Fatal(err)
	}
	db, err := database.OpenSQLite(ctx, options.DatabaseURL, false)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.ExecContext(ctx, "PRAGMA wal_autocheckpoint=0; CREATE TABLE backup_probe (value TEXT); INSERT INTO backup_probe VALUES ('committed WAL data')"); err != nil {
		t.Fatal(err)
	}
	connection, _ := database.Parse(options.DatabaseURL)
	info, err := os.Stat(connection.SQLitePath + "-wal")
	if err != nil || info.Size() == 0 {
		t.Fatalf("test must leave committed WAL data: %v", err)
	}
	writeStorageFixture(t, options.StorageDir)
	directory := filepath.Join(root, "backup")
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err := Create(ctx, options, directory); err != nil {
		t.Fatal(err)
	}
	if err := Validate(ctx, options, directory); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(directory, "database.sqlite-wal")); !os.IsNotExist(err) {
		t.Fatalf("validation must not create WAL in backup: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	// Restore into an existing database with stale journal sidecars.
	if err := os.WriteFile(connection.SQLitePath+"-wal", []byte("stale WAL"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(options.StorageDir, "stale"), []byte("remove me"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := Restore(ctx, options, directory); err != nil {
		t.Fatal(err)
	}
	db, err = database.OpenSQLite(ctx, options.DatabaseURL, false)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var value string
	if err := db.QueryRowContext(ctx, "SELECT value FROM backup_probe").Scan(&value); err != nil || value != "committed WAL data" {
		t.Fatalf("restored WAL data = %q, %v", value, err)
	}
	assertStorageFixture(t, options.StorageDir)
	if _, err := os.Stat(filepath.Join(options.StorageDir, "stale")); !os.IsNotExist(err) {
		t.Fatalf("stale file remains: %v", err)
	}
}

func TestRestoreRejectsInvalidBackupBeforeChangingData(t *testing.T) {
	for _, test := range []struct {
		name     string
		manifest string
	}{
		{"other database", `{"format_version":1,"database":"postgres","schema_version":1}`},
		{"future format", `{"format_version":2,"database":"sqlite","schema_version":1}`},
		{"unknown database", `{"format_version":1,"database":"other","schema_version":1}`},
		{"legacy PostgreSQL", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			options := Options{DatabaseURL: sqliteURL(filepath.Join(root, "current.sqlite")), StorageDir: filepath.Join(root, "books")}
			if err := os.WriteFile(filepath.Join(root, "current.sqlite"), []byte("current database"), 0600); err != nil {
				t.Fatal(err)
			}
			writeStorageFixture(t, options.StorageDir)
			directory := filepath.Join(root, "backup")
			if err := os.Mkdir(directory, 0700); err != nil {
				t.Fatal(err)
			}
			if test.manifest != "" {
				if err := os.WriteFile(filepath.Join(directory, "manifest.json"), []byte(test.manifest), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if err := Restore(context.Background(), options, directory); err == nil {
				t.Fatal("invalid restore succeeded")
			}
			data, err := os.ReadFile(filepath.Join(root, "current.sqlite"))
			if err != nil || string(data) != "current database" {
				t.Fatalf("database changed: %q, %v", data, err)
			}
			assertStorageFixture(t, options.StorageDir)
		})
	}
}

func TestStorageArchiveRejectsTraversalAndLinks(t *testing.T) {
	for _, member := range []struct {
		name string
		kind byte
	}{
		{"../outside", tar.TypeReg},
		{"/absolute", tar.TypeReg},
		{`..\outside`, tar.TypeReg},
		{"C:/outside", tar.TypeReg},
		{"link", tar.TypeSymlink},
		{"link", tar.TypeLink},
	} {
		t.Run(fmt.Sprintf("%s-%c", member.name, member.kind), func(t *testing.T) {
			file, err := os.Create(filepath.Join(t.TempDir(), "storage.tar.gz"))
			if err != nil {
				t.Fatal(err)
			}
			gz := gzip.NewWriter(file)
			tarWriter := tar.NewWriter(gz)
			if err := tarWriter.WriteHeader(&tar.Header{Name: member.name, Typeflag: member.kind, Mode: 0600}); err != nil {
				t.Fatal(err)
			}
			tarWriter.Close()
			gz.Close()
			file.Close()
			if err := readArchive(file.Name(), ""); err == nil {
				t.Fatal("unsafe archive was accepted")
			}
		})
	}
}

func TestBackupRejectsOverlappingPathsBeforeMutation(t *testing.T) {
	for _, test := range []struct {
		name     string
		database string
		storage  string
		backup   string
	}{
		{"database in storage", "books/current.sqlite", "books", "backup"},
		{"backup in storage", "db/current.sqlite", "books", "books/backup"},
		{"database in backup", "backup/current.sqlite", "books", "backup"},
		{"storage in backup", "db/current.sqlite", "backup/books", "backup"},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			dbPath := filepath.Join(root, filepath.FromSlash(test.database))
			if err := os.MkdirAll(filepath.Dir(dbPath), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(dbPath, []byte("current database"), 0600); err != nil {
				t.Fatal(err)
			}
			options := Options{DatabaseURL: sqliteURL(dbPath), StorageDir: filepath.Join(root, filepath.FromSlash(test.storage))}
			directory := filepath.Join(root, filepath.FromSlash(test.backup))
			for _, operation := range []func(context.Context, Options, string) error{Create, Restore} {
				if err := operation(context.Background(), options, directory); err == nil || !strings.Contains(err.Error(), "director") {
					t.Fatalf("overlap was not rejected: %v", err)
				}
			}
			data, err := os.ReadFile(dbPath)
			if err != nil || string(data) != "current database" {
				t.Fatalf("database changed: %q, %v", data, err)
			}
		})
	}
}

func TestBackupRejectsOverlapThroughSymlink(t *testing.T) {
	root := t.TempDir()
	storage := filepath.Join(root, "books")
	if err := os.Mkdir(storage, 0700); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "alias")
	if err := os.Symlink(storage, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	options := Options{DatabaseURL: sqliteURL(filepath.Join(root, "db.sqlite")), StorageDir: storage}
	if err := validateLayout(options, filepath.Join(link, "new-backup")); err == nil {
		t.Fatal("overlap through an existing symlink ancestor was accepted")
	}
	options.DatabaseURL = sqliteURL(filepath.Join(link, "new.sqlite"))
	if err := validateLayout(options, filepath.Join(root, "backup")); err == nil {
		t.Fatal("database in storage through a symlink was accepted")
	}
}

func TestPostgresBackupRestoreAndLegacyFormat(t *testing.T) {
	adminURL := os.Getenv("BOOK_HUB_TEST_DATABASE_URL")
	if adminURL == "" {
		t.Skip("BOOK_HUB_TEST_DATABASE_URL is not set")
	}
	for _, command := range []string{"pg_dump", "psql"} {
		if _, err := exec.LookPath(command); err != nil {
			t.Skipf("PostgreSQL backup tests require %s: %v", command, err)
		}
	}
	ctx := context.Background()
	admin, err := sql.Open("pgx", adminURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	databaseName := "backup_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.ExecContext(ctx, "CREATE DATABASE "+databaseName); err != nil {
		t.Fatal(err)
	}
	defer admin.ExecContext(ctx, "DROP DATABASE "+databaseName+" WITH (FORCE)")
	parsed, err := url.Parse(adminURL)
	if err != nil {
		t.Fatal(err)
	}
	parsed.Path = "/" + databaseName
	root := t.TempDir()
	options := Options{DatabaseURL: parsed.String(), StorageDir: filepath.Join(root, "books")}
	if err := database.Migrate(ctx, options.DatabaseURL, "up"); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("pgx", options.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.ExecContext(ctx, "CREATE TABLE backup_probe(value TEXT); INSERT INTO backup_probe VALUES ('postgres data')"); err != nil {
		t.Fatal(err)
	}
	writeStorageFixture(t, options.StorageDir)
	directory := filepath.Join(root, "backup")
	os.Mkdir(directory, 0700)
	if err := Create(ctx, options, directory); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(directory, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil || manifest.Database != "postgres" {
		t.Fatalf("manifest: %s, %v", data, err)
	}
	for _, legacy := range []bool{false, true} {
		if legacy {
			if err := os.Remove(filepath.Join(directory, "manifest.json")); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := db.ExecContext(ctx, "DELETE FROM backup_probe"); err != nil {
			t.Fatal(err)
		}
		if err := Restore(ctx, options, directory); err != nil {
			t.Fatalf("legacy=%t: %v", legacy, err)
		}
		var value string
		if err := db.QueryRowContext(ctx, "SELECT value FROM backup_probe").Scan(&value); err != nil || value != "postgres data" {
			t.Fatalf("restored value = %q, %v", value, err)
		}
		assertStorageFixture(t, options.StorageDir)
	}
}

func writeStorageFixture(t *testing.T, directory string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(directory, "covers"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"book.pdf", "covers/cover.jpg", ".hidden"} {
		if err := os.WriteFile(filepath.Join(directory, filepath.FromSlash(name)), []byte(name), 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func assertStorageFixture(t *testing.T, directory string) {
	t.Helper()
	for _, name := range []string{"book.pdf", "covers/cover.jpg", ".hidden"} {
		data, err := os.ReadFile(filepath.Join(directory, filepath.FromSlash(name)))
		if err != nil || string(data) != name {
			t.Fatalf("restored file %s: %q, %v", name, data, err)
		}
	}
}
