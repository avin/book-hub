package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"

	"book-hub/internal/config"
	"book-hub/internal/httpapi"
	"book-hub/internal/storage/files"
	"book-hub/internal/storage/sqlstore"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.DatabaseURL == "" {
		return fmt.Errorf("BOOK_HUB_DATABASE_URL is required")
	}
	logger := httpapi.NewJSONLogger(cfg.LogLevel)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	store, err := sqlstore.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer store.Close()

	fileStore, err := files.NewConfigured(cfg)
	if err != nil {
		return err
	}
	fileStore.SetLogger(logger)
	if err := fileStore.Ensure(); err != nil {
		return err
	}
	server := httpapi.New(cfg, store, fileStore, logger)
	workerCtx, cancelWorker := context.WithCancel(ctx)
	workerDone := make(chan struct{})
	go func() {
		defer close(workerDone)
		server.RunOriginalDeletions(workerCtx)
	}()
	defer func() {
		cancelWorker()
		<-workerDone
	}()
	logger.Info("starting book hub server", "addr", cfg.HTTPAddr, "api_base", config.APIBasePath(cfg.BasePath))
	return httpapi.ListenAndServe(ctx, cfg.HTTPAddr, server, logger)
}
