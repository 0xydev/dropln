// Package storage defines the persistence boundary for dropln.
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

// Comment is a stored comment row. Payload holds the opaque Format v2 comment
// envelope. Comments are bound to a paste and removed when the paste is.
type Comment struct {
	PasteID   string
	ID        string
	ParentID  string
	Payload   []byte
	CreatedAt time.Time
}

// ErrIDConflict is returned by Create / CreateComment when the chosen ID
// already exists. Callers should retry with a fresh ID.
var ErrIDConflict = errors.New("id already exists")

// ErrParentMissing is returned by CreateComment when the target paste does
// not exist (or was already burned/expired/deleted).
var ErrParentMissing = errors.New("parent paste not found")

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

	// CreateComment inserts a comment for an existing paste. Returns
	// ErrIDConflict on comment-id collision and ErrParentMissing if the
	// paste does not exist.
	CreateComment(ctx context.Context, c Comment) error

	// ListComments returns the paste's comments in creation order.
	// Returns an empty slice if the paste has no comments (or doesn't exist).
	ListComments(ctx context.Context, pasteID string) ([]Comment, error)

	// Close releases resources.
	Close()
}
