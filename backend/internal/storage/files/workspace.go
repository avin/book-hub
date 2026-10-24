package files

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"book-hub/internal/domain"
	"book-hub/internal/storage"
)

// Workspace owns local temporary files and one shared budget per backend.
type Workspace struct {
	root   string
	budget *workspaceBudget
}

type workspaceBudget struct {
	sync.Mutex
	used, limit int64
	initialized bool
}

type TempFile struct {
	Path    string
	SHA256  string
	Size    int64
	release func()
}

// Release removes the accepted file and releases its reservation exactly once.
func (t TempFile) Release() {
	if t.release != nil {
		t.release()
	}
}

func (s Workspace) Ensure() error {
	if err := os.MkdirAll(s.root, 0o755); err != nil {
		return err
	}
	s.budget.Lock()
	defer s.budget.Unlock()
	if s.budget.initialized {
		return nil
	}
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() && (strings.HasPrefix(entry.Name(), "upload-") || strings.HasPrefix(entry.Name(), "ready-")) {
			if err := os.Remove(filepath.Join(s.root, entry.Name())); err != nil {
				return err
			}
		}
	}
	s.budget.initialized = true
	return nil
}

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

func (s Workspace) reserve(bytes int64) error {
	if bytes < 0 || s.budget == nil {
		return storage.ErrUnavailable
	}
	s.budget.Lock()
	defer s.budget.Unlock()
	if bytes > s.budget.limit-s.budget.used {
		return fmt.Errorf("workspace budget exhausted: %w", storage.ErrUnavailable)
	}
	s.budget.used += bytes
	return nil
}

func (s Workspace) unreserve(bytes int64) {
	s.budget.Lock()
	s.budget.used -= bytes
	s.budget.Unlock()
}

func (s Workspace) SaveTemp(reader io.Reader, limit int64) (TempFile, error) {
	return s.SaveTempContext(context.Background(), reader, limit)
}

func (s Workspace) SaveTempContext(ctx context.Context, reader io.Reader, limit int64) (TempFile, error) {
	return s.save(ctx, reader, limit, -1)
}

// save reserves an expected full size before receiving, or grows an upload's
// reservation before each write when its exact size is not yet known.
func (s Workspace) save(ctx context.Context, reader io.Reader, limit, expected int64) (TempFile, error) {
	if limit < 0 || (limit == 0 && expected < 0) {
		return TempFile{}, domain.ErrValidation
	}
	reserved := max(expected, 0)
	if err := s.reserve(reserved); err != nil {
		return TempFile{}, err
	}
	if err := s.Ensure(); err != nil {
		s.unreserve(reserved)
		return TempFile{}, fmt.Errorf("workspace: %w: %w", storage.ErrUnavailable, err)
	}
	file, err := os.CreateTemp(s.root, "upload-*")
	if err != nil {
		s.unreserve(reserved)
		return TempFile{}, fmt.Errorf("workspace: %w: %w", storage.ErrUnavailable, err)
	}
	var once sync.Once
	release := func() {
		once.Do(func() {
			if err := os.Remove(file.Name()); err != nil && !os.IsNotExist(err) {
				return
			}
			s.unreserve(reserved)
		})
	}
	hash := sha256.New()
	buffer := make([]byte, 32*1024)
	var written int64
	input := io.LimitReader(contextReader{ctx, reader}, limit+1)
	for {
		n, readErr := input.Read(buffer)
		if n > 0 {
			if int64(n) > limit-written {
				err = domain.ErrQuotaExceeded
				break
			}
			if expected < 0 {
				if err = s.reserve(int64(n)); err != nil {
					break
				}
				reserved += int64(n)
			}
			if _, err = file.Write(buffer[:n]); err != nil {
				err = fmt.Errorf("workspace write: %w: %w", storage.ErrUnavailable, err)
				break
			}
			hash.Write(buffer[:n])
			written += int64(n)
		}
		if readErr != nil {
			if readErr != io.EOF {
				err = readErr
			}
			break
		}
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		release()
		return TempFile{}, err
	}
	return TempFile{Path: file.Name(), SHA256: hex.EncodeToString(hash.Sum(nil)), Size: written, release: release}, nil
}
