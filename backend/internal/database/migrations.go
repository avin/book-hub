package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"strconv"
	"strings"

	"book-hub/migrations"
	"github.com/golang-migrate/migrate/v4"
	migrationdb "github.com/golang-migrate/migrate/v4/database"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	migratesqlite "github.com/golang-migrate/migrate/v4/database/sqlite"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

func schemaSource(driver string) string {
	if driver == "sqlite" {
		return "sqlite"
	}
	return "."
}

func ExpectedVersion(driver string) (uint, error) {
	entries, err := fs.ReadDir(migrations.Files, schemaSource(driver))
	if err != nil {
		return 0, err
	}
	var latest uint
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".up.sql") {
			continue
		}
		prefix, _, _ := strings.Cut(entry.Name(), "_")
		version, err := strconv.ParseUint(prefix, 10, 32)
		if err != nil {
			return 0, err
		}
		latest = max(latest, uint(version))
	}
	return latest, nil
}

func CheckSchema(ctx context.Context, rawURL string) error {
	conn, err := Parse(rawURL)
	if err != nil {
		return err
	}
	var db *sql.DB
	if conn.Driver == "sqlite" {
		db, err = OpenSQLite(ctx, rawURL, false)
	} else {
		db, err = sql.Open("pgx", rawURL)
	}
	if err != nil {
		return err
	}
	defer db.Close()
	var version uint
	var dirty bool
	if err := db.QueryRowContext(ctx, "select version, dirty from schema_migrations").Scan(&version, &dirty); err != nil {
		return fmt.Errorf("database schema is not prepared; run book-hub-migrate up: %w", err)
	}
	expected, err := ExpectedVersion(conn.Driver)
	if err != nil {
		return err
	}
	if dirty {
		return errors.New("database migration is unfinished; recover the migration before starting the application")
	}
	if version != expected {
		return fmt.Errorf("database schema version %d is incompatible with expected %d; use matching binaries or run migrations", version, expected)
	}
	return nil
}

func NewMigrator(ctx context.Context, rawURL string, create bool) (*migrate.Migrate, error) {
	conn, err := Parse(rawURL)
	if err != nil {
		return nil, err
	}
	source, err := iofs.New(migrations.Files, schemaSource(conn.Driver))
	if err != nil {
		return nil, err
	}
	var driver migrationdb.Driver
	if conn.Driver == "sqlite" {
		db, openErr := OpenSQLite(ctx, rawURL, create)
		if openErr != nil {
			source.Close()
			return nil, openErr
		}
		driver, err = migratesqlite.WithInstance(db, &migratesqlite.Config{})
		if err != nil {
			db.Close()
		}
	} else {
		driver, err = (&postgres.Postgres{}).Open(rawURL)
	}
	if err != nil {
		source.Close()
		return nil, err
	}
	m, err := migrate.NewWithInstance("iofs", source, conn.Driver, driver)
	if err != nil {
		source.Close()
		driver.Close()
	}
	return m, err
}

func Migrate(ctx context.Context, rawURL, action string) error {
	if action != "up" && action != "down" {
		return errors.New("migration action must be up or down")
	}
	m, err := NewMigrator(ctx, rawURL, action == "up")
	if err != nil {
		return err
	}
	defer m.Close()
	if action == "up" {
		err = m.Up()
	} else {
		err = m.Steps(-1)
	}
	if errors.Is(err, migrate.ErrNoChange) {
		return nil
	}
	return err
}
