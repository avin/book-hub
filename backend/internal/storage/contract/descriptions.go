package contract

import (
	"context"
	"errors"
	"strings"
	"testing"

	"book-hub/internal/domain"
	"book-hub/internal/storage"
)

func runDescriptionContract(t *testing.T, newStore NewStore) {
	t.Run("description limits use raw UTF-16 length and leave rejected writes unchanged", func(t *testing.T) {
		ctx := context.Background()
		store := newStore(t)
		t.Cleanup(store.Close)
		owner, err := store.CreateUser(ctx, "description_limit", "hash", true, 100)
		if err != nil {
			t.Fatal(err)
		}
		file := domain.BookFileInput{SHA256: strings.Repeat("b", 64), StoragePath: "books/limit.pdf", SizeBytes: 10, Format: "pdf"}
		accepted := strings.Repeat("🙂", 5000)
		book, err := store.CreateBook(ctx, owner.ID, file, domain.BookInput{Title: "Title", Description: accepted})
		if err != nil || book.Description != accepted {
			t.Fatalf("boundary description: err=%v", err)
		}
		for _, invalid := range []string{accepted + "a", strings.Repeat(" ", 10001)} {
			title := "Must not be saved"
			if _, err := store.UpdateBook(ctx, owner.ID, book.ID, storage.BookPatch{Title: &title, Description: &invalid}); !errors.Is(err, domain.ErrValidation) {
				t.Fatalf("invalid update: %v", err)
			}
			got, err := store.GetBook(ctx, owner.ID, book.ID)
			if err != nil || got.Title != "Title" || got.Description != accepted {
				t.Fatalf("rejected update changed book: err=%v", err)
			}
			file.SHA256 = strings.Repeat("c", 64)
			_, err = store.CreateBookWithOriginal(ctx, owner.ID, file, domain.BookInput{Description: invalid}, func(context.Context) (string, error) {
				t.Error("invalid description persisted original")
				return "books/invalid.pdf", nil
			})
			if !errors.Is(err, domain.ErrValidation) {
				t.Fatalf("invalid create: %v", err)
			}
		}
	})
	t.Run("personal descriptions persist, clear and stay outside title search", func(t *testing.T) {
		ctx := context.Background()
		store := newStore(t)
		t.Cleanup(store.Close)
		owner, err := store.CreateUser(ctx, "description_owner", "hash", true, 100)
		if err != nil {
			t.Fatal(err)
		}
		other, err := store.CreateUser(ctx, "description_other", "hash", true, 100)
		if err != nil {
			t.Fatal(err)
		}
		file := domain.BookFileInput{SHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", StoragePath: "books/description.pdf", SizeBytes: 10, Format: "pdf"}
		book, err := store.CreateBook(ctx, owner.ID, file, domain.BookInput{Title: "Title", Description: " \nТолько в описании\n\n  <b>Текст</b> \ufeff"})
		if err != nil {
			t.Fatal(err)
		}
		const want = "Только в описании\n\n  <b>Текст</b>"
		if book.Description != want {
			t.Fatalf("created description = %q", book.Description)
		}
		got, err := store.GetBook(ctx, owner.ID, book.ID)
		if err != nil || got.Description != want {
			t.Fatalf("stored description = %q, err = %v", got.Description, err)
		}
		otherBook, err := store.CreateBook(ctx, other.ID, file, domain.BookInput{Title: "Other", Description: "Личное описание"})
		if err != nil {
			t.Fatal(err)
		}
		page, err := store.QueryBooks(ctx, owner.ID, domain.BookQuery{Limit: 10, Sort: "relevance"})
		if err != nil || len(page.Items) != 1 || page.Items[0].Description != want {
			t.Fatalf("list descriptions: page=%+v err=%v", page, err)
		}
		page, err = store.QueryBooks(ctx, owner.ID, domain.BookQuery{Limit: 10, Q: "описании", Sort: "relevance"})
		if err != nil || page.Total != 0 {
			t.Fatalf("description included in search: page=%+v err=%v", page, err)
		}
		update := "  Новое\nописание  "
		if _, err := store.UpdateBook(ctx, other.ID, book.ID, storage.BookPatch{Description: &update}); !errors.Is(err, domain.ErrNotFound) {
			t.Fatalf("foreign update: %v", err)
		}
		got, err = store.UpdateBook(ctx, owner.ID, book.ID, storage.BookPatch{Description: &update})
		if err != nil || got.Description != "Новое\nописание" {
			t.Fatalf("updated description = %q, err = %v", got.Description, err)
		}
		got, err = store.UpdateBook(ctx, owner.ID, book.ID, storage.BookPatch{})
		if err != nil || got.Description != "Новое\nописание" {
			t.Fatalf("omitted description = %q, err = %v", got.Description, err)
		}
		empty := "\n \t\ufeff"
		got, err = store.UpdateBook(ctx, owner.ID, book.ID, storage.BookPatch{Description: &empty})
		if err != nil || got.Description != "" {
			t.Fatalf("cleared description = %q, err = %v", got.Description, err)
		}
		got, err = store.GetBook(ctx, other.ID, otherBook.ID)
		if err != nil || got.Description != "Личное описание" {
			t.Fatalf("other user's description = %q, err = %v", got.Description, err)
		}
	})
}
