package files

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"

	"book-hub/internal/domain"
	"book-hub/internal/storage"
)

// BookLease holds the verified local file until the HTTP response has finished.
type BookLease struct {
	*os.File
	release func()
}

func (l *BookLease) Close() error {
	err := l.File.Close()
	if l.release != nil {
		l.release()
	}
	return err
}

func (s Store) OpenBook(ctx context.Context, book domain.Book) (*BookLease, error) {
	local, ok := s.Books.(interface{ LocalPath(string) string })
	if !ok {
		source := &originalReader{ctx: ctx, originals: s.Books, location: book.StoragePath}
		defer source.Close()
		temp, err := s.Work.save(ctx, source, book.SizeBytes, book.SizeBytes)
		if err != nil {
			return nil, fmt.Errorf("receive original: %w: %w", storage.ErrUnavailable, err)
		}
		if temp.Size != book.SizeBytes || temp.SHA256 != book.SHA256 {
			temp.Release()
			return nil, fmt.Errorf("original size or SHA-256 mismatch: %w", storage.ErrUnavailable)
		}
		file, err := os.Open(temp.Path)
		if err != nil {
			temp.Release()
			return nil, fmt.Errorf("open received original: %w: %w", storage.ErrUnavailable, err)
		}
		return &BookLease{File: file, release: temp.Release}, nil
	}
	file, err := os.Open(local.LocalPath(book.StoragePath))
	if err != nil {
		return nil, fmt.Errorf("open original: %w: %w", storage.ErrUnavailable, err)
	}
	if err := verify(ctx, file, book.SizeBytes, book.SHA256); err != nil {
		file.Close()
		return nil, fmt.Errorf("verify original: %w: %w", storage.ErrUnavailable, err)
	}
	return &BookLease{File: file}, nil
}

// Opening is deferred until save has reserved the full expected workspace size.
type originalReader struct {
	ctx       context.Context
	originals Originals
	location  string
	stream    io.ReadCloser
	stop      func() bool
}

func (r *originalReader) Read(p []byte) (int, error) {
	if r.stream == nil {
		var err error
		r.stream, err = r.originals.Open(r.ctx, r.location)
		if err != nil {
			return 0, err
		}
		r.stop = context.AfterFunc(r.ctx, func() { r.stream.Close() })
	}
	return r.stream.Read(p)
}

func (r *originalReader) Close() error {
	if r.stop != nil {
		r.stop()
	}
	if r.stream != nil {
		return r.stream.Close()
	}
	return nil
}

func verify(ctx context.Context, file *os.File, size int64, expected string) error {
	if size < 0 || len(expected) != 64 {
		return fmt.Errorf("invalid original integrity metadata")
	}
	hash := sha256.New()
	written, err := io.Copy(hash, io.LimitReader(contextReader{ctx, file}, size+1))
	if err != nil {
		return err
	}
	if written != size || hex.EncodeToString(hash.Sum(nil)) != expected {
		return fmt.Errorf("original size or SHA-256 mismatch")
	}
	_, err = file.Seek(0, io.SeekStart)
	return err
}

type contextReader struct {
	ctx context.Context
	io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.Reader.Read(p)
}
