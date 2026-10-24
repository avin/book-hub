package contract

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"

	"book-hub/internal/domain"
)

func runOriginalLifecycle(t *testing.T, newStore NewStore) {
	t.Run("concurrent uploads publish one original and preserve the successful owner", func(t *testing.T) {
		ctx := context.Background()
		store := newStore(t)
		t.Cleanup(store.Close)
		first, err := store.CreateUser(ctx, "first", "hash", true, 100)
		if err != nil {
			t.Fatal(err)
		}
		second, err := store.CreateUser(ctx, "second", "hash", true, 100)
		if err != nil {
			t.Fatal(err)
		}
		file := domain.BookFileInput{SHA256: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", Format: "pdf", SizeBytes: 7}
		var writes atomic.Int32
		persist := func(context.Context) (string, error) {
			if writes.Add(1) != 1 {
				return "", errors.New("original was published more than once")
			}
			return "originals/one.pdf", nil
		}
		results := make(chan error, 2)
		for _, owner := range []domain.User{first, second} {
			go func() {
				_, err := store.CreateBookWithOriginal(ctx, owner.ID, file, domain.BookInput{Title: "Book"}, persist)
				results <- err
			}()
		}
		for range 2 {
			if err := <-results; err != nil {
				t.Fatal(err)
			}
		}
		if writes.Load() != 1 {
			t.Fatalf("writes=%d", writes.Load())
		}
		if _, err := store.DeleteUser(ctx, first.ID); err != nil {
			t.Fatal(err)
		}
		if err := store.ProcessOriginalDeletions(ctx, func(context.Context, string) error { t.Error("shared original removed"); return nil }); err != nil {
			t.Fatal(err)
		}
		page, err := store.QueryBooks(ctx, second.ID, domain.BookQuery{Limit: 10})
		if err != nil || len(page.Items) != 1 || page.Items[0].StoragePath != "originals/one.pdf" {
			t.Fatalf("successful upload lost: page=%+v err=%v", page, err)
		}
	})
	t.Run("new owner cancels a queued deletion", func(t *testing.T) {
		ctx := context.Background()
		store := newStore(t)
		t.Cleanup(store.Close)
		owner, err := store.CreateUser(ctx, "owner", "hash", true, 100)
		if err != nil {
			t.Fatal(err)
		}
		file := domain.BookFileInput{SHA256: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", Format: "pdf", SizeBytes: 7, StoragePath: "originals/reused.pdf"}
		old, err := store.CreateBook(ctx, owner.ID, file, domain.BookInput{Title: "Old"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.DeleteBook(ctx, owner.ID, old.ID); err != nil {
			t.Fatal(err)
		}
		created, err := store.CreateBookWithOriginal(ctx, owner.ID, file, domain.BookInput{Title: "New"}, func(context.Context) (string, error) { return file.StoragePath, nil })
		if err != nil {
			t.Fatal(err)
		}
		if err := store.ProcessOriginalDeletions(ctx, func(context.Context, string) error { t.Error("reused original removed"); return nil }); err != nil {
			t.Fatal(err)
		}
		if _, err := store.GetBook(ctx, owner.ID, created.ID); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("original deletion survives failure and preserves shared files", func(t *testing.T) {
		ctx := context.Background()
		store := newStore(t)
		t.Cleanup(store.Close)
		first, err := store.CreateUser(ctx, "first", "hash", true, 100)
		if err != nil {
			t.Fatal(err)
		}
		second, err := store.CreateUser(ctx, "second", "hash", true, 100)
		if err != nil {
			t.Fatal(err)
		}
		file := domain.BookFileInput{SHA256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", Format: "pdf", SizeBytes: 7, StoragePath: "originals/shared.pdf"}
		one, err := store.CreateBook(ctx, first.ID, file, domain.BookInput{Title: "First"})
		if err != nil {
			t.Fatal(err)
		}
		stored, err := store.GetBookFileByHash(ctx, file.SHA256)
		if err != nil {
			t.Fatal(err)
		}
		file.ID = stored.ID
		two, err := store.CreateBook(ctx, second.ID, file, domain.BookInput{Title: "Second"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.DeleteBook(ctx, first.ID, one.ID); err != nil {
			t.Fatal(err)
		}
		removed := 0
		remove := func(context.Context, string) error { removed++; return nil }
		if err := store.ProcessOriginalDeletions(ctx, remove); err != nil || removed != 0 {
			t.Fatalf("shared original removed: count=%d err=%v", removed, err)
		}
		if _, err := store.DeleteBook(ctx, second.ID, two.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := store.GetBook(ctx, second.ID, two.ID); !errors.Is(err, domain.ErrNotFound) {
			t.Fatalf("deleted record is still accessible: %v", err)
		}
		unavailable := errors.New("original storage unavailable")
		if err := store.ProcessOriginalDeletions(ctx, func(context.Context, string) error { return unavailable }); !errors.Is(err, unavailable) {
			t.Fatalf("failure was lost: %v", err)
		}
		if err := store.ProcessOriginalDeletions(ctx, remove); err != nil || removed != 1 {
			t.Fatalf("deletion did not retry: count=%d err=%v", removed, err)
		}
		if err := store.ProcessOriginalDeletions(ctx, remove); err != nil || removed != 1 {
			t.Fatalf("completed deletion retried: count=%d err=%v", removed, err)
		}
	})
}
