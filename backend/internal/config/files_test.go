package config_test

import (
	"path/filepath"
	"testing"

	"book-hub/internal/config"
)

func TestStorageConfigurationPreservesLegacyDefaultsAndRejectsInvalidSettings(t *testing.T) {
	t.Setenv("BOOK_HUB_SESSION_SECRET", "01234567890123456789012345678901")
	t.Setenv("BOOK_HUB_STORAGE_DIR", t.TempDir())
	for _, key := range []string{"BOOK_HUB_BOOK_STORAGE", "BOOK_HUB_BOOKS_DIR", "BOOK_HUB_IMAGES_DIR", "BOOK_HUB_WORK_DIR", "BOOK_HUB_WORK_MAX_BYTES"} {
		t.Setenv(key, "")
	}
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	books, images, work := cfg.FilePaths()
	if books != filepath.Join(cfg.StorageDir, "books") || images != filepath.Join(cfg.StorageDir, "covers") || work != filepath.Join(cfg.StorageDir, "tmp") || cfg.WorkMaxBytes != 1<<30 {
		t.Fatalf("legacy defaults: %#v %s %s %s", cfg, books, images, work)
	}
	for _, value := range []string{"0", "-1", "abc", "9223372036854775808"} {
		t.Run("invalid budget "+value, func(t *testing.T) {
			t.Setenv("BOOK_HUB_WORK_MAX_BYTES", value)
			if _, err := config.Load(); err == nil {
				t.Fatal("invalid workspace budget accepted")
			}
		})
	}
	t.Run("unknown storage", func(t *testing.T) {
		t.Setenv("BOOK_HUB_BOOK_STORAGE", "unknown")
		if _, err := config.Load(); err == nil {
			t.Fatal("unknown storage accepted")
		}
	})
	t.Run("overlapping paths", func(t *testing.T) {
		t.Setenv("BOOK_HUB_WORK_DIR", books)
		if _, err := config.Load(); err == nil {
			t.Fatal("workspace over originals accepted")
		}
	})
}

func TestAdministrativeStorageConfigurationDoesNotRequireSessionSecret(t *testing.T) {
	t.Setenv("BOOK_HUB_SESSION_SECRET", "")
	t.Setenv("BOOK_HUB_STORAGE_DIR", t.TempDir())
	t.Setenv("BOOK_HUB_DATABASE_URL", "postgres://configured/database")
	cfg, err := config.LoadFileStorage()
	if err != nil || cfg.DatabaseURL != "postgres://configured/database" || cfg.WorkMaxBytes != 1<<30 {
		t.Fatalf("administrative file storage config: %#v %v", cfg, err)
	}
}
