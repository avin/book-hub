package httpapi_test

import (
	"net/http"
	"testing"
)

func TestBookSearchField(t *testing.T) {
	app := newTestApp(t, true)
	client := app.client(t)
	csrf := app.csrf(t, client)
	app.register(t, client, csrf, "search_fields", "password", http.StatusCreated)
	app.login(t, client, csrf, "search_fields", "password", http.StatusOK)
	book := app.uploadBookDescription(t, client, csrf, "Кириллица Reader 100% Under_score \\ ЁЖ", http.StatusCreated)
	for _, tc := range []struct {
		name   string
		query  map[string]any
		status int
		count  int
	}{
		{"default title", map[string]any{"q": "title"}, http.StatusOK, 1},
		{"description excluded by default", map[string]any{"q": "кириллица"}, http.StatusOK, 0},
		{"description search", map[string]any{"q": " КИРИЛЛИЦА ", "search_field": "description"}, http.StatusOK, 1},
		{"title excluded from description", map[string]any{"q": "title", "search_field": "description"}, http.StatusOK, 0},
		{"explicit title", map[string]any{"q": "title", "search_field": "title"}, http.StatusOK, 1},
		{"literal percent", map[string]any{"q": "100%", "search_field": "description"}, http.StatusOK, 1},
		{"literal underscore", map[string]any{"q": "under_score", "search_field": "description"}, http.StatusOK, 1},
		{"literal backslash", map[string]any{"q": "\\", "search_field": "description"}, http.StatusOK, 1},
		{"distinct Cyrillic letters", map[string]any{"q": "еж", "search_field": "description"}, http.StatusOK, 0},
		{"invalid field", map[string]any{"search_field": "file"}, http.StatusBadRequest, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := app.requestJSON(t, client, http.MethodPost, "/v1/books/query", csrf, tc.query, tc.status)
			if tc.status != http.StatusOK {
				return
			}
			items := result["items"].([]any)
			if len(items) != tc.count || result["total"] != float64(tc.count) {
				t.Fatalf("unexpected search results: %#v", result)
			}
			if tc.count == 1 && items[0].(map[string]any)["id"] != book["id"] {
				t.Fatalf("unexpected book: %#v", items)
			}
		})
	}
}
