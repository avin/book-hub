package config

import (
	"errors"
	"os"
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
		DefaultQuotaBytes:   envInt64("BOOK_HUB_DEFAULT_QUOTA_BYTES", domain.DefaultQuotaBytes),
		SessionSecret:       os.Getenv("BOOK_HUB_SESSION_SECRET"),
		SessionTTL:          envDuration("BOOK_HUB_SESSION_TTL", 3*365*24*time.Hour),
		MaxUploadBytes:      envInt64("BOOK_HUB_MAX_UPLOAD_BYTES", domain.DefaultMaxUpload),
		MaxCoverUploadBytes: envInt64("BOOK_HUB_MAX_COVER_UPLOAD_BYTES", domain.DefaultMaxCoverBytes),
	}
	cfg.RegistrationEnabled = envBool("BOOK_HUB_REGISTRATION_ENABLED", true)
	cfg.RegistrationAutoActivate = envBool("BOOK_HUB_REGISTRATION_AUTO_ACTIVATE", false)
	cfg.CookieSecure = envBool("BOOK_HUB_COOKIE_SECURE", false)
	if len(cfg.SessionSecret) < 32 {
		return Config{}, errors.New("BOOK_HUB_SESSION_SECRET must be at least 32 characters")
	}
	return cfg, nil
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
