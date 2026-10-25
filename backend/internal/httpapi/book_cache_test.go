package httpapi_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
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

func TestUploadedBookRemainsCachedAcrossRestartWithoutAnyOriginalAccess(t *testing.T) {
	h := newCacheHarness(t, 13)
	owner := h.app.client(t)
	csrf := h.app.csrf(t, owner)
	h.app.register(t, owner, csrf, "reader", "password", http.StatusCreated)
	h.app.login(t, owner, csrf, "reader", "password", http.StatusOK)
	id := h.app.uploadBook(t, owner, csrf, "book.pdf", []byte("%PDF-original"))
	h.source.mu.Lock()
	h.source.openErr = errors.New("original disk asleep")
	h.source.mu.Unlock()
	path := "/v1/books/" + id + "/file"
	for _, suffix := range []string{"", "?download=1"} {
		response := h.app.requestRaw(t, owner, http.MethodGet, path+suffix, "", nil, http.StatusOK)
		if string(response.body) != "%PDF-original" {
			t.Fatalf("cached bytes: %q", response.body)
		}
	}
	h.restart(t)
	h.app.requestRaw(t, owner, http.MethodGet, "/readyz", "", nil, http.StatusOK)
	h.app.requestRaw(t, owner, http.MethodHead, path, "", nil, http.StatusOK)
	response := h.app.requestRaw(t, owner, http.MethodGet, path, "", nil, http.StatusOK)
	if string(response.body) != "%PDF-original" {
		t.Fatalf("persisted cache bytes: %q", response.body)
	}
	other := h.app.client(t)
	otherCSRF := h.app.csrf(t, other)
	h.app.register(t, other, otherCSRF, "other", "password", http.StatusCreated)
	h.app.login(t, other, otherCSRF, "other", "password", http.StatusOK)
	h.app.requestRaw(t, other, http.MethodGet, path, "", nil, http.StatusNotFound)
	h.app.requestRaw(t, h.app.client(t), http.MethodGet, path, "", nil, http.StatusUnauthorized)
	h.source.mu.Lock()
	defer h.source.mu.Unlock()
	if h.source.opens != 0 {
		t.Fatalf("cache hit, startup, readiness or access check opened originals %d times", h.source.opens)
	}
}

type cacheHarness struct {
	app       testApp
	cfg       config.Config
	store     *memory.Store
	source    *cacheOriginals
	originals files.Originals
	logs      bytes.Buffer
}

func newCacheHarness(t *testing.T, maximum int64) *cacheHarness {
	t.Helper()
	root := t.TempDir()
	h := &cacheHarness{
		cfg: config.Config{
			StorageDir: filepath.Join(root, "storage"), CacheDir: filepath.Join(root, "cache"), CacheMaxBytes: maximum,
			BasePath: "/", DefaultQuotaBytes: 1 << 20, RegistrationEnabled: true, RegistrationAutoActivate: true,
			SessionSecret: "01234567890123456789012345678901", SessionTTL: time.Hour,
			MaxUploadBytes: 1 << 20, MaxCoverUploadBytes: 1 << 20,
		},
		store: memory.New(), source: &cacheOriginals{data: make(map[string][]byte)},
	}
	h.restart(t)
	return h
}

func (h *cacheHarness) restart(t *testing.T) {
	t.Helper()
	if h.app.server != nil {
		h.app.server.Close()
	}
	fileStore, err := files.NewConfigured(h.cfg)
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(&h.logs, nil))
	fileStore.SetLogger(logger)
	if err := fileStore.Ensure(); err != nil {
		t.Fatal(err)
	}
	fileStore.Books = h.source
	if h.originals != nil {
		fileStore.Books = h.originals
	}
	handler := httpapi.New(h.cfg, h.store, fileStore, logger)
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	h.app = testApp{server: server, storageRoot: h.cfg.StorageDir}
}

// cacheOriginals is the external original service; it can refuse every retrieval.
type cacheOriginals struct {
	mu      sync.Mutex
	data    map[string][]byte
	opens   int
	openErr error
	openFn  func(context.Context, string, []byte) (io.ReadCloser, error)
}

func (s *cacheOriginals) BookPath(hash, format string) string  { return hash + "." + format }
func (s *cacheOriginals) Delete(context.Context, string) error { return nil }
func (s *cacheOriginals) MoveBook(ctx context.Context, path, hash, format string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	key := s.BookPath(hash, format)
	s.mu.Lock()
	s.data[key] = data
	s.mu.Unlock()
	return key, nil
}
func (s *cacheOriginals) Open(ctx context.Context, location string) (io.ReadCloser, error) {
	s.mu.Lock()
	s.opens++
	err, fn, data := s.openErr, s.openFn, append([]byte(nil), s.data[location]...)
	s.mu.Unlock()
	if err != nil {
		return nil, err
	}
	if fn != nil {
		return fn(ctx, location, data)
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}

func cacheOwner(t *testing.T, h *cacheHarness) (*http.Client, string) {
	t.Helper()
	client := h.app.client(t)
	csrf := h.app.csrf(t, client)
	h.app.register(t, client, csrf, "reader", "password", http.StatusCreated)
	h.app.login(t, client, csrf, "reader", "password", http.StatusOK)
	return client, csrf
}

func TestBookCacheEvictsLeastRecentlyReadOrDownloadedBook(t *testing.T) {
	for _, suffix := range []string{"", "?download=1"} {
		t.Run(suffix, func(t *testing.T) {
			h := newCacheHarness(t, 26)
			owner, csrf := cacheOwner(t, h)
			a := h.app.uploadBook(t, owner, csrf, "a.pdf", []byte("%PDF-original"))
			b := h.app.uploadBook(t, owner, csrf, "b.pdf", []byte("%PDF-second!!"))
			h.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+a+"/file"+suffix, "", nil, http.StatusOK)
			h.restart(t)
			c := h.app.uploadBook(t, owner, csrf, "c.pdf", []byte("%PDF-third!!!"))
			h.source.mu.Lock()
			h.source.openErr = errors.New("offline")
			h.source.mu.Unlock()
			for _, id := range []string{a, c} {
				h.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+id+"/file", "", nil, http.StatusOK)
			}
			h.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+b+"/file", "", nil, http.StatusServiceUnavailable)
		})
	}
}

// Blocking the HTTP writer holds a real response open without timing assumptions.
type blockedCacheResponse struct {
	*httptest.ResponseRecorder
	started, proceed chan struct{}
	once             sync.Once
}

func (w *blockedCacheResponse) Write(p []byte) (int, error) {
	w.once.Do(func() { close(w.started); <-w.proceed })
	return w.ResponseRecorder.Write(p)
}

func TestBookCacheProtectsActiveHTTPResponseFromEviction(t *testing.T) {
	h := newCacheHarness(t, 13)
	owner, csrf := cacheOwner(t, h)
	a := h.app.uploadBook(t, owner, csrf, "a.pdf", []byte("%PDF-original"))
	req := httptest.NewRequest(http.MethodGet, h.app.server.URL+"/api/v1/books/"+a+"/file", nil)
	u, _ := url.Parse(h.app.server.URL)
	for _, cookie := range owner.Jar.Cookies(u) {
		req.AddCookie(cookie)
	}
	w := &blockedCacheResponse{ResponseRecorder: httptest.NewRecorder(), started: make(chan struct{}), proceed: make(chan struct{})}
	done := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(w.proceed) }) }
	t.Cleanup(release)
	go func() { defer close(done); h.app.server.Config.Handler.ServeHTTP(w, req) }()
	select {
	case <-w.started:
	case <-time.After(5 * time.Second):
		t.Fatal("response did not start")
	}
	b := h.app.uploadBook(t, owner, csrf, "b.pdf", []byte("%PDF-second!!"))
	// B cannot seed over A while A is pinned, so it uses the bounded original path.
	h.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+b+"/file", "", nil, http.StatusOK)
	h.source.mu.Lock()
	h.source.openErr = errors.New("offline")
	h.source.mu.Unlock()
	h.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+a+"/file", "", nil, http.StatusOK)
	release()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("response did not finish")
	}
	if w.Code != http.StatusOK || w.Body.String() != "%PDF-original" {
		t.Fatalf("active response: %d %q", w.Code, w.Body.String())
	}
}

func emptyBookCache(t *testing.T, h *cacheHarness) {
	t.Helper()
	entries, err := os.ReadDir(h.cfg.CacheDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if err := os.Remove(filepath.Join(h.cfg.CacheDir, entry.Name())); err != nil {
			t.Fatal(err)
		}
	}
	h.restart(t)
}

func TestBookCacheReadyAndReceivingFilesShareStrictBudget(t *testing.T) {
	h := newCacheHarness(t, 26)
	owner, csrf := cacheOwner(t, h)
	a := h.app.uploadBook(t, owner, csrf, "a.pdf", []byte("%PDF-original"))
	b := h.app.uploadBook(t, owner, csrf, "b.pdf", []byte("%PDF-second!!"))
	c := h.app.uploadBook(t, owner, csrf, "c.pdf", []byte("%PDF-third!!!"))
	emptyBookCache(t, h)
	h.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+a+"/file", "", nil, http.StatusOK)
	req := httptest.NewRequest(http.MethodGet, h.app.server.URL+"/api/v1/books/"+a+"/file", nil)
	u, _ := url.Parse(h.app.server.URL)
	for _, cookie := range owner.Jar.Cookies(u) {
		req.AddCookie(cookie)
	}
	w := &blockedCacheResponse{ResponseRecorder: httptest.NewRecorder(), started: make(chan struct{}), proceed: make(chan struct{})}
	responseDone := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(w.proceed) }) }
	t.Cleanup(release)
	go func() { defer close(responseDone); h.app.server.Config.Handler.ServeHTTP(w, req) }()
	select {
	case <-w.started:
	case <-time.After(5 * time.Second):
		t.Fatal("A response did not start")
	}
	started, proceed := make(chan struct{}), make(chan struct{})
	var proceedOnce sync.Once
	finishReceive := func() { proceedOnce.Do(func() { close(proceed) }) }
	t.Cleanup(finishReceive)
	h.source.mu.Lock()
	h.source.openFn = func(ctx context.Context, _ string, data []byte) (io.ReadCloser, error) {
		if string(data) == "%PDF-second!!" {
			close(started)
			select {
			case <-proceed:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		return io.NopCloser(bytes.NewReader(data)), nil
	}
	h.source.mu.Unlock()
	request, _ := http.NewRequest(http.MethodGet, h.app.server.URL+"/api/v1/books/"+b+"/file", nil)
	result := make(chan error, 1)
	go func() {
		resp, err := owner.Do(request)
		if err == nil {
			_, err = io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			if resp.StatusCode != 200 {
				err = errors.New("B response failed")
			}
		}
		result <- err
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("B receive did not start")
	}
	h.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+c+"/file", "", nil, http.StatusOK)
	entries, err := os.ReadDir(h.cfg.CacheDir)
	if err != nil {
		t.Fatal(err)
	}
	var used int64
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			t.Fatal(err)
		}
		used += info.Size()
	}
	if used > 26 || len(entries) != 2 {
		t.Fatalf("cache exceeded ready+inflight budget: bytes=%d files=%d", used, len(entries))
	}
	finishReceive()
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("B receive did not finish")
	}
	release()
	<-responseDone
}

func TestBookCacheBypassKeepsBooksAvailableAndLogsOperationalFailure(t *testing.T) {
	for _, mode := range []string{"too-small", "disabled", "unwritable"} {
		t.Run(mode, func(t *testing.T) {
			h := newCacheHarness(t, 1)
			switch mode {
			case "disabled":
				h.cfg.CacheDir = ""
				h.cfg.CacheMaxBytes = 0
			case "unwritable":
				if err := os.Remove(h.cfg.CacheDir); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(h.cfg.CacheDir, []byte("blocked"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			h.restart(t)
			owner, csrf := cacheOwner(t, h)
			id := h.app.uploadBook(t, owner, csrf, "book.pdf", []byte("%PDF-original"))
			h.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+id+"/file", "", nil, http.StatusOK)
			h.app.requestRaw(t, owner, http.MethodGet, "/readyz", "", nil, http.StatusOK)
			if mode == "unwritable" && !bytes.Contains(h.logs.Bytes(), []byte("book cache unavailable")) {
				t.Fatal("cache failure was not logged")
			}
		})
	}
}

func TestBookCacheRejectsTruncatedReceiveAndAllowsRetry(t *testing.T) {
	h := newCacheHarness(t, 13)
	owner, csrf := cacheOwner(t, h)
	id := h.app.uploadBook(t, owner, csrf, "book.pdf", []byte("%PDF-original"))
	emptyBookCache(t, h)
	h.source.mu.Lock()
	h.source.openFn = func(context.Context, string, []byte) (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader([]byte("%PDF-"))), nil
	}
	h.source.mu.Unlock()
	response := h.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+id+"/file", "", nil, http.StatusServiceUnavailable)
	if bytes.Contains(response.body, []byte("%PDF-")) {
		t.Fatal("truncated original leaked to HTTP response")
	}
	entries, err := os.ReadDir(h.cfg.CacheDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("unfinished cache remains: %v %v", entries, err)
	}
	h.source.mu.Lock()
	h.source.openFn = nil
	h.source.mu.Unlock()
	h.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+id+"/file", "", nil, http.StatusOK)
}

func TestBookCacheRestartDiscardsPartialAndCorruptCopies(t *testing.T) {
	h := newCacheHarness(t, 13)
	owner, csrf := cacheOwner(t, h)
	id := h.app.uploadBook(t, owner, csrf, "book.pdf", []byte("%PDF-original"))
	entries, err := os.ReadDir(h.cfg.CacheDir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("cache entries: %v %v", entries, err)
	}
	if err := os.WriteFile(filepath.Join(h.cfg.CacheDir, entries[0].Name()), []byte("%PDF-corrupt!"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(h.cfg.CacheDir, "partial-interrupted"), []byte("%PDF-partial"), 0600); err != nil {
		t.Fatal(err)
	}
	h.source.mu.Lock()
	h.source.openErr = errors.New("offline")
	h.source.mu.Unlock()
	h.restart(t)
	entries, err = os.ReadDir(h.cfg.CacheDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("invalid restarted cache remains: %v %v", entries, err)
	}
	h.source.mu.Lock()
	opens := h.source.opens
	h.source.mu.Unlock()
	if opens != 0 {
		t.Fatalf("startup contacted originals: %d", opens)
	}
	h.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+id+"/file", "", nil, http.StatusServiceUnavailable)
	h.source.mu.Lock()
	h.source.openErr = nil
	h.source.mu.Unlock()
	h.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+id+"/file", "", nil, http.StatusOK)
}

func TestBookCachePublicationFailureFallsBackToOriginal(t *testing.T) {
	h := newCacheHarness(t, 13)
	owner, csrf := cacheOwner(t, h)
	id := h.app.uploadBook(t, owner, csrf, "book.pdf", []byte("%PDF-original"))
	emptyBookCache(t, h)
	var once sync.Once
	h.source.mu.Lock()
	h.source.openFn = func(_ context.Context, location string, _ []byte) (io.ReadCloser, error) {
		var moveErr error
		once.Do(func() {
			// A conflicting directory reproduces a publication failure after the
			// partial file has already been created and written successfully.
			moveErr = os.Mkdir(filepath.Join(h.cfg.CacheDir, strings.TrimSuffix(location, ".pdf")+".book"), 0700)
		})
		if moveErr != nil {
			return nil, moveErr
		}
		return io.NopCloser(bytes.NewReader([]byte("%PDF-original"))), nil
	}
	h.source.mu.Unlock()
	response := h.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+id+"/file", "", nil, http.StatusOK)
	if string(response.body) != "%PDF-original" {
		t.Fatalf("bypass bytes: %q", response.body)
	}
	if !bytes.Contains(h.logs.Bytes(), []byte("book cache unavailable")) {
		t.Fatal("publication failure not logged")
	}
}

func TestBookCacheDiskFullWriteFallsBackToBoundedWorkspace(t *testing.T) {
	root := os.Getenv("BOOK_HUB_TEST_SMALL_CACHE_DIR")
	if root == "" {
		t.Skip("set BOOK_HUB_TEST_SMALL_CACHE_DIR to a dedicated tmpfs smaller than 128 KiB")
	}
	h := newCacheHarness(t, 256<<10)
	path, err := os.MkdirTemp(root, "cache-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(path) })
	h.cfg.CacheDir = path
	h.restart(t)
	owner, csrf := cacheOwner(t, h)
	data := append([]byte("%PDF-"), bytes.Repeat([]byte("a"), (128<<10)-5)...)
	id := h.app.uploadBook(t, owner, csrf, "book.pdf", data)
	if !bytes.Contains(h.logs.Bytes(), []byte("book cache unavailable")) {
		t.Fatal("fixture did not trigger a cache disk write failure")
	}
	response := h.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+id+"/file", "", nil, http.StatusOK)
	if !bytes.Equal(response.body, data) {
		t.Fatal("disk-full cache bypass changed bytes")
	}
	entries, err := os.ReadDir(path)
	if err != nil || len(entries) != 0 {
		t.Fatalf("partial cache files after ENOSPC: %v %v", entries, err)
	}
	_, _, work := h.cfg.FilePaths()
	entries, err = os.ReadDir(work)
	if err != nil || len(entries) != 0 {
		t.Fatalf("workspace retained bypass file: %v %v", entries, err)
	}
}

func TestBookCacheSharesOneCopyAcrossOwnersAndRevokesDeletedEntry(t *testing.T) {
	h := newCacheHarness(t, 13)
	owner, csrf := cacheOwner(t, h)
	a := h.app.uploadBook(t, owner, csrf, "book.pdf", []byte("%PDF-original"))
	other := h.app.client(t)
	otherCSRF := h.app.csrf(t, other)
	h.app.register(t, other, otherCSRF, "other", "password", http.StatusCreated)
	h.app.login(t, other, otherCSRF, "other", "password", http.StatusOK)
	b := h.app.uploadBook(t, other, otherCSRF, "book.pdf", []byte("%PDF-original"))
	h.source.mu.Lock()
	h.source.openErr = errors.New("offline")
	h.source.mu.Unlock()
	for _, test := range []struct {
		client *http.Client
		id     string
	}{{owner, a}, {other, b}} {
		h.app.requestRaw(t, test.client, http.MethodGet, "/v1/books/"+test.id+"/file", "", nil, http.StatusOK)
	}
	h.app.requestJSON(t, owner, http.MethodDelete, "/v1/books/"+a, csrf, nil, http.StatusNoContent)
	h.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+a+"/file", "", nil, http.StatusNotFound)
	h.app.requestRaw(t, other, http.MethodGet, "/v1/books/"+b+"/file", "", nil, http.StatusOK)
	entries, err := os.ReadDir(h.cfg.CacheDir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("owners duplicated cache: %v %v", entries, err)
	}
}

func TestBookCacheCancellationReleasesReceivingReservation(t *testing.T) {
	h := newCacheHarness(t, 13)
	owner, csrf := cacheOwner(t, h)
	id := h.app.uploadBook(t, owner, csrf, "book.pdf", []byte("%PDF-original"))
	emptyBookCache(t, h)
	started := make(chan struct{})
	h.source.mu.Lock()
	h.source.openFn = func(ctx context.Context, _ string, _ []byte) (io.ReadCloser, error) {
		close(started)
		<-ctx.Done()
		return nil, ctx.Err()
	}
	h.source.mu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest(http.MethodGet, h.app.server.URL+"/api/v1/books/"+id+"/file", nil).WithContext(ctx)
	u, _ := url.Parse(h.app.server.URL)
	for _, cookie := range owner.Jar.Cookies(u) {
		req.AddCookie(cookie)
	}
	done := make(chan struct{})
	go func() { defer close(done); h.app.server.Config.Handler.ServeHTTP(httptest.NewRecorder(), req) }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("cache receive did not start")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("cancelled receive did not finish")
	}
	entries, err := os.ReadDir(h.cfg.CacheDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("cancelled partial remains: %v %v", entries, err)
	}
	h.source.mu.Lock()
	h.source.openFn = nil
	h.source.mu.Unlock()
	h.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+id+"/file", "", nil, http.StatusOK)
	entries, err = os.ReadDir(h.cfg.CacheDir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("cache reservation was not released: %v %v", entries, err)
	}
}

func TestBookCacheDirectoryUsesDirectBypassAndWarmCopiesWithOfflineOriginals(t *testing.T) {
	for _, maximum := range []int64{1, 13} {
		t.Run(fmt.Sprint(maximum), func(t *testing.T) {
			h := newCacheHarness(t, maximum)
			books, _, _ := h.cfg.FilePaths()
			h.originals = files.NewDirectory(books)
			h.restart(t)
			owner, csrf := cacheOwner(t, h)
			id := h.app.uploadBook(t, owner, csrf, "book.pdf", []byte("%PDF-original"))
			if maximum == 13 {
				if err := os.Rename(books, books+"-offline"); err != nil {
					t.Fatal(err)
				}
			}
			// A local bypass needs no workspace reservation; a ready copy needs
			// neither workspace capacity nor access to the original directory.
			h.cfg.WorkMaxBytes = 1
			h.restart(t)
			response := h.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+id+"/file", "", nil, http.StatusOK)
			if string(response.body) != "%PDF-original" {
				t.Fatalf("local bytes: %q", response.body)
			}
		})
	}
}

func TestBookReadsDoNotVerifyOriginalHash(t *testing.T) {
	for _, local := range []bool{false, true} {
		for _, mode := range []string{"disabled", "bypass", "miss"} {
			t.Run(fmt.Sprintf("local=%t/%s", local, mode), func(t *testing.T) {
				h := newCacheHarness(t, 13)
				books, _, _ := h.cfg.FilePaths()
				if local {
					h.originals = files.NewDirectory(books)
					h.restart(t)
				}
				owner, csrf := cacheOwner(t, h)
				id := h.app.uploadBook(t, owner, csrf, "book.pdf", []byte("%PDF-original"))
				emptyBookCache(t, h)
				switch mode {
				case "disabled":
					h.cfg.CacheDir, h.cfg.CacheMaxBytes = "", 0
				case "bypass":
					h.cfg.CacheMaxBytes = 1
				}
				h.restart(t)
				// Changing bytes without changing size distinguishes hash checks from stat.
				changed := []byte("%PDF-changed!")
				if local {
					paths, err := filepath.Glob(filepath.Join(books, "*", "*.pdf"))
					if err != nil || len(paths) != 1 {
						t.Fatalf("originals: %v %v", paths, err)
					}
					if err := os.WriteFile(paths[0], changed, 0600); err != nil {
						t.Fatal(err)
					}
				} else {
					h.source.mu.Lock()
					for location := range h.source.data {
						h.source.data[location] = changed
					}
					h.source.mu.Unlock()
				}
				path := "/v1/books/" + id + "/file"
				_, _, response, done := coalescedRequest(t, h, owner, path, "bytes=5-8")
				awaitCoalesced(t, done, "range response did not finish")
				if response.Code != http.StatusPartialContent || response.Body.String() != "chan" || response.Header().Get("Content-Range") != "bytes 5-8/13" {
					t.Fatalf("range response: %d %q %v", response.Code, response.Body.String(), response.Header())
				}
				for _, suffix := range []string{"", "?download=1"} {
					full := h.app.requestRaw(t, owner, http.MethodGet, path+suffix, "", nil, http.StatusOK)
					if !bytes.Equal(full.body, changed) {
						t.Fatalf("book response: %q", full.body)
					}
				}
			})
		}
	}
}
