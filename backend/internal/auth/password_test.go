package auth_test

import (
	"strings"
	"testing"

	"book-hub/internal/auth"
)

func TestPasswordAlgorithms(t *testing.T) {
	for _, algorithm := range []string{"", auth.PasswordArgon2id, auth.PasswordPBKDF2SHA256} {
		t.Run(algorithm, func(t *testing.T) {
			// Keep the existing 2048-byte password contract, including Unicode.
			password := strings.Repeat("я", 1024)
			hash, err := auth.HashPasswordWithAlgorithm(password, algorithm)
			if err != nil {
				t.Fatal(err)
			}
			if !auth.VerifyPassword(password, hash) || auth.VerifyPassword(password+"x", hash) {
				t.Fatal("password verification failed")
			}
			other, err := auth.HashPasswordWithAlgorithm(password, algorithm)
			if err != nil || other == hash {
				t.Fatal("passwords must have independent random salts")
			}
			if auth.NeedsPasswordRehash(hash, algorithm) {
				t.Fatal("hash using the configured algorithm needs rehash")
			}
			if !auth.NeedsPasswordRehash(hash, oppositeAlgorithm(algorithm)) {
				t.Fatal("hash using a different algorithm does not need rehash")
			}
		})
	}
	if _, err := auth.HashPasswordWithAlgorithm("password", "sha256"); err == nil {
		t.Fatal("unknown algorithm accepted")
	}
}

func oppositeAlgorithm(algorithm string) string {
	if algorithm == auth.PasswordPBKDF2SHA256 {
		return auth.PasswordArgon2id
	}
	return auth.PasswordPBKDF2SHA256
}

func TestPBKDF2Interoperability(t *testing.T) {
	// Python hashlib.pbkdf2_hmac('sha256', b'password', b'0123456789abcdef', 600000, 32).
	const hash = "$pbkdf2-sha256$i=600000$MDEyMzQ1Njc4OWFiY2RlZg$mW18kPdKShac963vQrBoSPfRusPlaNHMlNT3m+HuAmM"
	if !auth.VerifyPassword("password", hash) || auth.VerifyPassword("wrong", hash) {
		t.Fatal("PBKDF2-HMAC-SHA256 reference hash verification failed")
	}
}

func TestMalformedPasswordHashesAreRejected(t *testing.T) {
	const salt = "MDEyMzQ1Njc4OWFiY2RlZg"
	const key = "mW18kPdKShac963vQrBoSPfRusPlaNHMlNT3m+HuAmM"
	for _, hash := range []string{
		"", "password", "$sha256$" + salt + "$" + key,
		"$pbkdf2-sha256$i=0$" + salt + "$" + key,
		"$pbkdf2-sha256$i=-1$" + salt + "$" + key,
		"$pbkdf2-sha256$i=10000001$" + salt + "$" + key,
		"$pbkdf2-sha256$i=999999999999999999999999$" + salt + "$" + key,
		"$pbkdf2-sha256$t=600000$" + salt + "$" + key,
		"$pbkdf2-sha256$i=600000$bad$" + key,
		"$pbkdf2-sha256$i=600000$" + salt + "$bad",
		"$pbkdf2-sha256$i=600000$" + salt + "$$extra",
		"$argon2id$v=18$m=65536,t=3,p=2$" + salt + "$" + key,
		"$argon2id$v=19$m=65536,t=0,p=2$" + salt + "$" + key,
		"$argon2id$v=19$m=65536,t=3,p=0$" + salt + "$" + key,
		"$argon2id$v=19$m=65536,t=3,p=256$" + salt + "$" + key,
		"$argon2id$v=19$m=1,t=3,p=2$" + salt + "$" + key,
		"$argon2id$v=19$m=4294967295,t=3,p=2$" + salt + "$" + key,
		"$argon2id$v=19$m=65536,t=3,t=3,p=2$" + salt + "$" + key,
		"$argon2id$v=19$m=65536,t=3,p=2$" + salt + "$",
	} {
		if auth.VerifyPassword("password", hash) {
			t.Fatalf("malformed hash verified: %q", hash)
		}
	}
}

func BenchmarkVerifyPassword(b *testing.B) {
	for _, algorithm := range []string{auth.PasswordArgon2id, auth.PasswordPBKDF2SHA256} {
		b.Run(algorithm, func(b *testing.B) {
			hash, err := auth.HashPasswordWithAlgorithm("password", algorithm)
			if err != nil {
				b.Fatal(err)
			}
			b.ReportAllocs()
			b.ResetTimer()
			for b.Loop() {
				if !auth.VerifyPassword("password", hash) {
					b.Fatal("password verification failed")
				}
			}
		})
	}
}
