package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"book-hub/internal/domain"
	"book-hub/internal/storage"
)

func (s *Server) writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func (s *Server) writeRawJSON(w http.ResponseWriter, status int, value []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(value)
}

func (s *Server) writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := errorStatus(err)
	s.writeErrorStatus(w, r, status, code, message)
}

func (s *Server) writeErrorStatus(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	s.writeJSON(w, status, map[string]any{
		"code":       code,
		"message":    message,
		"request_id": requestID(r),
	})
}

func errorStatus(err error) (int, string, string) {
	switch {
	case errors.Is(err, storage.ErrUnavailable):
		return http.StatusServiceUnavailable, "service_unavailable", "storage temporarily unavailable"
	case errors.Is(err, domain.ErrValidation):
		return http.StatusBadRequest, "validation_error", "invalid request"
	case errors.Is(err, domain.ErrUnauthorized), errors.Is(err, domain.ErrInvalidCredentials):
		return http.StatusUnauthorized, "unauthorized", "unauthorized"
	case errors.Is(err, domain.ErrForbidden):
		return http.StatusForbidden, "forbidden", "forbidden"
	case errors.Is(err, domain.ErrNotFound):
		return http.StatusNotFound, "not_found", "not found"
	case errors.Is(err, domain.ErrQuotaExceeded):
		return http.StatusRequestEntityTooLarge, "quota_exceeded", "quota exceeded"
	case errors.Is(err, domain.ErrUnsupportedFormat):
		return http.StatusBadRequest, "unsupported_format", "unsupported format"
	case errors.Is(err, domain.ErrDuplicateBook):
		return http.StatusConflict, "duplicate_book", "duplicate book"
	case errors.Is(err, domain.ErrAccountInactive):
		return http.StatusForbidden, "account_inactive", "account is inactive"
	case errors.Is(err, domain.ErrRegistrationDisabled):
		return http.StatusForbidden, "registration_disabled", "registration is disabled"
	case errors.Is(err, domain.ErrCSRFInvalid):
		return http.StatusForbidden, "csrf_invalid", "invalid csrf token"
	default:
		return http.StatusInternalServerError, "internal_error", "internal error"
	}
}

func requestID(r *http.Request) string {
	if value, ok := r.Context().Value(contextKey("request_id")).(string); ok {
		return value
	}
	return ""
}
