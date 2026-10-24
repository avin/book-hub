package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"book-hub/internal/backup"
	"book-hub/internal/config"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := run(ctx, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	if len(args) != 2 {
		return fmt.Errorf("usage: book-hub-backup create|validate|restore DIRECTORY")
	}
	cfg, err := config.LoadFileStorage()
	if err != nil {
		return err
	}
	options := backup.Options{DatabaseURL: cfg.DatabaseURL, FileStorage: cfg}
	switch args[0] {
	case "create":
		return backup.Create(ctx, options, args[1])
	case "validate":
		return backup.Validate(ctx, options, args[1])
	case "restore":
		return backup.Restore(ctx, options, args[1])
	default:
		return fmt.Errorf("usage: book-hub-backup create|validate|restore DIRECTORY")
	}
}
