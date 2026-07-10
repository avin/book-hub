package httpapi_test

import (
	"net/http"
	"strings"
	"testing"
)

func TestDownloadBookUsesUTF8ContentDispositionForCyrillicTitle(t *testing.T) {
	app := newTestApp(t, true)
	client := app.client(t)
	csrf := app.csrf(t, client)
	app.register(t, client, csrf, "reader", "password", http.StatusCreated)
	app.login(t, client, csrf, "reader", "password", http.StatusOK)

	bookID := app.uploadBookWithTitle(
		t,
		client,
		csrf,
		"book.pdf",
		[]byte("%PDF-1.4"),
		"Мейерс С. - Эффективный и современный C++. 42 рекомендации по использованию C++11 и C++14 - 2016",
	)

	response := app.requestRaw(t, client, http.MethodGet, "/v1/books/"+bookID+"/file?download=1", "", nil, http.StatusOK)
	disposition := response.header.Get("Content-Disposition")

	if !strings.Contains(disposition, "filename*=") {
		t.Fatalf("expected RFC 5987 filename* in Content-Disposition, got %q", disposition)
	}
	if !strings.Contains(disposition, "%D0%9C%D0%B5%D0%B9%D0%B5%D1%80%D1%81") {
		t.Fatalf("expected UTF-8 encoded Cyrillic in Content-Disposition, got %q", disposition)
	}
}
