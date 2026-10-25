package httpapi_test

import (
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func frontendFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	writeFrontendFile(t, dir, "index.html", "<!doctype html><title>Book Hub</title>")
	return dir
}

func writeFrontendFile(t *testing.T, dir, name, content string) {
	t.Helper()
	filename := filepath.Join(dir, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(filename), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filename, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestFrontendPagesAndAPIRouting(t *testing.T) {
	for _, base := range []string{"", "/hub"} {
		t.Run("base="+base, func(t *testing.T) {
			app := newTestAppWithFrontend(t, true, base+"/", frontendFixture(t))
			client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
			for _, route := range []string{"/", "/login", "/library?tag=books", "/settings", "/read/123", "/apiary"} {
				res, err := client.Get(app.server.URL + base + route)
				if err != nil {
					t.Fatal(err)
				}
				body, _ := io.ReadAll(res.Body)
				res.Body.Close()
				if res.StatusCode != 200 || string(body) != "<!doctype html><title>Book Hub</title>" {
					t.Fatalf("%s: status=%d body=%q", route, res.StatusCode, body)
				}
			}
			for _, route := range []string{"/api", "/api/", "/api/missing"} {
				res, err := client.Get(app.server.URL + base + route)
				if err != nil {
					t.Fatal(err)
				}
				res.Body.Close()
				status := http.StatusNotFound
				if route == "/api" {
					status = http.StatusTemporaryRedirect
				}
				if res.StatusCode != status || res.Header.Get("X-Request-Id") == "" {
					t.Fatalf("%s: API status=%d headers=%v", route, res.StatusCode, res.Header)
				}
			}
		})
	}
}

func TestFrontendPrefixAndMethods(t *testing.T) {
	app := newTestAppWithFrontend(t, true, "/hub", frontendFixture(t))
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	for _, tc := range []struct {
		method, path string
		status       int
	}{
		{"GET", "/hub?tag=one", 308},
		{"GET", "/", 404},
		{"GET", "/login", 404},
		{"GET", "/hub-other/login", 404},
		{"GET", "/api/healthz", 404},
		{"POST", "/hub/login", 405},
		{"POST", "/hub", 405},
		{"OPTIONS", "/hub/", 405},
		{"HEAD", "/hub/login", 200},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			req, _ := http.NewRequest(tc.method, app.server.URL+tc.path, nil)
			res, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			body, _ := io.ReadAll(res.Body)
			if res.StatusCode != tc.status {
				t.Fatalf("status=%d body=%q", res.StatusCode, body)
			}
			if tc.status == 308 && res.Header.Get("Location") != "/hub/?tag=one" {
				t.Fatalf("redirect=%q", res.Header.Get("Location"))
			}
			if tc.status == 405 && res.Header.Get("Allow") != "GET, HEAD" {
				t.Fatalf("Allow=%q", res.Header.Get("Allow"))
			}
			if tc.method == "HEAD" && len(body) != 0 {
				t.Fatalf("HEAD body=%q", body)
			}
		})
	}
}

func TestFrontendResourcesAndMissingFiles(t *testing.T) {
	dir := frontendFixture(t)
	resources := []struct{ path, body, mime string }{
		{"assets/app-C9x_2Ab0.js", "export const app = true;", "text/javascript"},
		{"assets/app-C9x_2Ab0.css", "body { margin: 0; }", "text/css"},
		{"pdfjs-assets/build/pdf.mjs", "export const pdf = true;", "text/javascript"},
		{"pdfjs-assets/build/pdf.worker.mjs", "const worker = true;", "text/javascript"},
		{"pdfjs-assets/wasm/openjpeg.wasm", "\x00asm\x01\x00\x00\x00", "application/wasm"},
		{"pdfjs-assets/cmaps/Adobe-Japan1-UCS2.bcmap", "\x00\x01\xff\x10", ""},
		{"pdfjs-assets/standard_fonts/FoxitSans.pfb", "\x80\x01font", ""},
		{"djvujs-assets/DjVu.js", "var DjVu = {};", "text/javascript"},
		{"robots", "public file without extension", ""},
	}
	for _, resource := range resources {
		writeFrontendFile(t, dir, resource.path, resource.body)
	}
	app := newTestAppWithFrontend(t, true, "/hub", dir)
	for _, resource := range resources {
		t.Run(resource.path, func(t *testing.T) {
			res, err := http.Get(app.server.URL + "/hub/" + resource.path)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			body, _ := io.ReadAll(res.Body)
			contentType, _, _ := mime.ParseMediaType(res.Header.Get("Content-Type"))
			if res.StatusCode != 200 || string(body) != resource.body || resource.mime != "" && contentType != resource.mime {
				t.Fatalf("status=%d mime=%q body=%q", res.StatusCode, contentType, body)
			}
		})
	}
	for _, path := range []string{"missing.js", "missing.mjs", "missing.wasm", "missing.css", "assets/missing", "assets", "pdfjs-assets/cmaps/missing", "djvujs-assets/missing"} {
		t.Run("missing/"+path, func(t *testing.T) {
			req, _ := http.NewRequest("GET", app.server.URL+"/hub/"+path, nil)
			req.Header.Set("Accept", "text/html")
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			if res.StatusCode != 404 || res.Header.Get("Cache-Control") != "no-store" {
				t.Fatalf("status=%d headers=%v", res.StatusCode, res.Header)
			}
		})
	}
}

func TestFrontendRejectsPrivateAndInvalidPaths(t *testing.T) {
	dir := frontendFixture(t)
	writeFrontendFile(t, dir, ".env", "secret")
	writeFrontendFile(t, dir, ".private/config", "secret")
	writeFrontendFile(t, dir, "public/file.txt", "public")
	app := newTestAppWithFrontend(t, true, "/hub", dir)
	for _, route := range []string{
		"/.env", "/.private/config", "/.missing", "/public/", "/public",
		"/../index.html", "/%2e%2e/index.html", "/public/../index.html",
		"/%2ehidden/route", "/public%5c..%5cindex.html", "/%2f../index.html", "/%00",
		"/C:/index.html", "/index.html:stream",
	} {
		t.Run(route, func(t *testing.T) {
			res, err := http.Get(app.server.URL + "/hub" + route)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			if res.StatusCode != 404 || res.Header.Get("Cache-Control") != "no-store" {
				t.Fatalf("status=%d headers=%v", res.StatusCode, res.Header)
			}
		})
	}
}

func TestFrontendSymlinksStayInsidePublicBuild(t *testing.T) {
	dir := frontendFixture(t)
	outside := t.TempDir()
	writeFrontendFile(t, outside, "secret", "private data")
	writeFrontendFile(t, dir, ".private/secret", "hidden data")
	writeFrontendFile(t, dir, "public.txt", "public data")
	for _, link := range []struct{ target, name string }{
		{outside, "external"}, {filepath.Join(outside, "secret"), "leak"},
		{".private", "hidden"}, {"public.txt", "alias.txt"},
	} {
		if err := os.Symlink(link.target, filepath.Join(dir, link.name)); err != nil {
			t.Skipf("symbolic links unavailable: %v", err)
		}
	}
	app := newTestAppWithFrontend(t, true, "/", dir)
	for _, route := range []string{"/external/secret", "/leak", "/external/missing", "/hidden/secret", "/hidden/missing"} {
		res, err := http.Get(app.server.URL + route)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 404 {
			t.Fatalf("%s: status=%d", route, res.StatusCode)
		}
	}
	res, err := http.Get(app.server.URL + "/alias.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != 200 || string(body) != "public data" {
		t.Fatalf("internal symlink: status=%d body=%q", res.StatusCode, body)
	}
}

func TestFrontendCachingRangesAndHEAD(t *testing.T) {
	dir := frontendFixture(t)
	writeFrontendFile(t, dir, "assets/app-C9x_2Ab0.js", "0123456789")
	writeFrontendFile(t, dir, "assets/config.js", "mutable config")
	writeFrontendFile(t, dir, "djvujs-assets/DjVu.js", "mutable reader")
	app := newTestAppWithFrontend(t, true, "/", dir)
	for _, route := range []string{"/", "/index.html", "/read/book"} {
		t.Run("html"+route, func(t *testing.T) {
			req, _ := http.NewRequest("GET", app.server.URL+route, nil)
			req.Header.Set("If-Modified-Since", "Wed, 01 Jan 2099 00:00:00 GMT")
			req.Header.Set("If-None-Match", "*")
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			if res.StatusCode != 200 || res.Header.Get("Cache-Control") != "no-store, no-cache, must-revalidate" {
				t.Fatalf("status=%d headers=%v", res.StatusCode, res.Header)
			}
		})
	}
	for _, tc := range []struct{ route, cache string }{
		{"/assets/app-C9x_2Ab0.js", "public, max-age=31536000, immutable"},
		{"/assets/config.js", "no-cache"}, {"/djvujs-assets/DjVu.js", "no-cache"},
	} {
		res, err := http.Get(app.server.URL + tc.route)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.Header.Get("Cache-Control") != tc.cache {
			t.Fatalf("%s: headers=%v", tc.route, res.Header)
		}
		if modified := res.Header.Get("Last-Modified"); modified != "" {
			req, _ := http.NewRequest("GET", app.server.URL+tc.route, nil)
			req.Header.Set("If-Modified-Since", modified)
			res, err = http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			if res.StatusCode != 304 {
				t.Fatalf("conditional resource status=%d", res.StatusCode)
			}
		}
	}
	for _, tc := range []struct {
		method, byteRange, body string
		status                  int
	}{
		{"HEAD", "", "", 200}, {"GET", "bytes=2-5", "2345", 206}, {"GET", "bytes=99-", "invalid range: failed to overlap\n", 416},
	} {
		req, _ := http.NewRequest(tc.method, app.server.URL+"/assets/app-C9x_2Ab0.js", nil)
		if tc.byteRange != "" {
			req.Header.Set("Range", tc.byteRange)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != tc.status || string(body) != tc.body {
			t.Fatalf("%s %s: status=%d body=%q", tc.method, tc.byteRange, res.StatusCode, body)
		}
		if tc.status == 416 && !strings.Contains(res.Header.Get("Cache-Control"), "no-store") {
			t.Fatalf("cached error: %v", res.Header)
		}
	}
}

func TestFrontendDisabledKeepsAPIOnly(t *testing.T) {
	app := newTestAppWithFrontend(t, true, "/", "")
	for _, route := range []string{"/", "/login", "/read/123"} {
		res, err := http.Get(app.server.URL + route)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 404 {
			t.Fatalf("%s: status=%d", route, res.StatusCode)
		}
	}
	app.csrf(t, app.client(t))
}

func TestFrontendPreservesAPIAuthAndErrors(t *testing.T) {
	for _, base := range []string{"", "/hub"} {
		t.Run(base, func(t *testing.T) {
			cookiePath := base
			if cookiePath == "" {
				cookiePath = "/"
			}
			app := newTestAppWithFrontend(t, true, cookiePath, frontendFixture(t))
			client := app.client(t)
			res, err := client.Get(app.server.URL + base + "/api/v1/auth/csrf")
			if err != nil {
				t.Fatal(err)
			}
			var csrf map[string]string
			if err := json.NewDecoder(res.Body).Decode(&csrf); err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			cookies := res.Cookies()
			if res.StatusCode != 200 || csrf["csrf_token"] == "" || res.Header.Get("X-Request-Id") == "" || len(cookies) != 1 || cookies[0].Path != cookiePath {
				t.Fatalf("csrf status=%d headers=%v body=%v", res.StatusCode, res.Header, csrf)
			}
			for _, tc := range []struct {
				method, route, code string
				status              int
			}{
				{"GET", "/healthz", "", 200}, {"DELETE", "/healthz", "", 405},
				{"GET", "/unknown", "", 404}, {"GET", "/v1/books/00000000-0000-0000-0000-000000000001/file", "unauthorized", 401},
				{"POST", "/v1/auth/register", "csrf_invalid", 403},
			} {
				req, _ := http.NewRequest(tc.method, app.server.URL+base+"/api"+tc.route, nil)
				res, err := client.Do(req)
				if err != nil {
					t.Fatal(err)
				}
				body, _ := io.ReadAll(res.Body)
				res.Body.Close()
				if res.StatusCode != tc.status || res.Header.Get("X-Request-Id") == "" || strings.Contains(string(body), "<!doctype") {
					t.Fatalf("%s %s: status=%d headers=%v body=%q", tc.method, tc.route, res.StatusCode, res.Header, body)
				}
				if tc.code != "" {
					var failure map[string]string
					if err := json.Unmarshal(body, &failure); err != nil || failure["code"] != tc.code || failure["request_id"] != res.Header.Get("X-Request-Id") {
						t.Fatalf("API error=%q, decode=%v", body, err)
					}
				}
			}
		})
	}
}

func TestFrontendAllowsAuthenticatedBookLifecycle(t *testing.T) {
	app := newTestAppWithFrontend(t, true, "/", frontendFixture(t))
	client := app.client(t)
	csrf := app.csrf(t, client)
	app.register(t, client, csrf, "static-reader", "password", http.StatusCreated)
	app.login(t, client, csrf, "static-reader", "password", http.StatusOK)
	bookID := app.uploadBook(t, client, csrf, "book.fb2", []byte("<FictionBook>book</FictionBook>"))
	res, err := client.Get(app.server.URL + "/api/v1/books/" + bookID + "/file")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != 200 || string(body) != "<FictionBook>book</FictionBook>" {
		t.Fatalf("book status=%d body=%q", res.StatusCode, body)
	}
}

func TestFrontendRelativeDirectoryAndSymlinkedRoot(t *testing.T) {
	dir := frontendFixture(t)
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	relative, err := filepath.Rel(cwd, dir)
	if err != nil {
		t.Fatal(err)
	}
	check := func(t *testing.T, directory string) {
		app := newTestAppWithFrontend(t, true, "/", directory)
		res, err := http.Get(app.server.URL + "/")
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			t.Fatalf("status=%d", res.StatusCode)
		}
	}
	t.Run("relative", func(t *testing.T) { check(t, relative) })
	t.Run("symlinked root", func(t *testing.T) {
		link := filepath.Join(t.TempDir(), "build")
		if err := os.Symlink(dir, link); err != nil {
			t.Skipf("symbolic links unavailable: %v", err)
		}
		check(t, link)
	})
}
