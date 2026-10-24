package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"book-hub/internal/database"
)

func TestBackupCommandUsesStorageSettingsWithoutHTTPSecret(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	source := filepath.ToSlash(filepath.Join(root, "source.sqlite"))
	if source[0] != '/' {
		source = "/" + source
	}
	source = "sqlite://" + source
	if err := database.Migrate(ctx, source, "up"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("BOOK_HUB_DATABASE_URL", source)
	t.Setenv("BOOK_HUB_SESSION_SECRET", "")
	t.Setenv("BOOK_HUB_STORAGE_DIR", filepath.Join(root, "unused-legacy"))
	t.Setenv("BOOK_HUB_BOOKS_DIR", filepath.Join(root, "originals"))
	t.Setenv("BOOK_HUB_IMAGES_DIR", filepath.Join(root, "images"))
	t.Setenv("BOOK_HUB_WORK_DIR", filepath.Join(root, "work"))
	os.Mkdir(filepath.Join(root, "images"), 0700)
	os.WriteFile(filepath.Join(root, "images", "image.jpg"), []byte("image"), 0600)
	directory := filepath.Join(root, "backup")
	os.Mkdir(directory, 0700)
	if err := run(ctx, []string{"create", directory}); err != nil {
		t.Fatal(err)
	}
	target := filepath.ToSlash(filepath.Join(root, "target.sqlite"))
	if target[0] != '/' {
		target = "/" + target
	}
	target = "sqlite://" + target
	t.Setenv("BOOK_HUB_DATABASE_URL", target)
	t.Setenv("BOOK_HUB_BOOKS_DIR", filepath.Join(root, "restored-originals"))
	t.Setenv("BOOK_HUB_IMAGES_DIR", filepath.Join(root, "restored-images"))
	if err := run(ctx, []string{"validate", directory}); err != nil {
		t.Fatal(err)
	}
	if err := run(ctx, []string{"restore", directory}); err != nil {
		t.Fatal(err)
	}
	if err := database.CheckSchema(ctx, target); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "restored-images", "image.jpg"))
	if err != nil || string(data) != "image" {
		t.Fatalf("configured image destination: %q %v", data, err)
	}
}
