-- 0001_init.sql
-- Initial schema for ulakbin: pastes table + expiry index.

CREATE TABLE IF NOT EXISTS pastes (
    -- Opaque short ID (PrivateBin convention: 16 hex chars / 8 random bytes).
    id              TEXT        PRIMARY KEY,

    -- Format v2 envelope, stored as opaque bytes. The server never inspects
    -- the contents — all crypto is client-side.
    payload         BYTEA       NOT NULL,

    -- Required to delete a paste before its TTL.
    delete_token    TEXT        NOT NULL,

    -- Mirrored from adata[3]; lifted into a column to make the burn-after-read
    -- DELETE ... RETURNING query trivial.
    burn_after_read BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Resolved expiry timestamp. NULL means "never expires".
    expires_at      TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial index: purge worker only ever scans expirable rows.
CREATE INDEX IF NOT EXISTS idx_pastes_expires_at
    ON pastes (expires_at)
    WHERE expires_at IS NOT NULL;
