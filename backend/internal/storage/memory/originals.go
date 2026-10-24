package memory

import (
	"context"
	"errors"
)

func (s *Store) ProcessOriginalDeletions(ctx context.Context, remove func(context.Context, string) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var failures []error
	for hash, location := range s.deletions {
		id := s.fileHash[hash]
		if s.fileRefCountLocked(id) == 0 {
			if err := remove(ctx, location); err != nil {
				failures = append(failures, err)
				continue
			}
			delete(s.files, id)
			delete(s.fileHash, hash)
		}
		delete(s.deletions, hash)
	}
	return errors.Join(failures...)
}
