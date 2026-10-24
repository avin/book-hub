package files

import (
	"context"
	"fmt"
	"os"
	"sync"

	"book-hub/internal/domain"
	"book-hub/internal/storage"
)

// bookReads shares a verified result while requests wait for or serve it.
// Its base lease retains the cache pin or workspace reservation; each response
// opens its own file so ranges and seeks cannot affect another response.
type bookReads struct {
	mu      sync.Mutex
	flights map[string]*bookFlight
}

type bookFlight struct {
	done, released      chan struct{}
	cancel              context.CancelFunc
	refs                int
	complete, abandoned bool
	lease               *BookLease
	err                 error
}

func (r *bookReads) open(ctx context.Context, book domain.Book, fetch func(context.Context, domain.Book) (*BookLease, error), cache *bookCache) (*BookLease, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		r.mu.Lock()
		flight := r.flights[book.SHA256]
		if flight != nil && flight.abandoned {
			r.mu.Unlock()
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-flight.released:
			}
			continue
		}
		if flight == nil {
			shared, cancel := context.WithCancel(context.WithoutCancel(ctx))
			flight = &bookFlight{done: make(chan struct{}), released: make(chan struct{}), cancel: cancel}
			r.flights[book.SHA256] = flight
			go r.fetch(shared, book, flight, fetch)
		}
		flight.refs++
		r.mu.Unlock()
		select {
		case <-ctx.Done():
			r.release(book.SHA256, flight)
			return nil, ctx.Err()
		case <-flight.done:
		}
		if err := ctx.Err(); err != nil {
			r.release(book.SHA256, flight)
			return nil, err
		}
		r.mu.Lock()
		err := flight.err
		var file *os.File
		if err == nil {
			file, err = os.Open(flight.lease.Name())
		}
		r.mu.Unlock()
		if err != nil {
			r.release(book.SHA256, flight)
			return nil, fmt.Errorf("open shared original: %w: %w", storage.ErrUnavailable, err)
		}
		if cache != nil {
			cache.touch(book.SHA256)
		}
		var once sync.Once
		return &BookLease{File: file, release: func() { once.Do(func() { r.release(book.SHA256, flight) }) }}, nil
	}
}

func (r *bookReads) fetch(ctx context.Context, book domain.Book, flight *bookFlight, fetch func(context.Context, domain.Book) (*BookLease, error)) {
	lease, err := fetch(ctx, book)
	flight.cancel()
	r.mu.Lock()
	flight.lease, flight.err, flight.complete = lease, err, true
	if flight.refs == 0 {
		r.mu.Unlock()
		if lease != nil {
			lease.Close()
		}
		r.mu.Lock()
		r.remove(book.SHA256, flight)
		close(flight.done)
		close(flight.released)
	} else {
		// A failed receive already released its resources, so a retry may start
		// even while previous clients are consuming the common error.
		if err != nil {
			r.remove(book.SHA256, flight)
		}
		close(flight.done)
	}
	r.mu.Unlock()
}

func (r *bookReads) release(hash string, flight *bookFlight) {
	r.mu.Lock()
	flight.refs--
	if flight.refs != 0 {
		r.mu.Unlock()
		return
	}
	flight.abandoned = true
	if !flight.complete {
		flight.cancel()
		r.mu.Unlock()
		return
	}
	lease := flight.lease
	r.mu.Unlock()
	if lease != nil {
		lease.Close()
	}
	r.mu.Lock()
	r.remove(hash, flight)
	close(flight.released)
	r.mu.Unlock()
}

func (r *bookReads) remove(hash string, flight *bookFlight) {
	if r.flights[hash] == flight {
		delete(r.flights, hash)
	}
}
