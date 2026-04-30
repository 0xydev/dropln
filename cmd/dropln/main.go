package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/0xydev/dropln/internal/config"
	"github.com/0xydev/dropln/internal/purge"
	"github.com/0xydev/dropln/internal/ratelimit"
	"github.com/0xydev/dropln/internal/server"
	"github.com/0xydev/dropln/internal/storage/postgres"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg, err := config.Load()
	if err != nil {
		logger.Error("config load failed", "err", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	store, err := postgres.New(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("storage init failed", "err", err)
		os.Exit(1)
	}
	defer store.Close()

	limiter := ratelimit.New(cfg.RateLimitPerMin, cfg.RateLimitBurst, cfg.RateLimitTTL)
	go limiter.Run(ctx)

	srv := server.New(cfg, logger, store, limiter)

	purger := purge.NewWorker(store, logger, cfg.PurgeInterval, cfg.PurgeBatchSize)
	go purger.Run(ctx)

	httpServer := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		logger.Info("dropln listening", "addr", cfg.Addr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server error", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	logger.Info("shutdown initiated")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown error", "err", err)
		os.Exit(1)
	}
	logger.Info("shutdown complete")
}
