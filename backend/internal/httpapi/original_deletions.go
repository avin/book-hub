package httpapi

import (
	"context"
	"time"
)

// RunOriginalDeletions processes durable tasks until the server is stopped.
// Request handlers only change the library; an unavailable original cannot undo a deletion.
func (s *Server) RunOriginalDeletions(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		if err := s.store.ProcessOriginalDeletions(ctx, s.files.Books.Delete); err != nil && ctx.Err() == nil {
			s.logger.Warn("original deletion will be retried", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
