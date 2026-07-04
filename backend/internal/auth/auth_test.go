package auth_test

import (
	"testing"

	"book-hub/internal/auth"
)

func TestPasswordHashVerifiesOnlyOriginalPassword(t *testing.T) {
	hash, err := auth.HashPassword("secret")
	if err != nil {
		t.Fatal(err)
	}
	if !auth.VerifyPassword("secret", hash) {
		t.Fatal("expected password to verify")
	}
	if auth.VerifyPassword("other", hash) {
		t.Fatal("unexpected password verification")
	}
}

func TestSessionTokenHashIsStableAndDoesNotExposeToken(t *testing.T) {
	token, hash, err := auth.NewSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	if token == "" || hash == "" {
		t.Fatal("expected token and hash")
	}
	if token == hash {
		t.Fatal("hash must not equal raw token")
	}
	if auth.HashSessionToken(token) != hash {
		t.Fatal("session hash is not stable")
	}
}

func TestCSRFTokenVerification(t *testing.T) {
	manager := auth.NewCSRFManager("01234567890123456789012345678901")
	token, err := manager.NewToken()
	if err != nil {
		t.Fatal(err)
	}
	if !manager.Verify(token) {
		t.Fatal("expected csrf token to verify")
	}
	if manager.Verify(token + "x") {
		t.Fatal("tampered token verified")
	}
}
