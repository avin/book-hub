package main

import (
	"bufio"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"book-hub/internal/auth"
	"book-hub/internal/config"
	"book-hub/internal/domain"
	"book-hub/internal/storage/files"
	"book-hub/internal/storage/memory"
)

func TestDeleteUserPreservesOriginalUntilLastOwner(t *testing.T) {
	ctx := context.Background()
	store := memory.New()
	local := files.New(t.TempDir())
	temp, err := local.Work.SaveTemp(strings.NewReader("shared original"), 100)
	if err != nil {
		t.Fatal(err)
	}
	location, err := local.Books.MoveBook(ctx, temp.Path, temp.SHA256, "pdf")
	if err != nil {
		t.Fatal(err)
	}
	file := domain.BookFileInput{SHA256: temp.SHA256, SizeBytes: temp.Size, StoragePath: location, Format: "pdf"}
	for _, login := range []string{"first", "second"} {
		user, err := store.CreateUser(ctx, login, "password hash", true, 1024)
		if err != nil {
			t.Fatal(err)
		}
		book, err := store.CreateBook(ctx, user.ID, file, domain.BookInput{Title: "Shared"})
		if err != nil {
			t.Fatal(err)
		}
		coverPath := filepath.Join(local.Root(), login+".png")
		if err := os.WriteFile(coverPath, []byte("local cover"), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := store.SetCover(ctx, user.ID, book.ID, domain.CoverFiles{CoverPath: coverPath}); err != nil {
			t.Fatal(err)
		}
		storedFile, err := store.GetBookFileByHash(ctx, temp.SHA256)
		if err != nil || storedFile == nil {
			t.Fatalf("shared original: %v, %v", storedFile, err)
		}
		file.ID = storedFile.ID
	}
	for index, login := range []string{"first", "second"} {
		scanner := bufio.NewScanner(strings.NewReader(login + "\ny\n"))
		if err := deleteUser(ctx, scanner, store); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(filepath.Join(local.Root(), login+".png")); !os.IsNotExist(err) {
			t.Fatalf("deleted user's cover remains: %v", err)
		}
		if _, err := os.Stat(location); err != nil {
			t.Fatalf("admin must leave durable work for a stopped backend: %v", err)
		}
		if err := store.ProcessOriginalDeletions(ctx, local.Books.Delete); err != nil {
			t.Fatal(err)
		}
		_, err := os.Stat(location)
		if index == 0 && err != nil {
			t.Fatalf("shared original lost with remaining owner: %v", err)
		}
		if index == 1 && !os.IsNotExist(err) {
			t.Fatalf("unreferenced original remains: %v", err)
		}
	}
}

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

func TestAdminUsesConfiguredPasswordAlgorithm(t *testing.T) {
	ctx := context.Background()
	store := memory.New()
	cfg := config.Config{DefaultQuotaBytes: 100, PasswordAlgorithm: auth.PasswordPBKDF2SHA256}
	if err := createUser(ctx, bufio.NewScanner(strings.NewReader("reader\npassword\n")), store, cfg); err != nil {
		t.Fatal(err)
	}
	user, err := store.GetUserByLogin(ctx, "reader")
	if err != nil || !strings.HasPrefix(user.PasswordHash, "$pbkdf2-sha256$") || !auth.VerifyPassword("password", user.PasswordHash) {
		t.Fatalf("created user's password: %v", err)
	}
	if err := store.CreateSession(ctx, user.ID, "session", 60); err != nil {
		t.Fatal(err)
	}
	if err := setPassword(ctx, bufio.NewScanner(strings.NewReader("reader\nreplacement\n")), store, cfg); err != nil {
		t.Fatal(err)
	}
	user, err = store.GetUser(ctx, user.ID)
	if err != nil || !strings.HasPrefix(user.PasswordHash, "$pbkdf2-sha256$") || !auth.VerifyPassword("replacement", user.PasswordHash) || auth.VerifyPassword("password", user.PasswordHash) {
		t.Fatalf("changed user's password: %v", err)
	}
	if _, err := store.GetSession(ctx, "session"); err == nil {
		t.Fatal("password reset did not revoke sessions")
	}
}
