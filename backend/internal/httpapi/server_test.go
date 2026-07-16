package httpapi_test

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"book-hub/internal/config"
	"book-hub/internal/httpapi"
	"book-hub/internal/storage/files"
	"book-hub/internal/storage/memory"
)

func TestCSRFContractPreservesBasePathCookieAndErrorResponse(t *testing.T) {
	app := newTestAppAtBasePath(t, true, "/book-hub")
	client := app.client(t)

	response, err := client.Get(app.server.URL + "/book-hub/api/v1/auth/csrf")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected csrf status %d, got %d", http.StatusOK, response.StatusCode)
	}
	if response.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("expected JSON content type, got %q", response.Header.Get("Content-Type"))
	}
	requestID := response.Header.Get("X-Request-Id")
	if requestID == "" {
		t.Fatal("expected request id header")
	}
	var csrfBody map[string]string
	if err := json.NewDecoder(response.Body).Decode(&csrfBody); err != nil {
		t.Fatal(err)
	}
	csrfToken := csrfBody["csrf_token"]
	if csrfToken == "" {
		t.Fatalf("expected csrf token body, got %#v", csrfBody)
	}
	setCookie := response.Header.Get("Set-Cookie")
	if !strings.Contains(setCookie, "book_hub_csrf="+csrfToken) ||
		!strings.Contains(setCookie, "Path=/book-hub") ||
		!strings.Contains(setCookie, "SameSite=Lax") {
		t.Fatalf("unexpected csrf cookie: %q", setCookie)
	}

	request, err := http.NewRequest(
		http.MethodPost,
		app.server.URL+"/book-hub/api/v1/auth/register",
		strings.NewReader(`{"login":"reader","password":"password"}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err = client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("expected missing csrf status %d, got %d", http.StatusForbidden, response.StatusCode)
	}
	var errorBody map[string]string
	if err := json.NewDecoder(response.Body).Decode(&errorBody); err != nil {
		t.Fatal(err)
	}
	if errorBody["code"] != "csrf_invalid" || errorBody["message"] != "invalid csrf token" {
		t.Fatalf("unexpected csrf error: %#v", errorBody)
	}
	if errorBody["request_id"] == "" || errorBody["request_id"] != response.Header.Get("X-Request-Id") {
		t.Fatalf("expected matching request ids, body=%#v header=%q", errorBody, response.Header.Get("X-Request-Id"))
	}

	response, err = client.Get(app.server.URL + "/api/v1/auth/csrf")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("expected unprefixed path status %d, got %d", http.StatusNotFound, response.StatusCode)
	}
}

func TestBasePathAndRequestIDContract(t *testing.T) {
	app := newTestAppAtBasePath(t, true, "/book-hub")
	client := app.client(t)

	for _, test := range []struct {
		name          string
		path          string
		status        int
		wantRequestID bool
	}{
		{name: "prefixed API path", path: "/book-hub/api/v1/auth/csrf", status: http.StatusOK, wantRequestID: true},
		{name: "unprefixed API path", path: "/api/v1/auth/csrf", status: http.StatusNotFound, wantRequestID: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			response, err := client.Get(app.server.URL + test.path)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()

			if response.StatusCode != test.status {
				t.Fatalf("expected status %d, got %d", test.status, response.StatusCode)
			}
			if got := response.Header.Get("X-Request-Id"); (got != "") != test.wantRequestID {
				t.Fatalf("unexpected request ID header %q", got)
			}
		})
	}
}

func TestErrorContractForCSRFJSONAndMultipart(t *testing.T) {
	app := newTestApp(t, true)
	client := app.client(t)
	csrf := app.csrf(t, client)
	app.register(t, client, csrf, "reader", "password", http.StatusCreated)
	app.login(t, client, csrf, "reader", "password", http.StatusOK)

	for _, test := range []struct {
		name         string
		newRequest   func(t *testing.T) *http.Request
		status       int
		errorCode    string
		errorMessage string
	}{
		{
			name: "missing CSRF token",
			newRequest: func(t *testing.T) *http.Request {
				t.Helper()
				req, err := http.NewRequest(http.MethodPost, app.server.URL+"/api/v1/auth/register", strings.NewReader(`{"login":"other","password":"password"}`))
				if err != nil {
					t.Fatal(err)
				}
				req.Header.Set("Content-Type", "application/json")
				return req
			},
			status: http.StatusForbidden, errorCode: "csrf_invalid", errorMessage: "invalid csrf token",
		},
		{
			name: "invalid JSON body",
			newRequest: func(t *testing.T) *http.Request {
				t.Helper()
				req, err := http.NewRequest(http.MethodPost, app.server.URL+"/api/v1/auth/register", strings.NewReader(`{"login":`))
				if err != nil {
					t.Fatal(err)
				}
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("X-CSRF-Token", csrf)
				return req
			},
			status: http.StatusBadRequest, errorCode: "validation_error", errorMessage: "invalid request",
		},
		{
			name: "multipart body without book file",
			newRequest: func(t *testing.T) *http.Request {
				t.Helper()
				var body bytes.Buffer
				writer := multipart.NewWriter(&body)
				if err := writer.WriteField("title", "Missing file"); err != nil {
					t.Fatal(err)
				}
				if err := writer.Close(); err != nil {
					t.Fatal(err)
				}
				req, err := http.NewRequest(http.MethodPost, app.server.URL+"/api/v1/books", &body)
				if err != nil {
					t.Fatal(err)
				}
				req.Header.Set("Content-Type", writer.FormDataContentType())
				req.Header.Set("X-CSRF-Token", csrf)
				return req
			},
			status: http.StatusBadRequest, errorCode: "validation_error", errorMessage: "invalid request",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			response, err := client.Do(test.newRequest(t))
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()

			if response.StatusCode != test.status {
				t.Fatalf("expected status %d, got %d", test.status, response.StatusCode)
			}
			var body map[string]string
			if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["code"] != test.errorCode || body["message"] != test.errorMessage {
				t.Fatalf("unexpected error response: %#v", body)
			}
			if requestID := response.Header.Get("X-Request-Id"); requestID == "" || body["request_id"] != requestID {
				t.Fatalf("expected matching request IDs, body=%#v header=%q", body, requestID)
			}
		})
	}
}

func TestAuthFlowRequiresActivationAndSupportsPasswordChange(t *testing.T) {
	app := newTestApp(t, false)
	client := app.client(t)
	csrf := app.csrf(t, client)

	app.register(t, client, csrf, "reader", "old-password", http.StatusCreated)
	app.login(t, client, csrf, "reader", "wrong-password", http.StatusUnauthorized)
	inactive := app.requestJSON(t, client, http.MethodPost, "/v1/auth/login", csrf, map[string]string{"login": "reader", "password": "old-password"}, http.StatusForbidden)
	if inactive["code"] != "account_inactive" {
		t.Fatalf("expected account_inactive error, got %#v", inactive)
	}

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
	book := app.requestJSON(t, client, http.MethodGet, "/v1/books/"+bookID, "", nil, http.StatusOK)
	lastOpenedAt, ok := book["last_opened_at"].(string)
	if !ok || lastOpenedAt == "" {
		t.Fatalf("expected last_opened_at in book response: %#v", book)
	}
	progress := app.requestJSON(t, client, http.MethodGet, "/v1/books/"+bookID+"/progress", "", nil, http.StatusOK)
	if progress["progress_percent"] != 42.5 || progress["updated_at"] != nil {
		t.Fatalf("unexpected progress: %#v", progress)
	}
	app.requestJSON(t, client, http.MethodDelete, "/v1/books/"+bookID+"/progress", csrf, nil, http.StatusNoContent)
	progress = app.requestJSON(t, client, http.MethodGet, "/v1/books/"+bookID+"/progress", "", nil, http.StatusOK)
	if progress["progress_percent"] != float64(0) {
		t.Fatalf("unexpected reset progress: %#v", progress)
	}
	book = app.requestJSON(t, client, http.MethodGet, "/v1/books/"+bookID, "", nil, http.StatusOK)
	if book["last_opened_at"] != lastOpenedAt {
		t.Fatalf("reset changed last_opened_at: before=%s after=%v", lastOpenedAt, book["last_opened_at"])
	}
}

func TestBookTagsAreLowercaseScopedAndCleanedUp(t *testing.T) {
	app := newTestApp(t, true)
	firstClient := app.client(t)
	firstCSRF := app.csrf(t, firstClient)
	app.register(t, firstClient, firstCSRF, "first", "password", http.StatusCreated)
	app.login(t, firstClient, firstCSRF, "first", "password", http.StatusOK)

	secondClient := app.client(t)
	secondCSRF := app.csrf(t, secondClient)
	app.register(t, secondClient, secondCSRF, "second", "password", http.StatusCreated)
	app.login(t, secondClient, secondCSRF, "second", "password", http.StatusOK)

	bookID := app.uploadBookWithTags(t, firstClient, firstCSRF, "first.pdf", []byte("%PDF first"), []string{" Go ", "PDF"})
	app.uploadBookWithTags(t, secondClient, secondCSRF, "second.pdf", []byte("%PDF second"), []string{"private"})

	book := app.requestJSON(t, firstClient, http.MethodGet, "/v1/books/"+bookID, "", nil, http.StatusOK)
	assertStringItems(t, book["tags"], []string{"go", "pdf"})

	tags := app.requestJSON(t, firstClient, http.MethodGet, "/v1/books/tags", "", nil, http.StatusOK)
	assertStringItems(t, tags["items"], []string{"go", "pdf"})

	app.requestJSON(t, firstClient, http.MethodPatch, "/v1/books/"+bookID, firstCSRF, map[string]any{"tags": []string{"Go"}}, http.StatusOK)
	tags = app.requestJSON(t, firstClient, http.MethodGet, "/v1/books/tags", "", nil, http.StatusOK)
	assertStringItems(t, tags["items"], []string{"go"})

	app.requestJSON(t, firstClient, http.MethodDelete, "/v1/books/"+bookID, firstCSRF, nil, http.StatusNoContent)
	tags = app.requestJSON(t, firstClient, http.MethodGet, "/v1/books/tags", "", nil, http.StatusOK)
	assertStringItems(t, tags["items"], []string{})
}

func TestCoverUploadStoresFullAndThumbnailVariants(t *testing.T) {
	app := newTestApp(t, true)
	client := app.client(t)
	csrf := app.csrf(t, client)
	app.register(t, client, csrf, "reader", "password", http.StatusCreated)
	app.login(t, client, csrf, "reader", "password", http.StatusOK)
	bookID := app.uploadBook(t, client, csrf, "book.pdf", []byte("%PDF"))

	app.uploadCover(t, client, csrf, bookID, "cover.png", testPNG(t, 300, 400), http.StatusNoContent)

	full := app.requestRaw(t, client, http.MethodGet, "/v1/books/"+bookID+"/cover", "", nil, http.StatusOK)
	if full.header.Get("Content-Type") != "image/png" {
		t.Fatalf("expected full cover content type image/png, got %q", full.header.Get("Content-Type"))
	}

	thumbnail := app.requestRaw(t, client, http.MethodGet, "/v1/books/"+bookID+"/cover?variant=thumbnail", "", nil, http.StatusOK)
	if thumbnail.header.Get("Content-Type") != "image/jpeg" {
		t.Fatalf("expected thumbnail content type image/jpeg, got %q", thumbnail.header.Get("Content-Type"))
	}
	decoded, _, err := image.Decode(bytes.NewReader(thumbnail.body))
	if err != nil {
		t.Fatal(err)
	}
	if decoded.Bounds().Dx() > 184 || decoded.Bounds().Dy() > 240 {
		t.Fatalf("thumbnail is too large: %dx%d", decoded.Bounds().Dx(), decoded.Bounds().Dy())
	}

	app.requestRaw(t, client, http.MethodGet, "/v1/books/"+bookID+"/cover?variant=small", "", nil, http.StatusBadRequest)
	app.uploadCover(t, client, csrf, bookID, "bad.png", []byte("not an image"), http.StatusBadRequest)
}

type testApp struct {
	server      *httptest.Server
	storageRoot string
}

func newTestApp(t *testing.T, autoActivate bool) testApp {
	return newTestAppAtBasePath(t, autoActivate, "/")
}

func newTestAppAtBasePath(t *testing.T, autoActivate bool, basePath string) testApp {
	t.Helper()
	root := t.TempDir()
	cfg := config.Config{
		BasePath:                 basePath,
		DefaultQuotaBytes:        1024 * 1024,
		RegistrationEnabled:      true,
		RegistrationAutoActivate: autoActivate,
		SessionSecret:            "01234567890123456789012345678901",
		SessionTTL:               time.Hour,
		MaxUploadBytes:           1024 * 1024,
		MaxCoverUploadBytes:      1024 * 1024,
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

type rawResponse struct {
	header http.Header
	body   []byte
}

func (a testApp) requestRaw(t *testing.T, client *http.Client, method, path, csrf string, body io.Reader, status int) rawResponse {
	t.Helper()
	req, err := http.NewRequest(method, a.server.URL+"/api"+path, body)
	if err != nil {
		t.Fatal(err)
	}
	if csrf != "" {
		req.Header.Set("X-CSRF-Token", csrf)
	}
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != status {
		t.Fatalf("%s %s: expected status %d, got %d: %s", method, path, status, res.StatusCode, data)
	}
	return rawResponse{header: res.Header.Clone(), body: data}
}

func (a testApp) uploadBook(t *testing.T, client *http.Client, csrf, filename string, content []byte) string {
	return a.uploadBookWithTitle(t, client, csrf, filename, content, "Uploaded")
}

func (a testApp) uploadBookWithTitle(
	t *testing.T,
	client *http.Client,
	csrf, filename string,
	content []byte,
	title string,
) string {
	return a.uploadBookWithTagsAndTitle(t, client, csrf, filename, content, title, nil)
}

func (a testApp) uploadBookWithTags(t *testing.T, client *http.Client, csrf, filename string, content []byte, tags []string) string {
	return a.uploadBookWithTagsAndTitle(t, client, csrf, filename, content, "Uploaded", tags)
}

func (a testApp) uploadBookWithTagsAndTitle(
	t *testing.T,
	client *http.Client,
	csrf, filename string,
	content []byte,
	title string,
	tags []string,
) string {
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
	if err := writer.WriteField("title", title); err != nil {
		t.Fatal(err)
	}
	for _, tag := range tags {
		if err := writer.WriteField("tags", tag); err != nil {
			t.Fatal(err)
		}
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

func assertStringItems(t *testing.T, value any, want []string) {
	t.Helper()
	items, ok := value.([]any)
	if !ok {
		t.Fatalf("expected array, got %#v", value)
	}
	if len(items) != len(want) {
		t.Fatalf("expected %d items, got %d: %#v", len(want), len(items), items)
	}
	for index, item := range items {
		if item != want[index] {
			t.Fatalf("expected item %d to be %q, got %#v", index, want[index], item)
		}
	}
}

func (a testApp) uploadCover(t *testing.T, client *http.Client, csrf, bookID, filename string, content []byte, status int) {
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
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPut, a.server.URL+"/api/v1/books/"+bookID+"/cover", &body)
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
	if res.StatusCode != status {
		data, _ := io.ReadAll(res.Body)
		t.Fatalf("cover upload: expected status %d, got %d: %s", status, res.StatusCode, data)
	}
}

func testPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: 80, G: 120, B: 180, A: 255})
		}
	}
	var body bytes.Buffer
	if err := png.Encode(&body, img); err != nil {
		t.Fatal(err)
	}
	return body.Bytes()
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
