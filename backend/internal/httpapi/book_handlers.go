package httpapi

import (
	"context"
	"fmt"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"book-hub/internal/domain"
	"book-hub/internal/storage"
	"book-hub/internal/storage/files"
)

func (s *Server) handleQueryBooks(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	userID, err := s.requireUserID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	var req bookQueryRequest
	if err := decodeJSON(r, &req, 1<<20); err != nil {
		s.writeError(w, r, err)
		return
	}
	query := domain.BookQuery{Limit: 50, Offset: 0, Sort: req.Sort, Tags: req.Tags, Favorite: req.Favorite, Q: req.Q}
	if req.Limit != nil {
		query.Limit = *req.Limit
	}
	if req.Offset != nil {
		query.Offset = *req.Offset
	}
	query, err = domain.NormalizeBookQuery(query)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	page, err := s.store.QueryBooks(r.Context(), userID, query)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	items := make([]bookResponse, 0, len(page.Items))
	for _, book := range page.Items {
		items = append(items, bookDTO(book))
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": page.Total, "limit": page.Limit, "offset": page.Offset})
}

func (s *Server) handleListBookTags(w http.ResponseWriter, r *http.Request) {
	userID, err := s.requireUserID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	tags, err := s.store.ListBookTags(r.Context(), userID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, tagsResponse{Items: tags})
}

func (s *Server) handleUploadBook(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	user, err := s.currentUser(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	temp, filename, form, err := s.readBookUpload(w, r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	defer temp.Release()

	format, err := domain.NormalizeBookFormat(filename)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	title := form.Get("title")
	if title == "" {
		title = domain.TitleFromFilename(filename)
	}
	favorite, _ := strconv.ParseBool(form.Get("favorite"))

	existing, err := s.store.GetBookFileByHash(r.Context(), temp.SHA256)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if existing != nil {
		if existing.Format != format {
			s.writeError(w, r, domain.ErrUnsupportedFormat)
			return
		}
		duplicate, err := s.store.UserHasBookFile(r.Context(), user.ID, existing.ID)
		if err != nil {
			s.writeError(w, r, err)
			return
		}
		if duplicate {
			s.writeError(w, r, domain.ErrDuplicateBook)
			return
		}
	}
	if user.UsedBytes+temp.Size > user.QuotaBytes {
		s.writeError(w, r, domain.ErrQuotaExceeded)
		return
	}
	book, err := s.store.CreateBookWithOriginal(r.Context(), user.ID,
		domain.BookFileInput{SHA256: temp.SHA256, SizeBytes: temp.Size, Format: format},
		domain.BookInput{Title: title, Description: form.Get("description"), Tags: form["tags"], Favorite: favorite},
		func(ctx context.Context) (string, error) {
			location, err := s.files.Books.MoveBook(ctx, temp.Path, temp.SHA256, format)
			if err != nil {
				return "", fmt.Errorf("save original: %w: %w", storage.ErrUnavailable, err)
			}
			return location, nil
		},
	)
	if err != nil {
		s.writeError(w, r, err)
		return
	}

	s.files.SeedBook(r.Context(), book, temp)
	s.writeJSON(w, http.StatusCreated, bookDTO(book))
}

func (s *Server) handleGetBook(w http.ResponseWriter, r *http.Request) {
	book, err := s.getOwnedBook(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, bookDTO(book))
}

func (s *Server) handlePatchBook(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	userID, bookID, err := s.userAndBookID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	var req bookPatchRequest
	if err := decodeJSON(r, &req, 1<<20); err != nil {
		s.writeError(w, r, err)
		return
	}
	book, err := s.store.UpdateBook(r.Context(), userID, bookID, storage.BookPatch{
		Title:       req.Title,
		Description: req.Description,
		Tags:        req.Tags,
		Favorite:    req.Favorite,
	})
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, bookDTO(book))
}

func (s *Server) handleDeleteBook(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	userID, bookID, err := s.userAndBookID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	deleted, err := s.store.DeleteBook(r.Context(), userID, bookID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	files.DeleteBestEffort(deleted.CoverPath)
	files.DeleteBestEffort(deleted.CoverThumbPath)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDownloadBook(w http.ResponseWriter, r *http.Request) {
	book, err := s.getOwnedBook(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	contentType := "application/xml"
	switch book.Format {
	case "pdf":
		contentType = "application/pdf"
	case "epub":
		contentType = "application/epub+zip"
	case "djvu":
		contentType = "image/vnd.djvu"
	}
	disposition := "inline"
	if r.URL.Query().Get("download") == "1" {
		disposition = "attachment"
	}
	original, err := s.files.OpenBook(r.Context(), book)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	defer original.Close()
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", bookFileContentDisposition(disposition, book.Title, book.Format))
	w.Header().Set("ETag", `"`+book.SHA256+`"`)
	http.ServeContent(w, r, book.Title+"."+book.Format, book.CreatedAt, original)
}

func (s *Server) handleUploadCover(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	userID, bookID, err := s.userAndBookID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if _, err := s.store.GetBook(r.Context(), userID, bookID); err != nil {
		s.writeError(w, r, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxCoverUploadBytes+10*1024)
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		s.writeError(w, r, domain.ErrValidation)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		s.writeError(w, r, domain.ErrValidation)
		return
	}
	defer file.Close()
	format, err := domain.NormalizeCoverFormat(header.Filename)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	coverFiles, err := s.files.Images.SaveCover(bookID.String(), format, file, s.cfg.MaxCoverUploadBytes)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	oldCoverFiles, err := s.store.SetCover(r.Context(), userID, bookID, coverFiles)
	if err != nil {
		deleteCoverFiles(coverFiles)
		s.writeError(w, r, err)
		return
	}
	deleteCoverFiles(oldCoverFiles)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGetCover(w http.ResponseWriter, r *http.Request) {
	book, err := s.getOwnedBook(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if book.CoverPath == nil {
		s.writeError(w, r, domain.ErrNotFound)
		return
	}
	coverPath := *book.CoverPath
	variant, err := domain.NormalizeCoverVariant(r.URL.Query().Get("variant"))
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if variant == "thumbnail" && book.CoverThumbPath != nil {
		coverPath = *book.CoverThumbPath
	}
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(coverPath), "."))
	if ext == "jpg" {
		w.Header().Set("Content-Type", "image/jpeg")
	} else {
		w.Header().Set("Content-Type", mime.TypeByExtension("."+ext))
	}
	w.Header().Set("Content-Disposition", `inline; filename="cover.`+ext+`"`)
	http.ServeFile(w, r, coverPath)
}

func (s *Server) handleDeleteCover(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	userID, bookID, err := s.userAndBookID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	oldCoverFiles, err := s.store.DeleteCover(r.Context(), userID, bookID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	deleteCoverFiles(oldCoverFiles)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGetProgress(w http.ResponseWriter, r *http.Request) {
	userID, bookID, err := s.userAndBookID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	progress, err := s.store.GetProgress(r.Context(), userID, bookID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, progressDTO(progress))
}

func (s *Server) handlePutProgress(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	userID, bookID, err := s.userAndBookID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	var req progressRequest
	if err := decodeJSON(r, &req, 1<<20); err != nil {
		s.writeError(w, r, err)
		return
	}
	if err := domain.ValidateProgress(req.ProgressPercent); err != nil {
		s.writeError(w, r, err)
		return
	}
	progress, err := s.store.PutProgress(r.Context(), userID, bookID, req.ProgressPercent)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, progressDTO(progress))
}

func (s *Server) handleDeleteProgress(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	userID, bookID, err := s.userAndBookID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if err := s.store.DeleteProgress(r.Context(), userID, bookID); err != nil {
		s.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteAllProgress(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	userID, err := s.requireUserID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if err := s.store.DeleteAllProgress(r.Context(), userID); err != nil {
		s.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
