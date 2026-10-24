package httpapi_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"
)

// Observing the request's cancellation channel synchronizes a waiting handler,
// without relying on resolver maps or scheduler delays.
type observedRequestContext struct {
	context.Context
	observed chan struct{}
	once     sync.Once
}

type interruptedBookRead struct {
	ctx                      context.Context
	prefix                   *bytes.Reader
	started, closed, cleanup chan struct{}
	startOnce, closeOnce     sync.Once
}

func (r *interruptedBookRead) Read(p []byte) (int, error) {
	if r.prefix.Len() > 0 {
		return r.prefix.Read(p)
	}
	r.startOnce.Do(func() { close(r.started) })
	<-r.ctx.Done()
	<-r.cleanup
	return 0, r.ctx.Err()
}

func (r *interruptedBookRead) Close() error {
	r.closeOnce.Do(func() { close(r.closed) })
	return nil
}

func TestAllBookWaitersCancelBeforeRetryReusesReleasedBudget(t *testing.T) {
	for _, cached := range []bool{false, true} {
		name := "workspace"
		if cached {
			name = "cache"
		}
		t.Run(name, func(t *testing.T) {
			h := newCacheHarness(t, 13)
			owner, csrf := cacheOwner(t, h)
			id := h.app.uploadBook(t, owner, csrf, "book.pdf", []byte("%PDF-original"))
			emptyBookCache(t, h)
			if !cached {
				h.cfg.CacheDir, h.cfg.CacheMaxBytes, h.cfg.WorkMaxBytes = "", 0, 13
				h.restart(t)
			}
			started, cancelled, cleanup := make(chan struct{}), make(chan struct{}), make(chan struct{})
			var finishOnce sync.Once
			finish := func() { finishOnce.Do(func() { close(cleanup) }) }
			t.Cleanup(finish)
			var mu sync.Mutex
			attempt := 0
			h.source.mu.Lock()
			h.source.openFn = func(ctx context.Context, _ string, data []byte) (io.ReadCloser, error) {
				mu.Lock()
				attempt++
				first := attempt == 1
				mu.Unlock()
				if first {
					return &interruptedBookRead{ctx: ctx, prefix: bytes.NewReader([]byte("%PDF-")), started: started, closed: cancelled, cleanup: cleanup}, nil
				}
				return io.NopCloser(bytes.NewReader(data)), nil
			}
			h.source.mu.Unlock()
			path := "/v1/books/" + id + "/file"
			_, cancelFirst, _, firstDone := coalescedRequest(t, h, owner, path, "")
			awaitCoalesced(t, started, "original receive did not begin")
			second, cancelSecond, _, secondDone := coalescedRequest(t, h, owner, path, "")
			awaitCoalesced(t, second.observed, "second waiter did not join")
			cancelFirst()
			cancelSecond()
			awaitCoalesced(t, cancelled, "last waiter did not cancel original receive")
			retry, _, response, retryDone := coalescedRequest(t, h, owner, path, "")
			awaitCoalesced(t, retry.observed, "retry did not wait for cleanup")
			h.source.mu.Lock()
			opens := h.source.opens
			h.source.mu.Unlock()
			if opens != 1 {
				t.Fatalf("retry began before cancelled receive released resources: %d opens", opens)
			}
			finish()
			for _, event := range []<-chan struct{}{firstDone, secondDone, retryDone} {
				awaitCoalesced(t, event, "request did not complete after cleanup")
			}
			if response.Code != http.StatusOK || response.Body.String() != "%PDF-original" {
				t.Fatalf("retry: %d %q", response.Code, response.Body.String())
			}
			_, _, work := h.cfg.FilePaths()
			if entries, err := os.ReadDir(work); err != nil || len(entries) != 0 {
				t.Fatalf("cancelled receive retained workspace: %v %v", entries, err)
			}
			if cached {
				if entries, err := os.ReadDir(h.cfg.CacheDir); err != nil || len(entries) != 1 {
					t.Fatalf("cache retry did not publish one complete copy: %v %v", entries, err)
				}
			}
		})
	}
}

func TestSharedWorkspaceFileStaysReservedUntilLastHTTPResponseFinishes(t *testing.T) {
	h := newCacheHarness(t, 13)
	owner, csrf := cacheOwner(t, h)
	a := h.app.uploadBook(t, owner, csrf, "a.pdf", []byte("%PDF-original"))
	b := h.app.uploadBook(t, owner, csrf, "b.pdf", []byte("%PDF-second!!"))
	h.cfg.CacheDir, h.cfg.CacheMaxBytes, h.cfg.WorkMaxBytes = "", 0, 13
	h.restart(t)
	request := httptest.NewRequest(http.MethodGet, h.app.server.URL+"/api/v1/books/"+a+"/file", nil)
	u, _ := url.Parse(h.app.server.URL)
	for _, cookie := range owner.Jar.Cookies(u) {
		request.AddCookie(cookie)
	}
	writer := &blockedCacheResponse{ResponseRecorder: httptest.NewRecorder(), started: make(chan struct{}), proceed: make(chan struct{})}
	var once sync.Once
	release := func() { once.Do(func() { close(writer.proceed) }) }
	t.Cleanup(release)
	done := make(chan struct{})
	go func() { defer close(done); h.app.server.Config.Handler.ServeHTTP(writer, request) }()
	awaitCoalesced(t, writer.started, "first response did not hold the workspace file")
	_, _, second, secondDone := coalescedRequest(t, h, owner, "/v1/books/"+a+"/file?download=1", "bytes=5-8")
	awaitCoalesced(t, secondDone, "shared range did not complete")
	if second.Code != http.StatusPartialContent || second.Body.String() != "orig" {
		t.Fatalf("shared independent range: %d %q", second.Code, second.Body.String())
	}
	h.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+b+"/file", "", nil, http.StatusServiceUnavailable)
	h.source.mu.Lock()
	opens := h.source.opens
	h.source.mu.Unlock()
	if opens != 1 {
		t.Fatalf("shared or rejected request opened another original: %d", opens)
	}
	release()
	awaitCoalesced(t, done, "last response did not complete")
	if writer.Code != http.StatusOK || writer.Body.String() != "%PDF-original" {
		t.Fatalf("first response seek was changed by another range: %d %q", writer.Code, writer.Body.String())
	}
	h.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+b+"/file", "", nil, http.StatusOK)
}

func TestSharedBookReceiveFailureAllowsAnotherAttempt(t *testing.T) {
	for _, cached := range []bool{false, true} {
		name := "workspace"
		if cached {
			name = "cache"
		}
		for _, failure := range []string{"unavailable", "truncated", "wrong hash", "interrupted"} {
			t.Run(name+"/"+failure, func(t *testing.T) {
				h := newCacheHarness(t, 13)
				owner, csrf := cacheOwner(t, h)
				id := h.app.uploadBook(t, owner, csrf, "book.pdf", []byte("%PDF-original"))
				emptyBookCache(t, h)
				if !cached {
					h.cfg.CacheDir, h.cfg.CacheMaxBytes, h.cfg.WorkMaxBytes = "", 0, 13
					h.restart(t)
				}
				started, proceed := make(chan struct{}), make(chan struct{})
				var once sync.Once
				var startedOnce sync.Once
				release := func() { once.Do(func() { close(proceed) }) }
				t.Cleanup(release)
				h.source.mu.Lock()
				h.source.openFn = func(ctx context.Context, _ string, _ []byte) (io.ReadCloser, error) {
					startedOnce.Do(func() { close(started) })
					select {
					case <-ctx.Done():
						return nil, ctx.Err()
					case <-proceed:
					}
					switch failure {
					case "truncated":
						return io.NopCloser(bytes.NewReader([]byte("%PDF-"))), nil
					case "wrong hash":
						return io.NopCloser(bytes.NewReader([]byte("%PDF-corrupt!"))), nil
					case "interrupted":
						return io.NopCloser(io.MultiReader(bytes.NewReader([]byte("%PDF-")), failedBookStream{})), nil
					default:
						return nil, errors.New("original unavailable")
					}
				}
				h.source.mu.Unlock()
				path := "/v1/books/" + id + "/file"
				_, _, first, firstDone := coalescedRequest(t, h, owner, path, "")
				awaitCoalesced(t, started, "failing original receive did not start")
				second, _, response, secondDone := coalescedRequest(t, h, owner, path, "")
				awaitCoalesced(t, second.observed, "second failing waiter did not join")
				release()
				awaitCoalesced(t, firstDone, "first error response did not finish")
				awaitCoalesced(t, secondDone, "second error response did not finish")
				if first.Code != http.StatusServiceUnavailable || response.Code != http.StatusServiceUnavailable {
					t.Fatalf("shared failure: %d %d", first.Code, response.Code)
				}
				if bytes.Contains(first.Body.Bytes(), []byte("%PDF-")) || bytes.Contains(response.Body.Bytes(), []byte("%PDF-")) {
					t.Fatal("incomplete or corrupt bytes leaked into a shared response")
				}
				h.source.mu.Lock()
				if h.source.opens != 1 {
					t.Errorf("failure fetched %d originals", h.source.opens)
				}
				h.source.openFn = nil
				h.source.mu.Unlock()
				h.app.requestRaw(t, owner, http.MethodGet, path, "", nil, http.StatusOK)
			})
		}
	}
}

type failedBookStream struct{}

func (failedBookStream) Read([]byte) (int, error) {
	return 0, errors.New("original transfer interrupted")
}

func (c *observedRequestContext) Done() <-chan struct{} {
	c.once.Do(func() { close(c.observed) })
	return c.Context.Done()
}

func coalescedRequest(t *testing.T, h *cacheHarness, client *http.Client, path, byteRange string) (*observedRequestContext, context.CancelFunc, *httptest.ResponseRecorder, <-chan struct{}) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	observed := &observedRequestContext{Context: ctx, observed: make(chan struct{})}
	request := httptest.NewRequest(http.MethodGet, h.app.server.URL+"/api"+path, nil).WithContext(observed)
	if byteRange != "" {
		request.Header.Set("Range", byteRange)
	}
	u, _ := url.Parse(h.app.server.URL)
	for _, cookie := range client.Jar.Cookies(u) {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { defer close(done); h.app.server.Config.Handler.ServeHTTP(response, request) }()
	t.Cleanup(cancel)
	return observed, cancel, response, done
}
func awaitCoalesced(t *testing.T, event <-chan struct{}, label string) {
	t.Helper()
	select {
	case <-event:
	case <-time.After(5 * time.Second):
		t.Fatal(label)
	}
}

func TestConcurrentBookRequestsShareFetchAfterOneClientCancels(t *testing.T) {
	for _, cached := range []bool{false, true} {
		name := "workspace"
		if cached {
			name = "cache"
		}
		t.Run(name, func(t *testing.T) {
			h := newCacheHarness(t, 13)
			owner, csrf := cacheOwner(t, h)
			id := h.app.uploadBook(t, owner, csrf, "book.pdf", []byte("%PDF-original"))
			other := h.app.client(t)
			otherCSRF := h.app.csrf(t, other)
			h.app.register(t, other, otherCSRF, "second", "password", http.StatusCreated)
			h.app.login(t, other, otherCSRF, "second", "password", http.StatusOK)
			otherID := h.app.uploadBook(t, other, otherCSRF, "book.pdf", []byte("%PDF-original"))
			emptyBookCache(t, h)
			if !cached {
				h.cfg.CacheDir = ""
				h.cfg.CacheMaxBytes = 0
				h.cfg.WorkMaxBytes = 13
				h.restart(t)
			}
			started, proceed, cancelled := make(chan struct{}, 3), make(chan struct{}), make(chan struct{}, 3)
			var releaseOnce sync.Once
			release := func() { releaseOnce.Do(func() { close(proceed) }) }
			t.Cleanup(release)
			h.source.mu.Lock()
			h.source.openFn = func(ctx context.Context, _ string, data []byte) (io.ReadCloser, error) {
				started <- struct{}{}
				select {
				case <-ctx.Done():
					cancelled <- struct{}{}
					return nil, ctx.Err()
				case <-proceed:
					return io.NopCloser(bytes.NewReader(data)), nil
				}
			}
			h.source.mu.Unlock()
			path := "/v1/books/" + id + "/file"
			_, cancelFirst, _, firstDone := coalescedRequest(t, h, owner, path, "")
			awaitCoalesced(t, started, "first original fetch did not start")
			// The common hash does not give a different user access to the first record.
			h.app.requestRaw(t, other, http.MethodGet, path, "", nil, http.StatusNotFound)
			second, _, response, secondDone := coalescedRequest(t, h, other, "/v1/books/"+otherID+"/file?download=1", "bytes=5-8")
			awaitCoalesced(t, second.observed, "second handler did not wait for its original")
			h.source.mu.Lock()
			opens := h.source.opens
			h.source.mu.Unlock()
			if opens != 1 {
				t.Fatalf("simultaneous requests fetched %d originals", opens)
			}
			cancelFirst()
			awaitCoalesced(t, firstDone, "cancelled handler did not finish")
			select {
			case <-cancelled:
				t.Fatal("one client cancelled the shared fetch")
			default:
			}
			release()
			awaitCoalesced(t, secondDone, "remaining response did not finish")
			if response.Code != 206 || response.Body.String() != "orig" || response.Header().Get("Content-Range") != "bytes 5-8/13" {
				t.Fatalf("remaining response: %d %q %v", response.Code, response.Body.String(), response.Header())
			}
		})
	}
}
