-- space-music — D1 schema behind `POST /plays`, `GET /stats` (play counts) and
-- `GET` / `POST /likes` (我喜欢).
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

-- 我喜欢 — one row per liked song, keyed by the same QQ label the plays use.
--
-- The pair `(qq, track_id)` is the primary key rather than a synthetic id, and
-- that is the whole write protocol: a like is `INSERT OR IGNORE`, an unlike is
-- `DELETE`, and both are idempotent. The client keeps the *desired state* per
-- song in a local outbox (not a log of taps), so a replayed batch lands on the
-- same answer instead of toggling twice.
--
-- `created_at` is the server's clock, not the client's: nothing is measured
-- from it (unlike `plays.played_at`, where "最近 7 天" is the point), so there
-- is no reason to trust a device clock for it.
CREATE TABLE IF NOT EXISTS likes (
    qq         TEXT NOT NULL,
    track_id   TEXT NOT NULL,
    track_name TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (qq, track_id)
);

CREATE INDEX IF NOT EXISTS idx_likes_qq_time ON likes (qq, created_at);
