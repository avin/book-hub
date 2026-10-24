package files_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"book-hub/internal/config"
	"book-hub/internal/storage/files"
	"github.com/google/uuid"
)

func TestFTPTransferCancellationAndNamespaceIsolation(t *testing.T) {
	address := os.Getenv("BOOK_HUB_TEST_FTP_ADDR")
	if address == "" {
		t.Skip("set BOOK_HUB_TEST_FTP_ADDR to run real FTP transfers")
	}
	cfg := config.Config{BookStorage: "ftp", FTPAddr: address, FTPUser: "bookhub", FTPPassword: "bookhub-test-password", FTPRoot: "/books/cancel-" + uuid.NewString(), StorageDir: t.TempDir()}
	source, err := files.NewOriginals(cfg)
	if err != nil {
		t.Fatal(err)
	}
	content := bytes.Repeat([]byte("large immutable original\n"), 1<<18)
	hash := sha256.Sum256(content)
	hexHash := hex.EncodeToString(hash[:])
	input := filepath.Join(t.TempDir(), "upload.pdf")
	if err := os.WriteFile(input, content, 0600); err != nil {
		t.Fatal(err)
	}
	location, err := source.MoveBook(context.Background(), input, hexHash, "pdf")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { source.Delete(context.Background(), location) })
	for _, outside := range []string{"/other/book.pdf", cfg.FTPRoot + "/../other.pdf", cfg.FTPRoot + "/x\r\nDELE /other"} {
		if reader, err := source.Open(context.Background(), outside); err == nil {
			reader.Close()
			t.Fatalf("opened outside namespace: %q", outside)
		}
		if err := source.Delete(context.Background(), outside); err == nil {
			t.Fatalf("deleted outside namespace: %q", outside)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	reader, err := source.Open(ctx, location)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.ReadFull(reader, make([]byte, 1024)); err != nil {
		t.Fatal(err)
	}
	cancel()
	done := make(chan struct{})
	go func() { io.Copy(io.Discard, reader); reader.Close(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("canceled FTP retrieval did not release connections")
	}
	// The interrupted reader cannot damage the published original or the next transfer.
	retry, err := source.Open(context.Background(), location)
	if err != nil {
		t.Fatal(err)
	}
	received, err := io.ReadAll(retry)
	closeErr := retry.Close()
	if err != nil || closeErr != nil || !bytes.Equal(received, content) {
		t.Fatalf("retry after interrupted FTP transfer: read=%v close=%v bytes=%d", err, closeErr, len(received))
	}
}
