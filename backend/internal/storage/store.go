package storage

import (
	"context"
	"encoding/json"

	"book-hub/internal/domain"
	"github.com/google/uuid"
)

type Users interface {
	CreateUser(ctx context.Context, login, passwordHash string, active bool, quotaBytes int64) (domain.User, error)
	GetUser(ctx context.Context, userID uuid.UUID) (domain.UserWithPassword, error)
	GetUserByLogin(ctx context.Context, login string) (domain.UserWithPassword, error)
	SetUserActive(ctx context.Context, userID uuid.UUID, active bool) error
	SetUserPassword(ctx context.Context, userID uuid.UUID, passwordHash string) error
	SetUserQuota(ctx context.Context, userID uuid.UUID, quotaBytes int64) error
	DeleteUser(ctx context.Context, userID uuid.UUID) ([]domain.DeletedBookFiles, error)
	ListUsers(ctx context.Context) ([]domain.User, error)
	UsedBytes(ctx context.Context, userID uuid.UUID) (int64, error)
}

type Sessions interface {
	CreateSession(ctx context.Context, userID uuid.UUID, tokenHash string, ttlSeconds int64) error
	GetSession(ctx context.Context, tokenHash string) (uuid.UUID, error)
	RevokeSession(ctx context.Context, tokenHash string) error
	RevokeUserSessions(ctx context.Context, userID uuid.UUID, exceptTokenHash *string) error
}

type Settings interface {
	GetSettings(ctx context.Context, userID uuid.UUID) (json.RawMessage, error)
	PutSettings(ctx context.Context, userID uuid.UUID, settings json.RawMessage) error
}

type Books interface {
	GetBookFileByHash(ctx context.Context, sha256 string) (*domain.BookFile, error)
	UserHasBookFile(ctx context.Context, userID, bookFileID uuid.UUID) (bool, error)
	CreateBook(ctx context.Context, userID uuid.UUID, file domain.BookFileInput, book domain.BookInput) (domain.Book, error)
	// CreateBookWithOriginal serializes publishing an original and adding its owner
	// against other uploads and delayed deletion. persist is called only for a new original.
	CreateBookWithOriginal(ctx context.Context, userID uuid.UUID, file domain.BookFileInput, book domain.BookInput, persist func(context.Context) (string, error)) (domain.Book, error)
	QueryBooks(ctx context.Context, userID uuid.UUID, query domain.BookQuery) (domain.BookPage, error)
	ListBookTags(ctx context.Context, userID uuid.UUID) ([]string, error)
	GetBook(ctx context.Context, userID, bookID uuid.UUID) (domain.Book, error)
	UpdateBook(ctx context.Context, userID, bookID uuid.UUID, patch BookPatch) (domain.Book, error)
	DeleteBook(ctx context.Context, userID, bookID uuid.UUID) (domain.DeletedBookFiles, error)
	SetCover(ctx context.Context, userID, bookID uuid.UUID, coverFiles domain.CoverFiles) (domain.CoverFiles, error)
	DeleteCover(ctx context.Context, userID, bookID uuid.UUID) (domain.CoverFiles, error)

	GetProgress(ctx context.Context, userID, bookID uuid.UUID) (domain.ReadingProgress, error)
	PutProgress(ctx context.Context, userID, bookID uuid.UUID, progress float64) (domain.ReadingProgress, error)
	DeleteProgress(ctx context.Context, userID, bookID uuid.UUID) error
	DeleteAllProgress(ctx context.Context, userID uuid.UUID) error
}

// OriginalDeletions retries removal only while the original has no owners.
// The callback runs under the same database protection used when adding owners.
type OriginalDeletions interface {
	ProcessOriginalDeletions(ctx context.Context, remove func(context.Context, string) error) error
}

// Store remains the HTTP composition root compatibility interface.
type Store interface {
	Users
	Sessions
	Settings
	Books
	OriginalDeletions

	Ping(ctx context.Context) error
	Close()
}

type BookPatch struct {
	Title    *string
	Tags     *[]string
	Favorite *bool
}
