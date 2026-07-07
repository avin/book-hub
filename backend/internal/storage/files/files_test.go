package files_test

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
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

func TestSaveCoverCreatesOriginalAndThumbnail(t *testing.T) {
	store := files.New(t.TempDir())
	cover, err := store.SaveCover("book-id", "png", testPNG(t, 300, 400), 1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Ext(cover.CoverPath) != ".png" {
		t.Fatalf("unexpected cover path: %s", cover.CoverPath)
	}
	if filepath.Base(cover.CoverThumbPath) == filepath.Base(cover.CoverPath) {
		t.Fatalf("thumbnail path must be distinct from cover path")
	}
	if filepath.Ext(cover.CoverThumbPath) != ".jpg" {
		t.Fatalf("unexpected thumbnail path: %s", cover.CoverThumbPath)
	}
	if _, err := os.Stat(cover.CoverPath); err != nil {
		t.Fatal(err)
	}
	thumbFile, err := os.Open(cover.CoverThumbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer thumbFile.Close()
	thumb, _, err := image.Decode(thumbFile)
	if err != nil {
		t.Fatal(err)
	}
	if thumb.Bounds().Dx() > 184 || thumb.Bounds().Dy() > 240 {
		t.Fatalf("thumbnail is too large: %dx%d", thumb.Bounds().Dx(), thumb.Bounds().Dy())
	}
}

func TestSaveCoverRejectsInvalidImage(t *testing.T) {
	store := files.New(t.TempDir())
	if _, err := store.SaveCover("book-id", "png", strings.NewReader("not an image"), 1024); err != domain.ErrValidation {
		t.Fatalf("expected validation error, got %v", err)
	}
}

func testPNG(t *testing.T, width, height int) *bytes.Reader {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: 80, G: 120, B: 180, A: 255})
		}
	}
	var body bytes.Buffer
	if err := png.Encode(&body, img); err != nil {
		t.Fatal(err)
	}
	return bytes.NewReader(body.Bytes())
}
