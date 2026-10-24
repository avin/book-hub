package files

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"

	"book-hub/internal/domain"
)

// Directory stores whole original books, preserving legacy absolute and relative locations.
type Directory struct{ root string }

func NewDirectory(root string) Directory { return Directory{root: root} }

func (s Directory) Ensure() error { return os.MkdirAll(s.root, 0o755) }

func (s Directory) Open(ctx context.Context, location string) (io.ReadCloser, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return os.Open(location)
}

func (s Directory) LocalPath(location string) string { return location }

func (s Directory) Empty(ctx context.Context) (bool, error) {
	empty := true
	err := filepath.WalkDir(s.root, func(path string, entry fs.DirEntry, err error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if errors.Is(err, os.ErrNotExist) && path == s.root {
			return nil
		}
		if err != nil {
			return err
		}
		if !entry.IsDir() {
			empty = false
			return fs.SkipAll
		}
		return nil
	})
	return empty, err
}

// Delete treats an already absent original as successfully removed.
func (s Directory) Delete(ctx context.Context, location string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if location == "" {
		return nil
	}
	err := os.Remove(location)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (s Directory) BookPath(sha256Hex, format string) string {
	return filepath.Join(s.root, sha256Hex[:2], sha256Hex+"."+format)
}

func (s Directory) MoveBook(ctx context.Context, tempPath, sha256Hex, format string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if len(sha256Hex) < 2 {
		return "", domain.ErrValidation
	}
	finalPath := s.BookPath(sha256Hex, format)
	if err := os.MkdirAll(filepath.Dir(finalPath), 0o755); err != nil {
		return "", err
	}
	if err := copyAtomic(ctx, tempPath, finalPath); err != nil {
		return "", err
	}
	return finalPath, nil
}

// Staging in the destination supports a workspace on a different filesystem.
// The accepted input stays available until its caller releases it.
func copyAtomic(ctx context.Context, source, target string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.CreateTemp(filepath.Dir(target), ".book-hub-*")
	if err != nil {
		return err
	}
	name := output.Name()
	defer os.Remove(name)
	_, copyErr := io.Copy(output, contextReader{ctx, input})
	if copyErr == nil {
		copyErr = output.Sync()
	}
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return os.Rename(name, target)
}
