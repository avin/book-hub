package files

import (
	"context"
	"fmt"
	"io"
	"os"

	"book-hub/internal/domain"
	"book-hub/internal/storage"
)

// BookLease holds the local file until the HTTP response has finished.
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
	return s.reads.open(ctx, book, s.fetchBook, s.cache)
}

func (s Store) fetchBook(ctx context.Context, book domain.Book) (*BookLease, error) {
	if s.cache != nil {
		lease, handled, err := s.cache.open(ctx, book, func() (io.ReadCloser, error) {
			return s.Books.Open(ctx, book.StoragePath)
		})
		if handled {
			return lease, err
		}
	}
	return s.openOriginal(ctx, book)
}

func (s Store) openOriginal(ctx context.Context, book domain.Book) (*BookLease, error) {
	local, ok := s.Books.(interface{ LocalPath(string) string })
	if !ok {
		source := &originalReader{ctx: ctx, originals: s.Books, location: book.StoragePath}
		defer source.Close()
		temp, err := s.Work.save(ctx, source, book.SizeBytes, book.SizeBytes)
		if err != nil {
			return nil, fmt.Errorf("receive original: %w: %w", storage.ErrUnavailable, err)
		}
		if temp.Size != book.SizeBytes {
			temp.Release()
			return nil, fmt.Errorf("original size mismatch: %w", storage.ErrUnavailable)
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
	info, err := file.Stat()
	if err == nil && (!info.Mode().IsRegular() || info.Size() != book.SizeBytes) {
		err = fmt.Errorf("original must be a regular file of size %d", book.SizeBytes)
	}
	if err != nil {
		file.Close()
		return nil, fmt.Errorf("stat original: %w: %w", storage.ErrUnavailable, err)
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
