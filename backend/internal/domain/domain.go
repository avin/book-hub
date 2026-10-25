package domain

import (
	"errors"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

const (
	DefaultQuotaBytes    int64 = 2147483648
	DefaultMaxUpload     int64 = 314572800
	DefaultMaxCoverBytes int64 = 1048576
	MaxSettingsBytes           = 64 * 1024
	MaxDescriptionLength       = 10000
)

var loginPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{3,64}$`)

var (
	ErrValidation           = errors.New("validation_error")
	ErrUnauthorized         = errors.New("unauthorized")
	ErrForbidden            = errors.New("forbidden")
	ErrNotFound             = errors.New("not_found")
	ErrQuotaExceeded        = errors.New("quota_exceeded")
	ErrUnsupportedFormat    = errors.New("unsupported_format")
	ErrDuplicateBook        = errors.New("duplicate_book")
	ErrAccountInactive      = errors.New("account_inactive")
	ErrRegistrationDisabled = errors.New("registration_disabled")
	ErrCSRFInvalid          = errors.New("csrf_invalid")
	ErrInvalidCredentials   = errors.New("invalid_credentials")
)

type User struct {
	ID         uuid.UUID
	Login      string
	IsActive   bool
	QuotaBytes int64
	UsedBytes  int64
	CreatedAt  time.Time
}

type UserWithPassword struct {
	User
	PasswordHash string
}

type BookFile struct {
	ID          uuid.UUID
	SHA256      string
	StoragePath string
	SizeBytes   int64
	Format      string
	CreatedAt   time.Time
}

type Book struct {
	ID              uuid.UUID
	Title           string
	Description     string
	Tags            []string
	Favorite        bool
	Format          string
	SizeBytes       int64
	ProgressPercent float64
	LastOpenedAt    time.Time
	StoragePath     string
	SHA256          string
	CoverPath       *string
	CoverThumbPath  *string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type BookQuery struct {
	Limit    int
	Offset   int
	Sort     string
	Tags     []string
	Favorite *bool
	Q        string
}

type BookPage struct {
	Items  []Book
	Total  int64
	Limit  int
	Offset int
}

type BookInput struct {
	Title       string
	Description string
	Tags        []string
	Favorite    bool
}

type BookFileInput struct {
	ID          uuid.UUID
	SHA256      string
	StoragePath string
	SizeBytes   int64
	Format      string
}

type DeletedBookFiles struct {
	BookPath       string
	CoverPath      string
	CoverThumbPath string
}

type CoverFiles struct {
	CoverPath      string
	CoverThumbPath string
}

type ReadingProgress struct {
	ProgressPercent float64
}

func NormalizeLogin(login string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(login))
	if !loginPattern.MatchString(normalized) {
		return "", ErrValidation
	}
	return normalized, nil
}

func ValidatePassword(password string) error {
	if password == "" || len(password) > 2048 {
		return ErrValidation
	}
	return nil
}

func NormalizeTitle(title string) string {
	normalized := strings.TrimSpace(title)
	if normalized == "" {
		return "untitled"
	}
	if len([]rune(normalized)) > 512 {
		return string([]rune(normalized)[:512])
	}
	return normalized
}

func NormalizeDescription(description string) (string, error) {
	if !utf8.ValidString(description) {
		return "", ErrValidation
	}
	length := 0
	for _, r := range description {
		length++
		if r > 0xffff {
			length++
		}
		if length > MaxDescriptionLength {
			return "", ErrValidation
		}
	}
	return strings.TrimFunc(description, func(r rune) bool {
		return r == '\ufeff' || (unicode.IsSpace(r) && r != '\u0085')
	}), nil
}

func TitleFromFilename(name string) string {
	base := filepath.Base(name)
	ext := filepath.Ext(base)
	return NormalizeTitle(strings.TrimSuffix(base, ext))
}

func NormalizeTags(tags []string) []string {
	result := make([]string, 0, min(len(tags), 50))
	seen := make(map[string]struct{}, len(tags))
	for _, tag := range tags {
		normalized := strings.ToLower(strings.TrimSpace(tag))
		if normalized == "" {
			continue
		}
		runes := []rune(normalized)
		if len(runes) > 64 {
			normalized = string(runes[:64])
		}
		key := strings.ToLower(normalized)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, normalized)
		if len(result) == 50 {
			break
		}
	}
	return result
}

func NormalizeBookQuery(q BookQuery) (BookQuery, error) {
	if q.Limit == 0 {
		q.Limit = 50
	}
	if q.Limit < 0 || q.Offset < 0 || q.Limit > 200 {
		return BookQuery{}, ErrValidation
	}
	if q.Sort == "" {
		q.Sort = "relevance"
	}
	switch q.Sort {
	case "relevance", "created_at_desc", "created_at_asc", "title_asc", "title_desc", "updated_at_desc", "updated_at_asc":
	default:
		return BookQuery{}, ErrValidation
	}
	q.Tags = NormalizeTags(q.Tags)
	q.Q = strings.TrimSpace(q.Q)
	return q, nil
}

func NormalizeBookFormat(filename string) (string, error) {
	switch strings.ToLower(strings.TrimPrefix(filepath.Ext(filename), ".")) {
	case "pdf":
		return "pdf", nil
	case "fb2":
		return "fb2", nil
	case "epub":
		return "epub", nil
	case "djvu", "djv":
		return "djvu", nil
	default:
		return "", ErrUnsupportedFormat
	}
}

func NormalizeCoverFormat(filename string) (string, error) {
	switch strings.ToLower(strings.TrimPrefix(filepath.Ext(filename), ".")) {
	case "jpg", "jpeg":
		return "jpg", nil
	case "png":
		return "png", nil
	case "webp":
		return "webp", nil
	default:
		return "", ErrUnsupportedFormat
	}
}

func NormalizeCoverVariant(variant string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(variant)) {
	case "", "full":
		return "full", nil
	case "thumbnail":
		return "thumbnail", nil
	default:
		return "", ErrValidation
	}
}

func ValidateProgress(progress float64) error {
	if progress < 0 || progress > 100 {
		return ErrValidation
	}
	return nil
}
