package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"book-hub/internal/auth"
	"book-hub/internal/config"
	"book-hub/internal/domain"
	"book-hub/internal/storage"
	"book-hub/internal/storage/files"
	"github.com/google/uuid"
)

const (
	sessionCookieName = "book_hub_session"
	csrfCookieName    = "book_hub_csrf"
	requestIDHeader   = "X-Request-Id"
)

type Server struct {
	cfg     config.Config
	store   storage.Store
	files   files.Store
	csrf    auth.CSRFManager
	logger  *slog.Logger
	handler http.Handler
}

type contextKey string

const userIDKey contextKey = "user_id"

func New(cfg config.Config, store storage.Store, fileStore files.Store, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	server := &Server{
		cfg:    cfg,
		store:  store,
		files:  fileStore,
		csrf:   auth.NewCSRFManager(cfg.SessionSecret),
		logger: logger,
	}
	server.handler = server.buildHandler()
	return server
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.handler.ServeHTTP(w, r)
}

func (s *Server) buildHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/auth/csrf", s.handleGetCSRF)
	mux.HandleFunc("POST /v1/auth/register", s.handleRegister)
	mux.HandleFunc("POST /v1/auth/login", s.handleLogin)
	mux.HandleFunc("POST /v1/auth/logout", s.handleLogout)
	mux.HandleFunc("GET /v1/me", s.handleMe)
	mux.HandleFunc("PUT /v1/me/password", s.handleChangePassword)
	mux.HandleFunc("GET /v1/me/settings", s.handleGetSettings)
	mux.HandleFunc("PUT /v1/me/settings", s.handlePutSettings)
	mux.HandleFunc("DELETE /v1/me/progress", s.handleDeleteAllProgress)
	mux.HandleFunc("POST /v1/books/query", s.handleQueryBooks)
	mux.HandleFunc("GET /v1/books/tags", s.handleListBookTags)
	mux.HandleFunc("POST /v1/books", s.handleUploadBook)
	mux.HandleFunc("GET /v1/books/{book_id}", s.handleGetBook)
	mux.HandleFunc("PATCH /v1/books/{book_id}", s.handlePatchBook)
	mux.HandleFunc("DELETE /v1/books/{book_id}", s.handleDeleteBook)
	mux.HandleFunc("GET /v1/books/{book_id}/file", s.handleDownloadBook)
	mux.HandleFunc("PUT /v1/books/{book_id}/cover", s.handleUploadCover)
	mux.HandleFunc("GET /v1/books/{book_id}/cover", s.handleGetCover)
	mux.HandleFunc("DELETE /v1/books/{book_id}/cover", s.handleDeleteCover)
	mux.HandleFunc("GET /v1/books/{book_id}/progress", s.handleGetProgress)
	mux.HandleFunc("PUT /v1/books/{book_id}/progress", s.handlePutProgress)
	mux.HandleFunc("DELETE /v1/books/{book_id}/progress", s.handleDeleteProgress)
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("GET /readyz", s.handleReady)

	apiPath := config.APIBasePath(s.cfg.BasePath)
	return s.withRequestID(http.StripPrefix(apiPath, mux), apiPath)
}

func (s *Server) withRequestID(next http.Handler, apiPath string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !hasPathPrefix(r.URL.Path, apiPath) {
			http.NotFound(w, r)
			return
		}
		requestID := uuid.NewString()
		w.Header().Set(requestIDHeader, requestID)
		ctx := context.WithValue(r.Context(), contextKey("request_id"), requestID)
		start := time.Now()
		next.ServeHTTP(w, r.WithContext(ctx))
		s.logger.InfoContext(ctx, "http request", "method", r.Method, "path", r.URL.Path, "request_id", requestID, "duration_ms", time.Since(start).Milliseconds())
	})
}

func (s *Server) handleGetCSRF(w http.ResponseWriter, r *http.Request) {
	token, err := s.csrf.NewToken()
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     csrfCookieName,
		Value:    token,
		Path:     s.cfg.BasePath,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
	s.writeJSON(w, http.StatusOK, map[string]string{"csrf_token": token})
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	if !s.cfg.RegistrationEnabled {
		s.writeError(w, r, domain.ErrRegistrationDisabled)
		return
	}
	var req loginRequest
	if err := decodeJSON(r, &req, 1<<20); err != nil {
		s.writeError(w, r, err)
		return
	}
	login, err := domain.NormalizeLogin(req.Login)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if err := domain.ValidatePassword(req.Password); err != nil {
		s.writeError(w, r, err)
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	user, err := s.store.CreateUser(r.Context(), login, hash, s.cfg.RegistrationAutoActivate, s.cfg.DefaultQuotaBytes)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusCreated, map[string]any{"user_id": user.ID, "is_active": user.IsActive})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	var req loginRequest
	if err := decodeJSON(r, &req, 1<<20); err != nil {
		s.writeError(w, r, err)
		return
	}
	login, err := domain.NormalizeLogin(req.Login)
	if err != nil {
		s.writeError(w, r, domain.ErrInvalidCredentials)
		return
	}
	user, err := s.store.GetUserByLogin(r.Context(), login)
	if err != nil || !auth.VerifyPassword(req.Password, user.PasswordHash) {
		s.writeError(w, r, domain.ErrInvalidCredentials)
		return
	}
	if !user.IsActive {
		s.writeError(w, r, domain.ErrAccountInactive)
		return
	}
	token, tokenHash, err := auth.NewSessionToken()
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if err := s.store.CreateSession(r.Context(), user.ID, tokenHash, int64(s.cfg.SessionTTL.Seconds())); err != nil {
		s.writeError(w, r, err)
		return
	}
	s.setSessionCookie(w, token, time.Now().Add(s.cfg.SessionTTL))
	s.writeJSON(w, http.StatusOK, map[string]any{"user": userResponse(user.User)})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	if cookie, err := r.Cookie(sessionCookieName); err == nil && cookie.Value != "" {
		_ = s.store.RevokeSession(r.Context(), auth.HashSessionToken(cookie.Value))
	}
	s.expireSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	user, err := s.currentUser(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, userResponse(user.User))
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	user, err := s.currentUser(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	var req changePasswordRequest
	if err := decodeJSON(r, &req, 1<<20); err != nil {
		s.writeError(w, r, err)
		return
	}
	if !auth.VerifyPassword(req.CurrentPassword, user.PasswordHash) {
		s.writeError(w, r, domain.ErrInvalidCredentials)
		return
	}
	if err := domain.ValidatePassword(req.NewPassword); err != nil {
		s.writeError(w, r, err)
		return
	}
	hash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	sessionHash := s.sessionHash(r)
	if err := s.store.SetUserPassword(r.Context(), user.ID, hash); err != nil {
		s.writeError(w, r, err)
		return
	}
	if err := s.store.RevokeUserSessions(r.Context(), user.ID, &sessionHash); err != nil {
		s.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	userID, err := s.requireUserID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	settings, err := s.store.GetSettings(r.Context(), userID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeRawJSON(w, http.StatusOK, settings)
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	userID, err := s.requireUserID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, domain.MaxSettingsBytes+1))
	if err != nil || len(body) > domain.MaxSettingsBytes {
		s.writeError(w, r, domain.ErrValidation)
		return
	}
	var object map[string]any
	if err := json.Unmarshal(body, &object); err != nil || object == nil {
		s.writeError(w, r, domain.ErrValidation)
		return
	}
	if err := s.store.PutSettings(r.Context(), userID, body); err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeRawJSON(w, http.StatusOK, body)
}

func (s *Server) handleQueryBooks(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	userID, err := s.requireUserID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	var req bookQueryRequest
	if err := decodeJSON(r, &req, 1<<20); err != nil {
		s.writeError(w, r, err)
		return
	}
	query := domain.BookQuery{Limit: 50, Offset: 0, Sort: req.Sort, Tags: req.Tags, Favorite: req.Favorite, Q: req.Q}
	if req.Limit != nil {
		query.Limit = *req.Limit
	}
	if req.Offset != nil {
		query.Offset = *req.Offset
	}
	query, err = domain.NormalizeBookQuery(query)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	page, err := s.store.QueryBooks(r.Context(), userID, query)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	items := make([]bookResponse, 0, len(page.Items))
	for _, book := range page.Items {
		items = append(items, bookDTO(book))
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": page.Total, "limit": page.Limit, "offset": page.Offset})
}

func (s *Server) handleListBookTags(w http.ResponseWriter, r *http.Request) {
	userID, err := s.requireUserID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	tags, err := s.store.ListBookTags(r.Context(), userID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, tagsResponse{Items: tags})
}

func (s *Server) handleUploadBook(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	user, err := s.currentUser(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxUploadBytes+10*1024)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		s.writeError(w, r, domain.ErrValidation)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		s.writeError(w, r, domain.ErrValidation)
		return
	}
	defer file.Close()

	format, err := domain.NormalizeBookFormat(header.Filename)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	title := firstFormValue(r, "title")
	if title == "" {
		title = domain.TitleFromFilename(header.Filename)
	}
	favorite, _ := strconv.ParseBool(firstFormValue(r, "favorite"))
	temp, err := s.files.SaveTemp(file, s.cfg.MaxUploadBytes)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	defer os.Remove(temp.Path)

	existingFile, err := s.store.GetBookFileByHash(r.Context(), temp.SHA256)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if existingFile != nil && existingFile.Format != format {
		s.writeError(w, r, domain.ErrUnsupportedFormat)
		return
	}
	if existingFile != nil {
		exists, err := s.store.UserHasBookFile(r.Context(), user.ID, existingFile.ID)
		if err != nil {
			s.writeError(w, r, err)
			return
		}
		if exists {
			s.writeError(w, r, domain.ErrDuplicateBook)
			return
		}
	}
	if user.UsedBytes+temp.Size > user.QuotaBytes {
		s.writeError(w, r, domain.ErrQuotaExceeded)
		return
	}

	fileInput := domain.BookFileInput{SHA256: temp.SHA256, SizeBytes: temp.Size, Format: format}
	movedNewFile := false
	if existingFile != nil {
		fileInput.ID = existingFile.ID
		fileInput.StoragePath = existingFile.StoragePath
	} else {
		finalPath, err := s.files.MoveBook(temp.Path, temp.SHA256, format)
		if err != nil {
			s.writeError(w, r, err)
			return
		}
		movedNewFile = true
		fileInput.StoragePath = finalPath
	}
	book, err := s.store.CreateBook(r.Context(), user.ID, fileInput, domain.BookInput{
		Title:    title,
		Tags:     r.MultipartForm.Value["tags"],
		Favorite: favorite,
	})
	if err != nil {
		if movedNewFile {
			files.DeleteBestEffort(fileInput.StoragePath)
		}
		s.writeError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusCreated, bookDTO(book))
}

func (s *Server) handleGetBook(w http.ResponseWriter, r *http.Request) {
	book, err := s.getOwnedBook(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, bookDTO(book))
}

func (s *Server) handlePatchBook(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	userID, bookID, err := s.userAndBookID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	var req bookPatchRequest
	if err := decodeJSON(r, &req, 1<<20); err != nil {
		s.writeError(w, r, err)
		return
	}
	book, err := s.store.UpdateBook(r.Context(), userID, bookID, storage.BookPatch{
		Title:    req.Title,
		Tags:     req.Tags,
		Favorite: req.Favorite,
	})
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, bookDTO(book))
}

func (s *Server) handleDeleteBook(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	userID, bookID, err := s.userAndBookID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	deleted, err := s.store.DeleteBook(r.Context(), userID, bookID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	files.DeleteBestEffort(deleted.CoverPath)
	files.DeleteBestEffort(deleted.CoverThumbPath)
	files.DeleteBestEffort(deleted.BookPath)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDownloadBook(w http.ResponseWriter, r *http.Request) {
	book, err := s.getOwnedBook(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	contentType := "application/xml"
	if book.Format == "pdf" {
		contentType = "application/pdf"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", `inline; filename="`+sanitizeFilename(book.Title)+"."+book.Format+`"`)
	http.ServeFile(w, r, book.StoragePath)
}

func (s *Server) handleUploadCover(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	userID, bookID, err := s.userAndBookID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if _, err := s.store.GetBook(r.Context(), userID, bookID); err != nil {
		s.writeError(w, r, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxCoverUploadBytes+10*1024)
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		s.writeError(w, r, domain.ErrValidation)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		s.writeError(w, r, domain.ErrValidation)
		return
	}
	defer file.Close()
	format, err := domain.NormalizeCoverFormat(header.Filename)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	coverFiles, err := s.files.SaveCover(bookID.String(), format, file, s.cfg.MaxCoverUploadBytes)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	oldCoverFiles, err := s.store.SetCover(r.Context(), userID, bookID, coverFiles)
	if err != nil {
		deleteCoverFiles(coverFiles)
		s.writeError(w, r, err)
		return
	}
	deleteCoverFiles(oldCoverFiles)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGetCover(w http.ResponseWriter, r *http.Request) {
	book, err := s.getOwnedBook(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if book.CoverPath == nil {
		s.writeError(w, r, domain.ErrNotFound)
		return
	}
	coverPath := *book.CoverPath
	variant, err := domain.NormalizeCoverVariant(r.URL.Query().Get("variant"))
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if variant == "thumbnail" && book.CoverThumbPath != nil {
		coverPath = *book.CoverThumbPath
	}
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(coverPath), "."))
	if ext == "jpg" {
		w.Header().Set("Content-Type", "image/jpeg")
	} else {
		w.Header().Set("Content-Type", mime.TypeByExtension("."+ext))
	}
	w.Header().Set("Content-Disposition", `inline; filename="cover.`+ext+`"`)
	http.ServeFile(w, r, coverPath)
}

func (s *Server) handleDeleteCover(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	userID, bookID, err := s.userAndBookID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	oldCoverFiles, err := s.store.DeleteCover(r.Context(), userID, bookID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	deleteCoverFiles(oldCoverFiles)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGetProgress(w http.ResponseWriter, r *http.Request) {
	userID, bookID, err := s.userAndBookID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	progress, err := s.store.GetProgress(r.Context(), userID, bookID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, progressDTO(progress))
}

func (s *Server) handlePutProgress(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	userID, bookID, err := s.userAndBookID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	var req progressRequest
	if err := decodeJSON(r, &req, 1<<20); err != nil {
		s.writeError(w, r, err)
		return
	}
	if err := domain.ValidateProgress(req.ProgressPercent); err != nil {
		s.writeError(w, r, err)
		return
	}
	progress, err := s.store.PutProgress(r.Context(), userID, bookID, req.ProgressPercent)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, progressDTO(progress))
}

func (s *Server) handleDeleteProgress(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	userID, bookID, err := s.userAndBookID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if err := s.store.DeleteProgress(r.Context(), userID, bookID); err != nil {
		s.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteAllProgress(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	userID, err := s.requireUserID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if err := s.store.DeleteAllProgress(r.Context(), userID); err != nil {
		s.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	s.writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Ping(r.Context()); err != nil {
		s.writeErrorStatus(w, r, http.StatusServiceUnavailable, "service_unavailable", "database is not ready")
		return
	}
	if err := s.files.CheckReady(); err != nil {
		s.writeErrorStatus(w, r, http.StatusServiceUnavailable, "service_unavailable", "storage is not ready")
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

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
		return uuid.Nil, domain.ErrUnauthorized
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

func (s *Server) writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func (s *Server) writeRawJSON(w http.ResponseWriter, status int, value []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(value)
}

func (s *Server) writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := errorStatus(err)
	s.writeErrorStatus(w, r, status, code, message)
}

func (s *Server) writeErrorStatus(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	s.writeJSON(w, status, map[string]any{
		"code":       code,
		"message":    message,
		"request_id": requestID(r),
	})
}

func errorStatus(err error) (int, string, string) {
	switch {
	case errors.Is(err, domain.ErrValidation):
		return http.StatusBadRequest, "validation_error", "invalid request"
	case errors.Is(err, domain.ErrUnauthorized), errors.Is(err, domain.ErrInvalidCredentials):
		return http.StatusUnauthorized, "unauthorized", "unauthorized"
	case errors.Is(err, domain.ErrForbidden):
		return http.StatusForbidden, "forbidden", "forbidden"
	case errors.Is(err, domain.ErrNotFound):
		return http.StatusNotFound, "not_found", "not found"
	case errors.Is(err, domain.ErrQuotaExceeded):
		return http.StatusRequestEntityTooLarge, "quota_exceeded", "quota exceeded"
	case errors.Is(err, domain.ErrUnsupportedFormat):
		return http.StatusBadRequest, "unsupported_format", "unsupported format"
	case errors.Is(err, domain.ErrDuplicateBook):
		return http.StatusConflict, "duplicate_book", "duplicate book"
	case errors.Is(err, domain.ErrAccountInactive):
		return http.StatusForbidden, "account_inactive", "account is inactive"
	case errors.Is(err, domain.ErrRegistrationDisabled):
		return http.StatusForbidden, "registration_disabled", "registration is disabled"
	case errors.Is(err, domain.ErrCSRFInvalid):
		return http.StatusForbidden, "csrf_invalid", "invalid csrf token"
	default:
		return http.StatusInternalServerError, "internal_error", "internal error"
	}
}

func requestID(r *http.Request) string {
	if value, ok := r.Context().Value(contextKey("request_id")).(string); ok {
		return value
	}
	return ""
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

func sanitizeFilename(value string) string {
	value = strings.TrimSpace(value)
	var b strings.Builder
	for _, r := range value {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-' || r == '.' {
			b.WriteRune(r)
		} else if r == ' ' {
			b.WriteRune('_')
		}
	}
	if b.Len() == 0 {
		return "book"
	}
	return b.String()
}

func deleteCoverFiles(coverFiles domain.CoverFiles) {
	files.DeleteBestEffort(coverFiles.CoverPath)
	files.DeleteBestEffort(coverFiles.CoverThumbPath)
}

func hasPathPrefix(path, prefix string) bool {
	return path == prefix || strings.HasPrefix(path, strings.TrimRight(prefix, "/")+"/")
}

type loginRequest struct {
	Login    string `json:"login"`
	Password string `json:"password"`
}

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

type bookQueryRequest struct {
	Limit    *int     `json:"limit"`
	Offset   *int     `json:"offset"`
	Sort     string   `json:"sort"`
	Tags     []string `json:"tags"`
	Favorite *bool    `json:"favorite"`
	Q        string   `json:"q"`
}

type bookPatchRequest struct {
	Title    *string   `json:"title"`
	Tags     *[]string `json:"tags"`
	Favorite *bool     `json:"favorite"`
}

type progressRequest struct {
	ProgressPercent float64 `json:"progress_percent"`
}

type tagsResponse struct {
	Items []string `json:"items"`
}

type userDTO struct {
	ID         string `json:"id"`
	Login      string `json:"login"`
	IsActive   bool   `json:"is_active"`
	QuotaBytes int64  `json:"quota_bytes"`
	UsedBytes  int64  `json:"used_bytes"`
	CreatedAt  string `json:"created_at"`
}

type bookResponse struct {
	ID              string   `json:"id"`
	Title           string   `json:"title"`
	Tags            []string `json:"tags"`
	Favorite        bool     `json:"favorite"`
	Format          string   `json:"format"`
	SizeBytes       int64    `json:"size_bytes"`
	ProgressPercent float64  `json:"progress_percent"`
	CreatedAt       string   `json:"created_at"`
	UpdatedAt       string   `json:"updated_at"`
}

type progressResponse struct {
	ProgressPercent float64 `json:"progress_percent"`
	UpdatedAt       *string `json:"updated_at"`
}

func userResponse(user domain.User) userDTO {
	return userDTO{
		ID:         user.ID.String(),
		Login:      user.Login,
		IsActive:   user.IsActive,
		QuotaBytes: user.QuotaBytes,
		UsedBytes:  user.UsedBytes,
		CreatedAt:  user.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func bookDTO(book domain.Book) bookResponse {
	return bookResponse{
		ID:              book.ID.String(),
		Title:           book.Title,
		Tags:            book.Tags,
		Favorite:        book.Favorite,
		Format:          book.Format,
		SizeBytes:       book.SizeBytes,
		ProgressPercent: book.ProgressPercent,
		CreatedAt:       book.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:       book.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func progressDTO(progress domain.ReadingProgress) progressResponse {
	var updatedAt *string
	if progress.UpdatedAt != nil {
		value := progress.UpdatedAt.UTC().Format(time.RFC3339)
		updatedAt = &value
	}
	return progressResponse{ProgressPercent: progress.ProgressPercent, UpdatedAt: updatedAt}
}

func LogLevel(level string) slog.Level {
	switch strings.ToLower(level) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func NewJSONLogger(level string) *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: LogLevel(level)}))
}

func ListenAndServe(ctx context.Context, addr string, handler http.Handler, logger *slog.Logger) error {
	server := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			logger.Error("http shutdown failed", "error", err)
		}
	}()
	err := server.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func DebugRouteList() string {
	return fmt.Sprintf("%s mounted", config.APIBasePath("/"))
}
