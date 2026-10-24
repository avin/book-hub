// Package files separates original books from local application images and temporary files.
package files

import (
	"context"
	"io"
	"path/filepath"

	"book-hub/internal/config"
)

// Originals stores immutable whole books. Locations belong to the selected adapter.
// MoveBook persists a book; callers retain and release their accepted temporary file.
type Originals interface {
	Open(context.Context, string) (io.ReadCloser, error)
	MoveBook(context.Context, string, string, string) (string, error)
	Delete(context.Context, string) error
	BookPath(string, string) string
}

// OriginalNamespace is used by restore to reject a nonempty selected destination.
type OriginalNamespace interface {
	Empty(context.Context) (bool, error)
}

// Store assembles the storage used by the server and administrative tools.
// New preserves the on-disk layout of existing local installations and backups.
type Store struct {
	Books  Originals
	Images Images
	Work   Workspace
	root   string
}

func New(root string) Store {
	return newStore(root, filepath.Join(root, "books"), filepath.Join(root, "covers"), filepath.Join(root, "tmp"), 1<<30)
}

func NewConfigured(cfg config.Config) (Store, error) {
	if err := cfg.ValidateFileStorage(); err != nil {
		return Store{}, err
	}
	books, images, work := cfg.FilePaths()
	limit := cfg.WorkMaxBytes
	if limit == 0 {
		limit = 1 << 30
	}
	originals, err := NewOriginals(cfg)
	if err != nil {
		return Store{}, err
	}
	store := newStore(cfg.StorageDir, books, images, work, limit)
	store.Books = originals
	return store, nil
}

// NewOriginals constructs the selected source without accessing it or local work/cache files.
func NewOriginals(cfg config.Config) (Originals, error) {
	if err := cfg.ValidateFileStorage(); err != nil {
		return nil, err
	}
	if cfg.BookStorage == "ftp" {
		root := cfg.FTPRoot
		if root == "" {
			root = "/books"
		}
		return &ftpOriginals{address: cfg.FTPAddr, user: cfg.FTPUser, password: cfg.FTPPassword, root: root}, nil
	}
	books, _, _ := cfg.FilePaths()
	return NewDirectory(books), nil
}

func newStore(root, books, images, workPath string, limit int64) Store {
	work := Workspace{root: workPath, budget: &workspaceBudget{limit: limit}}
	return Store{
		Books:  Directory{root: books},
		Images: Images{root: images, work: work},
		Work:   work,
		root:   root,
	}
}

func (s Store) Root() string { return s.root }

func (s Store) Ensure() error {
	if err := s.Work.Ensure(); err != nil {
		return err
	}
	return s.Images.Ensure()
}

func (s Store) CheckReady() error {
	if err := s.Ensure(); err != nil {
		return err
	}
	return s.Work.CheckReady()
}
