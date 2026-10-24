package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"book-hub/internal/storage"
	modernc "modernc.org/sqlite"
)

type executor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type connection struct {
	executor executor
	db       *sql.DB
}

type transaction struct {
	connection
	tx *sql.Tx
}

type commandResult int64

func (r commandResult) RowsAffected() int64 { return int64(r) }

// SQLite waits briefly in its busy handler so cancellation stays responsive.
// Retry only statements that report SQLITE_BUSY/LOCKED; never retry COMMIT.
func withBusyWait[T any](ctx context.Context, operation func() (T, error)) (T, error) {
	started := time.Now()
	for {
		value, err := operation()
		if err == nil {
			return value, nil
		}
		if ctx.Err() != nil {
			return value, ctx.Err()
		}
		if !isBusy(err) {
			return value, err
		}
		if time.Since(started) >= 5*time.Second {
			return value, errors.Join(storage.ErrUnavailable, err)
		}
		timer := time.NewTimer(5 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return value, ctx.Err()
		case <-timer.C:
		}
	}
}

func isBusy(err error) bool {
	var sqliteErr *modernc.Error
	return errors.As(err, &sqliteErr) && (sqliteErr.Code()&255 == 5 || sqliteErr.Code()&255 == 6)
}

func databaseError(err error) error {
	if isBusy(err) {
		return errors.Join(storage.ErrUnavailable, err)
	}
	return err
}

func (c *connection) Exec(ctx context.Context, query string, args ...any) (commandResult, error) {
	result, err := withBusyWait(ctx, func() (sql.Result, error) { return c.executor.ExecContext(ctx, query, args...) })
	if err != nil {
		return 0, err
	}
	count, err := result.RowsAffected()
	return commandResult(count), err
}

func (c *connection) Query(ctx context.Context, query string, args ...any) (*rows, error) {
	result, err := withBusyWait(ctx, func() (*sql.Rows, error) { return c.executor.QueryContext(ctx, query, args...) })
	if err != nil {
		return nil, err
	}
	return &rows{Rows: result}, nil
}

type rows struct{ *sql.Rows }

func (r *rows) Scan(dest ...any) error { return databaseError(r.Rows.Scan(dest...)) }
func (r *rows) Err() error             { return databaseError(r.Rows.Err()) }

type row struct {
	connection *connection
	ctx        context.Context
	query      string
	args       []any
}

func (c *connection) QueryRow(ctx context.Context, query string, args ...any) *row {
	return &row{connection: c, ctx: ctx, query: query, args: args}
}

func (r *row) Scan(dest ...any) error {
	_, err := withBusyWait(r.ctx, func() (struct{}, error) {
		return struct{}{}, r.connection.executor.QueryRowContext(r.ctx, r.query, r.args...).Scan(dest...)
	})
	return err
}

func (c *connection) Begin(ctx context.Context) (*transaction, error) {
	tx, err := withBusyWait(ctx, func() (*sql.Tx, error) { return c.db.BeginTx(ctx, nil) })
	if err != nil {
		return nil, err
	}
	return &transaction{connection: connection{executor: tx}, tx: tx}, nil
}

func (t *transaction) Commit(_ context.Context) error   { return databaseError(t.tx.Commit()) }
func (t *transaction) Rollback(_ context.Context) error { return t.tx.Rollback() }
