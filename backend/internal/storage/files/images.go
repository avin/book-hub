package files

import (
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"math"
	"os"
	"path/filepath"
	"time"

	"book-hub/internal/domain"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	coverThumbnailMaxWidth  = 184
	coverThumbnailMaxHeight = 240
	coverThumbnailQuality   = 82
	coverMaxPixels          = 20_000_000
)

// Images owns the local original covers and their thumbnails.
type Images struct {
	root string
	work Workspace
}

func (s Images) Ensure() error { return os.MkdirAll(s.root, 0o755) }

func (s Images) SaveCover(userBookID, format string, reader io.Reader, limit int64) (domain.CoverFiles, error) {
	if err := s.Ensure(); err != nil {
		return domain.CoverFiles{}, err
	}
	temp, err := s.work.SaveTemp(reader, limit)
	if err != nil {
		return domain.CoverFiles{}, err
	}
	defer os.Remove(temp.Path)

	stamp := time.Now().UTC().UnixNano()
	thumbnailPath := filepath.Join(s.root, fmt.Sprintf("%s.%d.thumbnail.jpg", userBookID, stamp))
	if err := saveCoverThumbnail(temp.Path, thumbnailPath); err != nil {
		return domain.CoverFiles{}, err
	}

	finalPath := filepath.Join(s.root, fmt.Sprintf("%s.%d.%s", userBookID, stamp, format))
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
