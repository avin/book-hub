package backup

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"book-hub/internal/config"
	"book-hub/internal/database"
	"book-hub/internal/storage/files"
	"book-hub/internal/storage/sqlstore"
	"github.com/google/uuid"
)

func TestBackupRejectsCacheDirectoryOverlapBeforeWriting(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	cfg := portableConfig(filepath.Join(root, "source"))
	cfg.CacheDir = filepath.Join(root, "cache")
	cfg.CacheMaxBytes = 1024
	if err := database.Migrate(ctx, cfg.DatabaseURL, "up"); err != nil {
		t.Fatal(err)
	}
	writePortableLibrary(t, cfg)
	if err := Create(ctx, Options{DatabaseURL: cfg.DatabaseURL, FileStorage: cfg}, cfg.CacheDir); err == nil {
		t.Fatal("backup was written into the running backend's cache")
	}
	entries, err := os.ReadDir(cfg.CacheDir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("cache changed before preflight: %v %v", entries, err)
	}
	data, err := os.ReadFile(filepath.Join(cfg.CacheDir, entries[0].Name()))
	if err != nil || string(data) != portableBook {
		t.Fatalf("cached original changed: %q %v", data, err)
	}
}

func TestRemoteBackupRestoresAcrossEveryStorageWithoutItsSource(t *testing.T) {
	requireRemoteBackupFixtures(t)
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			newDatabase, admin := remoteDatabaseFactory(t, driver)
			ctx := context.Background()
			root := t.TempDir()
			sourceRoot := filepath.Join(root, "source")
			source := remoteBackupConfig(t, "directory", sourceRoot)
			source.DatabaseURL = newDatabase(sourceRoot)
			source.CacheDir, source.CacheMaxBytes = filepath.Join(sourceRoot, "cache"), 1024
			if err := database.Migrate(ctx, source.DatabaseURL, "up"); err != nil {
				t.Fatal(err)
			}
			bookID := writePortableLibrary(t, source)
			cleanup := func(cfg config.Config) {
				originals := remoteOriginals(t, cfg)
				t.Cleanup(func() { _ = originals.Delete(context.Background(), portableOriginalPath(originals)) })
			}
			for index, kind := range []string{"ftp", "ftps-explicit", "ftps-implicit", "s3", "directory"} {
				t.Run(source.BookStorage+" to "+kind, func(t *testing.T) {
					copyDirectory := filepath.Join(root, fmt.Sprintf("copy-%d", index))
					if err := os.Mkdir(copyDirectory, 0700); err != nil {
						t.Fatal(err)
					}
					// The cache is deliberately unrelated to the required original. A full
					// backup must use the selected permanent source and omit local cache data.
					if source.CacheDir != "" {
						if err := os.MkdirAll(source.CacheDir, 0700); err != nil {
							t.Fatal(err)
						}
						if err := os.WriteFile(filepath.Join(source.CacheDir, "cache-only"), []byte("not an original"), 0600); err != nil {
							t.Fatal(err)
						}
					}
					if err := Create(ctx, Options{DatabaseURL: source.DatabaseURL, FileStorage: source}, copyDirectory); err != nil {
						t.Fatal(err)
					}
					assertRemoteBackupComponents(t, copyDirectory, driver)
					originals := remoteOriginals(t, source)
					if err := originals.Delete(ctx, portableOriginalPath(originals)); err != nil {
						t.Fatal(err)
					}
					if admin != nil {
						if _, err := admin.ExecContext(ctx, "DROP DATABASE "+pgDatabaseName(t, source.DatabaseURL)+" WITH (FORCE)"); err != nil {
							t.Fatal(err)
						}
					}
					if err := os.RemoveAll(sourceRoot); err != nil {
						t.Fatal(err)
					}
					targetRoot := filepath.Join(root, fmt.Sprintf("target-%d", index))
					target := remoteBackupConfig(t, kind, targetRoot)
					cleanup(target)
					target.DatabaseURL = newDatabase(targetRoot)
					options := Options{DatabaseURL: target.DatabaseURL, FileStorage: target}
					if err := Validate(ctx, options, copyDirectory); err != nil {
						t.Fatal(err)
					}
					if err := Restore(ctx, options, copyDirectory); err != nil {
						t.Fatal(err)
					}
					assertPortableLibraryHTTP(t, target, bookID, portableDescription)
					source, sourceRoot = target, targetRoot
				})
			}
		})
	}
}

func requireRemoteBackupFixtures(t *testing.T) {
	t.Helper()
	for _, name := range []string{"BOOK_HUB_TEST_FTP_ADDR", "BOOK_HUB_TEST_FTPS_EXPLICIT_ADDR", "BOOK_HUB_TEST_FTPS_IMPLICIT_ADDR", "BOOK_HUB_TEST_FTPS_CA_FILE", "BOOK_HUB_TEST_S3_ENDPOINT"} {
		if os.Getenv(name) == "" {
			t.Skipf("set %s to run the real remote backup matrix", name)
		}
	}
}

func remoteDatabaseFactory(t *testing.T, driver string) (func(string) string, *sql.DB) {
	t.Helper()
	if driver == "sqlite" {
		return func(root string) string { return sqliteURL(filepath.Join(root, "database", "library.sqlite")) }, nil
	}
	adminURL := os.Getenv("BOOK_HUB_TEST_DATABASE_URL")
	if adminURL == "" {
		t.Skip("set BOOK_HUB_TEST_DATABASE_URL to run the PostgreSQL remote backup matrix")
	}
	for _, name := range []string{"pg_dump", "psql"} {
		if _, err := exec.LookPath(name); err != nil {
			t.Skipf("requires %s", name)
		}
	}
	admin, err := sql.Open("pgx", adminURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { admin.Close() })
	return func(string) string { return newPortablePGDatabase(t, admin, adminURL) }, admin
}

func remoteBackupConfig(t *testing.T, kind, root string) config.Config {
	t.Helper()
	cfg := portableConfig(root)
	cfg.BookStorage = kind
	if kind == "ftp" || strings.HasPrefix(kind, "ftps-") {
		env := "BOOK_HUB_TEST_FTP_ADDR"
		if kind == "ftps-explicit" {
			env = "BOOK_HUB_TEST_FTPS_EXPLICIT_ADDR"
		} else if kind == "ftps-implicit" {
			env = "BOOK_HUB_TEST_FTPS_IMPLICIT_ADDR"
		}
		cfg.FTPAddr = os.Getenv(env)
		cfg.FTPUser, cfg.FTPPassword = "bookhub", "bookhub-test-password"
		cfg.FTPRoot = "/books/backup-" + uuid.NewString()
		cfg.FTPCAFile = os.Getenv("BOOK_HUB_TEST_FTPS_CA_FILE")
	}
	if kind == "s3" {
		cfg.S3Endpoint, cfg.S3Region, cfg.S3Bucket = os.Getenv("BOOK_HUB_TEST_S3_ENDPOINT"), "garage", "bookhub-test"
		cfg.S3Prefix = "backup-" + uuid.NewString()
		cfg.S3AccessKeyID = "GK00000000000000000000000000000001"
		cfg.S3SecretAccessKey = "codex-bookhub-s3-test-secret-000000000000000000000000000000000000"
	}
	return cfg
}

func remoteOriginals(t *testing.T, cfg config.Config) files.Originals {
	t.Helper()
	originals, err := files.NewOriginals(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return originals
}

func portableOriginalPath(originals files.Originals) string {
	hash := sha256.Sum256([]byte(portableBook))
	return originals.BookPath(hex.EncodeToString(hash[:]), "pdf")
}

func assertRemoteBackupComponents(t *testing.T, directory, driver string) {
	t.Helper()
	name := "database.sqlite"
	if driver == "postgres" {
		name = "database.sql"
	}
	entries, err := os.ReadDir(directory)
	if err != nil || len(entries) != 3 {
		t.Fatalf("backup components: %v %v", entries, err)
	}
	for _, part := range []string{"manifest.json", name, "storage.tar.gz"} {
		if info, err := os.Stat(filepath.Join(directory, part)); err != nil || info.Size() == 0 {
			t.Fatalf("missing backup component %s: %v", part, err)
		}
	}
	input, err := os.Open(filepath.Join(directory, "storage.tar.gz"))
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	gz, err := gzip.NewReader(input)
	if err != nil {
		t.Fatal(err)
	}
	defer gz.Close()
	archive := tar.NewReader(gz)
	for {
		header, err := archive.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(header.Name, "books/") && !strings.HasPrefix(header.Name, "covers/") {
			t.Fatalf("nonpermanent entry in full backup: %s", header.Name)
		}
	}
}

func TestRemoteFullBackupRejectsUnavailableOrDamagedOriginalDespiteWarmCache(t *testing.T) {
	requireRemoteBackupFixtures(t)
	for _, kind := range []string{"ftp", "ftps-explicit", "ftps-implicit", "s3"} {
		for _, failure := range []string{"missing", "corrupt", "authentication"} {
			t.Run(kind+"/"+failure, func(t *testing.T) {
				ctx := context.Background()
				root := t.TempDir()
				cfg := remoteBackupConfig(t, kind, filepath.Join(root, "source"))
				cfg.CacheDir, cfg.CacheMaxBytes = filepath.Join(root, "cache"), 1024
				if err := database.Migrate(ctx, cfg.DatabaseURL, "up"); err != nil {
					t.Fatal(err)
				}
				bookID := writePortableLibrary(t, cfg)
				originals := remoteOriginals(t, cfg)
				location := portableOriginalPath(originals)
				t.Cleanup(func() { _ = originals.Delete(context.Background(), location) })
				switch failure {
				case "missing":
					if err := originals.Delete(ctx, location); err != nil {
						t.Fatal(err)
					}
				case "corrupt":
					corrupt := filepath.Join(root, "corrupt")
					if err := os.WriteFile(corrupt, []byte(strings.Repeat("x", len(portableBook))), 0600); err != nil {
						t.Fatal(err)
					}
					hash := sha256.Sum256([]byte(portableBook))
					if _, err := originals.MoveBook(ctx, corrupt, hex.EncodeToString(hash[:]), "pdf"); err != nil {
						t.Fatal(err)
					}
				case "authentication":
					cfg.FTPPassword, cfg.S3SecretAccessKey = "invalid-password", "invalid-secret"
				}
				// Reading the library can still succeed from cache, but that must not
				// advertise a backup missing its required permanent original as complete.
				assertPortableLibraryHTTP(t, cfg, bookID, portableDescription)
				directory := filepath.Join(root, "backup")
				if err := os.Mkdir(directory, 0700); err != nil {
					t.Fatal(err)
				}
				if err := Create(ctx, Options{DatabaseURL: cfg.DatabaseURL, FileStorage: cfg}, directory); err == nil {
					t.Fatal("incomplete remote backup succeeded through the cache")
				}
				if _, err := os.Stat(filepath.Join(directory, "manifest.json")); !os.IsNotExist(err) {
					t.Fatalf("incomplete remote backup published manifest: %v", err)
				}
			})
		}
	}
}

func TestRemoteRestoreRejectsOccupiedNamespaceAndPreservesNeighbors(t *testing.T) {
	requireRemoteBackupFixtures(t)
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			ctx := context.Background()
			newDatabase, _ := remoteDatabaseFactory(t, driver)
			root := t.TempDir()
			source := remoteBackupConfig(t, "directory", filepath.Join(root, "source"))
			source.DatabaseURL = newDatabase(filepath.Join(root, "source"))
			if err := database.Migrate(ctx, source.DatabaseURL, "up"); err != nil {
				t.Fatal(err)
			}
			writePortableLibrary(t, source)
			directory := filepath.Join(root, "backup")
			if err := os.Mkdir(directory, 0700); err != nil {
				t.Fatal(err)
			}
			if err := Create(ctx, Options{DatabaseURL: source.DatabaseURL, FileStorage: source}, directory); err != nil {
				t.Fatal(err)
			}
			for _, kind := range []string{"ftp", "ftps-explicit", "ftps-implicit", "s3"} {
				t.Run(kind, func(t *testing.T) {
					targetRoot := filepath.Join(root, "target-"+kind)
					target := remoteBackupConfig(t, kind, targetRoot)
					target.DatabaseURL = newDatabase(targetRoot)
					if err := database.Migrate(ctx, target.DatabaseURL, "up"); err != nil {
						t.Fatal(err)
					}
					store, err := sqlstore.Open(ctx, target.DatabaseURL)
					if err != nil {
						t.Fatal(err)
					}
					defer store.Close()
					if _, err := store.CreateUser(ctx, "unchanged", "unused", true, 1024); err != nil {
						t.Fatal(err)
					}
					originals := remoteOriginals(t, target)
					location := putRemoteFixture(t, originals, "occupied original")
					neighbor := remoteOriginals(t, remoteBackupConfig(t, kind, filepath.Join(root, "neighbor-"+kind)))
					neighborLocation := putRemoteFixture(t, neighbor, "neighbor original")
					for _, operation := range []func(context.Context, Options, string) error{Validate, Restore} {
						if err := operation(ctx, Options{DatabaseURL: target.DatabaseURL, FileStorage: target}, directory); err == nil {
							t.Fatal("occupied remote namespace accepted")
						}
						if _, err := store.GetUserByLogin(ctx, "unchanged"); err != nil {
							t.Fatalf("destination DB changed before preflight: %v", err)
						}
						assertRemoteFixture(t, originals, location, "occupied original")
						assertRemoteFixture(t, neighbor, neighborLocation, "neighbor original")
						if _, err := os.Stat(target.ImagesDir); !os.IsNotExist(err) {
							t.Fatalf("destination images changed before preflight: %v", err)
						}
					}
				})
			}
		})
	}
}

func putRemoteFixture(t *testing.T, originals files.Originals, contents string) string {
	t.Helper()
	input := filepath.Join(t.TempDir(), "sentinel")
	if err := os.WriteFile(input, []byte(contents), 0600); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte(contents))
	location, err := originals.MoveBook(context.Background(), input, hex.EncodeToString(hash[:]), "pdf")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = originals.Delete(context.Background(), location) })
	return location
}

func assertRemoteFixture(t *testing.T, originals files.Originals, location, expected string) {
	t.Helper()
	input, err := originals.Open(context.Background(), location)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(input)
	closeErr := input.Close()
	if err != nil || closeErr != nil || string(data) != expected {
		t.Fatalf("remote fixture changed: %q read=%v close=%v", data, err, closeErr)
	}
}

func TestLegacyBackupRestoresIntoEveryRemoteStorage(t *testing.T) {
	requireRemoteBackupFixtures(t)
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			ctx := context.Background()
			newDatabase, admin := remoteDatabaseFactory(t, driver)
			root := t.TempDir()
			sourceRoot := filepath.Join(root, "old-source")
			source := portableConfig(sourceRoot)
			source.DatabaseURL = newDatabase(sourceRoot)
			source.BooksDir, source.ImagesDir, source.WorkDir = filepath.Join(source.StorageDir, "books"), filepath.Join(source.StorageDir, "covers"), filepath.Join(source.StorageDir, "tmp")
			if err := database.Migrate(ctx, source.DatabaseURL, "up"); err != nil {
				t.Fatal(err)
			}
			bookID := writePortableLibrary(t, source)
			migrator, err := database.NewMigrator(ctx, source.DatabaseURL, false)
			if err != nil {
				t.Fatal(err)
			}
			version := uint(3)
			if driver == "sqlite" {
				version = 1
			}
			if err := migrator.Migrate(version); err != nil {
				migrator.Close()
				t.Fatal(err)
			}
			migrator.Close()
			var db *sql.DB
			if driver == "sqlite" {
				db, err = database.OpenSQLite(ctx, source.DatabaseURL, false)
			} else {
				db, err = sql.Open("pgx", source.DatabaseURL)
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `UPDATE book_files SET storage_path = 'D:\old\books\original.pdf'; UPDATE user_books SET cover_path='old/covers/cover.png', cover_thumbnail_path='old/covers/cover.thumbnail.jpg'`); err != nil {
				db.Close()
				t.Fatal(err)
			}
			directory := filepath.Join(root, "legacy-copy")
			if err := os.Mkdir(directory, 0700); err != nil {
				t.Fatal(err)
			}
			if driver == "sqlite" {
				_, err = db.ExecContext(ctx, "VACUUM INTO ?", filepath.Join(directory, "database.sqlite"))
				if err == nil {
					err = os.WriteFile(filepath.Join(directory, "manifest.json"), []byte(`{"format_version":1,"database":"sqlite","schema_version":1}`), 0600)
				}
			} else {
				// Pre-SQLite PostgreSQL backups used a plain pg_dump and had no manifest.
				err = dumpPostgres(ctx, source.DatabaseURL, filepath.Join(directory, "database.sql"))
			}
			db.Close()
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(source.WorkDir, "upload-unfinished"), []byte("incomplete original"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(source.StorageDir, ".service"), []byte("not an original"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := writeLegacyArchive(source.StorageDir, filepath.Join(directory, "storage.tar.gz")); err != nil {
				t.Fatal(err)
			}
			if admin != nil {
				if _, err := admin.ExecContext(ctx, "DROP DATABASE "+pgDatabaseName(t, source.DatabaseURL)+" WITH (FORCE)"); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.RemoveAll(sourceRoot); err != nil {
				t.Fatal(err)
			}
			for _, kind := range []string{"ftp", "ftps-explicit", "ftps-implicit", "s3"} {
				t.Run(kind, func(t *testing.T) {
					targetRoot := filepath.Join(root, "target-"+kind)
					target := remoteBackupConfig(t, kind, targetRoot)
					target.DatabaseURL = newDatabase(targetRoot)
					originals := remoteOriginals(t, target)
					t.Cleanup(func() { _ = originals.Delete(context.Background(), portableOriginalPath(originals)) })
					if err := Restore(ctx, Options{DatabaseURL: target.DatabaseURL, FileStorage: target}, directory); err != nil {
						t.Fatal(err)
					}
					assertPortableLibraryHTTP(t, target, bookID, "")
					if _, err := os.Stat(filepath.Join(target.WorkDir, "upload-unfinished")); !os.IsNotExist(err) {
						t.Fatalf("legacy partial restored: %v", err)
					}
					if err := originals.Delete(ctx, portableOriginalPath(originals)); err != nil {
						t.Fatal(err)
					}
					if empty, err := originals.(files.OriginalNamespace).Empty(ctx); err != nil || !empty {
						t.Fatalf("legacy service entries were uploaded as originals: empty=%t err=%v", empty, err)
					}
				})
			}
		})
	}
}

// The real adapter persists an original, then the operation is interrupted before
// restore can change its database. Retrying requires manual cleanup, never resume.
type interruptedRestoreOriginals struct {
	files.Originals
	cancel context.CancelFunc
}

func (s interruptedRestoreOriginals) Empty(ctx context.Context) (bool, error) {
	return s.Originals.(files.OriginalNamespace).Empty(ctx)
}

func (s interruptedRestoreOriginals) MoveBook(ctx context.Context, source, hash, format string) (string, error) {
	location, err := s.Originals.MoveBook(ctx, source, hash, format)
	if err != nil {
		return location, err
	}
	s.cancel()
	return location, ctx.Err()
}

func TestInterruptedRemoteRestoreRequiresCleanupBeforeRetry(t *testing.T) {
	requireRemoteBackupFixtures(t)
	for _, kind := range []string{"ftp", "ftps-explicit", "ftps-implicit", "s3"} {
		t.Run(kind, func(t *testing.T) {
			ctx := context.Background()
			root := t.TempDir()
			source := portableConfig(filepath.Join(root, "source"))
			if err := database.Migrate(ctx, source.DatabaseURL, "up"); err != nil {
				t.Fatal(err)
			}
			bookID := writePortableLibrary(t, source)
			directory := filepath.Join(root, "backup")
			if err := os.Mkdir(directory, 0700); err != nil {
				t.Fatal(err)
			}
			if err := Create(ctx, Options{DatabaseURL: source.DatabaseURL, FileStorage: source}, directory); err != nil {
				t.Fatal(err)
			}
			target := remoteBackupConfig(t, kind, filepath.Join(root, "target"))
			originals := remoteOriginals(t, target)
			location := portableOriginalPath(originals)
			t.Cleanup(func() { _ = originals.Delete(context.Background(), location) })
			interrupted, cancel := context.WithCancel(ctx)
			defer cancel()
			options := Options{DatabaseURL: target.DatabaseURL, FileStorage: target, Originals: interruptedRestoreOriginals{originals, cancel}}
			if err := Restore(interrupted, options, directory); !errors.Is(err, context.Canceled) {
				t.Fatalf("interrupted restore result: %v", err)
			}
			connection, _ := database.Parse(target.DatabaseURL)
			if _, err := os.Stat(connection.SQLitePath); !os.IsNotExist(err) {
				t.Fatalf("database published after interrupted original restore: %v", err)
			}
			assertRemoteFixture(t, originals, location, portableBook)
			options.Originals = nil
			if err := Restore(ctx, options, directory); err == nil {
				t.Fatal("partial destination silently resumed")
			}
			if err := originals.Delete(ctx, location); err != nil {
				t.Fatal(err)
			}
			if err := Restore(ctx, options, directory); err != nil {
				t.Fatal(err)
			}
			assertPortableLibraryHTTP(t, target, bookID, portableDescription)
		})
	}
}
