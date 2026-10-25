package db

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

func lockOriginal(ctx context.Context, tx pgx.Tx, hash string) error {
	_, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, hash)
	return err
}

func (s *Store) ProcessOriginalDeletions(ctx context.Context, remove func(context.Context, string) error) error {
	var through string
	if err := s.pool.QueryRow(ctx, `select coalesce(max(sha256), '') from original_deletions`).Scan(&through); err != nil {
		return err
	}
	// Advance past failures too. The upper bound keeps this pass from chasing
	// newly queued higher keys while each query still holds at most 100 tasks.
	var after string
	var failures []error
	for after < through {
		if err := ctx.Err(); err != nil {
			return errors.Join(append(failures, err)...)
		}
		rows, err := s.pool.Query(ctx, `select sha256 from original_deletions where sha256 > $1 and sha256 <= $2 order by sha256 limit 100`, after, through)
		if err != nil {
			return errors.Join(append(failures, err)...)
		}
		var hashes []string
		for rows.Next() {
			var hash string
			if err := rows.Scan(&hash); err != nil {
				rows.Close()
				return errors.Join(append(failures, err)...)
			}
			hashes = append(hashes, hash)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return errors.Join(append(failures, err)...)
		}
		if len(hashes) == 0 {
			break
		}
		for _, hash := range hashes {
			if err := ctx.Err(); err != nil {
				return errors.Join(append(failures, err)...)
			}
			if err := s.deleteOriginal(ctx, hash, remove); err != nil {
				failures = append(failures, err)
			}
		}
		after = hashes[len(hashes)-1]
	}
	return errors.Join(failures...)
}

func (s *Store) deleteOriginal(ctx context.Context, hash string, remove func(context.Context, string) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := lockOriginal(ctx, tx, hash); err != nil {
		return err
	}
	var location string
	err = tx.QueryRow(ctx, `select storage_path from original_deletions where sha256 = $1`, hash).Scan(&location)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	var used bool
	if err := tx.QueryRow(ctx, `select exists(select 1 from user_books ub join book_files bf on bf.id = ub.book_file_id where bf.sha256 = $1)`, hash).Scan(&used); err != nil {
		return err
	}
	if !used {
		if err := remove(ctx, location); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `delete from book_files where sha256 = $1`, hash); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `delete from original_deletions where sha256 = $1`, hash); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
