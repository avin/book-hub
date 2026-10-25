package auth

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	PasswordArgon2id               = "argon2id"
	PasswordPBKDF2SHA256           = "pbkdf2-sha256"
	DefaultPBKDF2Iterations        = 600_000
	MaxPBKDF2Iterations            = 10_000_000
	argonMemory             uint32 = 64 * 1024
	argonIterations         uint32 = 3
	argonParallelism        uint8  = 2
	argonSaltLength                = 16
	argonKeyLength          uint32 = 32
)

func HashPassword(password string) (string, error) {
	return HashPasswordWithAlgorithm(password, PasswordArgon2id, 0)
}

// An empty algorithm preserves the default for programmatically built configs.
func HashPasswordWithAlgorithm(password, algorithm string, iterations int) (string, error) {
	if !ValidPasswordAlgorithm(algorithm) {
		return "", errors.New("unsupported password algorithm")
	}
	if iterations == 0 {
		iterations = DefaultPBKDF2Iterations
	}
	if iterations < 1 || iterations > MaxPBKDF2Iterations {
		return "", errors.New("invalid pbkdf2 iterations")
	}
	salt := make([]byte, argonSaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	if algorithm == PasswordPBKDF2SHA256 {
		key, err := pbkdf2.Key(sha256.New, password, salt, iterations, int(argonKeyLength))
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("$pbkdf2-sha256$i=%d$%s$%s", iterations,
			base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
	}
	key := argon2.IDKey([]byte(password), salt, argonIterations, argonMemory, argonParallelism, argonKeyLength)
	return fmt.Sprintf(
		"$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		argonMemory,
		argonIterations,
		argonParallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

func VerifyPassword(password, encodedHash string) bool {
	if strings.HasPrefix(encodedHash, "$pbkdf2-sha256$") {
		iterations, salt, expectedKey, err := decodePBKDF2Hash(encodedHash)
		if err != nil {
			return false
		}
		actualKey, err := pbkdf2.Key(sha256.New, password, salt, iterations, len(expectedKey))
		return err == nil && subtle.ConstantTimeCompare(actualKey, expectedKey) == 1
	}
	params, salt, expectedKey, err := decodeArgon2idHash(encodedHash)
	if err != nil {
		return false
	}
	actualKey := argon2.IDKey([]byte(password), salt, params.iterations, params.memory, params.parallelism, uint32(len(expectedKey)))
	return subtle.ConstantTimeCompare(actualKey, expectedKey) == 1
}

func ValidPasswordAlgorithm(algorithm string) bool {
	return algorithm == "" || algorithm == PasswordArgon2id || algorithm == PasswordPBKDF2SHA256
}

// NeedsPasswordRehash is used only after successful verification.
func NeedsPasswordRehash(encodedHash, algorithm string, iterations int) bool {
	if algorithm == "" {
		algorithm = PasswordArgon2id
	}
	if algorithm == PasswordPBKDF2SHA256 {
		if iterations == 0 {
			iterations = DefaultPBKDF2Iterations
		}
		storedIterations, _, _, err := decodePBKDF2Hash(encodedHash)
		return err != nil || storedIterations != iterations
	}
	return !strings.HasPrefix(encodedHash, "$"+algorithm+"$")
}

func decodePBKDF2Hash(encodedHash string) (int, []byte, []byte, error) {
	parts := strings.Split(encodedHash, "$")
	if len(parts) != 5 || parts[0] != "" || parts[1] != PasswordPBKDF2SHA256 || !strings.HasPrefix(parts[2], "i=") {
		return 0, nil, nil, errors.New("invalid pbkdf2 hash")
	}
	iterations, err := strconv.Atoi(strings.TrimPrefix(parts[2], "i="))
	if err != nil || iterations < 1 || iterations > MaxPBKDF2Iterations {
		return 0, nil, nil, errors.New("invalid pbkdf2 iterations")
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil || len(salt) != argonSaltLength {
		return 0, nil, nil, errors.New("invalid pbkdf2 salt")
	}
	key, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(key) != int(argonKeyLength) {
		return 0, nil, nil, errors.New("invalid pbkdf2 key")
	}
	return iterations, salt, key, nil
}

type argonParams struct {
	memory      uint32
	iterations  uint32
	parallelism uint8
}

func decodeArgon2idHash(encodedHash string) (argonParams, []byte, []byte, error) {
	parts := strings.Split(encodedHash, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" || parts[2] != "v=19" {
		return argonParams{}, nil, nil, errors.New("invalid argon2id hash")
	}
	var params argonParams
	seen := make(map[string]bool)
	for _, part := range strings.Split(parts[3], ",") {
		keyValue := strings.SplitN(part, "=", 2)
		if len(keyValue) != 2 || seen[keyValue[0]] {
			return argonParams{}, nil, nil, errors.New("invalid argon2id params")
		}
		seen[keyValue[0]] = true
		value, err := strconv.ParseUint(keyValue[1], 10, 32)
		if err != nil {
			return argonParams{}, nil, nil, err
		}
		switch keyValue[0] {
		case "m":
			params.memory = uint32(value)
		case "t":
			params.iterations = uint32(value)
		case "p":
			if value > 255 {
				return argonParams{}, nil, nil, errors.New("invalid argon2id parallelism")
			}
			params.parallelism = uint8(value)
		default:
			return argonParams{}, nil, nil, errors.New("invalid argon2id param")
		}
	}
	if params.parallelism == 0 || params.iterations == 0 || params.iterations > 10 || params.memory < 8*uint32(params.parallelism) || params.memory > 1024*1024 {
		return argonParams{}, nil, nil, errors.New("invalid argon2id params")
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) != argonSaltLength {
		return argonParams{}, nil, nil, errors.New("invalid argon2id salt")
	}
	key, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(key) != int(argonKeyLength) {
		return argonParams{}, nil, nil, errors.New("invalid argon2id key")
	}
	return params, salt, key, nil
}
