package frontend

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"book-hub/internal/config"
)

// Frontend owns the public build directory for the lifetime of the HTTP server.
type Frontend struct {
	root *os.Root
	base string
	api  string
}

func New(directory, basePath string) (*Frontend, error) {
	api := config.APIBasePath(basePath)
	f := &Frontend{base: strings.TrimSuffix(api, "/api"), api: api}
	if directory == "" {
		return f, nil
	}
	absolute, err := filepath.Abs(directory)
	if err != nil {
		return nil, fmt.Errorf("BOOK_HUB_FRONTEND_DIR: %w", err)
	}
	f.root, err = os.OpenRoot(absolute)
	if err != nil {
		return nil, fmt.Errorf("BOOK_HUB_FRONTEND_DIR: %w", err)
	}
	if err := f.validate(); err != nil {
		f.root.Close()
		return nil, fmt.Errorf("BOOK_HUB_FRONTEND_DIR %q: %w", directory, err)
	}
	return f, nil
}

func (f *Frontend) validate() error {
	dir, err := f.root.Open(".")
	if err != nil {
		return err
	}
	_, err = dir.ReadDir(1)
	dir.Close()
	if err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	index, _, err := f.open("index.html")
	if err != nil {
		return fmt.Errorf("read regular index.html: %w", err)
	}
	defer index.Close()
	var firstByte [1]byte
	if _, err := index.Read(firstByte[:]); err != nil && !errors.Is(err, io.EOF) {
		return fmt.Errorf("read index.html: %w", err)
	}
	return nil
}

func (f *Frontend) Close() error {
	if f.root != nil {
		return f.root.Close()
	}
	return nil
}

// Handler composes the unchanged API handler with the optional public frontend.
func (f *Frontend) Handler(api http.Handler) http.Handler {
	if f.root == nil {
		return api
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == f.api || strings.HasPrefix(r.URL.Path, f.api+"/") {
			api.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if r.URL.Path != f.base && !strings.HasPrefix(r.URL.Path, f.base+"/") {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		if f.base != "" && r.URL.Path == f.base {
			target := f.base + "/"
			if r.URL.RawQuery != "" {
				target += "?" + r.URL.RawQuery
			}
			http.Redirect(w, r, target, http.StatusPermanentRedirect)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, f.base+"/")
		trailingSlash := strings.HasSuffix(name, "/")
		name = strings.TrimSuffix(name, "/")
		if name == "" {
			if trailingSlash {
				http.NotFound(w, r)
				return
			}
			name = "index.html"
		}
		if !publicPath(name) {
			http.NotFound(w, r)
			return
		}
		file, info, err := f.open(name)
		if err == nil && trailingSlash {
			file.Close()
			http.NotFound(w, r)
			return
		}
		if errors.Is(err, fs.ErrNotExist) && path.Ext(name) == "" && !resourcePath(name) {
			name = "index.html"
			file, info, err = f.open(name)
		}
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer file.Close()
		w.Header().Set("Cache-Control", "no-cache")
		modified := info.ModTime()
		if strings.EqualFold(path.Ext(name), ".html") {
			w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
			r = r.Clone(r.Context())
			r.Header.Del("If-None-Match")
			r.Header.Del("If-Modified-Since")
			modified = time.Time{}
		} else if strings.HasPrefix(name, "assets/") && hashedAsset.MatchString(path.Base(name)) {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		switch strings.ToLower(path.Ext(name)) {
		case ".js", ".mjs":
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		case ".wasm":
			w.Header().Set("Content-Type", "application/wasm")
		case ".css":
			w.Header().Set("Content-Type", "text/css; charset=utf-8")
		case ".html":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
		}
		http.ServeContent(&staticResponse{ResponseWriter: w}, r, name, modified, file)
	})
}

func (f *Frontend) open(name string) (*os.File, fs.FileInfo, error) {
	name, err := f.resolve(name)
	if err != nil {
		return nil, nil, err
	}
	info, err := f.root.Stat(filepath.FromSlash(name))
	if err != nil {
		return nil, nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, nil, fs.ErrPermission
	}
	file, err := f.root.Open(filepath.FromSlash(name))
	return file, info, err
}

// Resolve links inside the root and reject aliases to hidden paths as well.
// os.Root independently enforces confinement when the file is opened.
func (f *Frontend) resolve(name string) (string, error) {
	for links := 0; links < 40; links++ {
		if !publicPath(name) {
			return "", fs.ErrPermission
		}
		parts := strings.Split(name, "/")
		linked := false
		for i := range parts {
			prefix := strings.Join(parts[:i+1], "/")
			info, err := f.root.Lstat(filepath.FromSlash(prefix))
			if err != nil {
				return "", err
			}
			if info.Mode()&os.ModeSymlink == 0 {
				continue
			}
			target, err := f.root.Readlink(filepath.FromSlash(prefix))
			if err != nil || filepath.IsAbs(target) {
				return "", fs.ErrPermission
			}
			name = path.Join(path.Dir(prefix), filepath.ToSlash(target), strings.Join(parts[i+1:], "/"))
			linked = true
			break
		}
		if !linked {
			return name, nil
		}
	}
	return "", fs.ErrPermission
}

func publicPath(name string) bool {
	if !fs.ValidPath(name) || strings.ContainsAny(name, "\\:\x00") {
		return false
	}
	for _, segment := range strings.Split(name, "/") {
		if strings.HasPrefix(segment, ".") {
			return false
		}
	}
	return true
}

var hashedAsset = regexp.MustCompile(`^.+-[A-Za-z0-9_-]{8,}\.[^.]+$`)

// ServeContent may generate range/conditional errors after cache headers are set.
type staticResponse struct {
	http.ResponseWriter
}

func (w *staticResponse) WriteHeader(status int) {
	if status >= 400 {
		w.Header().Set("Cache-Control", "no-store")
	}
	w.ResponseWriter.WriteHeader(status)
}

func resourcePath(name string) bool {
	first, _, _ := strings.Cut(name, "/")
	return first == "assets" || first == "pdfjs-assets" || first == "djvujs-assets"
}
