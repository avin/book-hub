package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"book-hub/internal/auth"
	"book-hub/internal/domain"
)

type Config struct {
	HTTPAddr                 string
	BasePath                 string
	FrontendDir              string
	LogLevel                 string
	DatabaseURL              string
	StorageDir               string
	BookStorage              string
	BooksDir                 string
	ImagesDir                string
	WorkDir                  string
	WorkMaxBytes             int64
	CacheDir                 string
	CacheMaxBytes            int64
	FTPAddr                  string
	FTPUser                  string
	FTPPassword              string
	FTPRoot                  string
	FTPCAFile                string
	S3Endpoint               string
	S3Region                 string
	S3Bucket                 string
	S3Prefix                 string
	S3AccessKeyID            string
	S3SecretAccessKey        string
	DefaultQuotaBytes        int64
	PasswordAlgorithm        string
	PBKDF2Iterations         int
	RegistrationEnabled      bool
	RegistrationAutoActivate bool
	SessionSecret            string
	SessionTTL               time.Duration
	CookieSecure             bool
	MaxUploadBytes           int64
	MaxCoverUploadBytes      int64
}

// LoadFileStorage loads the shared server/CLI settings without HTTP credentials.
func LoadFileStorage() (Config, error) {
	cfg := Config{
		CacheDir:          os.Getenv("BOOK_HUB_CACHE_DIR"),
		DatabaseURL:       os.Getenv("BOOK_HUB_DATABASE_URL"),
		StorageDir:        envString("BOOK_HUB_STORAGE_DIR", "./data/books"),
		BookStorage:       envString("BOOK_HUB_BOOK_STORAGE", "directory"),
		BooksDir:          os.Getenv("BOOK_HUB_BOOKS_DIR"),
		ImagesDir:         os.Getenv("BOOK_HUB_IMAGES_DIR"),
		WorkDir:           os.Getenv("BOOK_HUB_WORK_DIR"),
		FTPAddr:           os.Getenv("BOOK_HUB_FTP_ADDR"),
		FTPUser:           os.Getenv("BOOK_HUB_FTP_USER"),
		FTPPassword:       os.Getenv("BOOK_HUB_FTP_PASSWORD"),
		FTPRoot:           envString("BOOK_HUB_FTP_ROOT", "/books"),
		FTPCAFile:         os.Getenv("BOOK_HUB_FTP_CA_FILE"),
		S3Endpoint:        os.Getenv("BOOK_HUB_S3_ENDPOINT"),
		S3Region:          os.Getenv("BOOK_HUB_S3_REGION"),
		S3Bucket:          os.Getenv("BOOK_HUB_S3_BUCKET"),
		S3Prefix:          envString("BOOK_HUB_S3_PREFIX", "books"),
		S3AccessKeyID:     os.Getenv("BOOK_HUB_S3_ACCESS_KEY_ID"),
		S3SecretAccessKey: os.Getenv("BOOK_HUB_S3_SECRET_ACCESS_KEY"),
	}
	var err error
	cfg.WorkMaxBytes, err = strictPositiveBytes("BOOK_HUB_WORK_MAX_BYTES", 1<<30)
	if err != nil {
		return Config{}, err
	}
	if os.Getenv("BOOK_HUB_CACHE_MAX_BYTES") != "" {
		cfg.CacheMaxBytes, err = strictPositiveBytes("BOOK_HUB_CACHE_MAX_BYTES", 0)
		if err != nil {
			return Config{}, err
		}
	}
	if err := cfg.ValidateFileStorage(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func Load() (Config, error) {
	cfg, err := LoadFileStorage()
	if err != nil {
		return Config{}, err
	}
	cfg.HTTPAddr = envString("BOOK_HUB_HTTP_ADDR", ":8080")
	cfg.BasePath = normalizeBasePath(envString("BOOK_HUB_BASE_PATH", "/"))
	cfg.FrontendDir = os.Getenv("BOOK_HUB_FRONTEND_DIR")
	cfg.LogLevel = envString("BOOK_HUB_LOG_LEVEL", "info")
	cfg.DefaultQuotaBytes = envInt64("BOOK_HUB_DEFAULT_QUOTA_BYTES", domain.DefaultQuotaBytes)
	cfg.SessionSecret = os.Getenv("BOOK_HUB_SESSION_SECRET")
	cfg.SessionTTL = envDuration("BOOK_HUB_SESSION_TTL", 3*365*24*time.Hour)
	cfg.MaxUploadBytes = envInt64("BOOK_HUB_MAX_UPLOAD_BYTES", domain.DefaultMaxUpload)
	cfg.MaxCoverUploadBytes = envInt64("BOOK_HUB_MAX_COVER_UPLOAD_BYTES", domain.DefaultMaxCoverBytes)
	cfg.RegistrationEnabled = envBool("BOOK_HUB_REGISTRATION_ENABLED", true)
	cfg.RegistrationAutoActivate = envBool("BOOK_HUB_REGISTRATION_AUTO_ACTIVATE", false)
	cfg.CookieSecure = envBool("BOOK_HUB_COOKIE_SECURE", false)
	cfg.PasswordAlgorithm = envString("BOOK_HUB_PASSWORD_ALGORITHM", auth.PasswordArgon2id)
	if !auth.ValidPasswordAlgorithm(cfg.PasswordAlgorithm) {
		return Config{}, errors.New("BOOK_HUB_PASSWORD_ALGORITHM must be argon2id or pbkdf2-sha256")
	}
	cfg.PBKDF2Iterations = auth.DefaultPBKDF2Iterations
	if value := os.Getenv("BOOK_HUB_PBKDF2_ITERATIONS"); value != "" {
		cfg.PBKDF2Iterations, err = strconv.Atoi(value)
		if err != nil || cfg.PBKDF2Iterations < 1 || cfg.PBKDF2Iterations > auth.MaxPBKDF2Iterations {
			return Config{}, fmt.Errorf("BOOK_HUB_PBKDF2_ITERATIONS must be an integer between 1 and %d", auth.MaxPBKDF2Iterations)
		}
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
	if c.BookStorage != "" && c.BookStorage != "directory" && c.BookStorage != "ftp" && c.BookStorage != "s3" && c.BookStorage != "ftps-explicit" && c.BookStorage != "ftps-implicit" {
		return fmt.Errorf("BOOK_HUB_BOOK_STORAGE must be directory, ftp, ftps-explicit, ftps-implicit or s3")
	}
	if c.BookStorage == "ftp" || c.BookStorage == "ftps-explicit" || c.BookStorage == "ftps-implicit" {
		host, port, err := net.SplitHostPort(c.FTPAddr)
		number, portErr := strconv.Atoi(port)
		if err != nil || host == "" || strings.ContainsAny(host, " \t\r\n\x00") || portErr != nil || number < 1 || number > 65535 {
			return fmt.Errorf("BOOK_HUB_FTP_ADDR must be host:port")
		}
		if c.FTPUser == "" || strings.ContainsAny(c.FTPUser+c.FTPPassword, "\r\n\x00") {
			return fmt.Errorf("BOOK_HUB_FTP_USER and PASSWORD must contain valid FTP credentials")
		}
		root := c.FTPRoot
		if root == "" {
			root = "/books"
		}
		if root == "/" || !strings.HasPrefix(root, "/") || path.Clean(root) != root || strings.ContainsAny(root, "\\\r\n\x00") {
			return fmt.Errorf("BOOK_HUB_FTP_ROOT must be a clean absolute dedicated directory below /")
		}
	}
	if c.BookStorage == "s3" {
		if strings.TrimSpace(c.S3Region) == "" || strings.TrimSpace(c.S3Bucket) == "" || c.S3AccessKeyID == "" || c.S3SecretAccessKey == "" {
			return fmt.Errorf("S3 region, bucket and credentials are required")
		}
		if strings.ContainsAny(c.S3Region+c.S3Bucket+c.S3AccessKeyID+c.S3SecretAccessKey, "\r\n\x00") || strings.ContainsAny(c.S3Bucket, "/\\ \t") {
			return fmt.Errorf("invalid S3 configuration")
		}
		if c.S3Endpoint != "" {
			endpoint, err := url.Parse(c.S3Endpoint)
			if err != nil || (endpoint.Scheme != "http" && endpoint.Scheme != "https") || endpoint.Host == "" || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" || (endpoint.Path != "" && endpoint.Path != "/") {
				return fmt.Errorf("BOOK_HUB_S3_ENDPOINT must be an HTTP(S) origin")
			}
		}
		if c.S3Prefix == "" || strings.HasPrefix(c.S3Prefix, "/") || path.Clean(c.S3Prefix) != c.S3Prefix || c.S3Prefix == "." || c.S3Prefix == ".." || strings.HasPrefix(c.S3Prefix, "../") || strings.ContainsAny(c.S3Prefix, "\\\r\n\x00") {
			return fmt.Errorf("BOOK_HUB_S3_PREFIX must be a clean dedicated prefix")
		}
	}
	if c.WorkMaxBytes < 0 {
		return fmt.Errorf("BOOK_HUB_WORK_MAX_BYTES must be positive")
	}
	books, images, work := c.FilePaths()
	paths := []string{books, images, work}
	if c.BookStorage == "ftp" || c.BookStorage == "ftps-explicit" || c.BookStorage == "ftps-implicit" || c.BookStorage == "s3" {
		paths = []string{images, work}
	}
	if c.CacheDir != "" || c.CacheMaxBytes != 0 {
		if strings.TrimSpace(c.CacheDir) == "" || c.CacheMaxBytes <= 0 {
			return fmt.Errorf("BOOK_HUB_CACHE_DIR and a positive BOOK_HUB_CACHE_MAX_BYTES are both required to enable the cache")
		}
		paths = append(paths, c.CacheDir)
	}
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
				return fmt.Errorf("originals, images, workspace and cache directories must not overlap")
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
