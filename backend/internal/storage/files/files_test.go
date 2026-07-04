package files_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"book-hub/internal/domain"
	"book-hub/internal/storage/files"
)

func TestSaveTempCalculatesHashAndEnforcesLimit(t *testing.T) {
	store := files.New(t.TempDir())
	temp, err := store.SaveTemp(strings.NewReader("hello"), 10)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(temp.Path)
	if temp.Size != 5 {
		t.Fatalf("expected size 5, got %d", temp.Size)
	}
	if temp.SHA256 != "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" {
		t.Fatalf("unexpected hash: %s", temp.SHA256)
	}
	if _, err := os.Stat(temp.Path); err != nil {
		t.Fatal(err)
	}
}

func TestSaveTempRejectsOversizedInput(t *testing.T) {
	store := files.New(t.TempDir())
	if _, err := store.SaveTemp(strings.NewReader("hello"), 4); err != domain.ErrQuotaExceeded {
		t.Fatalf("expected quota exceeded, got %v", err)
	}
}

func TestMoveBookDeduplicatesExistingPhysicalFile(t *testing.T) {
	store := files.New(t.TempDir())
	first, err := store.SaveTemp(strings.NewReader("same"), 10)
	if err != nil {
		t.Fatal(err)
	}
	path, err := store.MoveBook(first.Path, first.SHA256, "pdf")
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.SaveTemp(strings.NewReader("same"), 10)
	if err != nil {
		t.Fatal(err)
	}
	secondPath, err := store.MoveBook(second.Path, second.SHA256, "pdf")
	if err != nil {
		t.Fatal(err)
	}
	if secondPath != path {
		t.Fatalf("expected same final path, got %q and %q", path, secondPath)
	}
	if _, err := os.Stat(second.Path); !os.IsNotExist(err) {
		t.Fatalf("expected duplicate temp to be removed, got %v", err)
	}
	if filepath.Base(path) != first.SHA256+".pdf" {
		t.Fatalf("unexpected final path: %s", path)
	}
}
