package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServerRejectsInvalidFrontendBeforeOpeningDatabase(t *testing.T) {
	t.Setenv("BOOK_HUB_SESSION_SECRET", strings.Repeat("s", 32))
	t.Setenv("BOOK_HUB_STORAGE_DIR", t.TempDir())
	t.Setenv("BOOK_HUB_DATABASE_URL", "invalid://not-a-database")
	root := t.TempDir()
	file := filepath.Join(root, "file")
	if err := os.WriteFile(file, []byte("file"), 0600); err != nil {
		t.Fatal(err)
	}
	empty := filepath.Join(root, "empty")
	indexDirectory := filepath.Join(root, "index-directory")
	for _, dir := range []string{empty, filepath.Join(indexDirectory, "index.html")} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	for _, dir := range []string{filepath.Join(root, "missing"), file, empty, indexDirectory} {
		t.Run(filepath.Base(dir), func(t *testing.T) {
			t.Setenv("BOOK_HUB_FRONTEND_DIR", dir)
			if err := run(); err == nil || !strings.Contains(err.Error(), "BOOK_HUB_FRONTEND_DIR") {
				t.Fatalf("expected frontend startup error, got %v", err)
			}
		})
	}
}

func TestServerRejectsFrontendIndexOutsideBuild(t *testing.T) {
	t.Setenv("BOOK_HUB_SESSION_SECRET", strings.Repeat("s", 32))
	t.Setenv("BOOK_HUB_STORAGE_DIR", t.TempDir())
	t.Setenv("BOOK_HUB_DATABASE_URL", "invalid://not-a-database")
	dir := t.TempDir()
	outside := filepath.Join(t.TempDir(), "private.html")
	if err := os.WriteFile(outside, []byte("private data"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "index.html")); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}
	t.Setenv("BOOK_HUB_FRONTEND_DIR", dir)
	if err := run(); err == nil || !strings.Contains(err.Error(), "BOOK_HUB_FRONTEND_DIR") {
		t.Fatalf("expected frontend startup error, got %v", err)
	}
}

func TestServerRejectsUnreadableFrontendIndex(t *testing.T) {
	t.Setenv("BOOK_HUB_SESSION_SECRET", strings.Repeat("s", 32))
	t.Setenv("BOOK_HUB_STORAGE_DIR", t.TempDir())
	t.Setenv("BOOK_HUB_DATABASE_URL", "invalid://not-a-database")
	dir := t.TempDir()
	index := filepath.Join(dir, "index.html")
	if err := os.WriteFile(index, []byte("frontend"), 0000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(index, 0600) })
	if file, err := os.Open(index); err == nil {
		file.Close()
		t.Skip("OS or current privileges allow reading files without read permission")
	}
	t.Setenv("BOOK_HUB_FRONTEND_DIR", dir)
	if err := run(); err == nil || !strings.Contains(err.Error(), "BOOK_HUB_FRONTEND_DIR") {
		t.Fatalf("expected frontend startup error, got %v", err)
	}
}
