package contract

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"book-hub/internal/domain"
	"book-hub/internal/storage"
)

// RunOriginalPersistence exercises the durable lifecycle through independent database stores.
func RunOriginalPersistence(t *testing.T, prepare func(*testing.T) func() storage.Store) {
	t.Run("re-upload repairs an original removed before a failed deletion acknowledgement", func(t *testing.T) {
		open := prepare(t)
		store := open()
		ctx := context.Background()
		owner, err := store.CreateUser(ctx, "owner", "hash", true, 100)
		if err != nil {
			t.Fatal(err)
		}
		file := originalFixture(t)
		book, err := store.CreateBook(ctx, owner.ID, file, domain.BookInput{Title: "Old"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.DeleteBook(ctx, owner.ID, book.ID); err != nil {
			t.Fatal(err)
		}
		failure := errors.New("delete completed but acknowledgement was lost")
		if err := store.ProcessOriginalDeletions(ctx, func(ctx context.Context, location string) error {
			if err := removeOriginal(ctx, location); err != nil {
				return err
			}
			return failure
		}); !errors.Is(err, failure) {
			t.Fatalf("deletion failure=%v", err)
		}
		store.Close()
		reopened := open()
		created, err := reopened.CreateBookWithOriginal(ctx, owner.ID, file, domain.BookInput{Title: "New"}, func(context.Context) (string, error) {
			return file.StoragePath, os.WriteFile(file.StoragePath, []byte("original"), 0600)
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := reopened.ProcessOriginalDeletions(ctx, func(context.Context, string) error { t.Error("old task removed repaired original"); return nil }); err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(created.StoragePath)
		if err != nil || string(data) != "original" {
			t.Fatalf("re-upload did not repair the original: data=%q err=%v", data, err)
		}
	})
	t.Run("queued administrative deletion survives closing and reopening the database", func(t *testing.T) {
		open := prepare(t)
		store := open()
		ctx := context.Background()
		owner, err := store.CreateUser(ctx, "owner", "hash", true, 100)
		if err != nil {
			t.Fatal(err)
		}
		file := originalFixture(t)
		if _, err := store.CreateBook(ctx, owner.ID, file, domain.BookInput{Title: "Book"}); err != nil {
			t.Fatal(err)
		}
		if _, err := store.DeleteUser(ctx, owner.ID); err != nil {
			t.Fatal(err)
		}
		failure := errors.New("storage is offline")
		if err := store.ProcessOriginalDeletions(ctx, func(context.Context, string) error { return failure }); !errors.Is(err, failure) {
			t.Fatalf("deletion failure=%v", err)
		}
		store.Close()
		reopened := open()
		if err := reopened.ProcessOriginalDeletions(ctx, removeOriginal); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(file.StoragePath); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("original remains after retry: %v", err)
		}
		if err := reopened.ProcessOriginalDeletions(ctx, func(context.Context, string) error { t.Error("completed task survived"); return nil }); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("an in-progress physical deletion excludes a new owner on another connection", func(t *testing.T) {
		open := prepare(t)
		first, second := open(), open()
		ctx := context.Background()
		owner, err := first.CreateUser(ctx, "owner", "hash", true, 100)
		if err != nil {
			t.Fatal(err)
		}
		file := originalFixture(t)
		book, err := first.CreateBook(ctx, owner.ID, file, domain.BookInput{Title: "Old"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := first.DeleteBook(ctx, owner.ID, book.ID); err != nil {
			t.Fatal(err)
		}
		entered, release := make(chan struct{}), make(chan struct{})
		worker := make(chan error, 1)
		go func() {
			worker <- first.ProcessOriginalDeletions(ctx, func(ctx context.Context, location string) error {
				close(entered)
				<-release
				return removeOriginal(ctx, location)
			})
		}()
		<-entered
		// A deadline is an explicit cancellation event, not a sleep to arrange a race.
		attempt, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
		_, err = second.CreateBookWithOriginal(attempt, owner.ID, file, domain.BookInput{Title: "New"}, func(context.Context) (string, error) {
			t.Error("publication crossed an active deletion")
			return file.StoragePath, nil
		})
		cancel()
		close(release)
		if workerErr := <-worker; workerErr != nil {
			t.Fatal(workerErr)
		}
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("publication was not excluded until cancellation: %v", err)
		}
		created, err := second.CreateBookWithOriginal(ctx, owner.ID, file, domain.BookInput{Title: "New"}, func(context.Context) (string, error) {
			return file.StoragePath, os.WriteFile(file.StoragePath, []byte("original"), 0600)
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := first.ProcessOriginalDeletions(ctx, func(context.Context, string) error { t.Error("old task removed a new original"); return nil }); err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(created.StoragePath)
		if err != nil || string(data) != "original" {
			t.Fatalf("new original lost: data=%q err=%v", data, err)
		}
	})
}

func originalFixture(t *testing.T) domain.BookFileInput {
	t.Helper()
	location := filepath.Join(t.TempDir(), "original.pdf")
	if err := os.WriteFile(location, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	return domain.BookFileInput{SHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", Format: "pdf", SizeBytes: 8, StoragePath: location}
}

func removeOriginal(_ context.Context, location string) error {
	err := os.Remove(location)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
