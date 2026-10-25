package config_test

import (
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
