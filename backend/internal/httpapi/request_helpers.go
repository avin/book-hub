package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"book-hub/internal/auth"
	"book-hub/internal/domain"
	"book-hub/internal/storage/files"
	"github.com/google/uuid"
)

func (s *Server) requireCSRF(r *http.Request) error {
	header := r.Header.Get("X-CSRF-Token")
	cookie, err := r.Cookie(csrfCookieName)
	if err != nil || header == "" || cookie.Value == "" || header != cookie.Value || !s.csrf.Verify(header) {
		return domain.ErrCSRFInvalid
	}
	return nil
}

func (s *Server) currentUser(r *http.Request) (domain.UserWithPassword, error) {
	userID, err := s.requireUserID(r)
	if err != nil {
		return domain.UserWithPassword{}, err
	}
	user, err := s.store.GetUser(r.Context(), userID)
	if err != nil {
		return domain.UserWithPassword{}, err
	}
	if !user.IsActive {
		return domain.UserWithPassword{}, domain.ErrUnauthorized
	}
	return user, nil
}

func (s *Server) requireUserID(r *http.Request) (uuid.UUID, error) {
	tokenHash := s.sessionHash(r)
	if tokenHash == "" {
		return uuid.Nil, domain.ErrUnauthorized
	}
	userID, err := s.store.GetSession(r.Context(), tokenHash)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return uuid.Nil, domain.ErrUnauthorized
		}
		return uuid.Nil, err
	}
	return userID, nil
}

func (s *Server) sessionHash(r *http.Request) string {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		return ""
	}
	return auth.HashSessionToken(cookie.Value)
}

func (s *Server) userAndBookID(r *http.Request) (uuid.UUID, uuid.UUID, error) {
	userID, err := s.requireUserID(r)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	bookID, err := uuid.Parse(r.PathValue("book_id"))
	if err != nil {
		return uuid.Nil, uuid.Nil, domain.ErrNotFound
	}
	return userID, bookID, nil
}

func (s *Server) getOwnedBook(r *http.Request) (domain.Book, error) {
	userID, bookID, err := s.userAndBookID(r)
	if err != nil {
		return domain.Book{}, err
	}
	return s.store.GetBook(r.Context(), userID, bookID)
}

func (s *Server) setSessionCookie(w http.ResponseWriter, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     s.cfg.BasePath,
		Expires:  expires,
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) expireSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     s.cfg.BasePath,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func decodeJSON(r *http.Request, target any, limit int64) error {
	reader := io.LimitReader(r.Body, limit+1)
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return domain.ErrValidation
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return domain.ErrValidation
	}
	return nil
}

func firstFormValue(r *http.Request, key string) string {
	if r.MultipartForm == nil {
		return ""
	}
	values := r.MultipartForm.Value[key]
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func deleteCoverFiles(coverFiles domain.CoverFiles) {
	files.DeleteBestEffort(coverFiles.CoverPath)
	files.DeleteBestEffort(coverFiles.CoverThumbPath)
}

func hasPathPrefix(path, prefix string) bool {
	return path == prefix || strings.HasPrefix(path, strings.TrimRight(prefix, "/")+"/")
}
