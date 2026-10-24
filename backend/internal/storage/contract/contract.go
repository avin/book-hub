package contract

import (
	"context"
	"errors"
	"testing"
	"time"

	"book-hub/internal/domain"
	"book-hub/internal/storage"
)

type NewStore func(t *testing.T) storage.Store

func Run(t *testing.T, newStore NewStore) {
	t.Helper()
	runQueryContract(t, newStore)
	runAccountContract(t, newStore)
	runOriginalLifecycle(t, newStore)

	t.Run("ownership, tags, relevance, progress, covers, sessions, quotas, deletion and deduplication", func(t *testing.T) {
		ctx := context.Background()
		store := newStore(t)
		t.Cleanup(store.Close)

		first, err := store.CreateUser(ctx, "first", "hash", true, 20)
		if err != nil {
			t.Fatal(err)
		}
		second, err := store.CreateUser(ctx, "second", "hash", true, 20)
		if err != nil {
			t.Fatal(err)
		}

		file := domain.BookFileInput{
			SHA256:      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			StoragePath: "books/shared.pdf",
			SizeBytes:   10,
			Format:      "pdf",
		}
		firstBook, err := store.CreateBook(ctx, first.ID, file, domain.BookInput{
			Title:    "First title",
			Tags:     []string{" Go ", "PDF", "go"},
			Favorite: true,
		})
		if err != nil {
			t.Fatal(err)
		}
		storedFile, err := store.GetBookFileByHash(ctx, file.SHA256)
		if err != nil || storedFile == nil {
			t.Fatalf("stored file lookup: file=%#v err=%v", storedFile, err)
		}
		file.ID = storedFile.ID
		secondBook, err := store.CreateBook(ctx, second.ID, file, domain.BookInput{Title: "Second title"})
		if err != nil {
			t.Fatal(err)
		}
		_, err = store.CreateBook(ctx, first.ID, domain.BookFileInput{
			SHA256:      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			StoragePath: "books/older.pdf",
			SizeBytes:   1,
			Format:      "pdf",
		}, domain.BookInput{Title: "Older title"})
		if err != nil {
			t.Fatal(err)
		}

		if _, err := store.GetBook(ctx, second.ID, firstBook.ID); !errors.Is(err, domain.ErrNotFound) {
			t.Fatalf("foreign book read: expected not found, got %v", err)
		}
		if _, err := store.UpdateBook(ctx, second.ID, firstBook.ID, storage.BookPatch{}); !errors.Is(err, domain.ErrNotFound) {
			t.Fatalf("foreign book update: expected not found, got %v", err)
		}
		if _, err := store.DeleteBook(ctx, second.ID, firstBook.ID); !errors.Is(err, domain.ErrNotFound) {
			t.Fatalf("foreign book delete: expected not found, got %v", err)
		}

		tags, err := store.ListBookTags(ctx, first.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got, want := len(tags), 2; got != want || tags[0] != "go" || tags[1] != "pdf" {
			t.Fatalf("unexpected tags: %#v", tags)
		}
		page, err := store.QueryBooks(ctx, first.ID, domain.BookQuery{Tags: []string{"go"}, Limit: 10})
		if err != nil || len(page.Items) != 1 || page.Items[0].ID != firstBook.ID {
			t.Fatalf("tag query: page=%#v err=%v", page, err)
		}

		if _, err := store.SetCover(ctx, first.ID, firstBook.ID, domain.CoverFiles{CoverPath: "covers/new.png", CoverThumbPath: "covers/new.jpg"}); err != nil {
			t.Fatal(err)
		}
		removedCover, err := store.DeleteCover(ctx, first.ID, firstBook.ID)
		if err != nil || removedCover.CoverPath != "covers/new.png" || removedCover.CoverThumbPath != "covers/new.jpg" {
			t.Fatalf("cover deletion: files=%#v err=%v", removedCover, err)
		}

		beforeProgress, err := store.GetBook(ctx, first.ID, firstBook.ID)
		if err != nil {
			t.Fatal(err)
		}
		time.Sleep(time.Millisecond)
		if _, err := store.PutProgress(ctx, first.ID, firstBook.ID, 42); err != nil {
			t.Fatal(err)
		}
		afterProgress, err := store.GetBook(ctx, first.ID, firstBook.ID)
		if err != nil || afterProgress.ProgressPercent != 42 || !afterProgress.LastOpenedAt.After(beforeProgress.LastOpenedAt) {
			t.Fatalf("progress update: book=%#v err=%v", afterProgress, err)
		}
		page, err = store.QueryBooks(ctx, first.ID, domain.BookQuery{Sort: "relevance", Limit: 10})
		if err != nil || len(page.Items) != 2 || page.Items[0].ID != firstBook.ID {
			t.Fatalf("relevance query: page=%#v err=%v", page, err)
		}

		if err := store.CreateSession(ctx, first.ID, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 60); err != nil {
			t.Fatal(err)
		}
		if _, err := store.GetSession(ctx, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); err != nil {
			t.Fatal(err)
		}
		if err := store.RevokeSession(ctx, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); err != nil {
			t.Fatal(err)
		}
		if _, err := store.GetSession(ctx, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); !errors.Is(err, domain.ErrUnauthorized) {
			t.Fatalf("revoked session: expected unauthorized, got %v", err)
		}

		if used, err := store.UsedBytes(ctx, first.ID); err != nil || used != 11 {
			t.Fatalf("first user quota: used=%d err=%v", used, err)
		}
		if err := store.SetUserQuota(ctx, first.ID, 10); !errors.Is(err, domain.ErrQuotaExceeded) {
			t.Fatalf("quota below use: expected quota exceeded, got %v", err)
		}
		if _, err := store.CreateBook(ctx, first.ID, file, domain.BookInput{Title: "Duplicate"}); !errors.Is(err, domain.ErrDuplicateBook) {
			t.Fatalf("same user duplicate: expected duplicate, got %v", err)
		}

		deleted, err := store.DeleteBook(ctx, first.ID, firstBook.ID)
		if err != nil || deleted.BookPath != "" {
			t.Fatalf("first reference deletion: files=%#v err=%v", deleted, err)
		}
		deleted, err = store.DeleteBook(ctx, second.ID, secondBook.ID)
		if err != nil || deleted.BookPath != "books/shared.pdf" {
			t.Fatalf("last reference deletion: files=%#v err=%v", deleted, err)
		}
	})
}
