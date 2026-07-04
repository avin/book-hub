package memory_test

import (
	"context"
	"errors"
	"testing"

	"book-hub/internal/domain"
	"book-hub/internal/storage/memory"
)

func TestQuotaAccountingCountsFullSizePerUserBook(t *testing.T) {
	ctx := context.Background()
	store := memory.New()
	user, err := store.CreateUser(ctx, "reader", "hash", true, 10)
	if err != nil {
		t.Fatal(err)
	}
	book, err := store.CreateBook(ctx, user.ID, domain.BookFileInput{
		SHA256:      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		StoragePath: "book.pdf",
		SizeBytes:   7,
		Format:      "pdf",
	}, domain.BookInput{Title: "Book"})
	if err != nil {
		t.Fatal(err)
	}
	if book.SizeBytes != 7 {
		t.Fatalf("unexpected book size: %d", book.SizeBytes)
	}
	used, err := store.UsedBytes(ctx, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if used != 7 {
		t.Fatalf("expected used bytes 7, got %d", used)
	}
	if err := store.SetUserQuota(ctx, user.ID, 6); !errors.Is(err, domain.ErrQuotaExceeded) {
		t.Fatalf("expected quota exceeded, got %v", err)
	}
	if err := store.SetUserQuota(ctx, user.ID, 7); err != nil {
		t.Fatalf("expected quota equal to used bytes to be allowed, got %v", err)
	}
}
