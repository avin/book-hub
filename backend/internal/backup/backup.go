// Package backup saves and restores a database together with its file storage.
// Callers must stop the server and exclude other writers for the entire operation.
package backup

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"book-hub/internal/config"
	"book-hub/internal/database"
	"book-hub/internal/storage/files"
	_ "github.com/jackc/pgx/v5/stdlib"
)

const formatVersion = 1

type Options struct {
	DatabaseURL string
	StorageDir  string
	FileStorage config.Config
	Originals   files.Originals
}

type Manifest struct {
	FormatVersion int    `json:"format_version"`
	Database      string `json:"database"`
	SchemaVersion int64  `json:"schema_version"`
}

func (o Options) fileConfig() config.Config {
	cfg := o.FileStorage
	if cfg.StorageDir == "" {
		cfg.StorageDir = o.StorageDir
	}
	return cfg
}

func (o Options) originals() (files.Originals, error) {
	if o.Originals != nil {
		return o.Originals, nil
	}
	return files.NewOriginals(o.fileConfig())
}

func Create(ctx context.Context, options Options, directory string) error {
	if err := validateLayout(options, directory); err != nil {
		return err
	}
	connection, err := database.Parse(options.DatabaseURL)
	if err != nil {
		return err
	}
	if err := database.CheckSchema(ctx, options.DatabaseURL); err != nil {
		return err
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return err
	}
	if len(entries) != 0 {
		return fmt.Errorf("backup directory must be empty")
	}
	version, err := schemaVersion(ctx, options.DatabaseURL)
	if err != nil {
		return err
	}
	if connection.Driver == "sqlite" {
		db, err := database.OpenSQLite(ctx, options.DatabaseURL, false)
		if err != nil {
			return err
		}
		_, err = db.ExecContext(ctx, "VACUUM INTO ?", filepath.Join(directory, "database.sqlite"))
		closeErr := db.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
	} else if err := dumpPostgres(ctx, connection.URL, filepath.Join(directory, "database.sql")); err != nil {
		return err
	}
	inventory, err := readInventory(ctx, connection.Driver, directory)
	if err != nil {
		return err
	}
	originals, err := options.originals()
	if err != nil {
		return err
	}
	if err := archiveLibrary(ctx, options.fileConfig(), originals, inventory, filepath.Join(directory, "storage.tar.gz")); err != nil {
		return err
	}
	data, err := json.MarshalIndent(Manifest{formatVersion, connection.Driver, version}, "", "  ")
	if err != nil {
		return err
	}
	// Written last: an incomplete backup is never advertised as a complete copy.
	return os.WriteFile(filepath.Join(directory, "manifest.json"), append(data, '\n'), 0600)
}

func Validate(ctx context.Context, options Options, directory string) error {
	prepared, err := prepareRestore(ctx, options, directory)
	if err != nil {
		return err
	}
	defer os.RemoveAll(prepared.staging)
	return requireEmptyOriginals(ctx, options)
}

func Restore(ctx context.Context, options Options, directory string) error {
	prepared, err := prepareRestore(ctx, options, directory)
	if err != nil {
		return err
	}
	defer os.RemoveAll(prepared.staging)
	if err := requireEmptyOriginals(ctx, options); err != nil {
		return err
	}
	originals, err := options.originals()
	if err != nil {
		return err
	}
	for _, book := range prepared.inventory.Books {
		source := filepath.Join(prepared.staging, "storage", filepath.FromSlash(book.archiveName()))
		if _, err := originals.MoveBook(ctx, source, book.Hash, book.Format); err != nil {
			return fmt.Errorf("restore original: %w", err)
		}
	}
	_, images, _ := options.fileConfig().FilePaths()
	if _, err := os.Stat(filepath.Join(prepared.staging, "storage", "covers")); err == nil {
		if err := copyTree(filepath.Join(prepared.staging, "storage", "covers"), images); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	connection, _ := database.Parse(options.DatabaseURL)
	if connection.Driver == "sqlite" {
		stagedDB := filepath.Join(prepared.staging, "database.sqlite")
		if err := database.Migrate(ctx, sqliteURL(stagedDB), "up"); err != nil {
			return err
		}
		if err := rewriteLocations(ctx, sqliteURL(stagedDB), prepared.inventory, originals, images); err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(connection.SQLitePath), 0700); err != nil {
			return err
		}
		staged, err := os.CreateTemp(filepath.Dir(connection.SQLitePath), ".restore-*.sqlite")
		if err != nil {
			return err
		}
		stagedPath := staged.Name()
		staged.Close()
		defer os.Remove(stagedPath)
		if err := copyFile(stagedDB, stagedPath); err != nil {
			return err
		}
		for _, suffix := range []string{"-wal", "-shm", "-journal"} {
			if err := os.Remove(connection.SQLitePath + suffix); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
		return os.Rename(stagedPath, connection.SQLitePath)
	}
	input, err := os.Open(filepath.Join(directory, "database.sql"))
	if err != nil {
		return err
	}
	defer input.Close()
	tool, err := postgresTool(ctx, connection.URL, "psql")
	if err != nil {
		return err
	}
	command := exec.CommandContext(ctx, tool, "--dbname", connection.URL, "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--single-transaction")
	command.Stdin, command.Stdout, command.Stderr = input, io.Discard, os.Stderr
	if err := command.Run(); err != nil {
		return fmt.Errorf("restore PostgreSQL: %w", err)
	}
	if err := database.Migrate(ctx, connection.URL, "up"); err != nil {
		return err
	}
	return rewriteLocations(ctx, connection.URL, prepared.inventory, originals, images)
}
func validateLayout(options Options, directory string) error {
	cfg := options.fileConfig()
	if err := cfg.ValidateFileStorage(); err != nil {
		return err
	}
	if cfg.StorageDir == "" {
		return fmt.Errorf("BOOK_HUB_STORAGE_DIR is required")
	}
	storagePath, err := resolvePath(cfg.StorageDir)
	if err != nil {
		return err
	}
	backupPath, err := resolvePath(directory)
	if err != nil {
		return err
	}
	if filepath.Dir(storagePath) == storagePath {
		return fmt.Errorf("storage directory must name a non-root directory")
	}
	if containsPath(storagePath, backupPath) || containsPath(backupPath, storagePath) {
		return fmt.Errorf("backup and storage directories must not contain each other")
	}
	books, images, work := cfg.FilePaths()
	separate := []string{images, work}
	if cfg.BookStorage == "" || cfg.BookStorage == "directory" {
		separate = append(separate, books)
	}
	for i, name := range separate {
		resolved, err := resolvePath(name)
		if err != nil {
			return err
		}
		for _, previous := range separate[:i] {
			if containsPath(previous, resolved) || containsPath(resolved, previous) {
				return fmt.Errorf("originals, images and workspace directories must not overlap through symlinks")
			}
		}
		separate[i] = resolved
	}
	localPaths := []string{storagePath, images, work}
	if cfg.BookStorage == "" || cfg.BookStorage == "directory" {
		localPaths = append(localPaths, books)
	}
	for i, path := range localPaths {
		resolved, err := resolvePath(path)
		if err != nil {
			return err
		}
		if filepath.Dir(resolved) == resolved || containsPath(resolved, backupPath) || containsPath(backupPath, resolved) {
			return fmt.Errorf("backup and local storage directories must not contain each other")
		}
		localPaths[i] = resolved
	}
	connection, err := database.Parse(options.DatabaseURL)
	if err != nil {
		return err
	}
	if connection.Driver == "sqlite" {
		databasePath, err := resolvePath(connection.SQLitePath)
		if err != nil {
			return err
		}
		if containsPath(backupPath, databasePath) {
			return fmt.Errorf("SQLite database must be outside storage and backup directories")
		}
		for _, path := range localPaths {
			if containsPath(path, databasePath) {
				return fmt.Errorf("SQLite database must be outside storage and backup directories")
			}
		}
	}
	return nil
}

func containsPath(parent, child string) bool {
	relative, err := filepath.Rel(parent, child)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

// Resolve existing ancestors too, so a missing target below a symlink cannot
// bypass the separation check before its first restore.
func resolvePath(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err == nil {
		return resolved, nil
	}
	if !os.IsNotExist(err) {
		return "", err
	}
	parent := filepath.Dir(absolute)
	if parent == absolute {
		return "", err
	}
	resolvedParent, err := resolvePath(parent)
	if err != nil {
		return "", err
	}
	return filepath.Join(resolvedParent, filepath.Base(absolute)), nil
}

func schemaVersion(ctx context.Context, rawURL string) (int64, error) {
	connection, err := database.Parse(rawURL)
	if err != nil {
		return 0, err
	}
	var db *sql.DB
	if connection.Driver == "sqlite" {
		db, err = database.OpenSQLite(ctx, rawURL, false)
	} else {
		db, err = sql.Open("pgx", connection.URL)
	}
	if err != nil {
		return 0, err
	}
	defer db.Close()
	var version int64
	var dirty bool
	if err := db.QueryRowContext(ctx, "SELECT version, dirty FROM schema_migrations").Scan(&version, &dirty); err != nil {
		return 0, err
	}
	if dirty {
		return 0, fmt.Errorf("database schema has an unfinished migration")
	}
	return version, nil
}

func dumpPostgres(ctx context.Context, rawURL, path string) error {
	tool, err := postgresTool(ctx, rawURL, "pg_dump")
	if err != nil {
		return err
	}
	output, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	command := exec.CommandContext(ctx, tool, "--dbname", rawURL, "--clean", "--if-exists", "--no-owner", "--no-privileges")
	command.Stdout = output
	command.Stderr = os.Stderr
	runErr := command.Run()
	closeErr := output.Close()
	if runErr != nil {
		return fmt.Errorf("dump PostgreSQL: %w", runErr)
	}
	return closeErr
}

// Use the server's major version: newer dumps can contain SET commands that an
// older server cannot restore, even when the dump itself succeeds.
func postgresTool(ctx context.Context, rawURL, name string) (string, error) {
	db, err := sql.Open("pgx", rawURL)
	if err != nil {
		return "", err
	}
	defer db.Close()
	var version int
	if err := db.QueryRowContext(ctx, "SHOW server_version_num").Scan(&version); err != nil {
		return "", err
	}
	major := version / 10000
	// Alpine keeps parallel client versions here. Host installations can use PATH.
	versioned := fmt.Sprintf("/usr/libexec/postgresql%d/%s", major, name)
	if path, err := exec.LookPath(versioned); err == nil {
		return path, nil
	}
	if path, err := exec.LookPath(name); err == nil {
		output, err := exec.CommandContext(ctx, path, "--version").Output()
		if err == nil {
			for _, field := range strings.Fields(string(output)) {
				prefix, _, _ := strings.Cut(field, ".")
				if clientMajor, err := strconv.Atoi(prefix); err == nil && clientMajor == major {
					return path, nil
				}
			}
		}
	}
	return "", fmt.Errorf("PostgreSQL %d requires a matching %s client; install PostgreSQL %d client tools", major, name, major)
}

func sqliteURL(path string) string {
	path, _ = filepath.Abs(path)
	path = filepath.ToSlash(path)
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return (&url.URL{Scheme: "sqlite", Path: path}).String()
}

func copyFile(source, target string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	syncErr := output.Sync()
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	if syncErr != nil {
		return syncErr
	}
	return closeErr
}

func copyTree(source, target string) error {
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		destination := filepath.Join(target, relative)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0700)
		}
		return copyFile(path, destination)
	})
}
