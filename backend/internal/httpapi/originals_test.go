package httpapi_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"book-hub/internal/config"
	"book-hub/internal/httpapi"
	"book-hub/internal/storage/files"
	"book-hub/internal/storage/memory"
)

func TestTruncatedOriginalReturnsTemporaryErrorWithoutLosingSession(t *testing.T) {
	app := newTestApp(t, true)
	client := app.client(t)
	csrf := app.csrf(t, client)
	app.register(t, client, csrf, "reader", "password", http.StatusCreated)
	app.login(t, client, csrf, "reader", "password", http.StatusOK)
	bookID := app.uploadBook(t, client, csrf, "book.pdf", []byte("%PDF-original"))
	paths, err := filepath.Glob(filepath.Join(app.storageRoot, "books", "*", "*.pdf"))
	if err != nil || len(paths) != 1 {
		t.Fatalf("originals: %v %v", paths, err)
	}
	if err := os.WriteFile(paths[0], []byte("%PDF-"), 0600); err != nil {
		t.Fatal(err)
	}
	response := app.requestRaw(t, client, http.MethodGet, "/v1/books/"+bookID+"/file", "", nil, http.StatusServiceUnavailable)
	if !bytes.Contains(response.body, []byte(`"code":"service_unavailable"`)) {
		t.Fatalf("expected temporary API error: %s", response.body)
	}
	app.requestRaw(t, client, http.MethodGet, "/v1/books/"+bookID, "", nil, http.StatusOK)
}

func TestRemoteOriginalIsFullyReceivedBeforeRangeResponse(t *testing.T) {
	source := &managedOriginals{started: make(chan struct{}), proceed: make(chan struct{})}
	app := newOriginalsApp(t, source, files.New(t.TempDir()))
	client := app.client(t)
	csrf := app.csrf(t, client)
	app.register(t, client, csrf, "reader", "password", http.StatusCreated)
	app.login(t, client, csrf, "reader", "password", http.StatusOK)
	bookID := app.uploadBookWithTitle(t, client, csrf, "book.pdf", []byte("%PDF-original"), "Книга")

	request, _ := http.NewRequest(http.MethodGet, app.server.URL+"/api/v1/books/"+bookID+"/file?download=1", nil)
	request.Header.Set("Range", "bytes=5-8")
	result := make(chan *http.Response, 1)
	fail := make(chan error, 1)
	go func() {
		response, err := client.Do(request)
		if err != nil {
			fail <- err
			return
		}
		result <- response
	}()
	select {
	case <-source.started:
	case <-time.After(5 * time.Second):
		t.Fatal("original retrieval did not start")
	}
	select {
	case response := <-result:
		response.Body.Close()
		t.Fatal("response started before complete original retrieval")
	default:
	}
	close(source.proceed)
	select {
	case err := <-fail:
		t.Fatal(err)
	case response := <-result:
		defer response.Body.Close()
		body, err := io.ReadAll(response.Body)
		if err != nil || response.StatusCode != http.StatusPartialContent || string(body) != "orig" {
			t.Fatalf("range response: %d %q %v", response.StatusCode, body, err)
		}
		if response.Header.Get("Content-Length") != "4" || response.Header.Get("Content-Range") != "bytes 5-8/13" {
			t.Fatalf("range headers: %v", response.Header)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("retrieval did not finish")
	}
}

func TestUploadAndRemoteReadShareBoundedWorkspace(t *testing.T) {
	source := &managedOriginals{started: make(chan struct{}), proceed: make(chan struct{})}
	root := t.TempDir()
	fileStore, err := files.NewConfigured(config.Config{StorageDir: root, WorkMaxBytes: 13})
	if err != nil {
		t.Fatal(err)
	}
	app := newOriginalsApp(t, source, fileStore)
	client := app.client(t)
	csrf := app.csrf(t, client)
	app.register(t, client, csrf, "reader", "password", http.StatusCreated)
	app.login(t, client, csrf, "reader", "password", http.StatusOK)
	bookID := app.uploadBook(t, client, csrf, "book.pdf", []byte("%PDF-original"))
	result := make(chan error, 1)
	go func() {
		response, err := client.Get(app.server.URL + "/api/v1/books/" + bookID + "/file")
		if err == nil {
			_, err = io.Copy(io.Discard, response.Body)
			response.Body.Close()
			if response.StatusCode != http.StatusOK {
				err = fmt.Errorf("download: %d", response.StatusCode)
			}
		}
		result <- err
	}()
	select {
	case <-source.started:
	case <-time.After(5 * time.Second):
		t.Fatal("retrieval did not start")
	}
	app.requestRaw(t, client, http.MethodGet, "/readyz", "", nil, http.StatusOK)
	app.uploadWithStatus(t, client, csrf, []byte("other"), http.StatusServiceUnavailable)
	close(source.proceed)
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	app.uploadWithStatus(t, client, csrf, []byte("other"), http.StatusCreated)
	entries, err := os.ReadDir(filepath.Join(root, "tmp"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("workspace files leaked: %v %v", entries, err)
	}
}

func TestWorkspaceRestartRemovesOnlyItsAbandonedFiles(t *testing.T) {
	root := t.TempDir()
	work := filepath.Join(root, "tmp")
	if err := os.MkdirAll(work, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(work, "upload-crashed"), bytes.Repeat([]byte("!"), 100), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(work, "keep.txt"), []byte("admin note"), 0600); err != nil {
		t.Fatal(err)
	}
	fileStore, err := files.NewConfigured(config.Config{StorageDir: root, WorkMaxBytes: 13})
	if err != nil {
		t.Fatal(err)
	}
	app := newOriginalsApp(t, fileStore.Books, fileStore)
	client := app.client(t)
	app.requestRaw(t, client, http.MethodGet, "/readyz", "", nil, http.StatusOK)
	if _, err := os.Stat(filepath.Join(work, "upload-crashed")); !os.IsNotExist(err) {
		t.Fatalf("abandoned work remains: %v", err)
	}
	if data, err := os.ReadFile(filepath.Join(work, "keep.txt")); err != nil || string(data) != "admin note" {
		t.Fatalf("unrelated file removed: %q %v", data, err)
	}
	csrf := app.csrf(t, client)
	app.register(t, client, csrf, "reader", "password", http.StatusCreated)
	app.login(t, client, csrf, "reader", "password", http.StatusOK)
	app.uploadWithStatus(t, client, csrf, []byte("%PDF-original"), http.StatusCreated)
}

func TestSeparatedOriginalsAndImagesRemainReadyWithoutOriginalDisk(t *testing.T) {
	root := t.TempDir()
	fileStore, err := files.NewConfigured(config.Config{
		StorageDir: filepath.Join(root, "legacy"), BooksDir: filepath.Join(root, "hdd"),
		ImagesDir: filepath.Join(root, "images"), WorkDir: filepath.Join(root, "work"),
	})
	if err != nil {
		t.Fatal(err)
	}
	app := newOriginalsApp(t, fileStore.Books, fileStore)
	client := app.client(t)
	csrf := app.csrf(t, client)
	app.register(t, client, csrf, "reader", "password", http.StatusCreated)
	app.login(t, client, csrf, "reader", "password", http.StatusOK)
	bookID := app.uploadBook(t, client, csrf, "book.pdf", []byte("%PDF-original"))
	app.uploadCover(t, client, csrf, bookID, "cover.png", testPNG(t, 30, 40), http.StatusNoContent)
	if err := os.Rename(filepath.Join(root, "hdd"), filepath.Join(root, "offline")); err != nil {
		t.Fatal(err)
	}
	// A regular file at the configured mount point makes even mkdir/stat-based
	// readiness checks of originals fail, while required local resources work.
	if err := os.WriteFile(filepath.Join(root, "hdd"), []byte("offline"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := fileStore.Ensure(); err != nil {
		t.Fatalf("startup depends on originals: %v", err)
	}
	app.requestRaw(t, client, http.MethodGet, "/readyz", "", nil, http.StatusOK)
	app.requestRaw(t, client, http.MethodGet, "/v1/books/"+bookID+"/cover", "", nil, http.StatusOK)
	app.requestRaw(t, client, http.MethodGet, "/v1/books/"+bookID+"/file", "", nil, http.StatusServiceUnavailable)
}

func TestRemoteOriginalFailuresNeverPublishPartialContentAndReleaseWorkspace(t *testing.T) {
	for _, failure := range []string{"truncated", "long", "interrupted", "unavailable"} {
		t.Run(failure, func(t *testing.T) {
			source := &managedOriginals{}
			root := t.TempDir()
			fileStore, err := files.NewConfigured(config.Config{StorageDir: root, WorkMaxBytes: 13})
			if err != nil {
				t.Fatal(err)
			}
			app := newOriginalsApp(t, source, fileStore)
			client := app.client(t)
			csrf := app.csrf(t, client)
			app.register(t, client, csrf, "reader", "password", http.StatusCreated)
			app.login(t, client, csrf, "reader", "password", http.StatusOK)
			bookID := app.uploadBook(t, client, csrf, "book.pdf", []byte("%PDF-original"))
			source.mu.Lock()
			switch failure {
			case "truncated":
				source.data = source.data[:5]
			case "long":
				source.data = append(source.data, '!')
			case "interrupted":
				source.readErr = io.ErrUnexpectedEOF
			case "unavailable":
				source.openErr = errors.New("source unavailable")
			}
			source.mu.Unlock()
			app.requestRaw(t, client, http.MethodGet, "/v1/books/"+bookID+"/file", "", nil, http.StatusServiceUnavailable)
			source.mu.Lock()
			source.data, source.readErr, source.openErr = []byte("%PDF-original"), nil, nil
			source.mu.Unlock()
			app.requestRaw(t, client, http.MethodGet, "/v1/books/"+bookID+"/file", "", nil, http.StatusOK)
			entries, err := os.ReadDir(filepath.Join(root, "tmp"))
			if err != nil || len(entries) != 0 {
				t.Fatalf("workspace leaked: %v %v", entries, err)
			}
		})
	}
}

func TestOriginalSaveFailureReturnsTemporaryErrorWithoutCreatingBook(t *testing.T) {
	source := &managedOriginals{saveErr: errors.New("original offline")}
	app := newOriginalsApp(t, source, files.New(t.TempDir()))
	client := app.client(t)
	csrf := app.csrf(t, client)
	app.register(t, client, csrf, "reader", "password", http.StatusCreated)
	app.login(t, client, csrf, "reader", "password", http.StatusOK)
	app.uploadWithStatus(t, client, csrf, []byte("%PDF-original"), http.StatusServiceUnavailable)
	page := app.requestJSON(t, client, http.MethodPost, "/v1/books/query", csrf, map[string]any{}, http.StatusOK)
	if page["total"] != float64(0) {
		t.Fatalf("failed save created book: %v", page)
	}
	source.mu.Lock()
	source.saveErr = nil
	source.mu.Unlock()
	app.uploadWithStatus(t, client, csrf, []byte("%PDF-original"), http.StatusCreated)
}

func TestCancelledRemoteReadReleasesItsWholeReservation(t *testing.T) {
	source := &managedOriginals{started: make(chan struct{}), proceed: make(chan struct{})}
	fileStore, err := files.NewConfigured(config.Config{StorageDir: t.TempDir(), WorkMaxBytes: 13})
	if err != nil {
		t.Fatal(err)
	}
	finished := make(chan struct{})
	app := newOriginalsApp(t, source, fileStore, func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasSuffix(r.URL.Path, "/file") {
				defer close(finished)
			}
			next.ServeHTTP(w, r)
		})
	})
	client := app.client(t)
	csrf := app.csrf(t, client)
	app.register(t, client, csrf, "reader", "password", http.StatusCreated)
	app.login(t, client, csrf, "reader", "password", http.StatusOK)
	bookID := app.uploadBook(t, client, csrf, "book.pdf", []byte("%PDF-original"))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, app.server.URL+"/api/v1/books/"+bookID+"/file", nil)
	result := make(chan error, 1)
	go func() {
		response, err := client.Do(request)
		if response != nil {
			response.Body.Close()
		}
		result <- err
	}()
	select {
	case <-source.started:
	case <-time.After(5 * time.Second):
		t.Fatal("retrieval did not start")
	}
	cancel()
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("request cancellation: %v", err)
	}
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("cancelled retrieval still running")
	}
	app.uploadWithStatus(t, client, csrf, []byte("other"), http.StatusCreated)
}

func TestRemoteOriginalHTTPContractAndAccessBeforeRetrieval(t *testing.T) {
	source := &managedOriginals{}
	app := newOriginalsApp(t, source, files.New(t.TempDir()))
	owner := app.client(t)
	csrf := app.csrf(t, owner)
	app.register(t, owner, csrf, "reader", "password", http.StatusCreated)
	app.login(t, owner, csrf, "reader", "password", http.StatusOK)
	bookID := app.uploadBookWithTitle(t, owner, csrf, "book.pdf", []byte("%PDF-original"), "Книга")
	other := app.client(t)
	otherCSRF := app.csrf(t, other)
	app.register(t, other, otherCSRF, "other", "password", http.StatusCreated)
	app.login(t, other, otherCSRF, "other", "password", http.StatusOK)
	path := "/v1/books/" + bookID + "/file"
	app.requestRaw(t, other, http.MethodGet, path, "", nil, http.StatusNotFound)
	app.requestRaw(t, app.client(t), http.MethodGet, path, "", nil, http.StatusUnauthorized)
	app.requestRaw(t, owner, http.MethodGet, "/readyz", "", nil, http.StatusOK)
	source.mu.Lock()
	opens := source.opens
	source.mu.Unlock()
	if opens != 0 {
		t.Fatalf("access or readiness contacted originals: %d", opens)
	}
	response := app.requestRaw(t, owner, http.MethodHead, path+"?download=1", "", nil, http.StatusOK)
	if len(response.body) != 0 || response.header.Get("Content-Length") != "13" || response.header.Get("Content-Type") != "application/pdf" || !strings.Contains(response.header.Get("Content-Disposition"), "filename*=") {
		t.Fatalf("HEAD contract: %v %q", response.header, response.body)
	}
	etag := response.header.Get("ETag")
	for _, test := range []struct {
		header, value string
		status        int
	}{{"Range", "bytes=99-", 416}, {"Range", "bytes=-3", 206}, {"If-None-Match", etag, 304}} {
		request, _ := http.NewRequest(http.MethodGet, app.server.URL+"/api"+path, nil)
		request.Header.Set(test.header, test.value)
		response, err := owner.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		io.Copy(io.Discard, response.Body)
		response.Body.Close()
		if response.StatusCode != test.status {
			t.Fatalf("%s=%s: %d", test.header, test.value, response.StatusCode)
		}
	}
}

func (a testApp) uploadWithStatus(t *testing.T, client *http.Client, csrf string, data []byte, status int) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, _ := writer.CreateFormFile("file", "book.pdf")
	part.Write(data)
	writer.Close()
	request, _ := http.NewRequest(http.MethodPost, a.server.URL+"/api/v1/books", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("X-CSRF-Token", csrf)
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	content, _ := io.ReadAll(response.Body)
	if response.StatusCode != status {
		t.Fatalf("upload: expected %d, got %d: %s", status, response.StatusCode, content)
	}
}

func newOriginalsApp(t *testing.T, source files.Originals, fileStore files.Store, wrappers ...func(http.Handler) http.Handler) testApp {
	t.Helper()
	cfg := config.Config{
		BasePath:          "/",
		DefaultQuotaBytes: 1024 * 1024, RegistrationEnabled: true, RegistrationAutoActivate: true,
		SessionSecret: "01234567890123456789012345678901", SessionTTL: time.Hour,
		MaxUploadBytes: 1024 * 1024, MaxCoverUploadBytes: 1024 * 1024,
	}
	fileStore.Books = source
	var handler http.Handler = httpapi.New(cfg, memory.New(), fileStore, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, wrap := range wrappers {
		handler = wrap(handler)
	}
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return testApp{server: server, storageRoot: fileStore.Root()}
}

// managedOriginals is a controllable external source, independent of the resolver.
type managedOriginals struct {
	opens                     int
	startOnce                 sync.Once
	mu                        sync.Mutex
	data                      []byte
	openErr, readErr, saveErr error
	started                   chan struct{}
	proceed                   chan struct{}
}

func (s *managedOriginals) BookPath(hash, format string) string { return hash + "." + format }

func (s *managedOriginals) MoveBook(ctx context.Context, path, hash, format string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.saveErr != nil {
		return "", s.saveErr
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	s.data = data
	return s.BookPath(hash, format), nil
}

func (s *managedOriginals) Delete(context.Context, string) error { return nil }

func (s *managedOriginals) Open(ctx context.Context, path string) (io.ReadCloser, error) {
	s.mu.Lock()
	s.opens++
	s.mu.Unlock()
	if s.started != nil {
		s.startOnce.Do(func() { close(s.started) })
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-s.proceed:
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.openErr != nil {
		return nil, s.openErr
	}
	data := append([]byte(nil), s.data...)
	if s.readErr != nil {
		return io.NopCloser(io.MultiReader(bytes.NewReader(data[:3]), failedOriginalRead{s.readErr})), nil
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}

type failedOriginalRead struct{ err error }

func (r failedOriginalRead) Read([]byte) (int, error) { return 0, r.err }
