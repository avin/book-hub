package sqlite

import (
	"context"
	"database/sql"
	"errors"
)

func (s *Store) ProcessOriginalDeletions(ctx context.Context, remove func(context.Context, string) error) error {
	rows, err := s.pool.Query(ctx, `select sha256 from original_deletions order by sha256 limit 100`)
	if err != nil {
		return err
	}
	var hashes []string
	for rows.Next() {
		var hash string
		if err := rows.Scan(&hash); err != nil {
			rows.Close()
			return err
		}
		hashes = append(hashes, hash)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	var failures []error
	for _, hash := range hashes {
		if err := s.deleteOriginal(ctx, hash, remove); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

func (s *Store) deleteOriginal(ctx context.Context, hash string, remove func(context.Context, string) error) error {
	// BEGIN IMMEDIATE excludes every competing writer, including another connection.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var location string
	err = tx.QueryRow(ctx, `select storage_path from original_deletions where sha256 = ?1`, hash).Scan(&location)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	var used bool
	if err := tx.QueryRow(ctx, `select exists(select 1 from user_books ub join book_files bf on bf.id = ub.book_file_id where bf.sha256 = ?1)`, hash).Scan(&used); err != nil {
		return err
	}
	if !used {
		if err := remove(ctx, location); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `delete from book_files where sha256 = ?1`, hash); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `delete from original_deletions where sha256 = ?1`, hash); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
