package files

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"math"
	"os"
	"path/filepath"
	"time"

	"book-hub/internal/domain"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
	_ "image/png"
)

const (
	coverThumbnailMaxWidth  = 184
	coverThumbnailMaxHeight = 240
	coverThumbnailQuality   = 82
	coverMaxPixels          = 20_000_000
)

type Store struct {
	root string
}

type TempFile struct {
	Path   string
	SHA256 string
	Size   int64
}

func New(root string) Store {
	return Store{root: root}
}

func (s Store) Root() string {
	return s.root
}

func (s Store) Ensure() error {
	if err := os.MkdirAll(filepath.Join(s.root, "tmp"), 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(s.root, "books"), 0o755); err != nil {
		return err
	}
	return os.MkdirAll(filepath.Join(s.root, "covers"), 0o755)
}

func (s Store) CheckReady() error {
	if err := s.Ensure(); err != nil {
		return err
	}
	probe, err := os.CreateTemp(filepath.Join(s.root, "tmp"), "ready-*")
	if err != nil {
		return err
	}
	name := probe.Name()
	if err := probe.Close(); err != nil {
		return err
	}
	return os.Remove(name)
}

func (s Store) SaveTemp(reader io.Reader, limit int64) (TempFile, error) {
	if limit <= 0 {
		return TempFile{}, domain.ErrValidation
	}
	if err := s.Ensure(); err != nil {
		return TempFile{}, err
	}
	temp, err := os.CreateTemp(filepath.Join(s.root, "tmp"), "upload-*")
	if err != nil {
		return TempFile{}, err
	}
	defer temp.Close()

	hasher := sha256.New()
	written, err := io.Copy(io.MultiWriter(temp, hasher), io.LimitReader(reader, limit+1))
	if err != nil {
		_ = os.Remove(temp.Name())
		return TempFile{}, err
	}
	if written > limit {
		_ = os.Remove(temp.Name())
		return TempFile{}, domain.ErrQuotaExceeded
	}
	return TempFile{
		Path:   temp.Name(),
		SHA256: hex.EncodeToString(hasher.Sum(nil)),
		Size:   written,
	}, nil
}

func (s Store) BookPath(sha256Hex, format string) string {
	return filepath.Join(s.root, "books", sha256Hex[:2], sha256Hex+"."+format)
}

func (s Store) MoveBook(tempPath, sha256Hex, format string) (string, error) {
	if len(sha256Hex) < 2 {
		return "", domain.ErrValidation
	}
	finalPath := s.BookPath(sha256Hex, format)
	if err := os.MkdirAll(filepath.Dir(finalPath), 0o755); err != nil {
		return "", err
	}
	if _, err := os.Stat(finalPath); err == nil {
		if removeErr := os.Remove(tempPath); removeErr != nil {
			return "", removeErr
		}
		return finalPath, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if err := os.Rename(tempPath, finalPath); err != nil {
		return "", err
	}
	return finalPath, nil
}

func (s Store) SaveCover(userBookID, format string, reader io.Reader, limit int64) (domain.CoverFiles, error) {
	if err := s.Ensure(); err != nil {
		return domain.CoverFiles{}, err
	}
	temp, err := s.SaveTemp(reader, limit)
	if err != nil {
		return domain.CoverFiles{}, err
	}
	defer os.Remove(temp.Path)

	stamp := time.Now().UTC().UnixNano()
	thumbnailPath := filepath.Join(s.root, "covers", fmt.Sprintf("%s.%d.thumbnail.jpg", userBookID, stamp))
	if err := saveCoverThumbnail(temp.Path, thumbnailPath); err != nil {
		return domain.CoverFiles{}, err
	}

	finalPath := filepath.Join(s.root, "covers", fmt.Sprintf("%s.%d.%s", userBookID, stamp, format))
	if err := os.MkdirAll(filepath.Dir(finalPath), 0o755); err != nil {
		_ = os.Remove(thumbnailPath)
		return domain.CoverFiles{}, err
	}
	if err := os.Rename(temp.Path, finalPath); err != nil {
		_ = os.Remove(thumbnailPath)
		return domain.CoverFiles{}, err
	}
	return domain.CoverFiles{CoverPath: finalPath, CoverThumbPath: thumbnailPath}, nil
}

func DeleteBestEffort(path string) {
	if path != "" {
		_ = os.Remove(path)
	}
}

func saveCoverThumbnail(sourcePath, thumbnailPath string) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()

	config, _, err := image.DecodeConfig(source)
	if err != nil {
		return domain.ErrValidation
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > coverMaxPixels/config.Height {
		return domain.ErrValidation
	}
	if _, err := source.Seek(0, io.SeekStart); err != nil {
		return err
	}

	src, _, err := image.Decode(source)
	if err != nil {
		return domain.ErrValidation
	}

	bounds := thumbnailBounds(src.Bounds(), coverThumbnailMaxWidth, coverThumbnailMaxHeight)
	dst := image.NewRGBA(bounds)
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Over, nil)

	if err := os.MkdirAll(filepath.Dir(thumbnailPath), 0o755); err != nil {
		return err
	}
	output, err := os.Create(thumbnailPath)
	if err != nil {
		return err
	}
	defer output.Close()

	return jpeg.Encode(output, dst, &jpeg.Options{Quality: coverThumbnailQuality})
}

func thumbnailBounds(src image.Rectangle, maxWidth, maxHeight int) image.Rectangle {
	width := src.Dx()
	height := src.Dy()
	if width <= 0 || height <= 0 {
		return image.Rect(0, 0, 1, 1)
	}
	scale := math.Min(float64(maxWidth)/float64(width), float64(maxHeight)/float64(height))
	if scale > 1 {
		scale = 1
	}
	targetWidth := max(1, int(math.Round(float64(width)*scale)))
	targetHeight := max(1, int(math.Round(float64(height)*scale)))
	return image.Rect(0, 0, targetWidth, targetHeight)
}
