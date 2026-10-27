package sqlite_test

import (
	"context"
	"database/sql"
	"fmt"
	"testing"

	"book-hub/internal/database"
	"book-hub/internal/domain"
	"book-hub/internal/storage/sqlite"
	"github.com/google/uuid"
)

const benchmarkBookCount = 25_000

func BenchmarkQueryBooksWithTags(b *testing.B) {
	store, userID := benchmarkStore(b)
	query := domain.BookQuery{
		Limit:  24,
		Offset: 312,
		Sort:   "relevance",
		Tags:   []string{"lang:ru", "sec:компьютеры"},
	}

	b.ResetTimer()
	for range b.N {
		if _, err := store.QueryBooks(context.Background(), userID, query); err != nil {
			b.Fatal(err)
		}
	}
}

func benchmarkStore(b *testing.B) (*sqlite.Store, uuid.UUID) {
	b.Helper()
	ctx := context.Background()
	path := b.TempDir() + "/benchmark.sqlite"
	databaseURL := fileURL(path)
	if err := database.Migrate(ctx, databaseURL, "up"); err != nil {
		b.Fatal(err)
	}
	db, err := database.OpenSQLite(ctx, databaseURL, false)
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = db.Close() })

	userID := uuid.New()
	if err := seedBenchmarkBooks(ctx, db, userID); err != nil {
		b.Fatal(err)
	}
	store, err := sqlite.Open(ctx, databaseURL)
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(store.Close)
	return store, userID
}

func seedBenchmarkBooks(ctx context.Context, db *sql.DB, userID uuid.UUID) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `insert into users (id, login, password_hash, is_active, quota_bytes) values (?, ?, ?, 1, 0)`, userID, "benchmark", "hash"); err != nil {
		return err
	}
	languageTagID, sectionTagID := uuid.New(), uuid.New()
	for _, tag := range []struct {
		id   uuid.UUID
		name string
	}{
		{languageTagID, "lang:ru"},
		{sectionTagID, "sec:компьютеры"},
	} {
		if _, err := tx.ExecContext(ctx, `insert into tags (id, user_id, name) values (?, ?, ?)`, tag.id, userID, tag.name); err != nil {
			return err
		}
	}
	fileStatement, err := tx.PrepareContext(ctx, `insert into book_files (id, sha256, storage_path, size_bytes, format) values (?, ?, ?, 1, 'pdf')`)
	if err != nil {
		return err
	}
	defer fileStatement.Close()
	bookStatement, err := tx.PrepareContext(ctx, `insert into user_books (id, user_id, book_file_id, title) values (?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer bookStatement.Close()
	tagStatement, err := tx.PrepareContext(ctx, `insert into user_book_tags (user_book_id, tag_id) values (?, ?)`)
	if err != nil {
		return err
	}
	defer tagStatement.Close()

	for i := range benchmarkBookCount {
		bookID, fileID := uuid.New(), uuid.New()
		if _, err := fileStatement.ExecContext(ctx, fileID, fmt.Sprintf("%064x", i), "books/"+fileID.String()+".pdf"); err != nil {
			return err
		}
		if _, err := bookStatement.ExecContext(ctx, bookID, userID, fileID, fmt.Sprintf("Книга %d", i)); err != nil {
			return err
		}
		if i%2 == 0 {
			if _, err := tagStatement.ExecContext(ctx, bookID, languageTagID); err != nil {
				return err
			}
		}
		if i%3 == 0 {
			if _, err := tagStatement.ExecContext(ctx, bookID, sectionTagID); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}
