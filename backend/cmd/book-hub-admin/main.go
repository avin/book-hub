package main

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"

	"book-hub/internal/auth"
	"book-hub/internal/config"
	"book-hub/internal/domain"
	"book-hub/internal/storage/db"
	"book-hub/internal/storage/files"
	"github.com/google/uuid"
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
	ctx := context.Background()
	store, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer store.Close()
	fileStore := files.New(cfg.StorageDir)
	scanner := bufio.NewScanner(os.Stdin)
	fmt.Println("Book Hub admin CLI")
	for {
		fmt.Print("admin> ")
		if !scanner.Scan() {
			return scanner.Err()
		}
		command := strings.TrimSpace(scanner.Text())
		switch command {
		case "", "help":
			printHelp()
		case "list users":
			if err := listUsers(ctx, store); err != nil {
				fmt.Fprintln(os.Stderr, err)
			}
		case "show user":
			if err := showUser(ctx, scanner, store); err != nil {
				fmt.Fprintln(os.Stderr, err)
			}
		case "create user":
			if err := createUser(ctx, scanner, store, cfg); err != nil {
				fmt.Fprintln(os.Stderr, err)
			}
		case "activate user":
			if err := setActive(ctx, scanner, store, true); err != nil {
				fmt.Fprintln(os.Stderr, err)
			}
		case "disable user":
			if err := setActive(ctx, scanner, store, false); err != nil {
				fmt.Fprintln(os.Stderr, err)
			}
		case "delete user":
			if err := deleteUser(ctx, scanner, store); err != nil {
				fmt.Fprintln(os.Stderr, err)
			}
		case "set quota":
			if err := setQuota(ctx, scanner, store); err != nil {
				fmt.Fprintln(os.Stderr, err)
			}
		case "set password":
			if err := setPassword(ctx, scanner, store); err != nil {
				fmt.Fprintln(os.Stderr, err)
			}
		case "show storage stats":
			fmt.Println("storage:", fileStore.Root())
		case "quit", "exit":
			return nil
		default:
			fmt.Println("unknown command; type help")
		}
	}
}

type adminStore interface {
	CreateUser(context.Context, string, string, bool, int64) (domain.User, error)
	GetUser(context.Context, uuid.UUID) (domain.UserWithPassword, error)
	GetUserByLogin(context.Context, string) (domain.UserWithPassword, error)
	SetUserActive(context.Context, uuid.UUID, bool) error
	SetUserPassword(context.Context, uuid.UUID, string) error
	SetUserQuota(context.Context, uuid.UUID, int64) error
	DeleteUser(context.Context, uuid.UUID) ([]domain.DeletedBookFiles, error)
	ListUsers(context.Context) ([]domain.User, error)
	RevokeUserSessions(context.Context, uuid.UUID, *string) error
}

func printHelp() {
	fmt.Println("commands: list users, show user, create user, activate user, disable user, delete user, set quota, set password, show storage stats, quit")
}

func listUsers(ctx context.Context, store adminStore) error {
	users, err := store.ListUsers(ctx)
	if err != nil {
		return err
	}
	for _, user := range users {
		fmt.Printf("%s\t%s\tactive=%t\tquota=%d\tused=%d\n", user.ID, user.Login, user.IsActive, user.QuotaBytes, user.UsedBytes)
	}
	return nil
}

func showUser(ctx context.Context, scanner *bufio.Scanner, store adminStore) error {
	user, err := readUser(ctx, scanner, store)
	if err != nil {
		return err
	}
	fmt.Printf("id: %s\nlogin: %s\nactive: %t\nquota_bytes: %d\nused_bytes: %d\ncreated_at: %s\n", user.ID, user.Login, user.IsActive, user.QuotaBytes, user.UsedBytes, user.CreatedAt)
	return nil
}

func createUser(ctx context.Context, scanner *bufio.Scanner, store adminStore, cfg config.Config) error {
	login, err := domain.NormalizeLogin(prompt(scanner, "login"))
	if err != nil {
		return err
	}
	password := prompt(scanner, "password")
	if err := domain.ValidatePassword(password); err != nil {
		return err
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	user, err := store.CreateUser(ctx, login, hash, false, cfg.DefaultQuotaBytes)
	if err != nil {
		return err
	}
	fmt.Println("created:", user.ID)
	return nil
}

func setActive(ctx context.Context, scanner *bufio.Scanner, store adminStore, active bool) error {
	user, err := readUser(ctx, scanner, store)
	if err != nil {
		return err
	}
	if !active && !confirm(scanner, "disable user and revoke sessions?") {
		return nil
	}
	if err := store.SetUserActive(ctx, user.ID, active); err != nil {
		return err
	}
	if !active {
		return store.RevokeUserSessions(ctx, user.ID, nil)
	}
	return nil
}

func deleteUser(ctx context.Context, scanner *bufio.Scanner, store adminStore) error {
	user, err := readUser(ctx, scanner, store)
	if err != nil {
		return err
	}
	if !confirm(scanner, "delete user permanently?") {
		return nil
	}
	deleted, err := store.DeleteUser(ctx, user.ID)
	if err != nil {
		return err
	}
	for _, item := range deleted {
		files.DeleteBestEffort(item.CoverPath)
		files.DeleteBestEffort(item.BookPath)
	}
	return nil
}

func setQuota(ctx context.Context, scanner *bufio.Scanner, store adminStore) error {
	user, err := readUser(ctx, scanner, store)
	if err != nil {
		return err
	}
	value, err := strconv.ParseInt(prompt(scanner, "quota bytes"), 10, 64)
	if err != nil {
		return err
	}
	if value < user.UsedBytes {
		return domain.ErrQuotaExceeded
	}
	return store.SetUserQuota(ctx, user.ID, value)
}

func setPassword(ctx context.Context, scanner *bufio.Scanner, store adminStore) error {
	user, err := readUser(ctx, scanner, store)
	if err != nil {
		return err
	}
	password := prompt(scanner, "new password")
	if err := domain.ValidatePassword(password); err != nil {
		return err
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	if err := store.SetUserPassword(ctx, user.ID, hash); err != nil {
		return err
	}
	return store.RevokeUserSessions(ctx, user.ID, nil)
}

func readUser(ctx context.Context, scanner *bufio.Scanner, store adminStore) (domain.UserWithPassword, error) {
	value := prompt(scanner, "user login or id")
	if id, err := uuid.Parse(value); err == nil {
		return store.GetUser(ctx, id)
	}
	login, err := domain.NormalizeLogin(value)
	if err != nil {
		return domain.UserWithPassword{}, err
	}
	return store.GetUserByLogin(ctx, login)
}

func prompt(scanner *bufio.Scanner, label string) string {
	fmt.Print(label + ": ")
	if !scanner.Scan() {
		return ""
	}
	return strings.TrimSpace(scanner.Text())
}

func confirm(scanner *bufio.Scanner, question string) bool {
	answer := strings.ToLower(prompt(scanner, question+" [y/N]"))
	return answer == "y" || answer == "yes"
}
