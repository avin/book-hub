package memory

import (
	"testing"
	"time"

	"book-hub/internal/domain"
	"github.com/google/uuid"
)

func TestSortBooksUsesDescendingIDForEqualKeys(t *testing.T) {
	for _, sortName := range []string{"relevance", "created_at_desc", "created_at_asc", "updated_at_desc", "updated_at_asc", "title_asc", "title_desc"} {
		t.Run(sortName, func(t *testing.T) {
			now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
			low := domain.Book{
				ID: uuid.MustParse("00000000-0000-0000-0000-000000000001"), Title: "Книга",
				CreatedAt: now, UpdatedAt: now, LastOpenedAt: now,
			}
			high := low
			high.ID = uuid.MustParse("00000000-0000-0000-0000-000000000002")
			high.Title = "КНИГА"
			for _, books := range [][]domain.Book{{low, high}, {high, low}} {
				sortBooks(books, sortName)
				if books[0].ID != high.ID || books[1].ID != low.ID {
					t.Fatalf("expected descending ID for equal keys, got %v then %v", books[0].ID, books[1].ID)
				}
			}
		})
	}
}
