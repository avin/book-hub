package domain_test

import (
	"errors"
	"strings"
	"testing"

	"book-hub/internal/domain"
)

func TestNormalizeTagsTrimsDeduplicatesAndLimits(t *testing.T) {
	tags := []string{" Go ", "go", "", strings.Repeat("x", 80), "PDF"}
	normalized := domain.NormalizeTags(tags)
	if len(normalized) != 3 {
		t.Fatalf("expected 3 tags, got %d: %#v", len(normalized), normalized)
	}
	if normalized[0] != "go" || normalized[1] != strings.Repeat("x", 64) || normalized[2] != "pdf" {
		t.Fatalf("unexpected tags: %#v", normalized)
	}
}

func TestNormalizeTitleUsesUntitledAndTruncates(t *testing.T) {
	if got := domain.NormalizeTitle("   "); got != "untitled" {
		t.Fatalf("expected untitled, got %q", got)
	}
	title := domain.NormalizeTitle(strings.Repeat("ж", 600))
	if len([]rune(title)) != 512 {
		t.Fatalf("expected 512 runes, got %d", len([]rune(title)))
	}
}

func TestNormalizeLogin(t *testing.T) {
	login, err := domain.NormalizeLogin(" Reader_1 ")
	if err != nil {
		t.Fatal(err)
	}
	if login != "reader_1" {
		t.Fatalf("unexpected login: %q", login)
	}
	if _, err := domain.NormalizeLogin("no spaces"); !errors.Is(err, domain.ErrValidation) {
		t.Fatalf("expected validation error, got %v", err)
	}
}

func TestNormalizeBookQueryDefaultsAndRejectsInvalidValues(t *testing.T) {
	query, err := domain.NormalizeBookQuery(domain.BookQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if query.Limit != 50 || query.Sort != "created_at_desc" {
		t.Fatalf("unexpected defaults: %#v", query)
	}
	if _, err := domain.NormalizeBookQuery(domain.BookQuery{Limit: 201}); !errors.Is(err, domain.ErrValidation) {
		t.Fatalf("expected validation error, got %v", err)
	}
	if _, err := domain.NormalizeBookQuery(domain.BookQuery{Limit: 10, Sort: "bad"}); !errors.Is(err, domain.ErrValidation) {
		t.Fatalf("expected validation error, got %v", err)
	}
}
