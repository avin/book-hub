package httpapi_test

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
)

func TestBookDescriptionUTF16Limit(t *testing.T) {
	for _, tc := range []struct {
		name        string
		description string
		status      int
	}{
		{"Cyrillic boundary", strings.Repeat("я", 10000), http.StatusCreated},
		{"three-byte boundary", strings.Repeat("書", 10000), http.StatusCreated},
		{"emoji boundary", strings.Repeat("🙂", 5000), http.StatusCreated},
		{"mixed boundary", strings.Repeat("a", 9998) + "🙂", http.StatusCreated},
		{"Cyrillic overflow", strings.Repeat("я", 10001), http.StatusBadRequest},
		{"emoji overflow", strings.Repeat("🙂", 5000) + "a", http.StatusBadRequest},
		{"raw spaces overflow", strings.Repeat(" ", 10001), http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(t, true)
			client := app.client(t)
			csrf := app.csrf(t, client)
			app.register(t, client, csrf, "description_limit", "password", http.StatusCreated)
			app.login(t, client, csrf, "description_limit", "password", http.StatusOK)
			app.uploadBookDescription(t, client, csrf, tc.description, tc.status)
			bookID := app.uploadBook(t, client, csrf, "patch.pdf", []byte("%PDF patch"))
			path := "/v1/books/" + bookID
			status := tc.status
			if status == http.StatusCreated {
				status = http.StatusOK
			}
			got := app.requestJSON(t, client, http.MethodPatch, path, csrf, map[string]string{"description": tc.description}, status)
			if status == http.StatusOK && got["description"] != tc.description {
				t.Fatalf("accepted description changed")
			}
			if status == http.StatusBadRequest {
				got = app.requestJSON(t, client, http.MethodGet, path, "", nil, http.StatusOK)
				if got["description"] != "" {
					t.Fatal("rejected update changed description")
				}
			}
		})
	}
}

func TestBookDescriptionRoundTrip(t *testing.T) {
	app := newTestApp(t, true)
	client := app.client(t)
	csrf := app.csrf(t, client)
	app.register(t, client, csrf, "descriptions", "password", http.StatusCreated)
	app.login(t, client, csrf, "descriptions", "password", http.StatusOK)
	book := app.uploadBookDescription(t, client, csrf, " \nПервая строка\n\n  Вторая <b>строка</b>  \n", http.StatusCreated)
	if got := book["description"]; got != "Первая строка\n\n  Вторая <b>строка</b>" {
		t.Fatalf("uploaded description: %#v", got)
	}
	path := "/v1/books/" + book["id"].(string)
	got := app.requestJSON(t, client, http.MethodGet, path, "", nil, http.StatusOK)
	if got["description"] != book["description"] {
		t.Fatalf("saved description: %#v", got["description"])
	}
	got = app.requestJSON(t, client, http.MethodPatch, path, csrf, map[string]string{"description": " \tНовое\nописание\ufeff "}, http.StatusOK)
	if got["description"] != "Новое\nописание" {
		t.Fatalf("updated description: %#v", got["description"])
	}
	got = app.requestJSON(t, client, http.MethodPatch, path, csrf, map[string]string{"title": "Новое название"}, http.StatusOK)
	if got["description"] != "Новое\nописание" {
		t.Fatalf("omitted description changed: %#v", got["description"])
	}
	got = app.requestJSON(t, client, http.MethodPatch, path, csrf, map[string]string{"description": " \n\t\ufeff"}, http.StatusOK)
	if got["description"] != "" {
		t.Fatalf("cleared description: %#v", got["description"])
	}
}

func (a testApp) uploadBookDescription(t *testing.T, client *http.Client, csrf, description string, status int) map[string]any {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "description.pdf")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("%PDF " + description)); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("title", "Title"); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("description", description); err != nil {
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
	if res.StatusCode != status {
		data, _ := io.ReadAll(res.Body)
		t.Fatalf("upload status %d, want %d: %s", res.StatusCode, status, data)
	}
	var decoded map[string]any
	if err := json.NewDecoder(res.Body).Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}
