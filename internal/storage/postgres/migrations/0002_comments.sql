-- 0002_comments.sql
-- Threaded comments attached to pastes. Each comment is encrypted with the
-- same key as its parent paste (zero-knowledge: server still can't decrypt).
-- ON DELETE CASCADE means burning/expiring/deleting a paste removes its
-- comments without an extra application step.

CREATE TABLE IF NOT EXISTS comments (
    paste_id   TEXT        NOT NULL REFERENCES pastes(id) ON DELETE CASCADE,
    id         TEXT        NOT NULL,
    parent_id  TEXT        NOT NULL,
    payload    BYTEA       NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (paste_id, id)
);

-- Listing comments for a paste in chronological order is the only read path.
CREATE INDEX IF NOT EXISTS idx_comments_paste_created
    ON comments (paste_id, created_at);
