package files

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"book-hub/internal/domain"
)

type Store struct {
	root string
}

type TempFile struct {
	Path   string
	SHA256 string
	Size   int64
}

func New(root string) Store {
	return Store{root: root}
}

func (s Store) Root() string {
	return s.root
}

func (s Store) Ensure() error {
	if err := os.MkdirAll(filepath.Join(s.root, "tmp"), 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(s.root, "books"), 0o755); err != nil {
		return err
	}
	return os.MkdirAll(filepath.Join(s.root, "covers"), 0o755)
}

func (s Store) CheckReady() error {
	if err := s.Ensure(); err != nil {
		return err
	}
	probe, err := os.CreateTemp(filepath.Join(s.root, "tmp"), "ready-*")
	if err != nil {
		return err
	}
	name := probe.Name()
	if err := probe.Close(); err != nil {
		return err
	}
	return os.Remove(name)
}

func (s Store) SaveTemp(reader io.Reader, limit int64) (TempFile, error) {
	if limit <= 0 {
		return TempFile{}, domain.ErrValidation
	}
	if err := s.Ensure(); err != nil {
		return TempFile{}, err
	}
	temp, err := os.CreateTemp(filepath.Join(s.root, "tmp"), "upload-*")
	if err != nil {
		return TempFile{}, err
	}
	defer temp.Close()

	hasher := sha256.New()
	written, err := io.Copy(io.MultiWriter(temp, hasher), io.LimitReader(reader, limit+1))
	if err != nil {
		_ = os.Remove(temp.Name())
		return TempFile{}, err
	}
	if written > limit {
		_ = os.Remove(temp.Name())
		return TempFile{}, domain.ErrQuotaExceeded
	}
	return TempFile{
		Path:   temp.Name(),
		SHA256: hex.EncodeToString(hasher.Sum(nil)),
		Size:   written,
	}, nil
}

func (s Store) BookPath(sha256Hex, format string) string {
	return filepath.Join(s.root, "books", sha256Hex[:2], sha256Hex+"."+format)
}

func (s Store) MoveBook(tempPath, sha256Hex, format string) (string, error) {
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

func (s Store) SaveCover(userBookID, format string, reader io.Reader, limit int64) (string, error) {
	if err := s.Ensure(); err != nil {
		return "", err
	}
	temp, err := s.SaveTemp(reader, limit)
	if err != nil {
		return "", err
	}
	finalPath := filepath.Join(s.root, "covers", fmt.Sprintf("%s.%s", userBookID, format))
	if err := os.MkdirAll(filepath.Dir(finalPath), 0o755); err != nil {
		_ = os.Remove(temp.Path)
		return "", err
	}
	if err := os.Rename(temp.Path, finalPath); err != nil {
		_ = os.Remove(temp.Path)
		return "", err
	}
	return finalPath, nil
}

func DeleteBestEffort(path string) {
	if path != "" {
		_ = os.Remove(path)
	}
}
