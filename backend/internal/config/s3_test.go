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
