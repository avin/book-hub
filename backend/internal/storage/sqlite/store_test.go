package sqlite_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"book-hub/internal/database"
	"book-hub/internal/domain"
	"book-hub/internal/storage"
	"book-hub/internal/storage/contract"
	"book-hub/internal/storage/sqlite"
	"github.com/google/uuid"
)

func TestStoreContract(t *testing.T) {
	contract.Run(t, func(t *testing.T) storage.Store {
		return openStore(t, migratedDatabase(t))
	})
}

func TestOriginalPersistenceAndIndependentConnections(t *testing.T) {
	contract.RunOriginalPersistence(t, func(t *testing.T) func() storage.Store {
		rawURL := migratedDatabase(t)
		return func() storage.Store {
			store := openStore(t, rawURL)
			t.Cleanup(store.Close)
			return store
		}
	})
}

func TestOpenDoesNotCreateMissingDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing.sqlite")
	store, err := sqlite.Open(context.Background(), fileURL(path))
	if store != nil {
		store.Close()
	}
	if err == nil {
		t.Fatal("opening missing database succeeded")
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("opening missing database created a file: %v", err)
	}
}

func TestPersistenceAfterReopen(t *testing.T) {
	ctx := context.Background()
	databaseURL := migratedDatabase(t)
	store := openStore(t, databaseURL)
	t.Cleanup(func() { store.Close() })
	owner, err := store.CreateUser(ctx, "reader", "persistent-hash", true, 12345)
	if err != nil {
		t.Fatal(err)
	}
	book, err := store.CreateBook(ctx, owner.ID, bookFile(), domain.BookInput{Title: "Сохранённая книга", Tags: []string{"PDF", " Книги "}, Favorite: true})
	if err != nil {
		t.Fatal(err)
	}
	cover := domain.CoverFiles{CoverPath: "covers/persistent.png", CoverThumbPath: "covers/persistent.jpg"}
	if _, err := store.SetCover(ctx, owner.ID, book.ID, cover); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutProgress(ctx, owner.ID, book.ID, 37.5); err != nil {
		t.Fatal(err)
	}
	const settings = `{"theme":"dark","reader":{"zoom":1.5}}`
	if err := store.PutSettings(ctx, owner.ID, json.RawMessage(settings)); err != nil {
		t.Fatal(err)
	}
	const token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if err := store.CreateSession(ctx, owner.ID, token, 600); err != nil {
		t.Fatal(err)
	}
	before, err := store.GetBook(ctx, owner.ID, book.ID)
	if err != nil {
		t.Fatal(err)
	}
	store.Close()
	store = openStore(t, databaseURL)
	user, err := store.GetUser(ctx, owner.ID)
	if err != nil || user.PasswordHash != "persistent-hash" || user.QuotaBytes != 12345 || !user.IsActive || user.UsedBytes != 7 {
		t.Fatalf("persisted user: user=%+v err=%v", user.User, err)
	}
	got, err := store.GetBook(ctx, owner.ID, book.ID)
	if err != nil || got.Title != book.Title || !got.Favorite || got.ProgressPercent != 37.5 || got.CoverPath == nil || *got.CoverPath != cover.CoverPath || got.CoverThumbPath == nil || *got.CoverThumbPath != cover.CoverThumbPath {
		t.Fatalf("persisted book: book=%+v err=%v", got, err)
	}
	if !got.CreatedAt.Equal(before.CreatedAt) || !got.LastOpenedAt.Equal(before.LastOpenedAt) || !got.UpdatedAt.Equal(before.UpdatedAt) {
		t.Fatalf("persisted timestamps: got=%+v before=%+v", got, before)
	}
	slices.Sort(got.Tags)
	if !slices.Equal(got.Tags, []string{"pdf", "книги"}) {
		t.Fatalf("persisted normalized tags: %v", got.Tags)
	}
	raw, err := store.GetSettings(ctx, owner.ID)
	if err != nil || string(raw) != settings {
		t.Fatalf("persisted settings: raw=%s err=%v", raw, err)
	}
	sessionUser, err := store.GetSession(ctx, token)
	if err != nil || sessionUser != owner.ID {
		t.Fatalf("persisted session: owner=%s err=%v", sessionUser, err)
	}
	file, err := store.GetBookFileByHash(ctx, strings.Repeat("a", 64))
	if err != nil || file == nil || file.StoragePath != "books/persistent.pdf" || file.SizeBytes != 7 {
		t.Fatalf("persisted file: file=%+v err=%v", file, err)
	}
}

func TestEscapedFilePath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Книги #100% &+.sqlite")
	databaseURL := fileURL(path)
	if err := database.Migrate(context.Background(), databaseURL, "up"); err != nil {
		t.Fatal(err)
	}
	store := openStore(t, databaseURL)
	t.Cleanup(store.Close)
	if _, err := store.CreateUser(context.Background(), "reader", "hash", true, 10000); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(path); err != nil || !info.Mode().IsRegular() {
		t.Fatalf("URL opened a different file: path=%s err=%v", path, err)
	}
}

func TestFailedBookCreationRollsBackFile(t *testing.T) {
	ctx := context.Background()
	store := openStore(t, migratedDatabase(t))
	t.Cleanup(store.Close)
	file := bookFile()
	if _, err := store.CreateBook(ctx, uuid.New(), file, domain.BookInput{Title: "Missing owner"}); err == nil {
		t.Fatal("book was created for a missing user")
	}
	if got, err := store.GetBookFileByHash(ctx, file.SHA256); err != nil || got != nil {
		t.Fatalf("rolled-back create left a file record: file=%+v err=%v", got, err)
	}
	user, err := store.CreateUser(ctx, "reader", "hash", true, 10000)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateBook(ctx, user.ID, file, domain.BookInput{Title: "Valid owner"}); err != nil {
		t.Fatalf("failed transaction left an unusable connection or claimed hash: %v", err)
	}
}

func TestConnectionIntegritySettings(t *testing.T) {
	ctx := context.Background()
	db := openDatabase(t, migratedDatabase(t))
	db.SetMaxOpenConns(4)
	var connections []*sql.Conn
	for range 4 {
		conn, err := db.Conn(ctx)
		if err != nil {
			t.Fatal(err)
		}
		connections = append(connections, conn)
		t.Cleanup(func() { _ = conn.Close() })
	}
	for i, conn := range connections {
		var foreignKeys, synchronous int
		var journal string
		if err := conn.QueryRowContext(ctx, "pragma foreign_keys").Scan(&foreignKeys); err != nil || foreignKeys != 1 {
			t.Fatalf("connection %d foreign keys: got=%d err=%v", i, foreignKeys, err)
		}
		if err := conn.QueryRowContext(ctx, "pragma synchronous").Scan(&synchronous); err != nil || synchronous != 2 {
			t.Fatalf("connection %d synchronous: got=%d err=%v", i, synchronous, err)
		}
		if err := conn.QueryRowContext(ctx, "pragma journal_mode").Scan(&journal); err != nil || strings.ToLower(journal) != "wal" {
			t.Fatalf("connection %d journal mode: got=%s err=%v", i, journal, err)
		}
		_, err := conn.ExecContext(ctx, "insert into sessions(id,user_id,token_hash,expires_at) values(?,?,?,?)", uuid.NewString(), uuid.NewString(), fmt.Sprintf("%064x", i), "2099-01-01T00:00:00Z")
		if err == nil || !strings.Contains(strings.ToLower(err.Error()), "foreign key") {
			t.Fatalf("connection %d missing-user session should violate its foreign key: %v", i, err)
		}
	}
}

func TestTimestampSortTiesUseDescendingID(t *testing.T) {
	ctx := context.Background()
	databaseURL := migratedDatabase(t)
	store := openStore(t, databaseURL)
	t.Cleanup(store.Close)
	user, err := store.CreateUser(ctx, "reader", "hash", true, 10000)
	if err != nil {
		t.Fatal(err)
	}
	var want []uuid.UUID
	for i := range 5 {
		file := bookFile()
		file.SHA256 = fmt.Sprintf("%064x", i)
		book, err := store.CreateBook(ctx, user.ID, file, domain.BookInput{Title: "Same title"})
		if err != nil {
			t.Fatal(err)
		}
		want = append(want, book.ID)
	}
	db := openDatabase(t, databaseURL)
	const timestamp = "2025-01-02T03:04:05.000000000Z"
	if _, err := db.ExecContext(ctx, "update user_books set created_at=?,updated_at=?,last_opened_at=?", timestamp, timestamp, timestamp); err != nil {
		t.Fatal(err)
	}
	sort.Slice(want, func(i, j int) bool { return want[i].String() > want[j].String() })
	for _, sortName := range []string{"created_at_asc", "created_at_desc", "updated_at_asc", "updated_at_desc", "relevance", "title_asc", "title_desc"} {
		t.Run(sortName, func(t *testing.T) {
			var got []uuid.UUID
			for offset := 0; offset < len(want); offset += 2 {
				page, err := store.QueryBooks(ctx, user.ID, domain.BookQuery{Sort: sortName, Limit: 2, Offset: offset})
				if err != nil {
					t.Fatal(err)
				}
				if page.Total != int64(len(want)) {
					t.Fatalf("total=%d want=%d", page.Total, len(want))
				}
				for _, book := range page.Items {
					got = append(got, book.ID)
				}
			}
			if !slices.Equal(got, want) {
				t.Fatalf("equal primary keys: IDs=%v want=%v", got, want)
			}
		})
	}
}

func TestConcurrentServerAndAdminStores(t *testing.T) {
	ctx := context.Background()
	databaseURL := migratedDatabase(t)
	server, admin := openStore(t, databaseURL), openStore(t, databaseURL)
	t.Cleanup(server.Close)
	t.Cleanup(admin.Close)
	user, err := admin.CreateUser(ctx, "reader", "hash", true, 10000)
	if err != nil {
		t.Fatal(err)
	}
	const workers = 12
	var wg sync.WaitGroup
	errors := make(chan error, workers)
	for i := range workers {
		wg.Go(func() {
			if i%2 == 0 {
				errors <- admin.SetUserQuota(ctx, user.ID, int64(10000+i))
				return
			}
			_, err := server.GetUser(ctx, user.ID)
			errors <- err
		})
	}
	wg.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Errorf("concurrent server/admin operation: %v", err)
		}
	}
}

func TestWriteWaitsForTemporaryLock(t *testing.T) {
	databaseURL := migratedDatabase(t)
	store := openStore(t, databaseURL)
	t.Cleanup(store.Close)
	unlock := holdWriteLock(t, databaseURL)
	result := make(chan error, 1)
	go func() {
		_, err := store.CreateUser(context.Background(), "reader", "hash", true, 10000)
		result <- err
	}()
	select {
	case err := <-result:
		t.Fatalf("write returned before its lock was released: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	unlock()
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("write did not resume after releasing lock")
	}
}

func TestWriteLockHonorsContextDeadline(t *testing.T) {
	databaseURL := migratedDatabase(t)
	store := openStore(t, databaseURL)
	t.Cleanup(store.Close)
	holdWriteLock(t, databaseURL)
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err := store.CreateUser(ctx, "reader", "hash", true, 10000)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline while waiting for write lock: %v", err)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("canceled operation waited %s", elapsed)
	}
}

func TestWriteLockBudgetReturnsUnavailable(t *testing.T) {
	databaseURL := migratedDatabase(t)
	store := openStore(t, databaseURL)
	t.Cleanup(store.Close)
	holdWriteLock(t, databaseURL)
	started := time.Now()
	_, err := store.CreateUser(context.Background(), "reader", "hash", true, 10000)
	if !errors.Is(err, storage.ErrUnavailable) {
		t.Fatalf("exhausted write lock budget: %v", err)
	}
	if elapsed := time.Since(started); elapsed < 4500*time.Millisecond || elapsed > 6500*time.Millisecond {
		t.Fatalf("write lock budget elapsed=%s, expected about five seconds", elapsed)
	}
}

func fileURL(path string) string {
	path = filepath.ToSlash(path)
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return (&url.URL{Scheme: "sqlite", Path: path}).String()
}

func migratedDatabase(t *testing.T) string {
	t.Helper()
	databaseURL := fileURL(filepath.Join(t.TempDir(), "book-hub.sqlite"))
	if err := database.Migrate(context.Background(), databaseURL, "up"); err != nil {
		t.Fatal(err)
	}
	return databaseURL
}

func openStore(t *testing.T, databaseURL string) *sqlite.Store {
	t.Helper()
	store, err := sqlite.Open(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func openDatabase(t *testing.T, databaseURL string) *sql.DB {
	t.Helper()
	db, err := database.OpenSQLite(context.Background(), databaseURL, false)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func holdWriteLock(t *testing.T, databaseURL string) func() {
	t.Helper()
	db := openDatabase(t, databaseURL)
	conn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.ExecContext(context.Background(), "begin immediate"); err != nil {
		_ = conn.Close()
		t.Fatal(err)
	}
	var once sync.Once
	unlock := func() {
		once.Do(func() {
			if _, err := conn.ExecContext(context.Background(), "rollback"); err != nil {
				t.Error(err)
			}
			_ = conn.Close()
		})
	}
	t.Cleanup(unlock)
	return unlock
}

func bookFile() domain.BookFileInput {
	return domain.BookFileInput{SHA256: strings.Repeat("a", 64), StoragePath: "books/persistent.pdf", SizeBytes: 7, Format: "pdf"}
}
