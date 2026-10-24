package files_test

import (
	"bufio"
	"context"
	"crypto/x509"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"book-hub/internal/config"
	"book-hub/internal/storage/files"
)

func TestFTPSNeverRetriesAsPlainFTP(t *testing.T) {
	for _, mode := range []string{"ftps-explicit", "ftps-implicit"} {
		t.Run(mode, func(t *testing.T) {
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			var mu sync.Mutex
			var accepted, credentials int
			var handlers sync.WaitGroup
			done := make(chan struct{})
			go func() {
				defer close(done)
				for {
					conn, err := listener.Accept()
					if err != nil {
						return
					}
					mu.Lock()
					accepted++
					mu.Unlock()
					handlers.Add(1)
					go func() {
						defer handlers.Done()
						defer conn.Close()
						conn.SetDeadline(time.Now().Add(2 * time.Second))
						conn.Write([]byte("220 Plain FTP fixture\r\n"))
						scanner := bufio.NewScanner(conn)
						for scanner.Scan() {
							line := scanner.Text()
							if strings.HasPrefix(line, "USER ") || strings.HasPrefix(line, "PASS ") {
								mu.Lock()
								credentials++
								mu.Unlock()
							}
							if strings.HasPrefix(line, "QUIT") {
								conn.Write([]byte("221 Goodbye\r\n"))
								return
							}
							conn.Write([]byte("502 TLS unavailable\r\n"))
						}
					}()
				}
			}()
			cfg := config.Config{BookStorage: mode, FTPAddr: listener.Addr().String(), FTPUser: "private-user", FTPPassword: "private-password", FTPRoot: "/books", StorageDir: t.TempDir()}
			source, err := files.NewOriginals(cfg)
			if err != nil {
				listener.Close()
				t.Fatal(err)
			}
			_, err = source.(files.OriginalNamespace).Empty(context.Background())
			listener.Close()
			<-done
			handlers.Wait()
			if err == nil {
				t.Fatal("FTPS succeeded against a plain FTP server")
			}
			mu.Lock()
			defer mu.Unlock()
			if accepted != 1 || credentials != 0 {
				t.Fatalf("TLS failure downgraded: connections=%d credential commands=%d", accepted, credentials)
			}
		})
	}
}

func TestFTPSRejectsUntrustedCertificateAndWrongServerName(t *testing.T) {
	for _, test := range []struct{ mode, env string }{{"ftps-explicit", "BOOK_HUB_TEST_FTPS_EXPLICIT_ADDR"}, {"ftps-implicit", "BOOK_HUB_TEST_FTPS_IMPLICIT_ADDR"}} {
		t.Run(test.mode, func(t *testing.T) {
			address := os.Getenv(test.env)
			if address == "" {
				t.Skip("set " + test.env + " for real FTPS certificate checks")
			}
			cfg := config.Config{BookStorage: test.mode, FTPAddr: address, FTPUser: "bookhub", FTPPassword: "bookhub-test-password", FTPRoot: "/books", StorageDir: t.TempDir()}
			source, err := files.NewOriginals(cfg)
			if err != nil {
				t.Fatal(err)
			}
			_, err = source.(files.OriginalNamespace).Empty(context.Background())
			var unknown x509.UnknownAuthorityError
			if !errors.As(err, &unknown) {
				t.Fatalf("untrusted certificate accepted or wrong failure: %v", err)
			}
			cfg.FTPCAFile = os.Getenv("BOOK_HUB_TEST_FTPS_CA_FILE")
			if cfg.FTPCAFile == "" {
				t.Fatal("BOOK_HUB_TEST_FTPS_CA_FILE required")
			}
			host, port, _ := net.SplitHostPort(address)
			addresses, err := net.LookupHost(host)
			if err != nil || len(addresses) == 0 {
				t.Fatalf("resolve fixture: %v", err)
			}
			cfg.FTPAddr = net.JoinHostPort(addresses[0], port)
			source, err = files.NewOriginals(cfg)
			if err != nil {
				t.Fatal(err)
			}
			_, err = source.(files.OriginalNamespace).Empty(context.Background())
			var name x509.HostnameError
			if !errors.As(err, &name) {
				t.Fatalf("wrong hostname accepted or wrong failure: %v", err)
			}
		})
	}
}

func TestFTPSRejectsInvalidCustomCAWithoutConnecting(t *testing.T) {
	cfg := config.Config{BookStorage: "ftps-explicit", FTPAddr: "offline.invalid:21", FTPUser: "reader", FTPRoot: "/books", StorageDir: t.TempDir()}
	cfg.FTPCAFile = filepath.Join(t.TempDir(), "missing.pem")
	if _, err := files.NewOriginals(cfg); err == nil {
		t.Fatal("missing CA accepted")
	}
	if err := os.WriteFile(cfg.FTPCAFile, []byte("not a certificate"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := files.NewOriginals(cfg); err == nil {
		t.Fatal("invalid CA accepted")
	}
}
