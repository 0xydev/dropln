// Package postgres implements storage.Store on top of PostgreSQL via pgx/v5.
package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/0xydev/ulakbin/internal/storage"
	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store is the Postgres-backed implementation of storage.Store.
type Store struct {
	pool *pgxpool.Pool
}

// New connects to Postgres using the given URL and applies any pending
// migrations. The caller owns the returned Store and must call Close.
func New(ctx context.Context, dsn string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}

	conn, err := pool.Acquire(ctx)
	if err != nil {
		pool.Close()
		return nil, fmt.Errorf("acquire conn for migrate: %w", err)
	}
	if err := Migrate(ctx, conn.Conn()); err != nil {
		conn.Release()
		pool.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	conn.Release()

	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

func (s *Store) Create(ctx context.Context, p storage.Paste) error {
	const q = `
		INSERT INTO pastes (id, payload, delete_token, burn_after_read, expires_at)
		VALUES ($1, $2, $3, $4, $5)`
	_, err := s.pool.Exec(ctx, q, p.ID, p.Payload, p.DeleteToken, p.BurnAfterRead, p.ExpiresAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgerrcode.UniqueViolation {
			return storage.ErrIDConflict
		}
		return fmt.Errorf("insert paste: %w", err)
	}
	return nil
}

// Read implements atomic burn-after-read. The DELETE-RETURNING serializes
// concurrent reads on a single row via the row-level lock the DELETE acquires:
// at most one caller observes the data, the rest see ErrNoRows. Non-burn pastes
// fall through to a regular SELECT.
func (s *Store) Read(ctx context.Context, id string) (*storage.Paste, bool, error) {
	const burnQ = `
		DELETE FROM pastes
		WHERE id = $1
		  AND burn_after_read = TRUE
		  AND (expires_at IS NULL OR expires_at > now())
		RETURNING id, payload, delete_token, burn_after_read, expires_at, created_at`
	p, found, err := scanOne(ctx, s.pool, burnQ, id)
	if err != nil {
		return nil, false, fmt.Errorf("read (burn path): %w", err)
	}
	if found {
		return p, true, nil
	}

	const selectQ = `
		SELECT id, payload, delete_token, burn_after_read, expires_at, created_at
		FROM pastes
		WHERE id = $1
		  AND (expires_at IS NULL OR expires_at > now())`
	p, found, err = scanOne(ctx, s.pool, selectQ, id)
	if err != nil {
		return nil, false, fmt.Errorf("read (select path): %w", err)
	}
	return p, found, nil
}

func (s *Store) Delete(ctx context.Context, id, deleteToken string) (bool, error) {
	const q = `DELETE FROM pastes WHERE id = $1 AND delete_token = $2`
	tag, err := s.pool.Exec(ctx, q, id, deleteToken)
	if err != nil {
		return false, fmt.Errorf("delete paste: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

func (s *Store) Purge(ctx context.Context, batchSize int) (int, error) {
	if batchSize <= 0 {
		return 0, nil
	}
	const q = `
		DELETE FROM pastes
		WHERE id IN (
			SELECT id FROM pastes
			WHERE expires_at IS NOT NULL AND expires_at <= now()
			LIMIT $1
		)`
	tag, err := s.pool.Exec(ctx, q, batchSize)
	if err != nil {
		return 0, fmt.Errorf("purge expired: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

// querier abstracts the few methods both *pgxpool.Pool and pgx.Tx expose,
// so scanOne can be reused if we later wrap reads in transactions.
type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func scanOne(ctx context.Context, q querier, sql string, args ...any) (*storage.Paste, bool, error) {
	var p storage.Paste
	err := q.QueryRow(ctx, sql, args...).Scan(
		&p.ID, &p.Payload, &p.DeleteToken, &p.BurnAfterRead, &p.ExpiresAt, &p.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return &p, true, nil
}
