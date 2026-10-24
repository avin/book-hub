package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"book-hub/internal/domain"
)

type Config struct {
	HTTPAddr                 string
	BasePath                 string
	LogLevel                 string
	DatabaseURL              string
	StorageDir               string
	BookStorage              string
	BooksDir                 string
	ImagesDir                string
	WorkDir                  string
	WorkMaxBytes             int64
	DefaultQuotaBytes        int64
	RegistrationEnabled      bool
	RegistrationAutoActivate bool
	SessionSecret            string
	SessionTTL               time.Duration
	CookieSecure             bool
	MaxUploadBytes           int64
	MaxCoverUploadBytes      int64
}

func Load() (Config, error) {
	cfg := Config{
		HTTPAddr:            envString("BOOK_HUB_HTTP_ADDR", ":8080"),
		BasePath:            normalizeBasePath(envString("BOOK_HUB_BASE_PATH", "/")),
		LogLevel:            envString("BOOK_HUB_LOG_LEVEL", "info"),
		DatabaseURL:         os.Getenv("BOOK_HUB_DATABASE_URL"),
		StorageDir:          envString("BOOK_HUB_STORAGE_DIR", "./data/books"),
		BookStorage:         envString("BOOK_HUB_BOOK_STORAGE", "directory"),
		BooksDir:            os.Getenv("BOOK_HUB_BOOKS_DIR"),
		ImagesDir:           os.Getenv("BOOK_HUB_IMAGES_DIR"),
		WorkDir:             os.Getenv("BOOK_HUB_WORK_DIR"),
		DefaultQuotaBytes:   envInt64("BOOK_HUB_DEFAULT_QUOTA_BYTES", domain.DefaultQuotaBytes),
		SessionSecret:       os.Getenv("BOOK_HUB_SESSION_SECRET"),
		SessionTTL:          envDuration("BOOK_HUB_SESSION_TTL", 3*365*24*time.Hour),
		MaxUploadBytes:      envInt64("BOOK_HUB_MAX_UPLOAD_BYTES", domain.DefaultMaxUpload),
		MaxCoverUploadBytes: envInt64("BOOK_HUB_MAX_COVER_UPLOAD_BYTES", domain.DefaultMaxCoverBytes),
	}
	cfg.RegistrationEnabled = envBool("BOOK_HUB_REGISTRATION_ENABLED", true)
	cfg.RegistrationAutoActivate = envBool("BOOK_HUB_REGISTRATION_AUTO_ACTIVATE", false)
	cfg.CookieSecure = envBool("BOOK_HUB_COOKIE_SECURE", false)
	var err error
	cfg.WorkMaxBytes, err = strictPositiveBytes("BOOK_HUB_WORK_MAX_BYTES", 1<<30)
	if err != nil {
		return Config{}, err
	}
	if err := cfg.ValidateFileStorage(); err != nil {
		return Config{}, err
	}
	if len(cfg.SessionSecret) < 32 {
		return Config{}, errors.New("BOOK_HUB_SESSION_SECRET must be at least 32 characters")
	}
	return cfg, nil
}

// FilePaths preserves the legacy layout unless a path was explicitly selected.
func (c Config) FilePaths() (books, images, work string) {
	root := c.StorageDir
	if root == "" {
		root = "./data/books"
	}
	books, images, work = c.BooksDir, c.ImagesDir, c.WorkDir
	if books == "" {
		books = filepath.Join(root, "books")
	}
	if images == "" {
		images = filepath.Join(root, "covers")
	}
	if work == "" {
		work = filepath.Join(root, "tmp")
	}
	return books, images, work
}

func (c Config) ValidateFileStorage() error {
	if c.BookStorage != "" && c.BookStorage != "directory" {
		return fmt.Errorf("BOOK_HUB_BOOK_STORAGE must be directory")
	}
	if c.WorkMaxBytes < 0 {
		return fmt.Errorf("BOOK_HUB_WORK_MAX_BYTES must be positive")
	}
	books, images, work := c.FilePaths()
	paths := []string{books, images, work}
	for i, path := range paths {
		absolute, err := filepath.Abs(path)
		if err != nil {
			return err
		}
		for _, other := range paths[i+1:] {
			otherAbsolute, err := filepath.Abs(other)
			if err != nil {
				return err
			}
			if containsPath(absolute, otherAbsolute) || containsPath(otherAbsolute, absolute) {
				return fmt.Errorf("originals, images and workspace directories must not overlap")
			}
		}
	}
	return nil
}

func containsPath(parent, child string) bool {
	relative, err := filepath.Rel(parent, child)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func strictPositiveBytes(key string, fallback int64) (int64, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	number, err := strconv.ParseInt(value, 10, 64)
	if err != nil || number <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer of bytes", key)
	}
	return number, nil
}

func APIBasePath(basePath string) string {
	basePath = normalizeBasePath(basePath)
	if basePath == "/" {
		return "/api"
	}
	return basePath + "/api"
}

func normalizeBasePath(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "/" {
		return "/"
	}
	value = "/" + strings.Trim(value, "/")
	return value
}

func envString(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt64(key string, fallback int64) int64 {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func envBool(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envDuration(key string, fallback time.Duration) time.Duration {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}
