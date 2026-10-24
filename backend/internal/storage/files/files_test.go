package files_test

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"book-hub/internal/domain"
	"book-hub/internal/storage/files"
)

func TestOriginalLifecyclePreservesWholeBook(t *testing.T) {
	store := files.New(t.TempDir())
	// Embedded illustrations belong to the original, including binary bytes.
	want := []byte("%PDF-1.7\nembedded image\x00\xff\x89\n%%EOF")
	temp, err := store.Work.SaveTemp(bytes.NewReader(want), 1024)
	if err != nil {
		t.Fatal(err)
	}
	path, err := store.Books.MoveBook(context.Background(), temp.Path, temp.SHA256, "pdf")
	if err != nil {
		t.Fatal(err)
	}
	original, err := store.Books.Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(original)
	original.Close()
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("original changed: bytes=%q err=%v", got, err)
	}
	if err := store.Books.Delete(context.Background(), path); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Books.Open(context.Background(), path); !os.IsNotExist(err) {
		t.Fatalf("deleted original still available: %v", err)
	}
}

func TestOriginalStoreReadsLegacyAbsoluteAndRelativeLocations(t *testing.T) {
	root := t.TempDir()
	t.Chdir(root)
	for _, location := range []string{filepath.Join(root, "absolute.pdf"), "relative.pdf"} {
		if err := os.WriteFile(location, []byte("legacy original"), 0600); err != nil {
			t.Fatal(err)
		}
		original, err := files.New("storage").Books.Open(context.Background(), location)
		if err != nil {
			t.Fatal(err)
		}
		got, err := io.ReadAll(original)
		original.Close()
		if err != nil || string(got) != "legacy original" {
			t.Fatalf("legacy location %q: bytes=%q err=%v", location, got, err)
		}
	}
}

func TestSaveTempCalculatesHashAndEnforcesLimit(t *testing.T) {
	store := files.New(t.TempDir())
	temp, err := store.Work.SaveTemp(strings.NewReader("hello"), 10)
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
	if _, err := store.Work.SaveTemp(strings.NewReader("hello"), 4); err != domain.ErrQuotaExceeded {
		t.Fatalf("expected quota exceeded, got %v", err)
	}
}

func TestMoveBookDeduplicatesExistingPhysicalFile(t *testing.T) {
	store := files.New(t.TempDir())
	first, err := store.Work.SaveTemp(strings.NewReader("same"), 10)
	if err != nil {
		t.Fatal(err)
	}
	path, err := store.Books.MoveBook(context.Background(), first.Path, first.SHA256, "pdf")
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Work.SaveTemp(strings.NewReader("same"), 10)
	if err != nil {
		t.Fatal(err)
	}
	secondPath, err := store.Books.MoveBook(context.Background(), second.Path, second.SHA256, "pdf")
	if err != nil {
		t.Fatal(err)
	}
	if secondPath != path {
		t.Fatalf("expected same final path, got %q and %q", path, secondPath)
	}
	if _, err := os.Stat(second.Path); err != nil {
		t.Fatalf("accepted file must remain available for cache population: %v", err)
	}
	first.Release()
	second.Release()
	if filepath.Base(path) != first.SHA256+".pdf" {
		t.Fatalf("unexpected final path: %s", path)
	}
}

func TestBookPathUsesCanonicalDJVUFormat(t *testing.T) {
	store := files.New(t.TempDir())
	sha256Hex := strings.Repeat("a", 64)

	path := store.Books.BookPath(sha256Hex, "djvu")
	if filepath.Base(path) != sha256Hex+".djvu" {
		t.Fatalf("unexpected DJVU storage path: %s", path)
	}
}

func TestSaveCoverCreatesOriginalAndThumbnail(t *testing.T) {
	store := files.New(t.TempDir())
	cover, err := store.Images.SaveCover("book-id", "png", testPNG(t, 300, 400), 1024*1024)
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
	if _, err := store.Images.SaveCover("book-id", "png", strings.NewReader("not an image"), 1024); err != domain.ErrValidation {
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
