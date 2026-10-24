package contract

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"testing"

	"book-hub/internal/domain"
	"github.com/google/uuid"
)

func runAccountContract(t *testing.T, newStore NewStore) {
	t.Helper()
	t.Run("isolated settings and session lifecycle", func(t *testing.T) {
		ctx := context.Background()
		store, first := readerStore(t, newStore)
		second, err := store.CreateUser(ctx, "second", "second-hash", true, 10000)
		if err != nil {
			t.Fatal(err)
		}
		settings := json.RawMessage(`{"theme":"dark","reader":{"zoom":1.25}}`)
		if err := store.PutSettings(ctx, first.ID, settings); err != nil {
			t.Fatal(err)
		}
		got, err := store.GetSettings(ctx, first.ID)
		if err != nil {
			t.Fatal(err)
		}
		var wantValue, gotValue any
		if err := json.Unmarshal(settings, &wantValue); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(got, &gotValue); err != nil || !reflect.DeepEqual(gotValue, wantValue) {
			t.Fatalf("settings round trip: raw=%s err=%v", got, err)
		}
		got, err = store.GetSettings(ctx, second.ID)
		if err != nil || string(got) != "{}" {
			t.Fatalf("another user's default settings: raw=%s err=%v", got, err)
		}
		if err := store.PutSettings(ctx, uuid.New(), settings); !errors.Is(err, domain.ErrNotFound) {
			t.Fatalf("missing user's settings update: %v", err)
		}

		keep, revoke, foreign, expired := tokenHash(), tokenHash(), tokenHash(), tokenHash()
		for _, token := range []string{keep, revoke} {
			if err := store.CreateSession(ctx, first.ID, token, 60); err != nil {
				t.Fatal(err)
			}
		}
		if err := store.CreateSession(ctx, second.ID, foreign, 60); err != nil {
			t.Fatal(err)
		}
		if err := store.CreateSession(ctx, first.ID, expired, -1); err != nil {
			t.Fatal(err)
		}
		assertUnauthorized := func(token string) {
			t.Helper()
			if _, err := store.GetSession(ctx, token); !errors.Is(err, domain.ErrUnauthorized) {
				t.Fatalf("unusable session %s: %v", token, err)
			}
		}
		assertSession := func(token string, userID uuid.UUID) {
			t.Helper()
			got, err := store.GetSession(ctx, token)
			if err != nil || got != userID {
				t.Fatalf("session owner: got=%s want=%s err=%v", got, userID, err)
			}
		}
		assertUnauthorized(expired)
		assertUnauthorized(tokenHash())
		if err := store.RevokeUserSessions(ctx, first.ID, &keep); err != nil {
			t.Fatal(err)
		}
		assertSession(keep, first.ID)
		assertUnauthorized(revoke)
		assertSession(foreign, second.ID)
		if err := store.SetUserActive(ctx, first.ID, false); err != nil {
			t.Fatal(err)
		}
		assertUnauthorized(keep)
		if err := store.SetUserActive(ctx, first.ID, true); err != nil {
			t.Fatal(err)
		}
		assertUnauthorized(keep)
		if err := store.RevokeUserSessions(ctx, second.ID, nil); err != nil {
			t.Fatal(err)
		}
		assertUnauthorized(foreign)
		if err := store.SetUserPassword(ctx, first.ID, "replacement-hash"); err != nil {
			t.Fatal(err)
		}
		user, err := store.GetUserByLogin(ctx, first.Login)
		if err != nil || user.PasswordHash != "replacement-hash" {
			t.Fatalf("changed password: user=%+v err=%v", user.User, err)
		}
		if _, err := store.DeleteUser(ctx, first.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := store.GetSettings(ctx, first.ID); !errors.Is(err, domain.ErrNotFound) {
			t.Fatalf("deleted user's settings: %v", err)
		}
		if _, err := store.GetUser(ctx, first.ID); !errors.Is(err, domain.ErrNotFound) {
			t.Fatalf("deleted user: %v", err)
		}
	})

	t.Run("cover and progress ownership and reset", func(t *testing.T) {
		ctx := context.Background()
		store, owner := readerStore(t, newStore)
		foreign, err := store.CreateUser(ctx, "foreign", "hash", true, 10000)
		if err != nil {
			t.Fatal(err)
		}
		book := createBook(t, store, owner.ID, domain.BookInput{Title: "Owned book"})
		otherBook := createBook(t, store, foreign.ID, domain.BookInput{Title: "Foreign book"})
		for name, operation := range map[string]func() error{
			"get progress":    func() error { _, err := store.GetProgress(ctx, foreign.ID, book.ID); return err },
			"put progress":    func() error { _, err := store.PutProgress(ctx, foreign.ID, book.ID, 10); return err },
			"delete progress": func() error { return store.DeleteProgress(ctx, foreign.ID, book.ID) },
			"set cover": func() error {
				_, err := store.SetCover(ctx, foreign.ID, book.ID, domain.CoverFiles{CoverPath: "foreign.png"})
				return err
			},
			"delete cover": func() error { _, err := store.DeleteCover(ctx, foreign.ID, book.ID); return err },
		} {
			if err := operation(); !errors.Is(err, domain.ErrNotFound) {
				t.Errorf("foreign %s: %v", name, err)
			}
		}
		for _, item := range []struct {
			user uuid.UUID
			book uuid.UUID
		}{{owner.ID, book.ID}, {foreign.ID, otherBook.ID}} {
			if _, err := store.PutProgress(ctx, item.user, item.book, 63.5); err != nil {
				t.Fatal(err)
			}
		}
		if err := store.DeleteProgress(ctx, owner.ID, book.ID); err != nil {
			t.Fatal(err)
		}
		progress, err := store.GetProgress(ctx, owner.ID, book.ID)
		if err != nil || progress.ProgressPercent != 0 {
			t.Fatalf("individual progress reset: progress=%+v err=%v", progress, err)
		}
		if _, err := store.PutProgress(ctx, owner.ID, book.ID, 12.5); err != nil {
			t.Fatal(err)
		}
		if err := store.DeleteAllProgress(ctx, owner.ID); err != nil {
			t.Fatal(err)
		}
		progress, err = store.GetProgress(ctx, owner.ID, book.ID)
		if err != nil || progress.ProgressPercent != 0 {
			t.Fatalf("all progress reset: progress=%+v err=%v", progress, err)
		}
		progress, err = store.GetProgress(ctx, foreign.ID, otherBook.ID)
		if err != nil || progress.ProgressPercent != 63.5 {
			t.Fatalf("foreign progress survives reset: progress=%+v err=%v", progress, err)
		}
		first := domain.CoverFiles{CoverPath: "covers/first.png", CoverThumbPath: "covers/first.jpg"}
		second := domain.CoverFiles{CoverPath: "covers/second.png", CoverThumbPath: "covers/second.jpg"}
		if _, err := store.SetCover(ctx, owner.ID, book.ID, first); err != nil {
			t.Fatal(err)
		}
		old, err := store.SetCover(ctx, owner.ID, book.ID, second)
		if err != nil || old != first {
			t.Fatalf("replaced cover paths: old=%+v err=%v", old, err)
		}
		deleted, err := store.DeleteBook(ctx, owner.ID, book.ID)
		if err != nil || deleted.CoverPath != second.CoverPath || deleted.CoverThumbPath != second.CoverThumbPath {
			t.Fatalf("deleted cover paths: files=%+v err=%v", deleted, err)
		}
		if _, err := store.GetProgress(ctx, owner.ID, book.ID); !errors.Is(err, domain.ErrNotFound) {
			t.Fatalf("deleted book progress: %v", err)
		}
	})
}

func tokenHash() string {
	id := uuid.New()
	return fmt.Sprintf("%064x", id[:])
}
