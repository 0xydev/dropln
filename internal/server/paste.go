package server

import (
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/0xydev/ulakbin/internal/paste"
	"github.com/0xydev/ulakbin/internal/storage"
)

// Version is the running server version. Override at build time with
// `-ldflags "-X github.com/0xydev/ulakbin/internal/server.Version=..."`.
var Version = "1.0.0-dev"

// createMaxAttempts caps how many times we retry on an ID collision.
// With 64 bits of entropy, two retries is already paranoid.
const createMaxAttempts = 3

func (s *Server) handleInfo(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"version":           Version,
		"max_paste_bytes":   s.cfg.MaxPasteBytes,
		"expire_options":    paste.ExpireOptions(),
		"formatter_options": paste.FormatterOptions(),
	})
}

func (s *Server) handleCreatePaste(w http.ResponseWriter, r *http.Request) {
	body := http.MaxBytesReader(w, r.Body, s.cfg.MaxPasteBytes)
	raw, err := io.ReadAll(body)
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "too_large", "payload exceeds limit")
			return
		}
		writeError(w, http.StatusBadRequest, "read_body", err.Error())
		return
	}

	payload, err := paste.Decode(raw)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "validation", err.Error())
		return
	}

	expiresAt, err := paste.ResolveExpire(payload.Meta.Expire, time.Now())
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "validation", err.Error())
		return
	}

	deleteToken, err := paste.NewDeleteToken()
	if err != nil {
		s.logger.Error("delete token", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "")
		return
	}

	row := storage.Paste{
		Payload:       raw,
		DeleteToken:   deleteToken,
		BurnAfterRead: payload.ADATA.BurnAfterRead,
		ExpiresAt:     expiresAt,
	}

	var id string
	for range createMaxAttempts {
		id, err = paste.NewID()
		if err != nil {
			s.logger.Error("new id", "err", err)
			writeError(w, http.StatusInternalServerError, "internal", "")
			return
		}
		row.ID = id
		err = s.store.Create(r.Context(), row)
		if err == nil {
			break
		}
		if !errors.Is(err, storage.ErrIDConflict) {
			s.logger.Error("create paste", "err", err)
			writeError(w, http.StatusInternalServerError, "internal", "")
			return
		}
	}
	if err != nil {
		s.logger.Error("create paste: id collision exhausted", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{
		"id":           id,
		"delete_token": deleteToken,
	})
}

func (s *Server) handleReadPaste(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !paste.ValidID(id) {
		writeError(w, http.StatusNotFound, "not_found", "")
		return
	}

	p, found, err := s.store.Read(r.Context(), id)
	if err != nil {
		s.logger.Error("read paste", "err", err, "id", id)
		writeError(w, http.StatusInternalServerError, "internal", "")
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "not_found", "")
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(p.Payload)
}

func (s *Server) handleDeletePaste(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !paste.ValidID(id) {
		writeError(w, http.StatusNotFound, "not_found", "")
		return
	}
	token := r.URL.Query().Get("token")
	if token == "" {
		writeError(w, http.StatusBadRequest, "missing_token", "delete token required")
		return
	}

	deleted, err := s.store.Delete(r.Context(), id, token)
	if err != nil {
		s.logger.Error("delete paste", "err", err, "id", id)
		writeError(w, http.StatusInternalServerError, "internal", "")
		return
	}
	if !deleted {
		writeError(w, http.StatusNotFound, "not_found", "")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
