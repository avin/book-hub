package httpapi_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
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
	"book-hub/internal/database"
	"book-hub/internal/httpapi"
	"book-hub/internal/storage"
	"book-hub/internal/storage/files"
	"book-hub/internal/storage/sqlstore"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestMultipleBackendsPublishOneOriginalAndCoordinateDeletionAcrossConnections(t *testing.T) {
	h := newMultipleBackends(t)
	first, second := h.nodes[0], h.nodes[1]
	clients := [2]*http.Client{first.app.client(t), second.app.client(t)}
	var csrf [2]string
	for i, node := range h.nodes {
		csrf[i] = node.app.csrf(t, clients[i])
		login := fmt.Sprintf("reader%d", i)
		node.app.register(t, clients[i], csrf[i], login, "password", http.StatusCreated)
		node.app.login(t, clients[i], csrf[i], login, "password", http.StatusOK)
	}
	content := []byte("%PDF-original")
	entered, proceed := make(chan struct{}), make(chan struct{})
	var once sync.Once
	release := func() { once.Do(func() { close(proceed) }) }
	t.Cleanup(release)
	h.source.put = func(ctx context.Context, input, hash, format string) (string, error) {
		close(entered)
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-proceed:
			return h.source.directory.MoveBook(ctx, input, hash, format)
		}
	}
	initial := make(chan multipleReply, 1)
	go func() { initial <- multipleUpload(context.Background(), first.app, clients[0], csrf[0], content) }()
	awaitMultipleEvent(t, entered, "first publication did not reach the original service")
	// The competing HTTP upload must be excluded by PostgreSQL, not by a local mutex.
	attempt, cancel := context.WithCancel(context.Background())
	defer cancel()
	pending := make(chan multipleReply, 1)
	go func() { pending <- multipleUpload(attempt, second.app, clients[1], csrf[1], content) }()
	awaitPostgresLockWait(t, second.cfg.DatabaseURL)
	cancel()
	blocked := awaitMultipleReply(t, pending)
	if !errors.Is(blocked.err, context.Canceled) {
		t.Fatalf("concurrent publication was not excluded: %+v", blocked)
	}
	release()
	created := awaitMultipleReply(t, initial)
	idA := created.bookID(t)
	h.source.mu.Lock()
	h.source.put = nil
	h.source.mu.Unlock()
	idB := multipleUpload(context.Background(), second.app, clients[1], csrf[1], content).bookID(t)
	h.source.mu.Lock()
	puts := h.source.puts
	h.source.mu.Unlock()
	if puts != 1 {
		t.Fatalf("concurrent users published %d copies of one original", puts)
	}
	first.app.requestRaw(t, clients[0], http.MethodDelete, "/v1/books/"+idA, csrf[0], nil, http.StatusNoContent)
	if err := first.store.ProcessOriginalDeletions(context.Background(), func(context.Context, string) error {
		t.Error("another backend still owns this original")
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	second.app.requestRaw(t, clients[1], http.MethodGet, "/v1/books/"+idB+"/file", "", nil, http.StatusOK)
	second.app.requestRaw(t, clients[1], http.MethodDelete, "/v1/books/"+idB, csrf[1], nil, http.StatusNoContent)

	deleting, finishDelete := make(chan struct{}), make(chan struct{})
	var finishOnce sync.Once
	finish := func() { finishOnce.Do(func() { close(finishDelete) }) }
	t.Cleanup(finish)
	deletion := make(chan error, 1)
	go func() {
		deletion <- first.store.ProcessOriginalDeletions(context.Background(), func(ctx context.Context, location string) error {
			close(deleting)
			<-finishDelete
			return h.source.directory.Delete(ctx, location)
		})
	}()
	awaitMultipleEvent(t, deleting, "physical deletion did not start")
	attempt, cancel = context.WithCancel(context.Background())
	defer cancel()
	pending = make(chan multipleReply, 1)
	go func() { pending <- multipleUpload(attempt, second.app, clients[0], csrf[0], content) }()
	awaitPostgresLockWait(t, second.cfg.DatabaseURL)
	cancel()
	blocked = awaitMultipleReply(t, pending)
	if !errors.Is(blocked.err, context.Canceled) {
		t.Fatalf("HTTP re-upload crossed an active deletion: %+v", blocked)
	}
	// A second worker on another connection must not execute the same physical deletion.
	workerURL, err := url.Parse(second.cfg.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	workerQuery := workerURL.Query()
	workerQuery.Set("application_name", workerQuery.Get("application_name")+"_worker")
	workerURL.RawQuery = workerQuery.Encode()
	workerStore, err := sqlstore.Open(context.Background(), workerURL.String())
	if err != nil {
		t.Fatal(err)
	}
	defer workerStore.Close()
	attempt, cancel = context.WithCancel(context.Background())
	defer cancel()
	otherWorker := make(chan error, 1)
	go func() {
		otherWorker <- workerStore.ProcessOriginalDeletions(attempt, func(context.Context, string) error {
			t.Error("two backend workers deleted the same original concurrently")
			return nil
		})
	}()
	awaitPostgresLockWait(t, workerURL.String())
	cancel()
	if err := <-otherWorker; !errors.Is(err, context.Canceled) {
		t.Fatalf("second worker was not excluded: %v", err)
	}
	finish()
	if err := <-deletion; err != nil {
		t.Fatal(err)
	}
	reloaded := multipleUpload(context.Background(), second.app, clients[0], csrf[0], content).bookID(t)
	if err := first.store.ProcessOriginalDeletions(context.Background(), func(context.Context, string) error {
		t.Error("a stale deletion removed the re-uploaded original")
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	second.app.requestRaw(t, clients[0], http.MethodGet, "/v1/books/"+reloaded+"/file", "", nil, http.StatusOK)
	hash := fmt.Sprintf("%x", sha256.Sum256(content))
	data, err := os.ReadFile(h.source.directory.BookPath(hash, "pdf"))
	if err != nil || !bytes.Equal(data, content) {
		t.Fatalf("re-uploaded original bytes: %q %v", data, err)
	}
}

func TestMultipleBackendsHaveIndependentWorkspaceBudgetsAndFetches(t *testing.T) {
	h := newMultipleBackends(t)
	first, second := h.nodes[0], h.nodes[1]
	owner := first.app.client(t)
	csrf := first.app.csrf(t, owner)
	first.app.register(t, owner, csrf, "reader", "password", http.StatusCreated)
	first.app.login(t, owner, csrf, "reader", "password", http.StatusOK)
	id := first.app.uploadBook(t, owner, csrf, "a.pdf", []byte("%PDF-original"))
	for i, node := range h.nodes {
		node.cfg.CacheDir, node.cfg.CacheMaxBytes = "", 0
		node.cfg.WorkMaxBytes = int64(13 + i*13)
		node.restart(t)
	}
	started := [2]chan struct{}{make(chan struct{}), make(chan struct{})}
	proceed := [2]chan struct{}{make(chan struct{}), make(chan struct{})}
	var once [2]sync.Once
	release := func(i int) { once[i].Do(func() { close(proceed[i]) }) }
	t.Cleanup(func() { release(0); release(1) })
	h.source.open = func(ctx context.Context, instance int, location string) (io.ReadCloser, error) {
		close(started[instance])
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-proceed[instance]:
			return h.source.directory.Open(ctx, location)
		}
	}
	responses := [2]chan multipleReply{make(chan multipleReply, 1), make(chan multipleReply, 1)}
	for i, node := range h.nodes {
		go func() {
			responses[i] <- multipleGet(node.app, owner, "/v1/books/"+id+"/file")
		}()
	}
	for i := range started {
		awaitMultipleEvent(t, started[i], "each backend must start its own original receive")
	}
	// A's full reservation does not consume B's separately configured budget.
	if reply := multipleUpload(context.Background(), first.app, owner, csrf, []byte("%PDF-second!!")); reply.err != nil || reply.status != http.StatusServiceUnavailable {
		t.Fatalf("full workspace should reject only the new A upload: %+v", reply)
	}
	b := multipleUpload(context.Background(), second.app, owner, csrf, []byte("%PDF-second!!")).bookID(t)
	assertInstanceBytes(t, first.cfg.WorkDir, 13)
	assertInstanceBytes(t, second.cfg.WorkDir, 26)
	release(1)
	if reply := awaitMultipleReply(t, responses[1]); reply.err != nil || reply.status != http.StatusOK || string(reply.body) != "%PDF-original" {
		t.Fatalf("B response: %+v", reply)
	}
	// A is still receiving, but B has released its reservation and can fetch again.
	h.source.mu.Lock()
	h.source.open = nil
	h.source.mu.Unlock()
	second.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+b+"/file", "", nil, http.StatusOK)
	release(0)
	if reply := awaitMultipleReply(t, responses[0]); reply.err != nil || reply.status != http.StatusOK || string(reply.body) != "%PDF-original" {
		t.Fatalf("A response: %+v", reply)
	}
	for _, node := range h.nodes {
		assertInstanceBytes(t, node.cfg.WorkDir, 0)
	}
}

func TestMultipleBackendsRetryAdministrativeDeletionAfterRestart(t *testing.T) {
	h := newMultipleBackends(t)
	first, second := h.nodes[0], h.nodes[1]
	owner := first.app.client(t)
	csrf := first.app.csrf(t, owner)
	first.app.register(t, owner, csrf, "reader", "password", http.StatusCreated)
	first.app.login(t, owner, csrf, "reader", "password", http.StatusOK)
	content := []byte("%PDF-original")
	id := first.app.uploadBook(t, owner, csrf, "a.pdf", content)
	second.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+id+"/file", "", nil, http.StatusOK)
	// This is the same storage operation used by the admin CLI, through its own connection.
	admin, err := sqlstore.Open(context.Background(), first.cfg.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	user, err := admin.GetUserByLogin(context.Background(), "reader")
	if err != nil {
		admin.Close()
		t.Fatal(err)
	}
	if _, err := admin.DeleteUser(context.Background(), user.ID); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	admin.Close()
	offline := errors.New("original service unavailable")
	if err := first.store.ProcessOriginalDeletions(context.Background(), func(context.Context, string) error { return offline }); !errors.Is(err, offline) {
		t.Fatalf("failed deletion was not retained: %v", err)
	}
	for _, node := range h.nodes {
		node.restart(t)
		node.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+id+"/file", "", nil, http.StatusUnauthorized)
	}
	if err := second.store.ProcessOriginalDeletions(context.Background(), h.source.directory.Delete); err != nil {
		t.Fatal(err)
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(content))
	if _, err := os.Stat(h.source.directory.BookPath(hash, "pdf")); !os.IsNotExist(err) {
		t.Fatalf("administrative deletion did not survive backend restarts: %v", err)
	}
	if err := first.store.ProcessOriginalDeletions(context.Background(), func(context.Context, string) error {
		t.Error("completed queue task ran on another backend")
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func multipleGet(app testApp, client *http.Client, path string) multipleReply {
	response, err := client.Get(app.server.URL + "/api" + path)
	if err != nil {
		return multipleReply{err: err}
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	return multipleReply{status: response.StatusCode, body: data, err: err}
}

type multipleReply struct {
	status int
	body   []byte
	err    error
}

func (r multipleReply) bookID(t *testing.T) string {
	t.Helper()
	if r.err != nil || r.status != http.StatusCreated {
		t.Fatalf("upload: status=%d body=%s err=%v", r.status, r.body, r.err)
	}
	var book struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(r.body, &book); err != nil || book.ID == "" {
		t.Fatalf("created book: %s %v", r.body, err)
	}
	return book.ID
}

func multipleUpload(ctx context.Context, app testApp, client *http.Client, csrf string, content []byte) multipleReply {
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("file", "book.pdf")
	if err != nil {
		return multipleReply{err: err}
	}
	_, _ = part.Write(content)
	_ = form.Close()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, app.server.URL+"/api/v1/books", &body)
	if err != nil {
		return multipleReply{err: err}
	}
	req.Header.Set("Content-Type", form.FormDataContentType())
	req.Header.Set("X-CSRF-Token", csrf)
	response, err := client.Do(req)
	if err != nil {
		return multipleReply{err: err}
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	return multipleReply{status: response.StatusCode, body: data, err: err}
}

func awaitMultipleReply(t *testing.T, reply <-chan multipleReply) multipleReply {
	t.Helper()
	select {
	case result := <-reply:
		return result
	case <-time.After(10 * time.Second):
		t.Fatal("HTTP operation did not finish")
		return multipleReply{}
	}
}

func awaitMultipleEvent(t *testing.T, event <-chan struct{}, message string) {
	t.Helper()
	select {
	case <-event:
	case <-time.After(10 * time.Second):
		t.Fatal(message)
	}
}

func TestMultipleBackendsKeepIndependentCachesAndOwnership(t *testing.T) {
	h := newMultipleBackends(t)
	first, second := h.nodes[0], h.nodes[1]
	owner, csrf := first.app.client(t), ""
	csrf = first.app.csrf(t, owner)
	first.app.register(t, owner, csrf, "reader", "password", http.StatusCreated)
	first.app.login(t, owner, csrf, "reader", "password", http.StatusOK)
	other, otherCSRF := second.login(t, "reader")
	a := first.app.uploadBook(t, owner, csrf, "a.pdf", []byte("%PDF-original"))
	first.app.uploadCover(t, owner, csrf, a, "cover.png", testPNG(t, 16, 20), http.StatusNoContent)
	cover := second.app.requestRaw(t, other, http.MethodGet, "/v1/books/"+a+"/cover", "", nil, http.StatusOK)
	if len(cover.body) == 0 {
		t.Fatal("shared local image was unavailable through the second backend")
	}
	second.app.requestRaw(t, other, http.MethodGet, "/v1/books/"+a+"/file", "", nil, http.StatusOK)
	b := first.app.uploadBook(t, owner, csrf, "b.pdf", []byte("%PDF-second!!"))
	second.app.requestRaw(t, other, http.MethodGet, "/v1/books/"+b+"/file?download=1", "", nil, http.StatusOK)
	assertInstanceBytes(t, first.cfg.CacheDir, 26)
	assertInstanceBytes(t, second.cfg.CacheDir, 13)
	h.source.setOffline(true)
	first.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+a+"/file", "", nil, http.StatusOK)
	second.app.requestRaw(t, other, http.MethodGet, "/v1/books/"+a+"/file", "", nil, http.StatusServiceUnavailable)
	h.source.mu.Lock()
	beforeRestart := h.source.opens
	h.source.mu.Unlock()
	// Restarting one backend recovers only its own completed cache, without the source.
	first.restart(t)
	first.app.requestRaw(t, owner, http.MethodGet, "/readyz", "", nil, http.StatusOK)
	for _, id := range []string{a, b} {
		first.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+id+"/file", "", nil, http.StatusOK)
	}
	h.source.mu.Lock()
	afterRestart := h.source.opens
	h.source.mu.Unlock()
	if afterRestart != beforeRestart {
		t.Fatalf("restart, readiness or cache hits accessed originals: before=%v after=%v", beforeRestart, afterRestart)
	}
	// An unusable cache on B falls back to originals and cannot damage A's cache.
	h.source.setOffline(false)
	second.app.server.Close()
	second.store.Close()
	second.app.server = nil
	second.store = nil
	second.cfg.CacheDir = filepath.Join(t.TempDir(), "unusable-cache")
	if err := os.WriteFile(second.cfg.CacheDir, []byte("not a directory"), 0600); err != nil {
		t.Fatal(err)
	}
	second.restart(t)
	second.app.requestRaw(t, other, http.MethodGet, "/v1/books/"+a+"/file", "", nil, http.StatusOK)
	h.source.setOffline(true)
	first.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+a+"/file", "", nil, http.StatusOK)
	stranger := second.app.client(t)
	strangerCSRF := second.app.csrf(t, stranger)
	second.app.register(t, stranger, strangerCSRF, "stranger", "password", http.StatusCreated)
	second.app.login(t, stranger, strangerCSRF, "stranger", "password", http.StatusOK)
	first.app.requestRaw(t, stranger, http.MethodGet, "/v1/books/"+a+"/file", "", nil, http.StatusNotFound)
	second.app.requestRaw(t, other, http.MethodDelete, "/v1/books/"+a, otherCSRF, nil, http.StatusNoContent)
	first.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+a+"/file", "", nil, http.StatusNotFound)
	first.app.requestRaw(t, owner, http.MethodGet, "/v1/books/"+b+"/file", "", nil, http.StatusOK)
}

type multipleBackends struct {
	nodes  [2]*postgresBackend
	source *multipleOriginals
}

type postgresBackend struct {
	app    testApp
	cfg    config.Config
	store  storage.Store
	source *multipleOriginals
	index  int
}

func newMultipleBackends(t *testing.T) *multipleBackends {
	t.Helper()
	raw := os.Getenv("BOOK_HUB_TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("set BOOK_HUB_TEST_DATABASE_URL to run multiple HTTP backends on PostgreSQL")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	schema := "multiple_backends_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.Exec(ctx, "create schema "+schema); err != nil {
		admin.Close(ctx)
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), "drop schema if exists "+schema+" cascade")
		admin.Close(context.Background())
	})
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	if err := database.Migrate(ctx, u.String(), "up"); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	h := &multipleBackends{source: &multipleOriginals{directory: files.NewDirectory(filepath.Join(root, "originals"))}}
	for i := range h.nodes {
		local := filepath.Join(root, fmt.Sprintf("backend-%d", i))
		nodeURL := *u
		nodeQuery := nodeURL.Query()
		nodeQuery.Set("application_name", fmt.Sprintf("%s_%d", schema, i))
		nodeURL.RawQuery = nodeQuery.Encode()
		node := &postgresBackend{index: i, source: h.source, cfg: config.Config{
			DatabaseURL: nodeURL.String(), StorageDir: local, BooksDir: filepath.Join(root, "originals"), ImagesDir: filepath.Join(root, "images"),
			WorkDir: filepath.Join(local, "work"), CacheDir: filepath.Join(local, "cache"), CacheMaxBytes: int64(26 - i*13), WorkMaxBytes: int64(1024 + i*1024),
			BasePath: "/", DefaultQuotaBytes: 1 << 20, RegistrationEnabled: true, RegistrationAutoActivate: true,
			SessionSecret: "01234567890123456789012345678901", SessionTTL: time.Hour, MaxUploadBytes: 1 << 20, MaxCoverUploadBytes: 1 << 20,
		}}
		h.nodes[i] = node
		node.restart(t)
		t.Cleanup(func() {
			if node.app.server != nil {
				node.app.server.Close()
			}
			if node.store != nil {
				node.store.Close()
			}
		})
	}
	return h
}

// Observe PostgreSQL's external lock state, rather than guessing how long a
// request needs to reach the database or inspecting the implementation's SQL.
func awaitPostgresLockWait(t *testing.T, rawURL string) {
	t.Helper()
	u, err := url.Parse(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	application := query.Get("application_name")
	query.Set("application_name", application+"_observer")
	u.RawQuery = query.Encode()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	observer, err := pgx.Connect(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	defer observer.Close(context.Background())
	for {
		var waiting bool
		if err := observer.QueryRow(ctx, `select exists (
			select 1 from pg_stat_activity where application_name = $1 and wait_event_type = 'Lock'
		)`, application).Scan(&waiting); err != nil {
			t.Fatalf("contending backend did not reach a database lock: %v", err)
		}
		if waiting {
			return
		}
	}
}

func (n *postgresBackend) restart(t *testing.T) {
	t.Helper()
	if n.app.server != nil {
		n.app.server.Close()
		n.store.Close()
	}
	store, err := sqlstore.Open(context.Background(), n.cfg.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	n.store = store
	fileStore, err := files.NewConfigured(n.cfg)
	if err != nil {
		t.Fatal(err)
	}
	fileStore.Books = &multipleOriginalClient{shared: n.source, index: n.index}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	fileStore.SetLogger(logger)
	if err := fileStore.Ensure(); err != nil {
		t.Fatal(err)
	}
	n.app = testApp{server: httptest.NewServer(httpapi.New(n.cfg, store, fileStore, logger)), storageRoot: n.cfg.StorageDir}
}

func (n *postgresBackend) login(t *testing.T, login string) (*http.Client, string) {
	t.Helper()
	client := n.app.client(t)
	csrf := n.app.csrf(t, client)
	n.app.login(t, client, csrf, login, "password", http.StatusOK)
	return client, csrf
}

// This boundary is one shared original service; its clients belong to separate backends.
type multipleOriginals struct {
	mu        sync.Mutex
	directory files.Directory
	offline   bool
	opens     [2]int
	puts      int
	open      func(context.Context, int, string) (io.ReadCloser, error)
	put       func(context.Context, string, string, string) (string, error)
}

func (s *multipleOriginals) setOffline(value bool) { s.mu.Lock(); s.offline = value; s.mu.Unlock() }

type multipleOriginalClient struct {
	shared *multipleOriginals
	index  int
}

func (s *multipleOriginalClient) BookPath(hash, format string) string {
	return s.shared.directory.BookPath(hash, format)
}

func (s *multipleOriginalClient) Open(ctx context.Context, location string) (io.ReadCloser, error) {
	s.shared.mu.Lock()
	s.shared.opens[s.index]++
	offline, open := s.shared.offline, s.shared.open
	s.shared.mu.Unlock()
	if offline {
		return nil, errors.New("original service offline")
	}
	if open != nil {
		return open(ctx, s.index, location)
	}
	return s.shared.directory.Open(ctx, location)
}

func (s *multipleOriginalClient) MoveBook(ctx context.Context, input, hash, format string) (string, error) {
	s.shared.mu.Lock()
	s.shared.puts++
	put := s.shared.put
	s.shared.mu.Unlock()
	if put != nil {
		return put(ctx, input, hash, format)
	}
	return s.shared.directory.MoveBook(ctx, input, hash, format)
}

func (s *multipleOriginalClient) Delete(ctx context.Context, location string) error {
	return s.shared.directory.Delete(ctx, location)
}

func assertInstanceBytes(t *testing.T, root string, maximum int64) {
	t.Helper()
	var size int64
	if err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() {
			info, err := entry.Info()
			if err != nil {
				return err
			}
			size += info.Size()
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if size > maximum {
		t.Fatalf("instance files use %d bytes, budget is %d", size, maximum)
	}
}
