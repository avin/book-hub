package httpapi

import "net/http"

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	s.writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Ping(r.Context()); err != nil {
		s.writeErrorStatus(w, r, http.StatusServiceUnavailable, "service_unavailable", "database is not ready")
		return
	}
	if err := s.files.CheckReady(); err != nil {
		s.writeErrorStatus(w, r, http.StatusServiceUnavailable, "service_unavailable", "storage is not ready")
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
