package main

import (
	"context"
	"errors"
	"fmt"
	"os"

	"book-hub/internal/database"
	"github.com/golang-migrate/migrate/v4"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) != 1 || (args[0] != "up" && args[0] != "down" && args[0] != "version") {
		return fmt.Errorf("usage: book-hub-migrate up|down|version")
	}
	rawURL := os.Getenv("BOOK_HUB_DATABASE_URL")
	if args[0] != "version" {
		return database.Migrate(context.Background(), rawURL, args[0])
	}
	m, err := database.NewMigrator(context.Background(), rawURL, false)
	if err != nil {
		return err
	}
	defer m.Close()
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
}
