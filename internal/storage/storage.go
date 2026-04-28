// Package storage defines the persistence boundary for ulakbin.
// Implementations live in subpackages (e.g. internal/storage/postgres).
package storage

import (
	"context"
	"errors"
	"time"
)

// Paste is a stored paste row. Payload holds the opaque Format v2 envelope —
// the storage layer never inspects its contents.
type Paste struct {
	ID            string
	Payload       []byte
	DeleteToken   string
	BurnAfterRead bool
	ExpiresAt     *time.Time // nil means "never expires"
	CreatedAt     time.Time
}

// ErrIDConflict is returned by Create if the chosen ID already exists.
// Callers should retry with a fresh ID.
var ErrIDConflict = errors.New("paste id already exists")

// Store is the persistence contract.
type Store interface {
	// Create inserts a paste. Returns ErrIDConflict if the ID is already in use.
	Create(ctx context.Context, p Paste) error

	// Read returns a paste by ID. If the paste is flagged burn-after-read and
	// is currently visible, it is atomically deleted as part of the read.
	// Returns (paste, true, nil) on hit, (nil, false, nil) on miss/expired.
	Read(ctx context.Context, id string) (*Paste, bool, error)

	// Delete removes a paste by ID after verifying the delete_token.
	// Returns true iff a row was deleted.
	Delete(ctx context.Context, id, deleteToken string) (bool, error)

	// Purge removes up to batchSize expired pastes. Returns the count purged.
	Purge(ctx context.Context, batchSize int) (int, error)

	// Close releases resources.
	Close()
}
