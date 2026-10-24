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
func TestFTPSModesAreExplicitConfiguration(t *testing.T) {
	for _, mode := range []string{"ftps-explicit", "ftps-implicit"} {
		cfg := config.Config{BookStorage: mode, FTPAddr: "localhost:21", FTPUser: "reader", FTPRoot: "/book-hub", StorageDir: t.TempDir()}
		if err := cfg.ValidateFileStorage(); err != nil {
			t.Errorf("%s: %v", mode, err)
		}
	}
}

func TestFTPSSettingsAreSharedByServerAndAdministrativeLoader(t *testing.T) {
	t.Setenv("BOOK_HUB_SESSION_SECRET", "01234567890123456789012345678901")
	t.Setenv("BOOK_HUB_STORAGE_DIR", t.TempDir())
	t.Setenv("BOOK_HUB_BOOK_STORAGE", "ftps-implicit")
	t.Setenv("BOOK_HUB_FTP_ADDR", "offline.example:990")
	t.Setenv("BOOK_HUB_FTP_USER", "reader")
	t.Setenv("BOOK_HUB_FTP_PASSWORD", "password")
	t.Setenv("BOOK_HUB_FTP_ROOT", "/book-hub")
	t.Setenv("BOOK_HUB_FTP_CA_FILE", "/configured/trusted.pem")
	server, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("BOOK_HUB_SESSION_SECRET", "")
	administrative, err := config.LoadFileStorage()
	if err != nil {
		t.Fatal(err)
	}
	if administrative.BookStorage != server.BookStorage || administrative.FTPCAFile != "/configured/trusted.pem" || administrative.FTPCAFile != server.FTPCAFile || administrative.FTPAddr != server.FTPAddr {
		t.Fatalf("FTPS configuration differs: server=%#v administrative=%#v", server, administrative)
	}
}
