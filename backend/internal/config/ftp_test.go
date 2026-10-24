package config_test

import (
	"book-hub/internal/config"
	"testing"
)

func TestFTPConfigurationRejectsInvalidConnectionAndNamespace(t *testing.T) {
	valid := config.Config{BookStorage: "ftp", FTPAddr: "localhost:21", FTPUser: "reader", FTPRoot: "/book-hub", StorageDir: t.TempDir()}
	if err := valid.ValidateFileStorage(); err != nil {
		t.Fatal(err)
	}
	for _, address := range []string{"localhost", ":21", "localhost:0", "localhost:70000", "localhost:ftp", "bad\nhost:21"} {
		cfg := valid
		cfg.FTPAddr = address
		if err := cfg.ValidateFileStorage(); err == nil {
			t.Errorf("invalid FTP address accepted: %q", address)
		}
	}
	for _, root := range []string{"/", "relative", "/books/../other", "/books\nDELE", "/books\\outside"} {
		cfg := valid
		cfg.FTPRoot = root
		if err := cfg.ValidateFileStorage(); err == nil {
			t.Errorf("invalid namespace accepted: %q", root)
		}
	}
}
