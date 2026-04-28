package server

import (
	"log/slog"
	"net/http"

	"github.com/0xydev/ulakbin/internal/config"
	"github.com/0xydev/ulakbin/internal/ratelimit"
	"github.com/0xydev/ulakbin/internal/server/dev"
	"github.com/0xydev/ulakbin/internal/storage"
)

type Server struct {
	cfg     *config.Config
	logger  *slog.Logger
	store   storage.Store
	limiter *ratelimit.Limiter
	handler http.Handler
}

func New(cfg *config.Config, logger *slog.Logger, store storage.Store, limiter *ratelimit.Limiter) *Server {
	s := &Server{
		cfg:     cfg,
		logger:  logger,
		store:   store,
		limiter: limiter,
	}
	s.handler = securityHeaders(cfg.HSTS)(s.routes())
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.handler.ServeHTTP(w, r)
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("GET /api/v1/info", s.handleInfo)

	rateLimit := ratelimit.Middleware(s.limiter, func(r *http.Request) string {
		return ratelimit.ClientIP(r, s.cfg.TrustProxy)
	})
	mux.Handle("POST /api/v1/paste", rateLimit(http.HandlerFunc(s.handleCreatePaste)))
	mux.HandleFunc("GET /api/v1/paste/{id}", s.handleReadPaste)
	mux.HandleFunc("DELETE /api/v1/paste/{id}", s.handleDeletePaste)

	mux.Handle("GET /_dev/", http.StripPrefix("/_dev/", dev.Handler()))

	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok\n"))
}
