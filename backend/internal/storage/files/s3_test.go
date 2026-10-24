package files_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"book-hub/internal/config"
	"book-hub/internal/storage/files"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"
)

func TestS3MultipartCancellationAndNamespaceIsolation(t *testing.T) {
	endpoint := os.Getenv("BOOK_HUB_TEST_S3_ENDPOINT")
	if endpoint == "" {
		t.Skip("set BOOK_HUB_TEST_S3_ENDPOINT to run real S3 transfers")
	}
	target, err := url.Parse(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	started, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	var blocking atomic.Bool
	blocking.Store(true)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("partNumber") != "" && blocking.Load() {
			once.Do(func() { close(started) })
			select {
			case <-r.Context().Done():
			case <-release:
			}
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		proxy.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	cfg := config.Config{BookStorage: "s3", S3Endpoint: server.URL, S3Region: "garage", S3Bucket: "bookhub-test", S3Prefix: "multipart-" + uuid.NewString(), S3AccessKeyID: "GK00000000000000000000000000000001", S3SecretAccessKey: "codex-bookhub-s3-test-secret-000000000000000000000000000000000000", StorageDir: t.TempDir()}
	source, err := files.NewOriginals(cfg)
	if err != nil {
		t.Fatal(err)
	}
	content := bytes.Repeat([]byte("immutable original\n"), 1<<19)
	hash := sha256.Sum256(content)
	hexHash := hex.EncodeToString(hash[:])
	input := filepath.Join(t.TempDir(), "upload.pdf")
	if err := os.WriteFile(input, content, 0600); err != nil {
		t.Fatal(err)
	}
	for _, outside := range []string{"other/book.pdf", cfg.S3Prefix + "/../other.pdf", cfg.S3Prefix + "-other/book.pdf", cfg.S3Prefix + "/bad\nkey"} {
		if reader, err := source.Open(context.Background(), outside); err == nil {
			reader.Close()
			t.Fatalf("opened outside namespace: %q", outside)
		}
		if err := source.Delete(context.Background(), outside); err == nil {
			t.Fatalf("deleted outside namespace: %q", outside)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, err := source.MoveBook(ctx, input, hexHash, "pdf"); done <- err }()
	select {
	case <-started:
	case <-time.After(15 * time.Second):
		cancel()
		close(release)
		t.Fatal("multipart upload did not start")
	}
	cancel()
	close(release)
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("canceled multipart upload succeeded")
		}
	case <-time.After(10 * time.Second):
		t.Fatal("multipart cancellation did not complete")
	}
	client := s3.New(s3.Options{Region: cfg.S3Region, BaseEndpoint: aws.String(server.URL), UsePathStyle: true, Credentials: credentials.NewStaticCredentialsProvider(cfg.S3AccessKeyID, cfg.S3SecretAccessKey, ""), RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired, ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired})
	uploads, err := client.ListMultipartUploads(context.Background(), &s3.ListMultipartUploadsInput{Bucket: aws.String(cfg.S3Bucket), Prefix: aws.String(cfg.S3Prefix + "/")})
	if err != nil || len(uploads.Uploads) != 0 {
		t.Fatalf("canceled multipart parts retained: uploads=%v err=%v", uploads, err)
	}
	if empty, err := source.(files.OriginalNamespace).Empty(context.Background()); err != nil || !empty {
		t.Fatalf("canceled upload published object: empty=%t err=%v", empty, err)
	}
	blocking.Store(false)
	location, err := source.MoveBook(context.Background(), input, hexHash, "pdf")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { source.Delete(context.Background(), location) })
	reader, err := source.Open(context.Background(), location)
	if err != nil {
		t.Fatal(err)
	}
	received, err := io.ReadAll(reader)
	closeErr := reader.Close()
	if err != nil || closeErr != nil || !bytes.Equal(content, received) {
		t.Fatalf("retry after canceled multipart upload: read=%v close=%v size=%d", err, closeErr, len(received))
	}
	// A sibling prefix with matching initial bytes is outside this namespace.
	siblingCfg := cfg
	siblingCfg.S3Prefix += "-other"
	sibling, err := files.NewOriginals(siblingCfg)
	if err != nil {
		t.Fatal(err)
	}
	if empty, err := sibling.(files.OriginalNamespace).Empty(context.Background()); err != nil || !empty {
		t.Fatalf("sibling prefix not isolated: empty=%t err=%v", empty, err)
	}
}
