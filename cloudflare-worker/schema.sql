-- space-music — D1 schema for the play counts behind `POST /plays` and
-- `GET /stats`.
--
-- Apply it once, after creating the database:
--
--   npx wrangler d1 create space-music-plays
--   npx wrangler d1 execute space-music-plays --remote --file schema.sql
--
-- The Worker also runs this same DDL lazily on its first write (`ensureSchema`
-- in `src/index.js`), so a fresh deployment heals itself and this file is the
-- record of *what* it creates rather than a step that must not be missed.
-- Keep the two in sync.

CREATE TABLE IF NOT EXISTS plays (
    -- The client's own id for the play event, not a sequence. It is the
    -- primary key so that re-sending a batch — which the client does whenever
    -- a response is lost, because it keeps unacknowledged plays in a local log
    -- — cannot count the same listen twice.
    event_id   TEXT PRIMARY KEY,
    -- The visitor's QQ number, as typed on the 账号 page. A label for their
    -- avatar, not a credential: nothing verifies it, so it is stored as-is.
    qq         TEXT NOT NULL,
    -- `<source>:<id>` is not stored — only the raw library id (`songs/x.mp3`
    -- for the public bucket, a Drive file id for a connected account).
    track_id   TEXT NOT NULL,
    track_name TEXT NOT NULL DEFAULT '',
    -- When the visitor listened (client clock) and when the row arrived. They
    -- differ by however long the device was offline.
    played_at  INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

-- The two queries `/stats` runs: the all-time ranking (by qq, grouped by
-- track) and the rolling 7-day one (by qq, filtered on played_at).
CREATE INDEX IF NOT EXISTS idx_plays_qq_time ON plays (qq, played_at);
CREATE INDEX IF NOT EXISTS idx_plays_qq_track ON plays (qq, track_id);
