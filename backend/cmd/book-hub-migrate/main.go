package main

import (
	"errors"
	"fmt"
	"os"

	"book-hub/internal/config"
	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("usage: book-hub-migrate up|down|version")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.DatabaseURL == "" {
		return fmt.Errorf("BOOK_HUB_DATABASE_URL is required")
	}
	migrationsPath, err := findMigrationsPath()
	if err != nil {
		return err
	}
	m, err := migrate.New("file://"+migrationsPath, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer m.Close()

	switch args[0] {
	case "up":
		err = m.Up()
		if errors.Is(err, migrate.ErrNoChange) {
			return nil
		}
		return err
	case "down":
		err = m.Steps(-1)
		if errors.Is(err, migrate.ErrNoChange) {
			return nil
		}
		return err
	case "version":
		version, dirty, err := m.Version()
		if errors.Is(err, migrate.ErrNilVersion) {
			fmt.Println("version: none")
			return nil
		}
		if err != nil {
			return err
		}
		fmt.Printf("version: %d dirty: %t\n", version, dirty)
		return nil
	default:
		return fmt.Errorf("usage: book-hub-migrate up|down|version")
	}
}

func findMigrationsPath() (string, error) {
	for _, path := range []string{"backend/migrations", "migrations"} {
		info, err := os.Stat(path)
		if err == nil && info.IsDir() {
			return path, nil
		}
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
	}
	return "", fmt.Errorf("migrations directory not found")
}
