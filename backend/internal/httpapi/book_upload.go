package httpapi

import (
	"errors"
	"io"
	"net/http"
	"net/url"

	"book-hub/internal/domain"
	"book-hub/internal/storage/files"
)

// Stream directly into the bounded workspace. ParseMultipartForm would first
// create an independent unaccounted disk copy for a large uploaded book.
func (s *Server) readBookUpload(w http.ResponseWriter, r *http.Request) (temp files.TempFile, filename string, form url.Values, err error) {
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxUploadBytes+10*1024)
	reader, err := r.MultipartReader()
	if err != nil {
		return temp, "", nil, domain.ErrValidation
	}
	form = make(url.Values)
	defer func() {
		if err != nil {
			temp.Release()
		}
	}()
	var metadataBytes int64
	for parts := 0; ; parts++ {
		part, readErr := reader.NextPart()
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil || parts >= 128 {
			return temp, "", nil, domain.ErrValidation
		}
		if part.FileName() != "" {
			if part.FormName() != "file" || filename != "" {
				part.Close()
				return temp, "", nil, domain.ErrValidation
			}
			filename = part.FileName()
			if _, err := domain.NormalizeBookFormat(filename); err != nil {
				part.Close()
				return temp, "", nil, err
			}
			temp, err = s.files.Work.SaveTempContext(r.Context(), part, s.cfg.MaxUploadBytes)
			if err != nil {
				return temp, "", nil, err
			}
		} else {
			value, readErr := io.ReadAll(io.LimitReader(part, 10*1024-metadataBytes+1))
			metadataBytes += int64(len(value))
			if readErr != nil || metadataBytes > 10*1024 {
				part.Close()
				return temp, "", nil, domain.ErrValidation
			}
			form.Add(part.FormName(), string(value))
		}
		part.Close()
	}
	if filename == "" {
		return temp, "", nil, domain.ErrValidation
	}
	return temp, filename, form, nil
}
