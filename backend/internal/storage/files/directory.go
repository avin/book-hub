package files

import (
	"context"
	"errors"
	"os"
	"path/filepath"

	"book-hub/internal/domain"
)

// Directory stores whole original books, preserving legacy absolute and relative locations.
type Directory struct{ root string }

func (s Directory) Ensure() error { return os.MkdirAll(s.root, 0o755) }

func (s Directory) Open(ctx context.Context, location string) (*os.File, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return os.Open(location)
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
	if _, err := os.Stat(finalPath); err == nil {
		if removeErr := os.Remove(tempPath); removeErr != nil {
			return "", removeErr
		}
		return finalPath, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if err := os.Rename(tempPath, finalPath); err != nil {
		return "", err
	}
	return finalPath, nil
}
