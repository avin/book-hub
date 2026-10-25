package config_test

import (
	"path/filepath"
	"testing"

	"book-hub/internal/config"
)

func TestFrontendDirectoryIsOptionalAndDoesNotAffectAdministrativeConfiguration(t *testing.T) {
	t.Setenv("BOOK_HUB_SESSION_SECRET", "01234567890123456789012345678901")
	t.Setenv("BOOK_HUB_STORAGE_DIR", t.TempDir())
	t.Setenv("BOOK_HUB_FRONTEND_DIR", "")
	cfg, err := config.Load()
	if err != nil || cfg.FrontendDir != "" {
		t.Fatalf("disabled frontend: %q %v", cfg.FrontendDir, err)
	}
	missing := filepath.Join(t.TempDir(), "unmounted-frontend")
	t.Setenv("BOOK_HUB_FRONTEND_DIR", missing)
	cfg, err = config.Load()
	if err != nil || cfg.FrontendDir != missing {
		t.Fatalf("server configuration: %q %v", cfg.FrontendDir, err)
	}
	t.Setenv("BOOK_HUB_SESSION_SECRET", "")
	if _, err := config.LoadFileStorage(); err != nil {
		t.Fatalf("administrative configuration requires frontend: %v", err)
	}
}
