package config_test

import (
	"testing"

	"book-hub/internal/config"
)

func TestS3ConfigurationRejectsInvalidEndpointAndNamespace(t *testing.T) {
	valid := config.Config{BookStorage: "s3", S3Region: "eu-west-1", S3Bucket: "library", S3Prefix: "book-hub", S3AccessKeyID: "access", S3SecretAccessKey: "secret", StorageDir: t.TempDir()}
	if err := valid.ValidateFileStorage(); err != nil {
		t.Fatal(err)
	}
	for _, prefix := range []string{"", "/", "..", "../outside", "books/../other", "books/", "books\\other", "books\nother"} {
		cfg := valid
		cfg.S3Prefix = prefix
		if err := cfg.ValidateFileStorage(); err == nil {
			t.Errorf("invalid S3 prefix accepted: %q", prefix)
		}
	}
	for _, endpoint := range []string{"ftp://localhost", "https://", "https://user:pass@localhost", "https://localhost/bucket", "https://localhost?bucket=test", "https://localhost#fragment"} {
		cfg := valid
		cfg.S3Endpoint = endpoint
		if err := cfg.ValidateFileStorage(); err == nil {
			t.Errorf("invalid S3 endpoint accepted: %q", endpoint)
		}
	}
	for _, missing := range []string{"region", "bucket", "access", "secret"} {
		cfg := valid
		switch missing {
		case "region":
			cfg.S3Region = ""
		case "bucket":
			cfg.S3Bucket = ""
		case "access":
			cfg.S3AccessKeyID = ""
		case "secret":
			cfg.S3SecretAccessKey = ""
		}
		if err := cfg.ValidateFileStorage(); err == nil {
			t.Errorf("missing S3 %s accepted", missing)
		}
	}
}

func TestS3AdministrativeConfigurationUsesTheSameStorageSettings(t *testing.T) {
	t.Setenv("BOOK_HUB_SESSION_SECRET", "")
	t.Setenv("BOOK_HUB_BOOK_STORAGE", "s3")
	t.Setenv("BOOK_HUB_S3_ENDPOINT", "https://s3.example.org")
	t.Setenv("BOOK_HUB_S3_REGION", "custom-region")
	t.Setenv("BOOK_HUB_S3_BUCKET", "book-hub")
	t.Setenv("BOOK_HUB_S3_PREFIX", "")
	t.Setenv("BOOK_HUB_S3_ACCESS_KEY_ID", "access")
	t.Setenv("BOOK_HUB_S3_SECRET_ACCESS_KEY", "secret")
	cfg, err := config.LoadFileStorage()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.BookStorage != "s3" || cfg.S3Endpoint != "https://s3.example.org" || cfg.S3Region != "custom-region" || cfg.S3Bucket != "book-hub" || cfg.S3Prefix != "books" || cfg.S3AccessKeyID != "access" || cfg.S3SecretAccessKey != "secret" {
		t.Fatalf("administrative S3 settings differ: %+v", cfg)
	}
}
