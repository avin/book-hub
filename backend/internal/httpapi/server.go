package httpapi

import (
	"log/slog"
	"net/http"

	"book-hub/internal/auth"
	"book-hub/internal/config"
	"book-hub/internal/storage"
	"book-hub/internal/storage/files"
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

func New(cfg config.Config, store storage.Store, fileStore files.Store, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	fileStore.SetLogger(logger)
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
