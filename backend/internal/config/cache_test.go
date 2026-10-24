package config_test

import (
	"path/filepath"
	"testing"

	"book-hub/internal/config"
)

func TestBookCacheMustBeExplicitlyConfiguredWithItsOwnBudgetAndDirectory(t *testing.T) {
	t.Setenv("BOOK_HUB_SESSION_SECRET", "01234567890123456789012345678901")
	t.Setenv("BOOK_HUB_STORAGE_DIR", t.TempDir())
	t.Setenv("BOOK_HUB_CACHE_DIR", "")
	t.Setenv("BOOK_HUB_CACHE_MAX_BYTES", "")
	cfg, err := config.Load()
	if err != nil || cfg.CacheDir != "" || cfg.CacheMaxBytes != 0 {
		t.Fatalf("cache should default to disabled: %+v %v", cfg, err)
	}
	cache := filepath.Join(t.TempDir(), "cache")
	for _, test := range []struct{ path, size string }{
		{cache, ""}, {"", "100"}, {cache, "0"}, {cache, "-1"}, {cache, "abc"}, {cache, "9223372036854775808"},
	} {
		t.Run(test.path+"/"+test.size, func(t *testing.T) {
			t.Setenv("BOOK_HUB_CACHE_DIR", test.path)
			t.Setenv("BOOK_HUB_CACHE_MAX_BYTES", test.size)
			if _, err := config.Load(); err == nil {
				t.Fatal("incomplete or invalid cache configuration accepted")
			}
		})
	}
	t.Setenv("BOOK_HUB_CACHE_DIR", cache)
	t.Setenv("BOOK_HUB_CACHE_MAX_BYTES", "100")
	cfg, err = config.Load()
	if err != nil || cfg.CacheDir != cache || cfg.CacheMaxBytes != 100 {
		t.Fatalf("explicit cache: %+v %v", cfg, err)
	}
	books, images, work := cfg.FilePaths()
	for _, path := range []string{books, images, work, filepath.Dir(work), filepath.Join(books, "cache")} {
		t.Setenv("BOOK_HUB_CACHE_DIR", path)
		if _, err := config.Load(); err == nil {
			t.Fatalf("overlapping cache directory accepted: %s", path)
		}
	}
}
