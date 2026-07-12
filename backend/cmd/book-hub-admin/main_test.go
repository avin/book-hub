package main

import (
	"bufio"
	"context"
	"strings"
	"testing"

	"book-hub/internal/config"
	"book-hub/internal/storage/memory"
)

func TestCreateUserActivatesAccount(t *testing.T) {
	store := memory.New()
	scanner := bufio.NewScanner(strings.NewReader("reader\npassword\n"))

	if err := createUser(context.Background(), scanner, store, config.Config{DefaultQuotaBytes: 100}); err != nil {
		t.Fatal(err)
	}

	user, err := store.GetUserByLogin(context.Background(), "reader")
	if err != nil {
		t.Fatal(err)
	}
	if !user.IsActive {
		t.Fatal("expected a user created by the admin CLI to be active")
	}
}
