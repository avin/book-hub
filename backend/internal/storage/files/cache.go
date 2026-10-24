package files

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"book-hub/internal/domain"
	"book-hub/internal/storage"
)

type cachedBook struct {
	size int64
	used time.Time
	pins int
}

// bookCache owns a single backend's ready files and in-progress reservations.
// Original access and slow copies happen outside the mutex.
type bookCache struct {
	mu          sync.Mutex
	root        string
	limit, used int64
	entries     map[string]*cachedBook
	pending     map[string]bool
	initialized bool
	disabled    bool
	logger      *slog.Logger
	lastUse     time.Time
}

func newBookCache(root string, limit int64) *bookCache {
	return &bookCache{root: root, limit: limit, entries: make(map[string]*cachedBook), pending: make(map[string]bool), logger: slog.Default()}
}

func (c *bookCache) warning(err error) {
	c.logger.Warn("book cache unavailable; using original when possible", "error", err)
}

func (c *bookCache) ensure() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.initialized {
		return
	}
	c.initialized = true
	if err := c.restore(); err != nil {
		c.disabled = true
		c.warning(err)
	}
}

func cacheHash(name string) (string, bool) {
	if !strings.HasSuffix(name, ".book") {
		return "", false
	}
	hash := strings.TrimSuffix(name, ".book")
	decoded, err := hex.DecodeString(hash)
	return hash, err == nil && len(decoded) == sha256.Size && hash == strings.ToLower(hash)
}

func (c *bookCache) path(hash string) string { return filepath.Join(c.root, hash+".book") }

func (c *bookCache) restore() error {
	if err := os.MkdirAll(c.root, 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(c.root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		path := filepath.Join(c.root, entry.Name())
		if strings.HasPrefix(entry.Name(), "partial-") && entry.Type().IsRegular() {
			if err := os.Remove(path); err != nil {
				return err
			}
			continue
		}
		hash, valid := cacheHash(entry.Name())
		if !valid || !entry.Type().IsRegular() {
			return fmt.Errorf("unexpected entry in cache: %s", entry.Name())
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		err = verify(context.Background(), file, info.Size(), hash)
		closeErr := file.Close()
		if closeErr != nil {
			return closeErr
		}
		if err != nil {
			c.warning(err)
			if err := os.Remove(path); err != nil {
				return err
			}
			continue
		}
		c.entries[hash] = &cachedBook{size: info.Size(), used: info.ModTime()}
		if info.ModTime().After(c.lastUse) {
			c.lastUse = info.ModTime()
		}
		c.used += info.Size()
	}
	return c.makeRoom(0)
}

var errCacheFull = errors.New("cache budget occupied")

func (c *bookCache) touch(hash string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if entry := c.entries[hash]; entry != nil {
		entry.used = c.nextUse()
		if err := os.Chtimes(c.path(hash), entry.used, entry.used); err != nil {
			c.warning(err)
		}
	}
}

// makeRoom never evicts pinned responses or an in-progress receive.
func (c *bookCache) makeRoom(size int64) error {
	if size > c.limit {
		return errCacheFull
	}
	for c.used > c.limit-size {
		var victim string
		var oldest *cachedBook
		for hash, entry := range c.entries {
			if entry.pins == 0 && (oldest == nil || entry.used.Before(oldest.used)) {
				victim, oldest = hash, entry
			}
		}
		if oldest == nil {
			return errCacheFull
		}
		if err := os.Remove(c.path(victim)); err != nil && !os.IsNotExist(err) {
			return err
		}
		delete(c.entries, victim)
		c.used -= oldest.size
	}
	return nil
}

func (c *bookCache) acquire(hash string, size int64) (*BookLease, error) {
	entry := c.entries[hash]
	if entry == nil {
		return nil, nil
	}
	file, err := os.Open(c.path(hash))
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil || info.Size() != size {
		file.Close()
		if err == nil {
			err = fmt.Errorf("cached file size mismatch")
		}
		return nil, err
	}
	entry.pins++
	entry.used = c.nextUse()
	// The timestamp preserves recency across restart, without consulting originals.
	if err := os.Chtimes(c.path(hash), entry.used, entry.used); err != nil {
		c.warning(err)
	}
	var once sync.Once
	return &BookLease{File: file, release: func() { once.Do(func() { c.mu.Lock(); entry.pins--; c.mu.Unlock() }) }}, nil
}

// open reports handled=false when the original/bounded workspace should be used.
// A failed original receive is handled here, so corrupt bytes are never retried as a cache bypass.
func (c *bookCache) open(ctx context.Context, book domain.Book, source func() (io.ReadCloser, error)) (*BookLease, bool, error) {
	c.ensure()
	c.mu.Lock()
	if c.disabled {
		c.mu.Unlock()
		return nil, false, nil
	}
	lease, err := c.acquire(book.SHA256, book.SizeBytes)
	if err != nil {
		c.warning(err)
		c.mu.Unlock()
		return nil, false, nil
	}
	if lease != nil {
		c.mu.Unlock()
		return lease, true, nil
	}
	_, validHash := cacheHash(book.SHA256 + ".book")
	if c.pending[book.SHA256] || book.SizeBytes < 0 || !validHash {
		c.mu.Unlock()
		return nil, false, nil
	}
	if err := c.makeRoom(book.SizeBytes); err != nil {
		if !errors.Is(err, errCacheFull) {
			c.warning(err)
		}
		c.mu.Unlock()
		return nil, false, nil
	}
	c.used += book.SizeBytes
	c.pending[book.SHA256] = true
	c.mu.Unlock()
	return c.receive(ctx, book, source)
}

func (c *bookCache) receive(ctx context.Context, book domain.Book, source func() (io.ReadCloser, error)) (*BookLease, bool, error) {
	output, err := os.CreateTemp(c.root, "partial-")
	if err != nil {
		c.finishFailure(book, "", err)
		return nil, false, nil
	}
	path := output.Name()
	input, err := source()
	if err != nil {
		output.Close()
		c.finishFailure(book, path, nil)
		return nil, true, fmt.Errorf("receive original: %w: %w", storage.ErrUnavailable, err)
	}
	stop := context.AfterFunc(ctx, func() { input.Close() })
	hash := sha256.New()
	buffer := make([]byte, 32*1024)
	var written int64
	var sourceErr, cacheErr error
	reader := io.LimitReader(contextReader{ctx, input}, book.SizeBytes+1)
	for {
		n, readErr := reader.Read(buffer)
		if n > 0 {
			if int64(n) > book.SizeBytes-written {
				sourceErr = fmt.Errorf("original size mismatch")
				break
			}
			if _, cacheErr = output.Write(buffer[:n]); cacheErr != nil {
				break
			}
			hash.Write(buffer[:n])
			written += int64(n)
		}
		if readErr != nil {
			if readErr != io.EOF {
				sourceErr = readErr
			}
			break
		}
	}
	stop()
	if closeErr := input.Close(); sourceErr == nil {
		sourceErr = closeErr
	}
	if sourceErr == nil && (written != book.SizeBytes || hex.EncodeToString(hash.Sum(nil)) != book.SHA256) {
		sourceErr = fmt.Errorf("original size or SHA-256 mismatch")
	}
	if cacheErr == nil && sourceErr == nil {
		cacheErr = output.Sync()
	}
	if closeErr := output.Close(); cacheErr == nil {
		cacheErr = closeErr
	}
	if sourceErr != nil || cacheErr != nil {
		c.finishFailure(book, path, cacheErr)
		if cacheErr != nil {
			return nil, false, nil
		}
		return nil, true, fmt.Errorf("receive original: %w: %w", storage.ErrUnavailable, sourceErr)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := os.Rename(path, c.path(book.SHA256)); err != nil {
		c.warning(err)
		if removeErr := os.Remove(path); removeErr == nil || os.IsNotExist(removeErr) {
			c.used -= book.SizeBytes
		}
		delete(c.pending, book.SHA256)
		return nil, false, nil
	}
	delete(c.pending, book.SHA256)
	c.entries[book.SHA256] = &cachedBook{size: book.SizeBytes}
	lease, err := c.acquire(book.SHA256, book.SizeBytes)
	if err != nil {
		c.warning(err)
		return nil, false, nil
	}
	return lease, true, nil
}

// Clock resolution must not turn two successive accesses into an arbitrary LRU tie.
// One microsecond also survives the timestamp resolution of NTFS.
func (c *bookCache) nextUse() time.Time {
	now := time.Now()
	if !now.After(c.lastUse) {
		now = c.lastUse.Add(time.Microsecond)
	}
	c.lastUse = now
	return now
}

func (c *bookCache) finishFailure(book domain.Book, path string, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if path == "" {
		c.used -= book.SizeBytes
	} else if removeErr := os.Remove(path); removeErr == nil || os.IsNotExist(removeErr) {
		c.used -= book.SizeBytes
	} else {
		c.warning(removeErr)
	}
	delete(c.pending, book.SHA256)
	if err != nil {
		c.warning(err)
	}
}

// SeedBook reuses an accepted upload after both its original and library entry are saved.
// Cache failures are optional and never change a successful upload result.
func (s Store) SeedBook(ctx context.Context, book domain.Book, temp TempFile) {
	if s.cache == nil {
		return
	}
	lease, _, _ := s.cache.open(ctx, book, func() (io.ReadCloser, error) { return os.Open(temp.Path) })
	if lease != nil {
		lease.Close()
	}
}
