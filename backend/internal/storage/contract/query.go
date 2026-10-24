package contract

import (
	"context"
	"fmt"
	"slices"
	"sort"
	"testing"
	"time"

	"book-hub/internal/domain"
	"book-hub/internal/storage"
	"github.com/google/uuid"
)

func runQueryContract(t *testing.T, newStore NewStore) {
	t.Helper()
	t.Run("literal case-insensitive title search", func(t *testing.T) {
		store, user := readerStore(t, newStore)
		titles := []string{"ПрИкЛюЧеНиЯ Reader", "Percent 100% literal", "Percent 100X literal", "Under_score", "UnderXscore", `Back\slash`, "BackXslash", "ЕЖ", "ЁЖ"}
		books := make([]domain.Book, len(titles))
		for i, title := range titles {
			books[i] = createBook(t, store, user.ID, domain.BookInput{Title: title})
		}
		for _, tc := range []struct {
			query string
			index int
		}{
			{"приключения", 0}, {"READER", 0}, {"%", 1}, {"100%", 1}, {"_", 3}, {"under_score", 3}, {`\`, 5}, {`back\slash`, 5}, {"еж", 7}, {"ёж", 8},
		} {
			t.Run(tc.query, func(t *testing.T) {
				assertQueryIDs(t, store, user.ID, domain.BookQuery{Q: tc.query, Limit: 100}, books[tc.index].ID)
			})
		}
		assertQueryIDs(t, store, user.ID, domain.BookQuery{Q: "absent", Limit: 100})
	})

	t.Run("normalized exact tags, AND and combined filters", func(t *testing.T) {
		store, user := readerStore(t, newStore)
		wanted := createBook(t, store, user.ID, domain.BookInput{Title: "Shared title", Tags: []string{" GO ", "ФАНТАСТИКА", "go", ""}, Favorite: true})
		partial := createBook(t, store, user.ID, domain.BookInput{Title: "Other title", Tags: []string{"go"}})
		createBook(t, store, user.ID, domain.BookInput{Title: "Shared title", Tags: []string{"golang", "фантастика"}, Favorite: true})
		createBook(t, store, user.ID, domain.BookInput{Title: "Shared title", Tags: []string{"ſ"}, Favorite: true})
		other, err := store.CreateUser(context.Background(), "another", "hash", true, 10000)
		if err != nil {
			t.Fatal(err)
		}
		createBook(t, store, other.ID, domain.BookInput{Title: "Shared title", Tags: []string{"go", "фантастика", "private"}, Favorite: true})
		query, err := domain.NormalizeBookQuery(domain.BookQuery{Tags: []string{" Go ", "Фантастика", "go"}})
		if err != nil {
			t.Fatal(err)
		}
		assertQueryIDs(t, store, user.ID, query, wanted.ID)
		assertQueryIDs(t, store, user.ID, domain.BookQuery{Tags: []string{"go"}, Limit: 100}, wanted.ID, partial.ID)
		assertQueryIDs(t, store, user.ID, domain.BookQuery{Tags: []string{"s"}, Limit: 100})
		assertQueryIDs(t, store, user.ID, domain.BookQuery{Tags: []string{"private"}, Limit: 100})
		favorite := true
		assertQueryIDs(t, store, user.ID, domain.BookQuery{Q: "SHARED", Tags: query.Tags, Favorite: &favorite, Limit: 100}, wanted.ID)
		favorite = false
		assertQueryIDs(t, store, user.ID, domain.BookQuery{Q: "SHARED", Tags: query.Tags, Favorite: &favorite, Limit: 100})
		newTags := []string{" NEW ", "новый", "new"}
		if _, err := store.UpdateBook(context.Background(), user.ID, wanted.ID, storage.BookPatch{Tags: &newTags}); err != nil {
			t.Fatal(err)
		}
		assertQueryIDs(t, store, user.ID, query)
		assertQueryIDs(t, store, user.ID, domain.BookQuery{Tags: []string{"new", "новый"}, Limit: 100}, wanted.ID)
		tags, err := store.ListBookTags(context.Background(), user.ID)
		if err != nil || slices.Contains(tags, "private") || !slices.Contains(tags, "new") || slices.Contains(tags, " NEW ") {
			t.Fatalf("normalized, user-scoped tag list: tags=%v err=%v", tags, err)
		}
	})

	t.Run("all sorts and stable title ties across pages", func(t *testing.T) {
		store, user := readerStore(t, newStore)
		first := createBook(t, store, user.ID, domain.BookInput{Title: "Gamma"})
		time.Sleep(2 * time.Millisecond)
		second := createBook(t, store, user.ID, domain.BookInput{Title: "Alpha"})
		time.Sleep(2 * time.Millisecond)
		third := createBook(t, store, user.ID, domain.BookInput{Title: "Beta"})
		time.Sleep(2 * time.Millisecond)
		favorite := true
		if _, err := store.UpdateBook(context.Background(), user.ID, first.ID, storage.BookPatch{Favorite: &favorite}); err != nil {
			t.Fatal(err)
		}
		for _, tc := range []struct {
			sort string
			ids  []uuid.UUID
		}{
			{"created_at_asc", []uuid.UUID{first.ID, second.ID, third.ID}},
			{"created_at_desc", []uuid.UUID{third.ID, second.ID, first.ID}},
			{"title_asc", []uuid.UUID{second.ID, third.ID, first.ID}},
			{"title_desc", []uuid.UUID{first.ID, third.ID, second.ID}},
			{"updated_at_asc", []uuid.UUID{second.ID, third.ID, first.ID}},
			{"updated_at_desc", []uuid.UUID{first.ID, third.ID, second.ID}},
			{"relevance", []uuid.UUID{third.ID, second.ID, first.ID}},
		} {
			t.Run(tc.sort, func(t *testing.T) {
				assertOrderedQuery(t, store, user.ID, domain.BookQuery{Sort: tc.sort, Limit: 100}, tc.ids)
			})
		}
		if _, err := store.PutProgress(context.Background(), user.ID, second.ID, 32); err != nil {
			t.Fatal(err)
		}
		assertOrderedQuery(t, store, user.ID, domain.BookQuery{Sort: "relevance", Limit: 100}, []uuid.UUID{second.ID, third.ID, first.ID})
		if _, err := store.QueryBooks(context.Background(), user.ID, domain.BookQuery{Sort: "created_at_desc", Limit: 1, Offset: 99}); err != nil {
			t.Fatal(err)
		}
		var tied []uuid.UUID
		for range 6 {
			tied = append(tied, createBook(t, store, user.ID, domain.BookInput{Title: "Same title"}).ID)
		}
		sort.Slice(tied, func(i, j int) bool { return tied[i].String() > tied[j].String() })
		for _, sortName := range []string{"title_asc", "title_desc"} {
			for range 3 {
				for offset := 0; offset < len(tied); offset += 2 {
					assertOrderedQuery(t, store, user.ID, domain.BookQuery{Q: "Same title", Sort: sortName, Limit: 2, Offset: offset}, tied[offset:offset+2])
				}
			}
		}
	})
}

func readerStore(t *testing.T, newStore NewStore) (storage.Store, domain.User) {
	t.Helper()
	store := newStore(t)
	t.Cleanup(store.Close)
	user, err := store.CreateUser(context.Background(), "reader", "hash", true, 10000)
	if err != nil {
		t.Fatal(err)
	}
	return store, user
}

func createBook(t *testing.T, store storage.Store, userID uuid.UUID, input domain.BookInput) domain.Book {
	t.Helper()
	id := uuid.New()
	book, err := store.CreateBook(context.Background(), userID, domain.BookFileInput{
		SHA256: fmt.Sprintf("%064x", id[:]), StoragePath: "books/" + id.String() + ".pdf", SizeBytes: 1, Format: "pdf",
	}, input)
	if err != nil {
		t.Fatal(err)
	}
	return book
}

func assertQueryIDs(t *testing.T, store storage.Store, userID uuid.UUID, query domain.BookQuery, want ...uuid.UUID) {
	t.Helper()
	page, err := store.QueryBooks(context.Background(), userID, query)
	if err != nil {
		t.Fatal(err)
	}
	got := make([]uuid.UUID, 0, len(page.Items))
	for _, book := range page.Items {
		got = append(got, book.ID)
	}
	sort.Slice(got, func(i, j int) bool { return got[i].String() < got[j].String() })
	want = slices.Clone(want)
	sort.Slice(want, func(i, j int) bool { return want[i].String() < want[j].String() })
	if !slices.Equal(got, want) || page.Total != int64(len(want)) {
		t.Fatalf("query %+v: got IDs=%v total=%d, want IDs=%v total=%d", query, got, page.Total, want, len(want))
	}
}

func assertOrderedQuery(t *testing.T, store storage.Store, userID uuid.UUID, query domain.BookQuery, want []uuid.UUID) {
	t.Helper()
	page, err := store.QueryBooks(context.Background(), userID, query)
	if err != nil {
		t.Fatal(err)
	}
	got := make([]uuid.UUID, 0, len(page.Items))
	for _, book := range page.Items {
		got = append(got, book.ID)
	}
	if !slices.Equal(got, want) || page.Limit != query.Limit || page.Offset != query.Offset || page.Total < int64(len(got)+query.Offset) {
		t.Fatalf("ordered query %+v: page=%+v IDs=%v, want %v", query, page, got, want)
	}
}
