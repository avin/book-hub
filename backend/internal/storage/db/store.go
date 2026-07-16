package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"book-hub/internal/domain"
	"book-hub/internal/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool *pgxpool.Pool
}

func Open(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *Store) Close() {
	s.pool.Close()
}

func (s *Store) CreateUser(ctx context.Context, login, passwordHash string, active bool, quotaBytes int64) (domain.User, error) {
	var user domain.User
	err := s.pool.QueryRow(ctx, `
		insert into users (id, login, password_hash, is_active, quota_bytes)
		values ($1, $2, $3, $4, $5)
		returning id, login, is_active, quota_bytes, created_at
	`, uuid.New(), login, passwordHash, active, quotaBytes).Scan(&user.ID, &user.Login, &user.IsActive, &user.QuotaBytes, &user.CreatedAt)
	if err != nil {
		if strings.Contains(err.Error(), "users_login_lower_idx") {
			return domain.User{}, domain.ErrValidation
		}
		return domain.User{}, err
	}
	return user, nil
}

func (s *Store) GetUser(ctx context.Context, userID uuid.UUID) (domain.UserWithPassword, error) {
	return s.getUser(ctx, "u.id = $1", userID)
}

func (s *Store) GetUserByLogin(ctx context.Context, login string) (domain.UserWithPassword, error) {
	return s.getUser(ctx, "u.login = lower($1)", login)
}

func (s *Store) getUser(ctx context.Context, predicate string, arg any) (domain.UserWithPassword, error) {
	var user domain.UserWithPassword
	err := s.pool.QueryRow(ctx, fmt.Sprintf(`
		select u.id, u.login, u.password_hash, u.is_active, u.quota_bytes, u.created_at,
			coalesce(sum(bf.size_bytes), 0)::bigint as used_bytes
		from users u
		left join user_books ub on ub.user_id = u.id
		left join book_files bf on bf.id = ub.book_file_id
		where %s
		group by u.id
	`, predicate), arg).Scan(&user.ID, &user.Login, &user.PasswordHash, &user.IsActive, &user.QuotaBytes, &user.CreatedAt, &user.UsedBytes)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.UserWithPassword{}, domain.ErrNotFound
	}
	return user, err
}

func (s *Store) SetUserActive(ctx context.Context, userID uuid.UUID, active bool) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `update users set is_active = $2, updated_at = now() where id = $1`, userID, active)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	if !active {
		if _, err := tx.Exec(ctx, `update sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, userID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) SetUserPassword(ctx context.Context, userID uuid.UUID, passwordHash string) error {
	tag, err := s.pool.Exec(ctx, `update users set password_hash = $2, updated_at = now() where id = $1`, userID, passwordHash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (s *Store) SetUserQuota(ctx context.Context, userID uuid.UUID, quotaBytes int64) error {
	used, err := s.UsedBytes(ctx, userID)
	if err != nil {
		return err
	}
	if quotaBytes < used {
		return domain.ErrQuotaExceeded
	}
	tag, err := s.pool.Exec(ctx, `update users set quota_bytes = $2, updated_at = now() where id = $1`, userID, quotaBytes)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (s *Store) DeleteUser(ctx context.Context, userID uuid.UUID) ([]domain.DeletedBookFiles, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		select ub.book_file_id, bf.storage_path, ub.cover_path, ub.cover_thumbnail_path
		from user_books ub
		join book_files bf on bf.id = ub.book_file_id
		where ub.user_id = $1
	`, userID)
	if err != nil {
		return nil, err
	}
	type candidate struct {
		fileID    uuid.UUID
		bookPath  string
		coverPath *string
		thumbPath *string
	}
	var candidates []candidate
	for rows.Next() {
		var item candidate
		if err := rows.Scan(&item.fileID, &item.bookPath, &item.coverPath, &item.thumbPath); err != nil {
			rows.Close()
			return nil, err
		}
		candidates = append(candidates, item)
	}
	rows.Close()
	if rows.Err() != nil {
		return nil, rows.Err()
	}

	tag, err := tx.Exec(ctx, `delete from users where id = $1`, userID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, domain.ErrNotFound
	}

	deleted := make([]domain.DeletedBookFiles, 0, len(candidates))
	for _, item := range candidates {
		var refs int
		if err := tx.QueryRow(ctx, `select count(*) from user_books where book_file_id = $1`, item.fileID).Scan(&refs); err != nil {
			return nil, err
		}
		files := domain.DeletedBookFiles{}
		if item.coverPath != nil {
			files.CoverPath = *item.coverPath
		}
		if item.thumbPath != nil {
			files.CoverThumbPath = *item.thumbPath
		}
		if refs == 0 {
			if _, err := tx.Exec(ctx, `delete from book_files where id = $1`, item.fileID); err != nil {
				return nil, err
			}
			files.BookPath = item.bookPath
		}
		deleted = append(deleted, files)
	}
	return deleted, tx.Commit(ctx)
}

func (s *Store) ListUsers(ctx context.Context) ([]domain.User, error) {
	rows, err := s.pool.Query(ctx, `
		select u.id, u.login, u.is_active, u.quota_bytes, u.created_at,
			coalesce(sum(bf.size_bytes), 0)::bigint as used_bytes
		from users u
		left join user_books ub on ub.user_id = u.id
		left join book_files bf on bf.id = ub.book_file_id
		group by u.id
		order by u.login
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []domain.User
	for rows.Next() {
		var user domain.User
		if err := rows.Scan(&user.ID, &user.Login, &user.IsActive, &user.QuotaBytes, &user.CreatedAt, &user.UsedBytes); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func (s *Store) UsedBytes(ctx context.Context, userID uuid.UUID) (int64, error) {
	var used int64
	err := s.pool.QueryRow(ctx, `
		select coalesce(sum(bf.size_bytes), 0)::bigint
		from user_books ub
		join book_files bf on bf.id = ub.book_file_id
		where ub.user_id = $1
	`, userID).Scan(&used)
	return used, err
}

func (s *Store) CreateSession(ctx context.Context, userID uuid.UUID, tokenHash string, ttlSeconds int64) error {
	_, err := s.pool.Exec(ctx, `
		insert into sessions (id, user_id, token_hash, expires_at)
		values ($1, $2, $3, now() + ($4 * interval '1 second'))
	`, uuid.New(), userID, tokenHash, ttlSeconds)
	return err
}

func (s *Store) GetSession(ctx context.Context, tokenHash string) (uuid.UUID, error) {
	var userID uuid.UUID
	err := s.pool.QueryRow(ctx, `
		select s.user_id
		from sessions s
		join users u on u.id = s.user_id
		where s.token_hash = $1
			and s.revoked_at is null
			and s.expires_at > now()
			and u.is_active = true
	`, tokenHash).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, domain.ErrUnauthorized
	}
	return userID, err
}

func (s *Store) RevokeSession(ctx context.Context, tokenHash string) error {
	_, err := s.pool.Exec(ctx, `update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null`, tokenHash)
	return err
}

func (s *Store) RevokeUserSessions(ctx context.Context, userID uuid.UUID, exceptTokenHash *string) error {
	if exceptTokenHash == nil {
		_, err := s.pool.Exec(ctx, `update sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, userID)
		return err
	}
	_, err := s.pool.Exec(ctx, `update sessions set revoked_at = now() where user_id = $1 and token_hash <> $2 and revoked_at is null`, userID, *exceptTokenHash)
	return err
}

func (s *Store) GetSettings(ctx context.Context, userID uuid.UUID) (json.RawMessage, error) {
	var raw []byte
	err := s.pool.QueryRow(ctx, `select settings_json from users where id = $1`, userID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return json.RawMessage(raw), err
}

func (s *Store) PutSettings(ctx context.Context, userID uuid.UUID, settings json.RawMessage) error {
	tag, err := s.pool.Exec(ctx, `update users set settings_json = $2, updated_at = now() where id = $1`, userID, settings)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (s *Store) GetBookFileByHash(ctx context.Context, sha256 string) (*domain.BookFile, error) {
	var file domain.BookFile
	err := s.pool.QueryRow(ctx, `select id, sha256, storage_path, size_bytes, format, created_at from book_files where sha256 = $1`, sha256).
		Scan(&file.ID, &file.SHA256, &file.StoragePath, &file.SizeBytes, &file.Format, &file.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &file, nil
}

func (s *Store) UserHasBookFile(ctx context.Context, userID, bookFileID uuid.UUID) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `select exists(select 1 from user_books where user_id = $1 and book_file_id = $2)`, userID, bookFileID).Scan(&exists)
	return exists, err
}

func (s *Store) CreateBook(ctx context.Context, userID uuid.UUID, file domain.BookFileInput, book domain.BookInput) (domain.Book, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domain.Book{}, err
	}
	defer tx.Rollback(ctx)

	fileID := file.ID
	if fileID == uuid.Nil {
		fileID = uuid.New()
		_, err := tx.Exec(ctx, `
			insert into book_files (id, sha256, storage_path, size_bytes, format)
			values ($1, $2, $3, $4, $5)
		`, fileID, file.SHA256, file.StoragePath, file.SizeBytes, file.Format)
		if err != nil {
			if strings.Contains(err.Error(), "book_files_sha256_key") {
				return domain.Book{}, domain.ErrDuplicateBook
			}
			return domain.Book{}, err
		}
	}

	bookID := uuid.New()
	_, err = tx.Exec(ctx, `
		insert into user_books (id, user_id, book_file_id, title, favorite)
		values ($1, $2, $3, $4, $5)
	`, bookID, userID, fileID, domain.NormalizeTitle(book.Title), book.Favorite)
	if err != nil {
		if strings.Contains(err.Error(), "user_books_user_id_book_file_id_key") {
			return domain.Book{}, domain.ErrDuplicateBook
		}
		return domain.Book{}, err
	}
	if err := replaceBookTags(ctx, tx, userID, bookID, book.Tags); err != nil {
		return domain.Book{}, err
	}
	created, err := scanBook(ctx, tx, userID, bookID)
	if err != nil {
		return domain.Book{}, err
	}
	return created, tx.Commit(ctx)
}

func (s *Store) QueryBooks(ctx context.Context, userID uuid.UUID, query domain.BookQuery) (domain.BookPage, error) {
	orderBy := map[string]string{
		"relevance":       "ub.last_opened_at desc, ub.created_at desc, ub.id desc",
		"created_at_asc":  "ub.created_at asc",
		"title_asc":       "lower(ub.title) asc",
		"title_desc":      "lower(ub.title) desc",
		"updated_at_asc":  "ub.updated_at asc",
		"updated_at_desc": "ub.updated_at desc",
	}[query.Sort]
	if orderBy == "" {
		orderBy = "ub.last_opened_at desc, ub.created_at desc, ub.id desc"
	}

	where := `
		ub.user_id = $1
		and ($2::text = '' or lower(ub.title) like '%' || lower($2) || '%')
		and ($3::bool is null or ub.favorite = $3)
		and not exists (
			select 1 from unnest($4::text[]) qtag
			where not exists (
				select 1
				from user_book_tags ubt
				join tags t on t.id = ubt.tag_id
				where ubt.user_book_id = ub.id and t.name = qtag
			)
		)
	`
	var total int64
	if err := s.pool.QueryRow(ctx, `select count(*) from user_books ub where `+where, userID, query.Q, query.Favorite, query.Tags).Scan(&total); err != nil {
		return domain.BookPage{}, err
	}
	rows, err := s.pool.Query(ctx, `
		select ub.id, ub.title,
			coalesce(array_agg(t.name order by t.name) filter (where t.name is not null), '{}'::text[]) as tags,
			ub.favorite, bf.format, bf.size_bytes,
			ub.progress_percent, bf.storage_path, ub.cover_path, ub.cover_thumbnail_path, ub.created_at, ub.last_opened_at, ub.updated_at
		from user_books ub
		join book_files bf on bf.id = ub.book_file_id
		left join user_book_tags ubt on ubt.user_book_id = ub.id
		left join tags t on t.id = ubt.tag_id
		where `+where+`
		group by ub.id, bf.id
		order by `+orderBy+`
		limit $5 offset $6
	`, userID, query.Q, query.Favorite, query.Tags, query.Limit, query.Offset)
	if err != nil {
		return domain.BookPage{}, err
	}
	defer rows.Close()
	items, err := scanBooks(rows)
	if err != nil {
		return domain.BookPage{}, err
	}
	return domain.BookPage{Items: items, Total: total, Limit: query.Limit, Offset: query.Offset}, nil
}

func (s *Store) ListBookTags(ctx context.Context, userID uuid.UUID) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		select distinct t.name
		from tags t
		join user_book_tags ubt on ubt.tag_id = t.id
		join user_books ub on ub.id = ubt.user_book_id
		where ub.user_id = $1
		order by t.name
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tags := make([]string, 0)
	for rows.Next() {
		var tag string
		if err := rows.Scan(&tag); err != nil {
			return nil, err
		}
		tags = append(tags, tag)
	}
	return tags, rows.Err()
}

func (s *Store) GetBook(ctx context.Context, userID, bookID uuid.UUID) (domain.Book, error) {
	return scanBook(ctx, s.pool, userID, bookID)
}

func (s *Store) UpdateBook(ctx context.Context, userID, bookID uuid.UUID, patch storage.BookPatch) (domain.Book, error) {
	current, err := s.GetBook(ctx, userID, bookID)
	if err != nil {
		return domain.Book{}, err
	}
	title := current.Title
	favorite := current.Favorite
	if patch.Title != nil {
		title = domain.NormalizeTitle(*patch.Title)
	}
	if patch.Favorite != nil {
		favorite = *patch.Favorite
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domain.Book{}, err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		update user_books set title = $3, favorite = $4, updated_at = now()
		where id = $2 and user_id = $1
	`, userID, bookID, title, favorite)
	if err != nil {
		return domain.Book{}, err
	}
	if tag.RowsAffected() == 0 {
		return domain.Book{}, domain.ErrNotFound
	}
	if patch.Tags != nil {
		tags := domain.NormalizeTags(*patch.Tags)
		if err := replaceBookTags(ctx, tx, userID, bookID, tags); err != nil {
			return domain.Book{}, err
		}
		if err := deleteUnusedTags(ctx, tx, userID); err != nil {
			return domain.Book{}, err
		}
	}
	updated, err := scanBook(ctx, tx, userID, bookID)
	if err != nil {
		return domain.Book{}, err
	}
	return updated, tx.Commit(ctx)
}

func (s *Store) DeleteBook(ctx context.Context, userID, bookID uuid.UUID) (domain.DeletedBookFiles, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domain.DeletedBookFiles{}, err
	}
	defer tx.Rollback(ctx)
	var fileID uuid.UUID
	var bookPath string
	var coverPath *string
	var thumbPath *string
	err = tx.QueryRow(ctx, `
		select ub.book_file_id, bf.storage_path, ub.cover_path, ub.cover_thumbnail_path
		from user_books ub
		join book_files bf on bf.id = ub.book_file_id
		where ub.user_id = $1 and ub.id = $2
	`, userID, bookID).Scan(&fileID, &bookPath, &coverPath, &thumbPath)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.DeletedBookFiles{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.DeletedBookFiles{}, err
	}
	if _, err := tx.Exec(ctx, `delete from user_books where id = $1`, bookID); err != nil {
		return domain.DeletedBookFiles{}, err
	}
	if err := deleteUnusedTags(ctx, tx, userID); err != nil {
		return domain.DeletedBookFiles{}, err
	}
	var refs int
	if err := tx.QueryRow(ctx, `select count(*) from user_books where book_file_id = $1`, fileID).Scan(&refs); err != nil {
		return domain.DeletedBookFiles{}, err
	}
	files := domain.DeletedBookFiles{}
	if coverPath != nil {
		files.CoverPath = *coverPath
	}
	if thumbPath != nil {
		files.CoverThumbPath = *thumbPath
	}
	if refs == 0 {
		if _, err := tx.Exec(ctx, `delete from book_files where id = $1`, fileID); err != nil {
			return domain.DeletedBookFiles{}, err
		}
		files.BookPath = bookPath
	}
	return files, tx.Commit(ctx)
}

func (s *Store) SetCover(ctx context.Context, userID, bookID uuid.UUID, coverFiles domain.CoverFiles) (domain.CoverFiles, error) {
	current, err := s.GetBook(ctx, userID, bookID)
	if err != nil {
		return domain.CoverFiles{}, err
	}
	old := domain.CoverFiles{}
	if current.CoverPath != nil {
		old.CoverPath = *current.CoverPath
	}
	if current.CoverThumbPath != nil {
		old.CoverThumbPath = *current.CoverThumbPath
	}
	_, err = s.pool.Exec(ctx, `
		update user_books set cover_path = $3, cover_thumbnail_path = $4, updated_at = now()
		where user_id = $1 and id = $2
	`, userID, bookID, coverFiles.CoverPath, coverFiles.CoverThumbPath)
	return old, err
}

func (s *Store) DeleteCover(ctx context.Context, userID, bookID uuid.UUID) (domain.CoverFiles, error) {
	current, err := s.GetBook(ctx, userID, bookID)
	if err != nil {
		return domain.CoverFiles{}, err
	}
	old := domain.CoverFiles{}
	if current.CoverPath != nil {
		old.CoverPath = *current.CoverPath
	}
	if current.CoverThumbPath != nil {
		old.CoverThumbPath = *current.CoverThumbPath
	}
	_, err = s.pool.Exec(ctx, `
		update user_books set cover_path = null, cover_thumbnail_path = null, updated_at = now()
		where user_id = $1 and id = $2
	`, userID, bookID)
	return old, err
}

func (s *Store) GetProgress(ctx context.Context, userID, bookID uuid.UUID) (domain.ReadingProgress, error) {
	if _, err := s.GetBook(ctx, userID, bookID); err != nil {
		return domain.ReadingProgress{}, err
	}
	var progress domain.ReadingProgress
	err := s.pool.QueryRow(ctx, `select progress_percent from user_books where id = $1`, bookID).
		Scan(&progress.ProgressPercent)
	return progress, err
}

func (s *Store) PutProgress(ctx context.Context, userID, bookID uuid.UUID, progress float64) (domain.ReadingProgress, error) {
	if _, err := s.GetBook(ctx, userID, bookID); err != nil {
		return domain.ReadingProgress{}, err
	}
	var saved domain.ReadingProgress
	err := s.pool.QueryRow(ctx, `
		update user_books
		set progress_percent = $3, last_opened_at = now()
		where user_id = $1 and id = $2
		returning progress_percent
	`, userID, bookID, progress).Scan(&saved.ProgressPercent)
	return saved, err
}

func (s *Store) DeleteProgress(ctx context.Context, userID, bookID uuid.UUID) error {
	if _, err := s.GetBook(ctx, userID, bookID); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `update user_books set progress_percent = 0 where user_id = $1 and id = $2`, userID, bookID)
	return err
}

func (s *Store) DeleteAllProgress(ctx context.Context, userID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
		update user_books set progress_percent = 0
		where user_id = $1
	`, userID)
	return err
}

func replaceBookTags(ctx context.Context, tx pgx.Tx, userID, bookID uuid.UUID, tags []string) error {
	if _, err := tx.Exec(ctx, `delete from user_book_tags where user_book_id = $1`, bookID); err != nil {
		return err
	}
	for _, name := range domain.NormalizeTags(tags) {
		tagID := uuid.New()
		err := tx.QueryRow(ctx, `
			insert into tags (id, user_id, name)
			values ($1, $2, $3)
			on conflict (user_id, name) do update set name = excluded.name
			returning id
		`, tagID, userID, name).Scan(&tagID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			insert into user_book_tags (user_book_id, tag_id)
			values ($1, $2)
			on conflict do nothing
		`, bookID, tagID); err != nil {
			return err
		}
	}
	return nil
}

func deleteUnusedTags(ctx context.Context, tx pgx.Tx, userID uuid.UUID) error {
	_, err := tx.Exec(ctx, `
		delete from tags t
		where t.user_id = $1
			and not exists (
				select 1
				from user_book_tags ubt
				where ubt.tag_id = t.id
			)
	`, userID)
	return err
}

type bookQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func scanBook(ctx context.Context, q bookQuerier, userID, bookID uuid.UUID) (domain.Book, error) {
	rows, err := q.Query(ctx, `
		select ub.id, ub.title,
			coalesce(array_agg(t.name order by t.name) filter (where t.name is not null), '{}'::text[]) as tags,
			ub.favorite, bf.format, bf.size_bytes,
			ub.progress_percent, bf.storage_path, ub.cover_path, ub.cover_thumbnail_path, ub.created_at, ub.last_opened_at, ub.updated_at
		from user_books ub
		join book_files bf on bf.id = ub.book_file_id
		left join user_book_tags ubt on ubt.user_book_id = ub.id
		left join tags t on t.id = ubt.tag_id
		where ub.user_id = $1 and ub.id = $2
		group by ub.id, bf.id
	`, userID, bookID)
	if err != nil {
		return domain.Book{}, err
	}
	defer rows.Close()
	books, err := scanBooks(rows)
	if err != nil {
		return domain.Book{}, err
	}
	if len(books) == 0 {
		return domain.Book{}, domain.ErrNotFound
	}
	return books[0], nil
}

func scanBooks(rows pgx.Rows) ([]domain.Book, error) {
	var books []domain.Book
	for rows.Next() {
		var book domain.Book
		if err := rows.Scan(
			&book.ID,
			&book.Title,
			&book.Tags,
			&book.Favorite,
			&book.Format,
			&book.SizeBytes,
			&book.ProgressPercent,
			&book.StoragePath,
			&book.CoverPath,
			&book.CoverThumbPath,
			&book.CreatedAt,
			&book.LastOpenedAt,
			&book.UpdatedAt,
		); err != nil {
			return nil, err
		}
		books = append(books, book)
	}
	return books, rows.Err()
}
