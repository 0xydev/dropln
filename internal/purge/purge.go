// Package purge runs a periodic background sweep that deletes expired pastes.
// Storage backends already filter expired rows on read; this worker just
// reclaims space and keeps the index small.
package purge

import (
	"context"
	"log/slog"
	"time"

	"github.com/0xydev/ulakbin/internal/storage"
)

type Worker struct {
	store     storage.Store
	logger    *slog.Logger
	interval  time.Duration
	batchSize int
}

func NewWorker(store storage.Store, logger *slog.Logger, interval time.Duration, batchSize int) *Worker {
	return &Worker{
		store:     store,
		logger:    logger,
		interval:  interval,
		batchSize: batchSize,
	}
}

// Run blocks until ctx is cancelled, sweeping at every tick. The first sweep
// runs immediately so a fresh process doesn't carry stale rows for a full
// interval before noticing.
func (w *Worker) Run(ctx context.Context) {
	w.sweep(ctx)

	t := time.NewTicker(w.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			w.sweep(ctx)
		}
	}
}

func (w *Worker) sweep(ctx context.Context) {
	n, err := w.store.Purge(ctx, w.batchSize)
	if err != nil {
		w.logger.Error("purge sweep failed", "err", err)
		return
	}
	if n > 0 {
		w.logger.Info("purged expired pastes", "count", n)
	}
}
