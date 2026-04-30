package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/0xydev/dropln/internal/paste"
	"github.com/0xydev/dropln/internal/storage"
)

func (s *Server) handleCreateComment(w http.ResponseWriter, r *http.Request) {
	pasteID := r.PathValue("id")
	if !paste.ValidID(pasteID) {
		writeError(w, http.StatusNotFound, "not_found", "")
		return
	}

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

	cp, err := paste.DecodeComment(raw)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "validation", err.Error())
		return
	}
	// Defense in depth: the URL is canonical for the parent paste.
	if cp.PasteID != pasteID {
		writeError(w, http.StatusUnprocessableEntity, "validation", "pasteid in body must match URL")
		return
	}

	row := storage.Comment{
		PasteID:  pasteID,
		ParentID: cp.ParentID,
		Payload:  raw,
	}

	var commentID string
	for range createMaxAttempts {
		commentID, err = paste.NewID()
		if err != nil {
			s.logger.Error("new id", "err", err)
			writeError(w, http.StatusInternalServerError, "internal", "")
			return
		}
		row.ID = commentID
		err = s.store.CreateComment(r.Context(), row)
		if err == nil {
			break
		}
		if errors.Is(err, storage.ErrParentMissing) {
			writeError(w, http.StatusNotFound, "parent_missing", "paste not found")
			return
		}
		if !errors.Is(err, storage.ErrIDConflict) {
			s.logger.Error("create comment", "err", err)
			writeError(w, http.StatusInternalServerError, "internal", "")
			return
		}
	}
	if err != nil {
		s.logger.Error("create comment: id collision exhausted", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"id": commentID})
}

func (s *Server) handleListComments(w http.ResponseWriter, r *http.Request) {
	pasteID := r.PathValue("id")
	if !paste.ValidID(pasteID) {
		writeError(w, http.StatusNotFound, "not_found", "")
		return
	}

	comments, err := s.store.ListComments(r.Context(), pasteID)
	if err != nil {
		s.logger.Error("list comments", "err", err, "id", pasteID)
		writeError(w, http.StatusInternalServerError, "internal", "")
		return
	}

	// Splice server-generated id and created fields into each stored envelope.
	// The original envelope keys stay byte-identical since we re-emit them
	// from a parsed RawMessage map; only `id` and `created` are added.
	out := make([]map[string]json.RawMessage, 0, len(comments))
	for _, c := range comments {
		var m map[string]json.RawMessage
		if err := json.Unmarshal(c.Payload, &m); err != nil {
			// Should be impossible — payload was validated on insert.
			s.logger.Error("comment payload corrupt", "err", err, "comment_id", c.ID)
			continue
		}
		idJSON, _ := json.Marshal(c.ID)
		createdJSON, _ := json.Marshal(c.CreatedAt.Unix())
		m["id"] = idJSON
		m["created"] = createdJSON
		out = append(out, m)
	}

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, out)
}
