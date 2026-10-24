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

	"book-hub/internal/database"
	_ "github.com/jackc/pgx/v5/stdlib"
)

const formatVersion = 1

type Options struct {
	DatabaseURL string
	StorageDir  string
}

type Manifest struct {
	FormatVersion int    `json:"format_version"`
	Database      string `json:"database"`
	SchemaVersion int64  `json:"schema_version"`
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
		// VACUUM INTO reads the complete database snapshot, including committed WAL data.
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
	if err := archiveStorage(options.StorageDir, filepath.Join(directory, "storage.tar.gz")); err != nil {
		return err
	}
	data, err := json.MarshalIndent(Manifest{formatVersion, connection.Driver, version}, "", "  ")
	if err != nil {
		return err
	}
	// Written last: an incomplete backup is never advertised as a new-format copy.
	return os.WriteFile(filepath.Join(directory, "manifest.json"), append(data, '\n'), 0600)
}

func Validate(ctx context.Context, options Options, directory string) error {
	_, err := validate(ctx, options, directory)
	return err
}

func validate(ctx context.Context, options Options, directory string) (Manifest, error) {
	if err := validateLayout(options, directory); err != nil {
		return Manifest{}, err
	}
	connection, err := database.Parse(options.DatabaseURL)
	if err != nil {
		return Manifest{}, err
	}
	manifest := Manifest{Database: "postgres"} // Legacy PostgreSQL backups have no manifest.
	data, err := os.ReadFile(filepath.Join(directory, "manifest.json"))
	if err == nil {
		if err := json.Unmarshal(data, &manifest); err != nil {
			return Manifest{}, fmt.Errorf("invalid backup manifest: %w", err)
		}
		if manifest.FormatVersion != formatVersion || manifest.SchemaVersion < 1 {
			return Manifest{}, fmt.Errorf("unsupported backup format or schema version")
		}
	} else if !os.IsNotExist(err) {
		return Manifest{}, err
	}
	if manifest.Database != "postgres" && manifest.Database != "sqlite" {
		return Manifest{}, fmt.Errorf("unsupported backup database: %q", manifest.Database)
	}
	if manifest.Database != connection.Driver {
		return Manifest{}, fmt.Errorf("cannot restore %s backup into %s; database conversion is not supported", manifest.Database, connection.Driver)
	}
	if manifest.FormatVersion != 0 {
		expected, err := database.ExpectedVersion(connection.Driver)
		if err != nil {
			return Manifest{}, err
		}
		if manifest.SchemaVersion > int64(expected) {
			return Manifest{}, fmt.Errorf("backup schema version %d is newer than supported %d", manifest.SchemaVersion, expected)
		}
	}
	name := "database.sql"
	if manifest.Database == "sqlite" {
		name = "database.sqlite"
	}
	for _, name := range []string{name, "storage.tar.gz"} {
		info, err := os.Lstat(filepath.Join(directory, name))
		if err != nil {
			return Manifest{}, err
		}
		if !info.Mode().IsRegular() || info.Size() == 0 {
			return Manifest{}, fmt.Errorf("backup component must be a nonempty regular file: %s", name)
		}
	}
	if manifest.Database == "sqlite" {
		// Checking schema and integrity in a temporary copy keeps validation read-only
		// even when SQLite opens a WAL-mode database.
		tempDir, err := os.MkdirTemp("", "book-hub-validate-*")
		if err != nil {
			return Manifest{}, err
		}
		defer os.RemoveAll(tempDir)
		path := filepath.Join(tempDir, name)
		if err := copyFile(filepath.Join(directory, name), path); err != nil {
			return Manifest{}, err
		}
		rawURL := sqliteURL(path)
		version, err := schemaVersion(ctx, rawURL)
		if err != nil {
			return Manifest{}, err
		}
		if version != manifest.SchemaVersion {
			return Manifest{}, fmt.Errorf("SQLite schema version does not match backup manifest")
		}
		db, err := database.OpenSQLite(ctx, rawURL, false)
		if err != nil {
			return Manifest{}, err
		}
		defer db.Close()
		var integrity string
		if err := db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&integrity); err != nil {
			return Manifest{}, err
		}
		if integrity != "ok" {
			return Manifest{}, fmt.Errorf("SQLite integrity check failed: %s", integrity)
		}
	}
	if err := readArchive(filepath.Join(directory, "storage.tar.gz"), ""); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func Restore(ctx context.Context, options Options, directory string) error {
	if err := validateLayout(options, directory); err != nil {
		return err
	}
	manifest, err := validate(ctx, options, directory)
	if err != nil {
		return err
	}
	connection, err := database.Parse(options.DatabaseURL)
	if err != nil {
		return err
	}
	storage, err := filepath.Abs(options.StorageDir)
	if err != nil || options.StorageDir == "" || filepath.Dir(storage) == storage {
		return fmt.Errorf("storage directory must name a non-root directory")
	}
	// Unpack and verify every entry before replacing any current data.
	tempDir, err := os.MkdirTemp("", "book-hub-restore-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tempDir)
	if err := readArchive(filepath.Join(directory, "storage.tar.gz"), tempDir); err != nil {
		return err
	}
	if manifest.Database == "sqlite" {
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
		if err := copyFile(filepath.Join(directory, "database.sqlite"), stagedPath); err != nil {
			return err
		}
		for _, suffix := range []string{"-wal", "-shm", "-journal"} {
			if err := os.Remove(connection.SQLitePath + suffix); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
		if err := os.Rename(stagedPath, connection.SQLitePath); err != nil {
			return err
		}
	} else {
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
		command.Stdin = input
		command.Stdout = io.Discard
		command.Stderr = os.Stderr
		if err := command.Run(); err != nil {
			return fmt.Errorf("restore PostgreSQL: %w", err)
		}
	}
	if err := os.MkdirAll(storage, 0700); err != nil {
		return err
	}
	entries, err := os.ReadDir(storage)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := os.RemoveAll(filepath.Join(storage, entry.Name())); err != nil {
			return err
		}
	}
	// Copy rather than rename because staging and storage may be separate volumes.
	return copyTree(tempDir, storage)
}

func validateLayout(options Options, directory string) error {
	if options.StorageDir == "" {
		return fmt.Errorf("BOOK_HUB_STORAGE_DIR is required")
	}
	storagePath, err := resolvePath(options.StorageDir)
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
	connection, err := database.Parse(options.DatabaseURL)
	if err != nil {
		return err
	}
	if connection.Driver == "sqlite" {
		databasePath, err := resolvePath(connection.SQLitePath)
		if err != nil {
			return err
		}
		if containsPath(storagePath, databasePath) || containsPath(backupPath, databasePath) {
			return fmt.Errorf("SQLite database must be outside storage and backup directories")
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
