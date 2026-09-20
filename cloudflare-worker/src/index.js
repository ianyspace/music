/**
 * space-music — Cloudflare Worker that exposes an R2 bucket as a JSON track
 * index for the static blog's `/music/` page.
 *
 * The blog is exported statically to GitHub Pages, so it cannot list a bucket
 * on its own (R2 has no directory listing over HTTP). This Worker does it:
 *
 *   GET  /tracks            → { tracks: [...], generatedAt }
 *   GET  /tracks?refresh=1  → same, bypassing the edge cache
 *   POST /plays             → record play events into the D1 database
 *   GET  /stats?qq=…        → play rankings for one QQ number
 *
 * Each track is:
 *   { id, name, key, size, url, lyricsUrl, coverUrl, source: 'cloud' }
 *
 * `id` is the R2 object key (stable and unique), `url` points at the public
 * R2 domain so the browser can download the audio directly, and `lyricsUrl` /
 * `coverUrl` are the matching `.lrc` / `.txt` / image objects with the same
 * base name (either may be `null`). Both are paired here rather than in the
 * client because R2 cannot be listed over HTTP: the bucket is enumerated once,
 * in this Worker, and the answer travels with the index.
 *
 * The index is cached in `caches.default` for CACHE_TTL_SECONDS to keep R2
 * Class A (list) operations low; `?refresh=1` is the escape hatch.
 */

const AUDIO_EXTENSIONS = ['mp3', 'flac', 'm4a', 'wav', 'ogg', 'oga', 'opus', 'aac', 'wma', 'ape'];
const LYRIC_EXTENSIONS = ['lrc', 'txt'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];
const CACHE_TTL_SECONDS = 300;
const LIST_PAGE_SIZE = 1000;
const LIST_HARD_CAP = 5000;
const CACHE_PATH = '/__space-music-index-v1';

/* --- play counts (D1) ---------------------------------------------------- */

// How many songs a ranking returns. A visitor's own top 50 is already more
// than anyone scrolls; the rest is bandwidth nobody reads.
const RANKING_LIMIT = 50;
// "最近 7 天" is a rolling window, not a calendar week: the client asks once and
// gets the same answer whichever timezone the phone is in.
const RECENT_DAYS = 7;
const RECENT_WINDOW_MS = RECENT_DAYS * 24 * 60 * 60 * 1000;
// One request carries one sync batch. The client caps its local log at 1000
// entries, so a single flush may need a few requests — but never one huge body
// (the client sends these with `keepalive`, which has a 64 KB limit).
const MAX_PLAYS_PER_REQUEST = 200;
const MAX_TRACK_ID_LENGTH = 512;
const MAX_TRACK_NAME_LENGTH = 200;
// A play must be a real moment. A device with a wrong clock is common enough
// that rejecting it would lose the record; clamping to "now" keeps the row
// useful instead of dropping it. 2001-09-09 is the floor — the era of
// JavaScript millisecond timestamps.
const MIN_PLAYED_AT = 1000000000000;
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * The play table.
 *
 * `event_id` is a **primary key** rather than an auto-increment id, and that is
 * the whole reason retrying is safe: the client writes each play to a local log
 * first and re-sends anything the server never acknowledged, so the same event
 * can arrive twice (a lost response, two tabs flushing at once). `INSERT OR
 * IGNORE` on the client's own id makes the second arrival a no-op — without it
 * every retry would inflate the count, and the count is the entire feature.
 *
 * `played_at` is when the visitor listened (client clock), `created_at` is when
 * the row landed. They differ by however long the device was offline.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS plays (
    event_id   TEXT PRIMARY KEY,
    qq         TEXT NOT NULL,
    track_id   TEXT NOT NULL,
    track_name TEXT NOT NULL DEFAULT '',
    played_at  INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plays_qq_time ON plays (qq, played_at);
CREATE INDEX IF NOT EXISTS idx_plays_qq_track ON plays (qq, track_id);
`;

// Run once per isolate, and retried on the next request if it failed — a cold
// start that lost a race with the first deploy must not leave the database
// without its table forever.
let schemaPromise = null;

const ensureSchema = function (db) {
    if (!schemaPromise) {
        schemaPromise = db.exec(SCHEMA_SQL).catch((error) => {
            schemaPromise = null;
            throw error;
        });
    }
    return schemaPromise;
};

// Same rule as `normalizeQq` in components/Music/shared.js: 5–11 digits, and
// nothing else is a QQ number. It is a *label* the visitor typed, not a
// credential — there is no way to verify an account from here, so the server
// checks the shape and nothing more.
const normalizeQq = function (value) {
    const digits = String(value == null ? '' : value).replace(/\D/g, '');
    return /^\d{5,11}$/.test(digits) ? digits : '';
};

const extensionOf = function (name) {
    const match = /\.([a-z0-9]+)$/i.exec(name);
    return match ? match[1].toLowerCase() : '';
};

const basenameOf = function (key) {
    return key.split('/').pop() || key;
};

// Mirrors `normalizeLyricKey` in components/Music/shared.js so that
// "01. 牵丝戏 - 银临.mp3" matches "牵丝戏-银临.lrc" — and, since the rule is
// just "same base name, any extension", "牵丝戏-银临.jpg" as well.
const normalizeLyricKey = function (name) {
    return name
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/^\s*\d{1,3}[\s._-]+/, '')
        .toLowerCase()
        .replace(/[\s._()[\]{}-]+/g, '');
};

const encodeKey = function (key) {
    return key.split('/').map(encodeURIComponent).join('/');
};

const corsHeaders = function (request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    const allowOrigin = allowed.includes(origin) ? origin : (allowed[0] || '');
    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
    };
};

const withHeaders = function (body, status, headers) {
    return new Response(body, { status, headers });
};

const jsonResponse = function (data, status, headers) {
    return withHeaders(JSON.stringify(data), status, {
        'Content-Type': 'application/json; charset=utf-8',
        ...headers,
    });
};

// Adds CORS to an already built response without disturbing its body.
const withCors = function (response, cors) {
    const headers = new Headers(response.headers);
    Object.keys(cors).forEach((name) => headers.set(name, cors[name]));
    return new Response(response.body, { status: response.status, headers });
};

const listAllObjects = async function (bucket, prefix) {
    const objects = [];
    let cursor;
    do {
        const page = await bucket.list({ prefix, cursor, limit: LIST_PAGE_SIZE });
        objects.push(...page.objects);
        cursor = page.truncated ? page.cursor : undefined;
    } while (cursor && objects.length < LIST_HARD_CAP);
    return objects;
};

const buildIndex = async function (env) {
    const objects = await listAllObjects(env.MUSIC_BUCKET, env.MUSIC_PREFIX || '');
    const base = String(env.R2_PUBLIC_BASE || '').replace(/\/+$/, '');

    const lyricsByKey = new Map();
    const coversByKey = new Map();
    const audioObjects = [];
    objects.forEach((object) => {
        const ext = extensionOf(object.key);
        if (LYRIC_EXTENSIONS.includes(ext)) lyricsByKey.set(normalizeLyricKey(object.key), object);
        else if (IMAGE_EXTENSIONS.includes(ext)) coversByKey.set(normalizeLyricKey(object.key), object);
        else if (AUDIO_EXTENSIONS.includes(ext)) audioObjects.push(object);
    });

    const tracks = audioObjects
        .map((object) => {
            const key = normalizeLyricKey(object.key);
            const lyric = lyricsByKey.get(key);
            const cover = coversByKey.get(key);
            return {
                id: object.key,
                key: object.key,
                name: basenameOf(object.key),
                size: object.size,
                url: `${base}/${encodeKey(object.key)}`,
                lyricsUrl: lyric ? `${base}/${encodeKey(lyric.key)}` : null,
                // `null`, not absent: the client reads a missing field as "this
                // index predates covers" and falls back to guessing the
                // `.jpg` name, which would cost it a 404 per song. Saying
                // "there is none" is the answer it needs to hear.
                coverUrl: cover ? `${base}/${encodeKey(cover.key)}` : null,
                source: 'cloud',
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

    return { tracks, generatedAt: Date.now() };
};

/* --- POST /plays --------------------------------------------------------- */

const clampPlayedAt = function (value, now) {
    const stamp = Number(value);
    if (!Number.isFinite(stamp)) return now;
    if (stamp < MIN_PLAYED_AT || stamp > now + MAX_CLOCK_SKEW_MS) return now;
    return Math.round(stamp);
};

const clip = function (value, max) {
    const text = String(value == null ? '' : value);
    return text.length > max ? text.slice(0, max) : text;
};

/**
 * Records a batch of play events.
 *
 * The client is the only writer and it is not authenticated — the QQ number is
 * a label the visitor typed, so there is nothing to authenticate *with*. What
 * this endpoint guarantees is narrower and honest: the shape of what it stores
 * (a valid QQ, a bounded batch, a plausible timestamp, one row per event id),
 * and that re-sending a batch cannot double-count.
 *
 * A batch is one D1 transaction, so a partial write cannot happen: either the
 * whole batch lands or the client keeps it in its local log and retries.
 */
const handlePlays = async function (request, env, cors) {
    if (!env.PLAY_DB) return jsonResponse({ error: 'PLAY_DB binding is missing' }, 500, cors);

    let payload;
    try {
        payload = await request.json();
    } catch (error) {
        return jsonResponse({ error: 'Invalid JSON body' }, 400, cors);
    }

    const qq = normalizeQq(payload && payload.qq);
    if (!qq) return jsonResponse({ error: 'A valid qq (5-11 digits) is required' }, 400, cors);

    const incoming = Array.isArray(payload.plays) ? payload.plays.slice(0, MAX_PLAYS_PER_REQUEST) : [];
    const now = Date.now();
    const seen = new Set();
    const rows = [];
    incoming.forEach((play) => {
        if (!play) return;
        const eventId = clip(play.eid, 64).trim();
        const trackId = clip(play.id, MAX_TRACK_ID_LENGTH).trim();
        // No event id means the client could not have logged it either — a row
        // that can never be deduplicated is worse than no row.
        if (!eventId || !trackId || seen.has(eventId)) return;
        seen.add(eventId);
        rows.push({
            eventId,
            trackId,
            trackName: clip(play.name, MAX_TRACK_NAME_LENGTH),
            playedAt: clampPlayedAt(play.at, now),
        });
    });

    if (rows.length === 0) return jsonResponse({ ok: true, received: 0, inserted: 0 }, 200, cors);

    try {
        await ensureSchema(env.PLAY_DB);
        const statement = env.PLAY_DB.prepare(
            `INSERT OR IGNORE INTO plays (event_id, qq, track_id, track_name, played_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        );
        const results = await env.PLAY_DB.batch(rows.map((row) => statement.bind(
            row.eventId, qq, row.trackId, row.trackName, row.playedAt, now,
        )));
        // `INSERT OR IGNORE` reports 0 changes for a row it already had, so the
        // count that comes back is "new events", which is what a retry needs to
        // see.
        const inserted = results.reduce((sum, result) => sum + (result.meta ? result.meta.changes || 0 : 0), 0);
        return jsonResponse({ ok: true, received: rows.length, inserted }, 200, cors);
    } catch (error) {
        return jsonResponse({ error: `Cannot write plays: ${error.message}` }, 502, cors);
    }
};

/* --- GET /stats ---------------------------------------------------------- */

const rankingRows = function (result) {
    return (result.results || []).map((row) => ({
        id: row.id,
        name: row.name || '',
        count: Number(row.playCount) || 0,
        lastAt: Number(row.lastAt) || 0,
    }));
};

/**
 * The visitor's own rankings: all time and the last `RECENT_DAYS` days.
 *
 * Both windows are the same query with a different `WHERE`, and both are
 * grouped by `track_id` — the ranking is per song, not per play. `track_name`
 * is taken as the newest non-empty one the client sent, because a library
 * refresh can rename a file and the row should follow the visitor's screen.
 *
 * There is no authentication, deliberately: the QQ number is the visitor's own
 * label for their avatar (see the note on `normalizeQq`), so this answers
 * "what has this number listened to", not "prove you are this number". Anyone
 * who knows a number can read its ranking — the same as anyone who knows it can
 * fetch its avatar.
 */
const handleStats = async function (env, url, cors) {
    if (!env.PLAY_DB) return jsonResponse({ error: 'PLAY_DB binding is missing' }, 500, cors);

    const qq = normalizeQq(url.searchParams.get('qq'));
    if (!qq) return jsonResponse({ error: 'A valid qq (5-11 digits) is required' }, 400, cors);

    const since = Date.now() - RECENT_WINDOW_MS;
    const ranking = `SELECT track_id AS id,
                            MAX(track_name) AS name,
                            COUNT(*) AS playCount,
                            MAX(played_at) AS lastAt
                     FROM plays
                     WHERE qq = ?1`;
    const rankingOrder = `GROUP BY track_id ORDER BY playCount DESC, lastAt DESC LIMIT ${RANKING_LIMIT}`;

    try {
        await ensureSchema(env.PLAY_DB);
        const [totals, all, recent, recentTotals] = await env.PLAY_DB.batch([
            env.PLAY_DB.prepare(
                `SELECT COUNT(*) AS plays, COUNT(DISTINCT track_id) AS tracks,
                        MIN(played_at) AS firstAt, MAX(played_at) AS lastAt
                 FROM plays WHERE qq = ?1`,
            ).bind(qq),
            env.PLAY_DB.prepare(`${ranking} ${rankingOrder}`).bind(qq),
            env.PLAY_DB.prepare(`${ranking} AND played_at >= ?2 ${rankingOrder}`).bind(qq, since),
            env.PLAY_DB.prepare(
                `SELECT COUNT(*) AS plays, COUNT(DISTINCT track_id) AS tracks
                 FROM plays WHERE qq = ?1 AND played_at >= ?2`,
            ).bind(qq, since),
        ]);

        const totalRow = (totals.results && totals.results[0]) || {};
        const recentRow = (recentTotals.results && recentTotals.results[0]) || {};
        return jsonResponse({
            qq,
            total: {
                plays: Number(totalRow.plays) || 0,
                tracks: Number(totalRow.tracks) || 0,
                firstAt: Number(totalRow.firstAt) || 0,
                lastAt: Number(totalRow.lastAt) || 0,
            },
            all: rankingRows(all),
            recent: {
                since,
                plays: Number(recentRow.plays) || 0,
                tracks: Number(recentRow.tracks) || 0,
                list: rankingRows(recent),
            },
            generatedAt: Date.now(),
        }, 200, cors);
    } catch (error) {
        return jsonResponse({ error: `Cannot read plays: ${error.message}` }, 502, cors);
    }
};

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const cors = corsHeaders(request, env);

        if (request.method === 'OPTIONS') return withHeaders(null, 204, cors);

        if (url.pathname === '/plays') {
            if (request.method !== 'POST') return jsonResponse({ error: 'Use POST /plays' }, 405, cors);
            const response = await handlePlays(request, env, cors);
            response.headers.set('Cache-Control', 'no-store');
            return response;
        }

        if (url.pathname === '/stats') {
            // GET only: the answer is a JSON body, and a HEAD here would have
            // to drop it while still running the query.
            if (request.method !== 'GET') {
                return jsonResponse({ error: 'Use GET /stats?qq=…' }, 405, cors);
            }
            const response = await handleStats(env, url, cors);
            // A ranking is per-visitor and changes on every play; an edge cache
            // here would serve one visitor's numbers to another.
            response.headers.set('Cache-Control', 'no-store');
            return response;
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return jsonResponse({ error: 'Method not allowed' }, 405, cors);
        }
        if (url.pathname !== '/tracks') {
            return jsonResponse({ error: 'Not found. Try /tracks, /plays or /stats' }, 404, cors);
        }
        if (!env.MUSIC_BUCKET) {
            return jsonResponse({ error: 'MUSIC_BUCKET binding is missing' }, 500, cors);
        }
        if (!env.R2_PUBLIC_BASE) {
            return jsonResponse({ error: 'R2_PUBLIC_BASE variable is missing' }, 500, cors);
        }

        const forceRefresh = url.searchParams.get('refresh') === '1';
        const cache = typeof caches !== 'undefined' ? caches.default : undefined;
        const cacheKey = new Request(`${url.origin}${CACHE_PATH}`, { method: 'GET' });

        if (cache && !forceRefresh) {
            const hit = await cache.match(cacheKey);
            if (hit) {
                const headers = new Headers(hit.headers);
                headers.set('X-Music-Cache', 'HIT');
                Object.keys(cors).forEach((name) => headers.set(name, cors[name]));
                return new Response(hit.body, { status: 200, headers });
            }
        }

        let index;
        try {
            index = await buildIndex(env);
        } catch (error) {
            return jsonResponse({ error: `Cannot list bucket: ${error.message}` }, 502, cors);
        }

        const payload = JSON.stringify(index);
        const body = request.method === 'HEAD' ? null : payload;
        const headers = {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
            'X-Music-Cache': 'MISS',
            ...cors,
        };

        if (cache && ctx && typeof ctx.waitUntil === 'function') {
            const cached = new Response(payload, {
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
                },
            });
            ctx.waitUntil(cache.put(cacheKey, cached));
        }

        return withHeaders(body, 200, headers);
    },
};
