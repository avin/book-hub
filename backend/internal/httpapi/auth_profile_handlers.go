package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"book-hub/internal/auth"
	"book-hub/internal/domain"
)

func (s *Server) handleGetCSRF(w http.ResponseWriter, r *http.Request) {
	token, err := s.csrf.NewToken()
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: csrfCookieName, Value: token, Path: s.cfg.BasePath, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode})
	s.writeJSON(w, http.StatusOK, map[string]string{"csrf_token": token})
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	if !s.cfg.RegistrationEnabled {
		s.writeError(w, r, domain.ErrRegistrationDisabled)
		return
	}
	var req loginRequest
	if err := decodeJSON(r, &req, 1<<20); err != nil {
		s.writeError(w, r, err)
		return
	}
	login, err := domain.NormalizeLogin(req.Login)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if err := domain.ValidatePassword(req.Password); err != nil {
		s.writeError(w, r, err)
		return
	}
	hash, err := auth.HashPasswordWithAlgorithm(req.Password, s.cfg.PasswordAlgorithm)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	user, err := s.store.CreateUser(r.Context(), login, hash, s.cfg.RegistrationAutoActivate, s.cfg.DefaultQuotaBytes)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusCreated, map[string]any{"user_id": user.ID, "is_active": user.IsActive})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	var req loginRequest
	if err := decodeJSON(r, &req, 1<<20); err != nil {
		s.writeError(w, r, err)
		return
	}
	login, err := domain.NormalizeLogin(req.Login)
	if err != nil {
		s.writeError(w, r, domain.ErrInvalidCredentials)
		return
	}
	user, err := s.store.GetUserByLogin(r.Context(), login)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			err = domain.ErrInvalidCredentials
		}
		s.writeError(w, r, err)
		return
	}
	if !auth.VerifyPassword(req.Password, user.PasswordHash) {
		s.writeError(w, r, domain.ErrInvalidCredentials)
		return
	}
	if !user.IsActive {
		s.writeError(w, r, domain.ErrAccountInactive)
		return
	}
	if auth.NeedsPasswordRehash(user.PasswordHash, s.cfg.PasswordAlgorithm) {
		hash, err := auth.HashPasswordWithAlgorithm(req.Password, s.cfg.PasswordAlgorithm)
		if err != nil {
			s.writeError(w, r, err)
			return
		}
		updated, err := s.store.RehashUserPassword(r.Context(), user.ID, user.PasswordHash, hash)
		if err != nil {
			s.writeError(w, r, err)
			return
		}
		if !updated {
			s.writeError(w, r, domain.ErrInvalidCredentials)
			return
		}
	}
	token, tokenHash, err := auth.NewSessionToken()
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if err := s.store.CreateSession(r.Context(), user.ID, tokenHash, int64(s.cfg.SessionTTL.Seconds())); err != nil {
		s.writeError(w, r, err)
		return
	}
	s.setSessionCookie(w, token, time.Now().Add(s.cfg.SessionTTL))
	s.writeJSON(w, http.StatusOK, map[string]any{"user": userResponse(user.User)})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	if cookie, err := r.Cookie(sessionCookieName); err == nil && cookie.Value != "" {
		if err := s.store.RevokeSession(r.Context(), auth.HashSessionToken(cookie.Value)); err != nil {
			s.writeError(w, r, err)
			return
		}
	}
	s.expireSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	user, err := s.currentUser(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, userResponse(user.User))
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	user, err := s.currentUser(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	var req changePasswordRequest
	if err := decodeJSON(r, &req, 1<<20); err != nil {
		s.writeError(w, r, err)
		return
	}
	if !auth.VerifyPassword(req.CurrentPassword, user.PasswordHash) {
		s.writeError(w, r, domain.ErrInvalidCredentials)
		return
	}
	if err := domain.ValidatePassword(req.NewPassword); err != nil {
		s.writeError(w, r, err)
		return
	}
	hash, err := auth.HashPasswordWithAlgorithm(req.NewPassword, s.cfg.PasswordAlgorithm)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	sessionHash := s.sessionHash(r)
	if err := s.store.SetUserPassword(r.Context(), user.ID, hash); err != nil {
		s.writeError(w, r, err)
		return
	}
	if err := s.store.RevokeUserSessions(r.Context(), user.ID, &sessionHash); err != nil {
		s.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	userID, err := s.requireUserID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	settings, err := s.store.GetSettings(r.Context(), userID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeRawJSON(w, http.StatusOK, settings)
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	if err := s.requireCSRF(r); err != nil {
		s.writeError(w, r, err)
		return
	}
	userID, err := s.requireUserID(r)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, domain.MaxSettingsBytes+1))
	if err != nil || len(body) > domain.MaxSettingsBytes {
		s.writeError(w, r, domain.ErrValidation)
		return
	}
	var object map[string]any
	if err := json.Unmarshal(body, &object); err != nil || object == nil {
		s.writeError(w, r, domain.ErrValidation)
		return
	}
	if err := s.store.PutSettings(r.Context(), userID, body); err != nil {
		s.writeError(w, r, err)
		return
	}
	s.writeRawJSON(w, http.StatusOK, body)
}
