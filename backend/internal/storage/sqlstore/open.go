package sqlstore

import (
	"context"

	"book-hub/internal/database"
	"book-hub/internal/storage"
	"book-hub/internal/storage/db"
	"book-hub/internal/storage/sqlite"
)

func Open(ctx context.Context, rawURL string) (storage.Store, error) {
	conn, err := database.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	if conn.Driver == "sqlite" {
		return sqlite.Open(ctx, rawURL)
	}
	if err := database.CheckSchema(ctx, rawURL); err != nil {
		return nil, err
	}
	return db.Open(ctx, rawURL)
}
