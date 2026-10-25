package backup

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"book-hub/internal/config"
	"book-hub/internal/database"
	"book-hub/internal/storage/files"
)

type preparedRestore struct {
	staging   string
	inventory libraryInventory
}

func prepareRestore(ctx context.Context, options Options, directory string) (_ preparedRestore, resultErr error) {
	if err := validateLayout(options, directory); err != nil {
		return preparedRestore{}, err
	}
	connection, err := database.Parse(options.DatabaseURL)
	if err != nil {
		return preparedRestore{}, err
	}
	manifest := Manifest{Database: "postgres"}
	data, err := os.ReadFile(filepath.Join(directory, "manifest.json"))
	if err == nil {
		if err := json.Unmarshal(data, &manifest); err != nil {
			return preparedRestore{}, fmt.Errorf("invalid backup manifest: %w", err)
		}
		if manifest.FormatVersion != formatVersion || manifest.SchemaVersion < 1 {
			return preparedRestore{}, fmt.Errorf("unsupported backup format or schema version")
		}
	} else if !os.IsNotExist(err) {
		return preparedRestore{}, err
	}
	if manifest.Database != "postgres" && manifest.Database != "sqlite" {
		return preparedRestore{}, fmt.Errorf("unsupported backup database: %q", manifest.Database)
	}
	if manifest.Database != connection.Driver {
		return preparedRestore{}, fmt.Errorf("cannot restore %s backup into %s; database conversion is not supported", manifest.Database, connection.Driver)
	}
	databaseName := "database.sql"
	if connection.Driver == "sqlite" {
		databaseName = "database.sqlite"
	}
	for _, name := range []string{databaseName, "storage.tar.gz"} {
		info, err := os.Lstat(filepath.Join(directory, name))
		if err != nil {
			return preparedRestore{}, err
		}
		if !info.Mode().IsRegular() || info.Size() == 0 {
			return preparedRestore{}, fmt.Errorf("backup component must be a nonempty regular file: %s", name)
		}
	}
	staging, err := os.MkdirTemp("", "book-hub-restore-*")
	if err != nil {
		return preparedRestore{}, err
	}
	defer func() {
		if resultErr != nil {
			os.RemoveAll(staging)
		}
	}()
	if err := copyFile(filepath.Join(directory, databaseName), filepath.Join(staging, databaseName)); err != nil {
		return preparedRestore{}, err
	}
	inventory, err := readInventory(ctx, connection.Driver, staging)
	if err != nil {
		return preparedRestore{}, err
	}
	expected, err := database.ExpectedVersion(connection.Driver)
	if err != nil {
		return preparedRestore{}, err
	}
	if inventory.Version < 1 || inventory.Version > int64(expected) {
		return preparedRestore{}, fmt.Errorf("unsupported backup schema version %d", inventory.Version)
	}
	if manifest.FormatVersion != 0 && manifest.SchemaVersion != inventory.Version {
		return preparedRestore{}, fmt.Errorf("database schema version does not match backup manifest")
	}
	// Both the entire archive and every required original are checked before any
	// writes to the destination. Legacy service/tmp entries are only staged.
	if err := readArchive(filepath.Join(directory, "storage.tar.gz"), filepath.Join(staging, "storage")); err != nil {
		return preparedRestore{}, err
	}
	storage := filepath.Join(staging, "storage")
	if err := verifyInventory(ctx, storage, inventory); err != nil {
		return preparedRestore{}, err
	}
	// Keep database files apart from legacy archive entries named database.sqlite.
	return preparedRestore{staging: staging, inventory: inventory}, nil
}

func requireEmptyOriginals(ctx context.Context, options Options) error {
	originals, err := options.originals()
	if err != nil {
		return err
	}
	namespace, ok := originals.(files.OriginalNamespace)
	if !ok {
		return fmt.Errorf("selected original storage cannot check its destination namespace")
	}
	empty, err := namespace.Empty(ctx)
	if err != nil {
		return fmt.Errorf("check destination original storage: %w", err)
	}
	if !empty {
		return fmt.Errorf("destination original storage must be empty; clear only the dedicated destination before retrying")
	}
	return nil
}

func verifyInventory(ctx context.Context, storage string, inventory libraryInventory) error {
	for _, book := range inventory.Books {
		input, err := os.Open(filepath.Join(storage, filepath.FromSlash(book.archiveName())))
		if err != nil {
			return fmt.Errorf("required original missing from backup: %w", err)
		}
		err = copyVerified(ctx, io.Discard, input, book)
		input.Close()
		if err != nil {
			return err
		}
	}
	for _, cover := range inventory.Covers {
		for _, location := range []struct {
			value string
			valid bool
		}{{cover.Cover.String, cover.Cover.Valid}, {cover.Thumbnail.String, cover.Thumbnail.Valid}} {
			if !location.valid {
				continue
			}
			name, err := imageName(location.value)
			if err != nil {
				return err
			}
			info, err := os.Lstat(filepath.Join(storage, "covers", name))
			if err != nil {
				return fmt.Errorf("required image missing from backup: %w", err)
			}
			if !info.Mode().IsRegular() {
				return fmt.Errorf("required image must be a regular file")
			}
		}
	}
	return ctx.Err()
}

func copyVerified(ctx context.Context, destination io.Writer, source io.Reader, book bookRecord) error {
	hasher := sha256.New()
	written, err := io.Copy(io.MultiWriter(destination, hasher), io.LimitReader(backupReader{ctx, source}, book.Size+1))
	if err != nil {
		return err
	}
	if written != book.Size || hex.EncodeToString(hasher.Sum(nil)) != book.Hash {
		return fmt.Errorf("original %s size or SHA-256 mismatch", book.ID)
	}
	return nil
}

type backupReader struct {
	context.Context
	io.Reader
}

func (r backupReader) Read(data []byte) (int, error) {
	if err := r.Err(); err != nil {
		return 0, err
	}
	return r.Reader.Read(data)
}

func archiveLibrary(ctx context.Context, cfg config.Config, originals files.Originals, inventory libraryInventory, outputPath string) (resultErr error) {
	output, err := os.OpenFile(outputPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer output.Close()
	compressed := gzip.NewWriter(output)
	defer compressed.Close()
	archive := tar.NewWriter(compressed)
	defer archive.Close()
	for _, book := range inventory.Books {
		if err := archive.WriteHeader(&tar.Header{Name: book.archiveName(), Mode: 0600, Typeflag: tar.TypeReg, Size: book.Size, ModTime: time.Now()}); err != nil {
			return err
		}
		input, err := originals.Open(ctx, book.Location)
		if err != nil {
			return fmt.Errorf("backup original: %w", err)
		}
		err = copyVerified(ctx, archive, input, book)
		closeErr := input.Close()
		if err != nil {
			return fmt.Errorf("backup original: %w", err)
		}
		if closeErr != nil {
			return closeErr
		}
	}
	_, images, _ := cfg.FilePaths()
	// The configured root may be a symlink, but links inside its tree remain
	// unsupported so the archive cannot escape the selected image directory.
	images, err = resolvePath(images)
	if err != nil {
		return err
	}
	err = filepath.WalkDir(images, func(filePath string, entry os.DirEntry, walkErr error) error {
		if os.IsNotExist(walkErr) && filePath == images {
			return nil
		}
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if filePath == images {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.IsDir() && !info.Mode().IsRegular() {
			return fmt.Errorf("images contain an unsupported file: %s", filePath)
		}
		header, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(images, filePath)
		if err != nil {
			return err
		}
		header.Name = "covers/" + filepath.ToSlash(relative)
		if err := archive.WriteHeader(header); err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		input, err := os.Open(filePath)
		if err != nil {
			return err
		}
		_, err = io.Copy(archive, backupReader{ctx, input})
		closeErr := input.Close()
		if err != nil {
			return err
		}
		return closeErr
	})
	if err != nil {
		return err
	}
	// Missing referenced images make a backup incomplete too.
	for _, cover := range inventory.Covers {
		for _, location := range []struct {
			value string
			valid bool
		}{{cover.Cover.String, cover.Cover.Valid}, {cover.Thumbnail.String, cover.Thumbnail.Valid}} {
			if location.valid {
				name, err := imageName(location.value)
				if err != nil {
					return err
				}
				if _, err := os.Stat(filepath.Join(images, name)); err != nil {
					return err
				}
			}
		}
	}
	if err := archive.Close(); err != nil {
		return err
	}
	if err := compressed.Close(); err != nil {
		return err
	}
	return output.Close()
}
