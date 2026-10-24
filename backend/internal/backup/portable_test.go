package backup

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"book-hub/internal/auth"
	"book-hub/internal/config"
	"book-hub/internal/database"
	"book-hub/internal/domain"
	"book-hub/internal/httpapi"
	"book-hub/internal/storage/files"
	"book-hub/internal/storage/sqlstore"
	"github.com/google/uuid"
)

func TestPortableSQLiteLibraryRestoresWithoutItsSource(t *testing.T) {
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
	if err := os.RemoveAll(filepath.Join(root, "source")); err != nil {
		t.Fatal(err)
	}
	target := portableConfig(filepath.Join(root, "target"))
	if err := Restore(ctx, Options{DatabaseURL: target.DatabaseURL, FileStorage: target}, directory); err != nil {
		t.Fatal(err)
	}
	assertPortableLibraryHTTP(t, target, bookID)
}

func portableConfig(root string) config.Config {
	return config.Config{BasePath: "/", DatabaseURL: sqliteURL(filepath.Join(root, "database", "library.sqlite")), StorageDir: filepath.Join(root, "legacy"), BooksDir: filepath.Join(root, "originals"), ImagesDir: filepath.Join(root, "images"), WorkDir: filepath.Join(root, "work"), SessionSecret: strings.Repeat("x", 32), SessionTTL: time.Hour, MaxUploadBytes: 1024, MaxCoverUploadBytes: 1024}
}

const portableBook = "%PDF-1.7\nwhole original with embedded illustration\x00\xff\n"

func writePortableLibrary(t *testing.T, cfg config.Config) string {
	t.Helper()
	ctx := context.Background()
	store, err := sqlstore.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	password, err := auth.HashPassword("password")
	if err != nil {
		t.Fatal(err)
	}
	owner, err := store.CreateUser(ctx, "reader", password, true, 1024)
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
	temp, err := fileStore.Work.SaveTemp(strings.NewReader(portableBook), 1024)
	if err != nil {
		t.Fatal(err)
	}
	defer temp.Release()
	location, err := fileStore.Books.MoveBook(ctx, temp.Path, temp.SHA256, "pdf")
	if err != nil {
		t.Fatal(err)
	}
	book, err := store.CreateBook(ctx, owner.ID, domain.BookFileInput{SHA256: temp.SHA256, SizeBytes: temp.Size, Format: "pdf", StoragePath: location}, domain.BookInput{Title: "Книга\tс иллюстрацией", Tags: []string{"restored"}, Favorite: true})
	if err != nil {
		t.Fatal(err)
	}
	fileStore.SeedBook(ctx, book, temp)
	_, images, _ := cfg.FilePaths()
	cover := filepath.Join(images, "cover.png")
	thumb := filepath.Join(images, "cover.thumbnail.jpg")
	if err := os.WriteFile(cover, []byte("original cover"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(thumb, []byte("thumbnail"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetCover(ctx, owner.ID, book.ID, domain.CoverFiles{CoverPath: cover, CoverThumbPath: thumb}); err != nil {
		t.Fatal(err)
	}
	return book.ID.String()
}

func assertPortableLibraryHTTP(t *testing.T, cfg config.Config, bookID string) {
	t.Helper()
	ctx := context.Background()
	store, err := sqlstore.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	fileStore, err := files.NewConfigured(cfg)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(httpapi.New(cfg, store, fileStore, slog.New(slog.NewTextHandler(io.Discard, nil))))
	defer server.Close()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	response, err := client.Get(server.URL + "/api/v1/auth/csrf")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	var csrf string
	for _, cookie := range response.Cookies() {
		if cookie.Name == "book_hub_csrf" {
			csrf = cookie.Value
		}
	}
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/login", strings.NewReader(`{"login":"reader","password":"password"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-CSRF-Token", csrf)
	response, err = client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("login: %d", response.StatusCode)
	}
	for _, test := range []struct{ suffix, expected string }{{"/file", portableBook}, {"/cover", "original cover"}, {"/cover?variant=thumbnail", "thumbnail"}} {
		response, err := client.Get(server.URL + "/api/v1/books/" + bookID + test.suffix)
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil || response.StatusCode != http.StatusOK || !bytes.Equal(data, []byte(test.expected)) {
			t.Fatalf("restored %s: %d %q %v", test.suffix, response.StatusCode, data, err)
		}
	}
	response, err = client.Get(server.URL + "/api/v1/books/" + bookID)
	if err != nil {
		t.Fatal(err)
	}
	var metadata struct {
		Title     string   `json:"title"`
		Tags      []string `json:"tags"`
		Favorite  bool     `json:"favorite"`
		Format    string   `json:"format"`
		SizeBytes int64    `json:"size_bytes"`
	}
	err = json.NewDecoder(response.Body).Decode(&metadata)
	response.Body.Close()
	if err != nil || response.StatusCode != http.StatusOK || metadata.Title != "Книга\tс иллюстрацией" || !metadata.Favorite || metadata.Format != "pdf" || metadata.SizeBytes != int64(len(portableBook)) || len(metadata.Tags) != 1 || metadata.Tags[0] != "restored" {
		t.Fatalf("restored HTTP metadata: %+v status=%d err=%v", metadata, response.StatusCode, err)
	}
	request, _ = http.NewRequest(http.MethodGet, server.URL+"/api/v1/books/"+bookID+"/file", nil)
	request.Header.Set("Range", "bytes=0-3")
	response, err = client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != http.StatusPartialContent || string(data) != "%PDF" {
		t.Fatalf("restored HTTP range: %d %q %v", response.StatusCode, data, err)
	}
	foreign, err := store.CreateUser(ctx, "foreign"+uuid.NewString()[:8], "unused", true, 1024)
	if err != nil {
		t.Fatal(err)
	}
	token, tokenHash, err := auth.NewSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.CreateSession(ctx, foreign.ID, tokenHash, 3600); err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{"/file", "/cover"} {
		request, _ = http.NewRequest(http.MethodGet, server.URL+"/api/v1/books/"+bookID+suffix, nil)
		request.AddCookie(&http.Cookie{Name: "book_hub_session", Value: token})
		response, err = http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusNotFound {
			t.Fatalf("foreign access after restore: %d", response.StatusCode)
		}
	}
	hash := sha256.Sum256([]byte(portableBook))
	file, err := store.GetBookFileByHash(ctx, hex.EncodeToString(hash[:]))
	if err != nil || file == nil {
		t.Fatalf("restored metadata: %v", err)
	}
}

func TestPortableRestorePreflightPreservesDestination(t *testing.T) {
	for _, failure := range []string{"nonempty originals", "corrupt original", "missing image", "truncated database"} {
		t.Run(failure, func(t *testing.T) {
			ctx := context.Background()
			root := t.TempDir()
			source := portableConfig(filepath.Join(root, "source"))
			if err := database.Migrate(ctx, source.DatabaseURL, "up"); err != nil {
				t.Fatal(err)
			}
			writePortableLibrary(t, source)
			directory := filepath.Join(root, "backup")
			os.Mkdir(directory, 0700)
			if err := Create(ctx, Options{DatabaseURL: source.DatabaseURL, FileStorage: source}, directory); err != nil {
				t.Fatal(err)
			}
			target := portableConfig(filepath.Join(root, "target"))
			connection, _ := database.Parse(target.DatabaseURL)
			os.MkdirAll(filepath.Dir(connection.SQLitePath), 0700)
			os.WriteFile(connection.SQLitePath, []byte("unchanged database"), 0600)
			if failure == "nonempty originals" {
				os.MkdirAll(target.BooksDir, 0700)
				os.WriteFile(filepath.Join(target.BooksDir, "sentinel"), []byte("untouched"), 0600)
			}
			if failure == "truncated database" {
				os.WriteFile(filepath.Join(directory, "database.sqlite"), []byte("not a database"), 0600)
			}
			if failure == "corrupt original" || failure == "missing image" {
				staged := filepath.Join(root, "archive")
				if err := readArchive(filepath.Join(directory, "storage.tar.gz"), staged); err != nil {
					t.Fatal(err)
				}
				hash := sha256.Sum256([]byte(portableBook))
				name := hex.EncodeToString(hash[:])
				if failure == "corrupt original" {
					os.WriteFile(filepath.Join(staged, "books", name[:2], name+".pdf"), []byte(strings.Repeat("x", len(portableBook))), 0600)
				} else {
					os.Remove(filepath.Join(staged, "covers", "cover.png"))
				}
				os.Remove(filepath.Join(directory, "storage.tar.gz"))
				if err := archiveStorage(staged, filepath.Join(directory, "storage.tar.gz")); err != nil {
					t.Fatal(err)
				}
			}
			for _, operation := range []func(context.Context, Options, string) error{Validate, Restore} {
				if err := operation(ctx, Options{DatabaseURL: target.DatabaseURL, FileStorage: target}, directory); err == nil {
					t.Fatal("invalid restore accepted")
				}
				data, err := os.ReadFile(connection.SQLitePath)
				if err != nil || string(data) != "unchanged database" {
					t.Fatalf("destination database changed: %q %v", data, err)
				}
				if _, err := os.Stat(target.ImagesDir); !os.IsNotExist(err) {
					t.Fatalf("images created before preflight: %v", err)
				}
			}
		})
	}
}

func TestPortableBackupRejectsDamagedOriginalWithoutPublishingManifest(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	source := portableConfig(filepath.Join(root, "source"))
	if err := database.Migrate(ctx, source.DatabaseURL, "up"); err != nil {
		t.Fatal(err)
	}
	writePortableLibrary(t, source)
	hash := sha256.Sum256([]byte(portableBook))
	name := hex.EncodeToString(hash[:])
	os.WriteFile(filepath.Join(source.BooksDir, name[:2], name+".pdf"), []byte("damaged"), 0600)
	directory := filepath.Join(root, "backup")
	os.Mkdir(directory, 0700)
	if err := Create(ctx, Options{DatabaseURL: source.DatabaseURL, FileStorage: source}, directory); err == nil {
		t.Fatal("damaged backup succeeded")
	}
	if _, err := os.Stat(filepath.Join(directory, "manifest.json")); !os.IsNotExist(err) {
		t.Fatalf("incomplete backup advertised: %v", err)
	}
}

func TestPortableLegacySQLiteRestoresOldPathsAndServiceEntries(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	source := portableConfig(filepath.Join(root, "source"))
	source.BooksDir = filepath.Join(source.StorageDir, "books")
	source.ImagesDir = filepath.Join(source.StorageDir, "covers")
	source.WorkDir = filepath.Join(source.StorageDir, "tmp")
	if err := database.Migrate(ctx, source.DatabaseURL, "up"); err != nil {
		t.Fatal(err)
	}
	bookID := writePortableLibrary(t, source)
	if err := database.Migrate(ctx, source.DatabaseURL, "down"); err != nil {
		t.Fatal(err)
	}
	db, err := database.OpenSQLite(ctx, source.DatabaseURL, false)
	if err != nil {
		t.Fatal(err)
	}
	// A Windows absolute original and a relative image path can coexist in old backups.
	if _, err = db.ExecContext(ctx, `UPDATE book_files SET storage_path = 'D:\old\library\books\original.pdf'; UPDATE user_books SET cover_path='old/covers/cover.png', cover_thumbnail_path='D:\old\covers\cover.thumbnail.jpg'`); err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(root, "backup")
	os.Mkdir(directory, 0700)
	if _, err = db.ExecContext(ctx, "VACUUM INTO ?", filepath.Join(directory, "database.sqlite")); err != nil {
		t.Fatal(err)
	}
	db.Close()
	os.WriteFile(filepath.Join(directory, "manifest.json"), []byte(`{"format_version":1,"database":"sqlite","schema_version":1}`), 0600)
	os.WriteFile(filepath.Join(source.WorkDir, "upload-unfinished"), []byte("partial"), 0600)
	os.WriteFile(filepath.Join(source.StorageDir, ".service"), []byte("service"), 0600)
	if err := writeLegacyArchive(source.StorageDir, filepath.Join(directory, "storage.tar.gz")); err != nil {
		t.Fatal(err)
	}
	os.RemoveAll(filepath.Join(root, "source"))
	target := portableConfig(filepath.Join(root, "target"))
	if err := Restore(ctx, Options{DatabaseURL: target.DatabaseURL, FileStorage: target}, directory); err != nil {
		t.Fatal(err)
	}
	assertPortableLibraryHTTP(t, target, bookID)
	if _, err := os.Stat(filepath.Join(target.WorkDir, "upload-unfinished")); !os.IsNotExist(err) {
		t.Fatalf("legacy temporary file restored: %v", err)
	}
	if err := database.CheckSchema(ctx, target.DatabaseURL); err != nil {
		t.Fatal(err)
	}
}

// Reproduce the old `tar -czf ... -C STORAGE .` layout, including ./ and service entries.
func writeLegacyArchive(root, destination string) error {
	output, err := os.Create(destination)
	if err != nil {
		return err
	}
	defer output.Close()
	gz := gzip.NewWriter(output)
	tw := tar.NewWriter(gz)
	err = filepath.WalkDir(root, func(name string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		header, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, name)
		if err != nil {
			return err
		}
		header.Name = "./" + filepath.ToSlash(rel)
		if rel == "." {
			header.Name = "./"
		}
		if err := tw.WriteHeader(header); err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		input, err := os.Open(name)
		if err != nil {
			return err
		}
		_, err = io.Copy(tw, input)
		input.Close()
		return err
	})
	if err != nil {
		return err
	}
	if err = tw.Close(); err != nil {
		return err
	}
	if err = gz.Close(); err != nil {
		return err
	}
	return output.Close()
}

func TestPortablePostgresLibraryRestoresCurrentAndLegacyWithoutSource(t *testing.T) {
	adminURL := os.Getenv("BOOK_HUB_TEST_DATABASE_URL")
	if adminURL == "" {
		t.Skip("BOOK_HUB_TEST_DATABASE_URL is not set")
	}
	for _, tool := range []string{"pg_dump", "psql"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skipf("requires %s", tool)
		}
	}
	ctx := context.Background()
	admin, err := sql.Open("pgx", adminURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	for _, legacy := range []bool{false, true} {
		t.Run(fmt.Sprintf("legacy=%t", legacy), func(t *testing.T) {
			root := t.TempDir()
			source := portableConfig(filepath.Join(root, "source"))
			source.DatabaseURL = newPortablePGDatabase(t, admin, adminURL)
			if legacy {
				source.BooksDir = filepath.Join(source.StorageDir, "books")
				source.ImagesDir = filepath.Join(source.StorageDir, "covers")
				source.WorkDir = filepath.Join(source.StorageDir, "tmp")
			}
			if err := database.Migrate(ctx, source.DatabaseURL, "up"); err != nil {
				t.Fatal(err)
			}
			bookID := writePortableLibrary(t, source)
			directory := filepath.Join(root, "backup")
			os.Mkdir(directory, 0700)
			if legacy {
				if err := database.Migrate(ctx, source.DatabaseURL, "down"); err != nil {
					t.Fatal(err)
				}
				db, err := sql.Open("pgx", source.DatabaseURL)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := db.ExecContext(ctx, `UPDATE book_files SET storage_path = E'D:\\old\\library\\books\\original.pdf'; UPDATE user_books SET cover_path='old/covers/cover.png', cover_thumbnail_path=E'D:\\old\\covers\\cover.thumbnail.jpg'`); err != nil {
					t.Fatal(err)
				}
				db.Close()
				if err := dumpPostgres(ctx, source.DatabaseURL, filepath.Join(directory, "database.sql")); err != nil {
					t.Fatal(err)
				}
				os.WriteFile(filepath.Join(source.WorkDir, "upload-unfinished"), []byte("partial"), 0600)
				os.WriteFile(filepath.Join(source.StorageDir, ".service"), []byte("service"), 0600)
				if err := writeLegacyArchive(source.StorageDir, filepath.Join(directory, "storage.tar.gz")); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := Create(ctx, Options{DatabaseURL: source.DatabaseURL, FileStorage: source}, directory); err != nil {
					t.Fatal(err)
				}
			}
			os.RemoveAll(filepath.Join(root, "source"))
			if _, err := admin.ExecContext(ctx, "DROP DATABASE "+pgDatabaseName(t, source.DatabaseURL)+" WITH (FORCE)"); err != nil {
				t.Fatal(err)
			}
			target := portableConfig(filepath.Join(root, "target"))
			target.DatabaseURL = newPortablePGDatabase(t, admin, adminURL)
			if err := Validate(ctx, Options{DatabaseURL: target.DatabaseURL, FileStorage: target}, directory); err != nil {
				t.Fatal(err)
			}
			if err := Restore(ctx, Options{DatabaseURL: target.DatabaseURL, FileStorage: target}, directory); err != nil {
				t.Fatal(err)
			}
			assertPortableLibraryHTTP(t, target, bookID)
			// A second restore must reject the occupied namespace before it changes the DB.
			if err := Restore(ctx, Options{DatabaseURL: target.DatabaseURL, FileStorage: target}, directory); err == nil {
				t.Fatal("nonempty destination accepted")
			}
			assertPortableLibraryHTTP(t, target, bookID)
		})
	}
}

func newPortablePGDatabase(t *testing.T, admin *sql.DB, rawURL string) string {
	t.Helper()
	name := "portable_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.ExecContext(context.Background(), "CREATE DATABASE "+name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { admin.ExecContext(context.Background(), "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)") })
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	parsed.Path = "/" + name
	return parsed.String()
}
func pgDatabaseName(t *testing.T, rawURL string) string {
	t.Helper()
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimPrefix(parsed.Path, "/")
}

func TestPortableBackupOmitsPendingOrphansAndTemporaryFiles(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	source := portableConfig(filepath.Join(root, "source"))
	if err := database.Migrate(ctx, source.DatabaseURL, "up"); err != nil {
		t.Fatal(err)
	}
	bookID := writePortableLibrary(t, source)
	store, err := sqlstore.Open(ctx, source.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := store.CreateUser(ctx, "deleted", "hash", true, 1024)
	if err != nil {
		t.Fatal(err)
	}
	orphan, err := store.CreateBook(ctx, owner.ID, domain.BookFileInput{SHA256: strings.Repeat("a", 64), Format: "pdf", SizeBytes: 99, StoragePath: "old/missing-original.pdf"}, domain.BookInput{Title: "Deleted"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.DeleteBook(ctx, owner.ID, orphan.ID); err != nil {
		t.Fatal(err)
	}
	store.Close()
	os.WriteFile(filepath.Join(source.WorkDir, "upload-active"), []byte("not permanent"), 0600)
	os.WriteFile(filepath.Join(source.StorageDir, "cache-ready"), []byte("not permanent"), 0600)
	directory := filepath.Join(root, "backup")
	os.Mkdir(directory, 0700)
	if err := Create(ctx, Options{DatabaseURL: source.DatabaseURL, FileStorage: source}, directory); err != nil {
		t.Fatal(err)
	}
	staged := filepath.Join(root, "archive")
	if err := readArchive(filepath.Join(directory, "storage.tar.gz"), staged); err != nil {
		t.Fatal(err)
	}
	err = filepath.WalkDir(staged, func(name string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(staged, name)
		if rel != "." && !strings.HasPrefix(filepath.ToSlash(rel), "books") && !strings.HasPrefix(filepath.ToSlash(rel), "covers") {
			t.Errorf("nonpermanent archive entry: %s", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	target := portableConfig(filepath.Join(root, "target"))
	if err := Restore(ctx, Options{DatabaseURL: target.DatabaseURL, FileStorage: target}, directory); err != nil {
		t.Fatal(err)
	}
	assertPortableLibraryHTTP(t, target, bookID)
	restored, err := sqlstore.Open(ctx, target.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	if file, err := restored.GetBookFileByHash(ctx, strings.Repeat("a", 64)); err != nil || file != nil {
		t.Fatalf("orphan metadata retained: %#v %v", file, err)
	}
	if err := restored.ProcessOriginalDeletions(ctx, func(context.Context, string) error { t.Error("restored deletion targeted old location"); return nil }); err != nil {
		t.Fatal(err)
	}
}

func TestRestoreRejectsAliasedOriginalAndImageDirectories(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	source := portableConfig(filepath.Join(root, "source"))
	if err := database.Migrate(ctx, source.DatabaseURL, "up"); err != nil {
		t.Fatal(err)
	}
	writePortableLibrary(t, source)
	directory := filepath.Join(root, "backup")
	os.Mkdir(directory, 0700)
	if err := Create(ctx, Options{DatabaseURL: source.DatabaseURL, FileStorage: source}, directory); err != nil {
		t.Fatal(err)
	}
	target := portableConfig(filepath.Join(root, "target"))
	os.MkdirAll(target.BooksDir, 0700)
	if err := os.Symlink(target.BooksDir, target.ImagesDir); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := Restore(ctx, Options{DatabaseURL: target.DatabaseURL, FileStorage: target}, directory); err == nil {
		t.Fatal("aliased original/image destinations accepted")
	}
	entries, err := os.ReadDir(target.BooksDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("destination changed before preflight: %v %v", entries, err)
	}
}
