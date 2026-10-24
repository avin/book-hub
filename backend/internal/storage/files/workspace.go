package files

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"

	"book-hub/internal/domain"
)

// Workspace owns local temporary files, independently of original books.
type Workspace struct{ root string }

type TempFile struct {
	Path   string
	SHA256 string
	Size   int64
}

func (s Workspace) Ensure() error { return os.MkdirAll(s.root, 0o755) }

func (s Workspace) CheckReady() error {
	if err := s.Ensure(); err != nil {
		return err
	}
	probe, err := os.CreateTemp(s.root, "ready-*")
	if err != nil {
		return err
	}
	name := probe.Name()
	if err := probe.Close(); err != nil {
		return err
	}
	return os.Remove(name)
}

func (s Workspace) SaveTemp(reader io.Reader, limit int64) (TempFile, error) {
	if limit <= 0 {
		return TempFile{}, domain.ErrValidation
	}
	if err := s.Ensure(); err != nil {
		return TempFile{}, err
	}
	temp, err := os.CreateTemp(s.root, "upload-*")
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
