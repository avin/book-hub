package httpapi_test

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"book-hub/internal/config"
	"book-hub/internal/httpapi"
	"book-hub/internal/storage/files"
	"book-hub/internal/storage/memory"
)

func TestAuthFlowRequiresActivationAndSupportsPasswordChange(t *testing.T) {
	app := newTestApp(t, false)
	client := app.client(t)
	csrf := app.csrf(t, client)

	app.register(t, client, csrf, "reader", "old-password", http.StatusCreated)
	app.login(t, client, csrf, "reader", "old-password", http.StatusForbidden)

	activeApp := newTestApp(t, true)
	firstClient := activeApp.client(t)
	firstCSRF := activeApp.csrf(t, firstClient)
	activeApp.register(t, firstClient, firstCSRF, "reader", "old-password", http.StatusCreated)
	activeApp.login(t, firstClient, firstCSRF, "reader", "old-password", http.StatusOK)

	secondClient := activeApp.client(t)
	secondCSRF := activeApp.csrf(t, secondClient)
	activeApp.login(t, secondClient, secondCSRF, "reader", "old-password", http.StatusOK)

	reqBody := map[string]string{"current_password": "old-password", "new_password": "new-password"}
	activeApp.requestJSON(t, secondClient, http.MethodPut, "/v1/me/password", secondCSRF, reqBody, http.StatusNoContent)
	activeApp.requestJSON(t, firstClient, http.MethodGet, "/v1/me", "", nil, http.StatusUnauthorized)
	activeApp.requestJSON(t, secondClient, http.MethodGet, "/v1/me", "", nil, http.StatusOK)

	thirdClient := activeApp.client(t)
	thirdCSRF := activeApp.csrf(t, thirdClient)
	activeApp.login(t, thirdClient, thirdCSRF, "reader", "old-password", http.StatusUnauthorized)
	activeApp.login(t, thirdClient, thirdCSRF, "reader", "new-password", http.StatusOK)
}

func TestUploadDeleteLifecycleDeduplicatesPhysicalFiles(t *testing.T) {
	app := newTestApp(t, true)
	firstClient := app.client(t)
	firstCSRF := app.csrf(t, firstClient)
	app.register(t, firstClient, firstCSRF, "first", "password", http.StatusCreated)
	app.login(t, firstClient, firstCSRF, "first", "password", http.StatusOK)

	secondClient := app.client(t)
	secondCSRF := app.csrf(t, secondClient)
	app.register(t, secondClient, secondCSRF, "second", "password", http.StatusCreated)
	app.login(t, secondClient, secondCSRF, "second", "password", http.StatusOK)

	firstBookID := app.uploadBook(t, firstClient, firstCSRF, "book.pdf", []byte("%PDF same"))
	secondBookID := app.uploadBook(t, secondClient, secondCSRF, "book.pdf", []byte("%PDF same"))
	if countStoredFiles(t, app.storageRoot) != 1 {
		t.Fatalf("expected one physical book file after duplicate upload")
	}

	app.requestJSON(t, firstClient, http.MethodDelete, "/v1/books/"+firstBookID, firstCSRF, nil, http.StatusNoContent)
	if countStoredFiles(t, app.storageRoot) != 1 {
		t.Fatalf("expected physical file to remain while second user references it")
	}

	app.requestJSON(t, secondClient, http.MethodDelete, "/v1/books/"+secondBookID, secondCSRF, nil, http.StatusNoContent)
	if countStoredFiles(t, app.storageRoot) != 0 {
		t.Fatalf("expected physical file to be deleted when no users reference it")
	}
}

func TestSettingsAndProgressFlow(t *testing.T) {
	app := newTestApp(t, true)
	client := app.client(t)
	csrf := app.csrf(t, client)
	app.register(t, client, csrf, "reader", "password", http.StatusCreated)
	app.login(t, client, csrf, "reader", "password", http.StatusOK)
	bookID := app.uploadBook(t, client, csrf, "book.fb2", []byte("<FictionBook/>"))

	app.requestJSON(t, client, http.MethodPut, "/v1/me/settings", csrf, map[string]any{"theme": "dark"}, http.StatusOK)
	settings := app.requestJSON(t, client, http.MethodGet, "/v1/me/settings", "", nil, http.StatusOK)
	if settings["theme"] != "dark" {
		t.Fatalf("unexpected settings: %#v", settings)
	}

	app.requestJSON(t, client, http.MethodPut, "/v1/books/"+bookID+"/progress", csrf, map[string]any{"progress_percent": 42.5}, http.StatusOK)
	progress := app.requestJSON(t, client, http.MethodGet, "/v1/books/"+bookID+"/progress", "", nil, http.StatusOK)
	if progress["progress_percent"] != 42.5 {
		t.Fatalf("unexpected progress: %#v", progress)
	}
	app.requestJSON(t, client, http.MethodDelete, "/v1/books/"+bookID+"/progress", csrf, nil, http.StatusNoContent)
	progress = app.requestJSON(t, client, http.MethodGet, "/v1/books/"+bookID+"/progress", "", nil, http.StatusOK)
	if progress["progress_percent"] != float64(0) || progress["updated_at"] != nil {
		t.Fatalf("unexpected reset progress: %#v", progress)
	}
}

type testApp struct {
	server      *httptest.Server
	storageRoot string
}

func newTestApp(t *testing.T, autoActivate bool) testApp {
	t.Helper()
	root := t.TempDir()
	cfg := config.Config{
		BasePath:                 "/",
		DefaultQuotaBytes:        1024 * 1024,
		RegistrationEnabled:      true,
		RegistrationAutoActivate: autoActivate,
		SessionSecret:            "01234567890123456789012345678901",
		SessionTTL:               time.Hour,
		MaxUploadBytes:           1024 * 1024,
		MaxCoverUploadBytes:      1024,
	}
	fileStore := files.New(root)
	handler := httpapi.New(cfg, memory.New(), fileStore, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return testApp{server: server, storageRoot: root}
}

func (a testApp) client(t *testing.T) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return &http.Client{Jar: jar}
}

func (a testApp) csrf(t *testing.T, client *http.Client) string {
	t.Helper()
	res, err := client.Get(a.server.URL + "/api/v1/auth/csrf")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("csrf status %d", res.StatusCode)
	}
	var body map[string]string
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return body["csrf_token"]
}

func (a testApp) register(t *testing.T, client *http.Client, csrf, login, password string, status int) {
	t.Helper()
	a.requestJSON(t, client, http.MethodPost, "/v1/auth/register", csrf, map[string]string{"login": login, "password": password}, status)
}

func (a testApp) login(t *testing.T, client *http.Client, csrf, login, password string, status int) {
	t.Helper()
	a.requestJSON(t, client, http.MethodPost, "/v1/auth/login", csrf, map[string]string{"login": login, "password": password}, status)
}

func (a testApp) requestJSON(t *testing.T, client *http.Client, method, path, csrf string, body any, status int) map[string]any {
	t.Helper()
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequest(method, a.server.URL+"/api"+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if csrf != "" {
		req.Header.Set("X-CSRF-Token", csrf)
	}
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != status {
		data, _ := io.ReadAll(res.Body)
		t.Fatalf("%s %s: expected status %d, got %d: %s", method, path, status, res.StatusCode, data)
	}
	if status == http.StatusNoContent {
		return nil
	}
	var decoded map[string]any
	if err := json.NewDecoder(res.Body).Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

func (a testApp) uploadBook(t *testing.T, client *http.Client, csrf, filename string, content []byte) string {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("title", "Uploaded"); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, a.server.URL+"/api/v1/books", &body)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("X-CSRF-Token", csrf)
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		data, _ := io.ReadAll(res.Body)
		t.Fatalf("upload status %d: %s", res.StatusCode, data)
	}
	var decoded map[string]any
	if err := json.NewDecoder(res.Body).Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	id, ok := decoded["id"].(string)
	if !ok || id == "" {
		t.Fatalf("missing book id: %#v", decoded)
	}
	return id
}

func countStoredFiles(t *testing.T, root string) int {
	t.Helper()
	count := 0
	booksRoot := filepath.Join(root, "books")
	if err := filepath.WalkDir(booksRoot, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() {
			count++
		}
		return nil
	}); err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	return count
}
