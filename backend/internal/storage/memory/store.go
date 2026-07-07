package memory

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"sync"
	"time"

	"book-hub/internal/domain"
	"book-hub/internal/storage"
	"github.com/google/uuid"
)

type Store struct {
	mu       sync.Mutex
	users    map[uuid.UUID]domain.UserWithPassword
	files    map[uuid.UUID]domain.BookFile
	fileHash map[string]uuid.UUID
	books    map[uuid.UUID]bookRecord
	sessions map[string]sessionRecord
	settings map[uuid.UUID]json.RawMessage
	progress map[uuid.UUID]domain.ReadingProgress
}

type bookRecord struct {
	UserID     uuid.UUID
	BookFileID uuid.UUID
	Book       domain.Book
}

type sessionRecord struct {
	UserID    uuid.UUID
	ExpiresAt time.Time
	RevokedAt *time.Time
}

func New() *Store {
	return &Store{
		users:    make(map[uuid.UUID]domain.UserWithPassword),
		files:    make(map[uuid.UUID]domain.BookFile),
		fileHash: make(map[string]uuid.UUID),
		books:    make(map[uuid.UUID]bookRecord),
		sessions: make(map[string]sessionRecord),
		settings: make(map[uuid.UUID]json.RawMessage),
		progress: make(map[uuid.UUID]domain.ReadingProgress),
	}
}

func (s *Store) Ping(context.Context) error { return nil }
func (s *Store) Close()                     {}

func (s *Store) CreateUser(_ context.Context, login, passwordHash string, active bool, quotaBytes int64) (domain.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, user := range s.users {
		if strings.EqualFold(user.Login, login) {
			return domain.User{}, domain.ErrValidation
		}
	}
	now := time.Now().UTC()
	user := domain.UserWithPassword{
		User: domain.User{
			ID:         uuid.New(),
			Login:      login,
			IsActive:   active,
			QuotaBytes: quotaBytes,
			CreatedAt:  now,
		},
		PasswordHash: passwordHash,
	}
	s.users[user.ID] = user
	return user.User, nil
}

func (s *Store) GetUser(_ context.Context, userID uuid.UUID) (domain.UserWithPassword, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	user, ok := s.users[userID]
	if !ok {
		return domain.UserWithPassword{}, domain.ErrNotFound
	}
	user.UsedBytes = s.usedBytesLocked(userID)
	return user, nil
}

func (s *Store) GetUserByLogin(_ context.Context, login string) (domain.UserWithPassword, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, user := range s.users {
		if strings.EqualFold(user.Login, login) {
			user.UsedBytes = s.usedBytesLocked(user.ID)
			return user, nil
		}
	}
	return domain.UserWithPassword{}, domain.ErrNotFound
}

func (s *Store) SetUserActive(_ context.Context, userID uuid.UUID, active bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	user, ok := s.users[userID]
	if !ok {
		return domain.ErrNotFound
	}
	user.IsActive = active
	s.users[userID] = user
	if !active {
		now := time.Now().UTC()
		for token, session := range s.sessions {
			if session.UserID == userID {
				session.RevokedAt = &now
				s.sessions[token] = session
			}
		}
	}
	return nil
}

func (s *Store) SetUserPassword(_ context.Context, userID uuid.UUID, passwordHash string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	user, ok := s.users[userID]
	if !ok {
		return domain.ErrNotFound
	}
	user.PasswordHash = passwordHash
	s.users[userID] = user
	return nil
}

func (s *Store) SetUserQuota(_ context.Context, userID uuid.UUID, quotaBytes int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	user, ok := s.users[userID]
	if !ok {
		return domain.ErrNotFound
	}
	if quotaBytes < s.usedBytesLocked(userID) {
		return domain.ErrQuotaExceeded
	}
	user.QuotaBytes = quotaBytes
	s.users[userID] = user
	return nil
}

func (s *Store) DeleteUser(_ context.Context, userID uuid.UUID) ([]domain.DeletedBookFiles, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[userID]; !ok {
		return nil, domain.ErrNotFound
	}
	var deleted []domain.DeletedBookFiles
	for bookID, record := range s.books {
		if record.UserID != userID {
			continue
		}
		delete(s.progress, bookID)
		delete(s.books, bookID)
		files := domain.DeletedBookFiles{}
		if record.Book.CoverPath != nil {
			files.CoverPath = *record.Book.CoverPath
		}
		if record.Book.CoverThumbPath != nil {
			files.CoverThumbPath = *record.Book.CoverThumbPath
		}
		if s.fileRefCountLocked(record.BookFileID) == 0 {
			if file, ok := s.files[record.BookFileID]; ok {
				files.BookPath = file.StoragePath
				delete(s.fileHash, file.SHA256)
				delete(s.files, record.BookFileID)
			}
		}
		deleted = append(deleted, files)
	}
	for token, session := range s.sessions {
		if session.UserID == userID {
			delete(s.sessions, token)
		}
	}
	delete(s.settings, userID)
	delete(s.users, userID)
	return deleted, nil
}

func (s *Store) ListUsers(context.Context) ([]domain.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	users := make([]domain.User, 0, len(s.users))
	for _, user := range s.users {
		user.UsedBytes = s.usedBytesLocked(user.ID)
		users = append(users, user.User)
	}
	sort.Slice(users, func(i, j int) bool { return users[i].Login < users[j].Login })
	return users, nil
}

func (s *Store) UsedBytes(_ context.Context, userID uuid.UUID) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[userID]; !ok {
		return 0, domain.ErrNotFound
	}
	return s.usedBytesLocked(userID), nil
}

func (s *Store) CreateSession(_ context.Context, userID uuid.UUID, tokenHash string, ttlSeconds int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[userID]; !ok {
		return domain.ErrNotFound
	}
	s.sessions[tokenHash] = sessionRecord{UserID: userID, ExpiresAt: time.Now().UTC().Add(time.Duration(ttlSeconds) * time.Second)}
	return nil
}

func (s *Store) GetSession(_ context.Context, tokenHash string) (uuid.UUID, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[tokenHash]
	if !ok || session.RevokedAt != nil || time.Now().UTC().After(session.ExpiresAt) {
		return uuid.Nil, domain.ErrUnauthorized
	}
	user, ok := s.users[session.UserID]
	if !ok || !user.IsActive {
		return uuid.Nil, domain.ErrUnauthorized
	}
	return session.UserID, nil
}

func (s *Store) RevokeSession(_ context.Context, tokenHash string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[tokenHash]
	if !ok {
		return nil
	}
	now := time.Now().UTC()
	session.RevokedAt = &now
	s.sessions[tokenHash] = session
	return nil
}

func (s *Store) RevokeUserSessions(_ context.Context, userID uuid.UUID, exceptTokenHash *string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	for token, session := range s.sessions {
		if session.UserID == userID && (exceptTokenHash == nil || token != *exceptTokenHash) {
			session.RevokedAt = &now
			s.sessions[token] = session
		}
	}
	return nil
}

func (s *Store) GetSettings(_ context.Context, userID uuid.UUID) (json.RawMessage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[userID]; !ok {
		return nil, domain.ErrNotFound
	}
	if settings, ok := s.settings[userID]; ok {
		return cloneJSON(settings), nil
	}
	return json.RawMessage(`{}`), nil
}

func (s *Store) PutSettings(_ context.Context, userID uuid.UUID, settings json.RawMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[userID]; !ok {
		return domain.ErrNotFound
	}
	s.settings[userID] = cloneJSON(settings)
	return nil
}

func (s *Store) GetBookFileByHash(_ context.Context, sha256 string) (*domain.BookFile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, ok := s.fileHash[sha256]
	if !ok {
		return nil, nil
	}
	file := s.files[id]
	return &file, nil
}

func (s *Store) UserHasBookFile(_ context.Context, userID, bookFileID uuid.UUID) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, record := range s.books {
		if record.UserID == userID && record.BookFileID == bookFileID {
			return true, nil
		}
	}
	return false, nil
}

func (s *Store) CreateBook(_ context.Context, userID uuid.UUID, fileInput domain.BookFileInput, bookInput domain.BookInput) (domain.Book, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[userID]; !ok {
		return domain.Book{}, domain.ErrNotFound
	}
	fileID := fileInput.ID
	if fileID == uuid.Nil {
		fileID = uuid.New()
		s.files[fileID] = domain.BookFile{
			ID:          fileID,
			SHA256:      fileInput.SHA256,
			StoragePath: fileInput.StoragePath,
			SizeBytes:   fileInput.SizeBytes,
			Format:      fileInput.Format,
			CreatedAt:   time.Now().UTC(),
		}
		s.fileHash[fileInput.SHA256] = fileID
	}
	for _, record := range s.books {
		if record.UserID == userID && record.BookFileID == fileID {
			return domain.Book{}, domain.ErrDuplicateBook
		}
	}
	file := s.files[fileID]
	now := time.Now().UTC()
	book := domain.Book{
		ID:              uuid.New(),
		Title:           domain.NormalizeTitle(bookInput.Title),
		Tags:            domain.NormalizeTags(bookInput.Tags),
		Favorite:        bookInput.Favorite,
		Format:          file.Format,
		SizeBytes:       file.SizeBytes,
		ProgressPercent: 0,
		StoragePath:     file.StoragePath,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	s.books[book.ID] = bookRecord{UserID: userID, BookFileID: fileID, Book: book}
	return book, nil
}

func (s *Store) QueryBooks(_ context.Context, userID uuid.UUID, query domain.BookQuery) (domain.BookPage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	items := make([]domain.Book, 0)
	for id, record := range s.books {
		if record.UserID != userID || !matchesQuery(record.Book, query) {
			continue
		}
		book := record.Book
		if progress, ok := s.progress[id]; ok {
			book.ProgressPercent = progress.ProgressPercent
		}
		items = append(items, book)
	}
	sortBooks(items, query.Sort)
	total := int64(len(items))
	end := min(query.Offset+query.Limit, len(items))
	if query.Offset > len(items) {
		items = nil
	} else {
		items = items[query.Offset:end]
	}
	return domain.BookPage{Items: items, Total: total, Limit: query.Limit, Offset: query.Offset}, nil
}

func (s *Store) ListBookTags(_ context.Context, userID uuid.UUID) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	tagsSet := make(map[string]struct{})
	for _, record := range s.books {
		if record.UserID != userID {
			continue
		}
		for _, tag := range record.Book.Tags {
			tagsSet[tag] = struct{}{}
		}
	}
	tags := make([]string, 0, len(tagsSet))
	for tag := range tagsSet {
		tags = append(tags, tag)
	}
	sort.Strings(tags)
	return tags, nil
}

func (s *Store) GetBook(_ context.Context, userID, bookID uuid.UUID) (domain.Book, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.getBookLocked(userID, bookID)
}

func (s *Store) UpdateBook(_ context.Context, userID, bookID uuid.UUID, patch storage.BookPatch) (domain.Book, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.books[bookID]
	if !ok || record.UserID != userID {
		return domain.Book{}, domain.ErrNotFound
	}
	if patch.Title != nil {
		record.Book.Title = domain.NormalizeTitle(*patch.Title)
	}
	if patch.Tags != nil {
		record.Book.Tags = domain.NormalizeTags(*patch.Tags)
	}
	if patch.Favorite != nil {
		record.Book.Favorite = *patch.Favorite
	}
	record.Book.UpdatedAt = time.Now().UTC()
	s.books[bookID] = record
	return record.Book, nil
}

func (s *Store) DeleteBook(_ context.Context, userID, bookID uuid.UUID) (domain.DeletedBookFiles, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.books[bookID]
	if !ok || record.UserID != userID {
		return domain.DeletedBookFiles{}, domain.ErrNotFound
	}
	delete(s.progress, bookID)
	delete(s.books, bookID)
	files := domain.DeletedBookFiles{}
	if record.Book.CoverPath != nil {
		files.CoverPath = *record.Book.CoverPath
	}
	if record.Book.CoverThumbPath != nil {
		files.CoverThumbPath = *record.Book.CoverThumbPath
	}
	if s.fileRefCountLocked(record.BookFileID) == 0 {
		file := s.files[record.BookFileID]
		files.BookPath = file.StoragePath
		delete(s.fileHash, file.SHA256)
		delete(s.files, record.BookFileID)
	}
	return files, nil
}

func (s *Store) SetCover(_ context.Context, userID, bookID uuid.UUID, coverFiles domain.CoverFiles) (domain.CoverFiles, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.books[bookID]
	if !ok || record.UserID != userID {
		return domain.CoverFiles{}, domain.ErrNotFound
	}
	old := domain.CoverFiles{}
	if record.Book.CoverPath != nil {
		old.CoverPath = *record.Book.CoverPath
	}
	if record.Book.CoverThumbPath != nil {
		old.CoverThumbPath = *record.Book.CoverThumbPath
	}
	record.Book.CoverPath = &coverFiles.CoverPath
	record.Book.CoverThumbPath = &coverFiles.CoverThumbPath
	record.Book.UpdatedAt = time.Now().UTC()
	s.books[bookID] = record
	return old, nil
}

func (s *Store) DeleteCover(_ context.Context, userID, bookID uuid.UUID) (domain.CoverFiles, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.books[bookID]
	if !ok || record.UserID != userID {
		return domain.CoverFiles{}, domain.ErrNotFound
	}
	old := domain.CoverFiles{}
	if record.Book.CoverPath != nil {
		old.CoverPath = *record.Book.CoverPath
	}
	if record.Book.CoverThumbPath != nil {
		old.CoverThumbPath = *record.Book.CoverThumbPath
	}
	record.Book.CoverPath = nil
	record.Book.CoverThumbPath = nil
	record.Book.UpdatedAt = time.Now().UTC()
	s.books[bookID] = record
	return old, nil
}

func (s *Store) GetProgress(_ context.Context, userID, bookID uuid.UUID) (domain.ReadingProgress, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.getBookLocked(userID, bookID); err != nil {
		return domain.ReadingProgress{}, err
	}
	if progress, ok := s.progress[bookID]; ok {
		return progress, nil
	}
	return domain.ReadingProgress{ProgressPercent: 0, UpdatedAt: nil}, nil
}

func (s *Store) PutProgress(_ context.Context, userID, bookID uuid.UUID, progressPercent float64) (domain.ReadingProgress, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.getBookLocked(userID, bookID); err != nil {
		return domain.ReadingProgress{}, err
	}
	now := time.Now().UTC()
	progress := domain.ReadingProgress{ProgressPercent: progressPercent, UpdatedAt: &now}
	s.progress[bookID] = progress
	return progress, nil
}

func (s *Store) DeleteProgress(_ context.Context, userID, bookID uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.getBookLocked(userID, bookID); err != nil {
		return err
	}
	delete(s.progress, bookID)
	return nil
}

func (s *Store) getBookLocked(userID, bookID uuid.UUID) (domain.Book, error) {
	record, ok := s.books[bookID]
	if !ok || record.UserID != userID {
		return domain.Book{}, domain.ErrNotFound
	}
	book := record.Book
	if progress, ok := s.progress[bookID]; ok {
		book.ProgressPercent = progress.ProgressPercent
	}
	return book, nil
}

func (s *Store) usedBytesLocked(userID uuid.UUID) int64 {
	var used int64
	for _, record := range s.books {
		if record.UserID == userID {
			used += record.Book.SizeBytes
		}
	}
	return used
}

func (s *Store) fileRefCountLocked(fileID uuid.UUID) int {
	count := 0
	for _, record := range s.books {
		if record.BookFileID == fileID {
			count++
		}
	}
	return count
}

func matchesQuery(book domain.Book, query domain.BookQuery) bool {
	if query.Favorite != nil && book.Favorite != *query.Favorite {
		return false
	}
	if query.Q != "" && !strings.Contains(strings.ToLower(book.Title), strings.ToLower(query.Q)) {
		return false
	}
	for _, tag := range query.Tags {
		found := false
		for _, bookTag := range book.Tags {
			if strings.EqualFold(tag, bookTag) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func sortBooks(items []domain.Book, sortName string) {
	sort.SliceStable(items, func(i, j int) bool {
		a := items[i]
		b := items[j]
		switch sortName {
		case "created_at_asc":
			return a.CreatedAt.Before(b.CreatedAt)
		case "title_asc":
			return strings.ToLower(a.Title) < strings.ToLower(b.Title)
		case "title_desc":
			return strings.ToLower(a.Title) > strings.ToLower(b.Title)
		case "updated_at_asc":
			return a.UpdatedAt.Before(b.UpdatedAt)
		case "updated_at_desc":
			return a.UpdatedAt.After(b.UpdatedAt)
		case "progress_asc":
			return a.ProgressPercent < b.ProgressPercent
		case "progress_desc":
			return a.ProgressPercent > b.ProgressPercent
		default:
			return a.CreatedAt.After(b.CreatedAt)
		}
	})
}

func cloneJSON(value json.RawMessage) json.RawMessage {
	cloned := make([]byte, len(value))
	copy(cloned, value)
	return cloned
}
