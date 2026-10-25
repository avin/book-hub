package config_test

import (
	"strconv"
	"testing"

	"book-hub/internal/auth"
	"book-hub/internal/config"
)

func TestPasswordAlgorithmConfiguration(t *testing.T) {
	t.Setenv("BOOK_HUB_SESSION_SECRET", "01234567890123456789012345678901")
	t.Setenv("BOOK_HUB_STORAGE_DIR", t.TempDir())
	for _, algorithm := range []string{"", auth.PasswordArgon2id, auth.PasswordPBKDF2SHA256, "sha256"} {
		t.Run(algorithm, func(t *testing.T) {
			t.Setenv("BOOK_HUB_PASSWORD_ALGORITHM", algorithm)
			cfg, err := config.Load()
			if algorithm == "sha256" {
				if err == nil {
					t.Fatal("unsupported password algorithm accepted")
				}
				return
			}
			want := algorithm
			if want == "" {
				want = auth.PasswordArgon2id
			}
			if err != nil || cfg.PasswordAlgorithm != want {
				t.Fatalf("password algorithm: got=%q want=%q err=%v", cfg.PasswordAlgorithm, want, err)
			}
		})
	}
}

func TestPBKDF2IterationsConfiguration(t *testing.T) {
	t.Setenv("BOOK_HUB_SESSION_SECRET", "01234567890123456789012345678901")
	t.Setenv("BOOK_HUB_STORAGE_DIR", t.TempDir())
	t.Setenv("BOOK_HUB_PASSWORD_ALGORITHM", auth.PasswordPBKDF2SHA256)
	for _, value := range []string{"", "1", "1000", "10000", "600000", "10000000", "0", "-1", "10000001", "1.5", "abc", "999999999999999999999"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("BOOK_HUB_PBKDF2_ITERATIONS", value)
			want := auth.DefaultPBKDF2Iterations
			var parseErr error
			if value != "" {
				want, parseErr = strconv.Atoi(value)
			}
			cfg, err := config.Load()
			if parseErr != nil || want < 1 || want > auth.MaxPBKDF2Iterations {
				if err == nil {
					t.Fatal("invalid PBKDF2 iterations accepted")
				}
				return
			}
			if err != nil || cfg.PBKDF2Iterations != want {
				t.Fatalf("iterations: got=%d want=%d err=%v", cfg.PBKDF2Iterations, want, err)
			}
		})
	}
}
