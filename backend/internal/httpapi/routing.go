package httpapi

import (
	"context"
	"net/http"
	"time"

	"book-hub/internal/config"
	"github.com/google/uuid"
)

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
