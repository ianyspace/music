/**
 * Play counts — the one part of this app that leaves the visitor's browser.
 *
 * Everything else here is local on purpose (the audio cache, the likes, the
 * pinned order, the QQ number). Play counts are the exception: they are the
 * only feature that is *about* the visitor across devices, so they have to be
 * stored somewhere that is not this browser — a Cloudflare D1 database, written
 * and read by the Worker in `cloudflare-worker/` (`POST /plays`, `GET /stats`).
 *
 * Three rules shape everything below:
 *
 * 1. **It must never block playback.** The caller is an `<audio>` event; the
 *    listener is waiting for music. So `recordPlay` writes one small row to
 *    localStorage and fires a request nobody awaits — a slow or dead network
 *    costs the visitor nothing at all.
 * 2. **A failed report must not lose the play.** Every event is written to a
 *    local log *first* and only removed once the server has acknowledged it, so
 *    being offline (or the Worker being down) degrades to "synced later"
 *    instead of "not counted".
 * 3. **A retry must not count twice.** Each event carries its own `eid`, which
 *    is the database's primary key, and the server inserts with `OR IGNORE`.
 *    That is what makes re-sending a batch — after a lost response, from two
 *    tabs at once, from a manual 同步 — safe.
 *
 * The log is keyed per event and carries the QQ number it belongs to, so a
 * visitor who changes numbers still sends the old number's plays to the old
 * number.
 */

import { music } from 'config';

import { normalizeQq, storageGet, storageSet } from './shared';

// The pending log, as a JSON array of `{ eid, qq, id, name, at }`.
//
// localStorage rather than IndexedDB: these are a few dozen bytes per entry and
// they are read on the playback path, where a transaction (however fast) is
// still a promise to await. The audio cache went the other way for exactly the
// opposite reason — megabytes of blob.
//
// Nothing outside this module reads the key: the log is an implementation
// detail of `recordPlay` / `flushPending`, and the page only ever asks how many
// entries are in it.
const PLAY_LOG_KEY = 'music:playLog';

// Ceiling on the pending log. localStorage is a few megabytes and a *failed*
// sync is the only way this array grows, so it is normally 0–2 entries; the cap
// exists so a device that has been offline for months cannot fill the quota and
// take the whole app's storage down with it. Oldest entries go first.
const PENDING_LIMIT = 1000;

// Short on purpose: the caller retries anyway (automatically on the next play,
// or by hand from 账号), so a hanging request should give up and let the record
// stay local rather than hold a connection open.
const REQUEST_TIMEOUT_MS = 10000;

// Must match `MAX_PLAYS_PER_REQUEST` in the Worker. The server answers 200 with
// however many rows it took, so sending more than it accepts would leave the
// extra plays marked acknowledged and then delete them — a silent loss. Chunking
// here is what keeps "acknowledged" meaning "all of it".
const BATCH_SIZE = 200;

const workerBase = function () {
    return String(music.workerUrl || '').replace(/\/+$/, '');
};

/**
 * A unique id for one play event.
 *
 * Time-prefixed so the log sorts by when it happened even if two ids collide in
 * their random part, and short enough that 200 of them fit in one request body.
 * It is *not* a security token — it only has to be unique among one visitor's
 * own plays, because that is the only scope the server deduplicates within.
 */
const newEventId = function () {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const readPending = function () {
    let parsed;
    try { parsed = JSON.parse(storageGet(PLAY_LOG_KEY)); } catch (err) { parsed = null; }
    if (!Array.isArray(parsed)) return [];
    // Anything half-written is dropped rather than sent: the server would
    // reject it anyway, and a bad row would block the log forever (it can never
    // be acknowledged, so it never leaves).
    return parsed.filter((entry) => (
        entry
        && typeof entry.eid === 'string' && entry.eid
        && typeof entry.id === 'string' && entry.id
        && normalizeQq(entry.qq)
        && Number.isFinite(Number(entry.at))
    ));
};

// Best-effort, like everything on the audio cache: a browser in private mode
// (or one whose quota is full) simply keeps no log, and the app carries on
// recording nothing rather than failing the play.
const writePending = function (entries) {
    try { storageSet(PLAY_LOG_KEY, JSON.stringify(entries)); } catch (err) { /* see above */ }
};

const appendPending = function (entry) {
    const next = readPending().concat(entry);
    writePending(next.length > PENDING_LIMIT ? next.slice(next.length - PENDING_LIMIT) : next);
};

/**
 * How many plays are still waiting to reach the database.
 *
 * Reads the whole log to filter it (see `readPending`), which is fine at this
 * size and is the only way a half-written entry is not counted.
 */
export const pendingCount = function () {
    return readPending().length;
};

const reportPlays = async function (qq, entries) {
    const base = workerBase();
    if (!base) throw new Error('未配置曲库 Worker 地址');
    const response = await fetch(`${base}/plays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            qq,
            plays: entries.map((entry) => ({
                eid: entry.eid,
                id: entry.id,
                name: entry.name,
                at: entry.at,
            })),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        // The request must survive the page being closed right after a song
        // starts — the common case is a phone that gets locked mid-song.
        keepalive: true,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
};

/**
 * Sends everything in the local log and removes exactly what was acknowledged.
 *
 * Grouped by QQ (in practice one group — a visitor has one number at a time),
 * and sequential rather than parallel: the point of this function is to be
 * quiet, not fast.
 *
 * **Never throws.** Every caller is either a background flush that has nowhere
 * to report to, or a button whose feedback is "N 条没成功，还留在本机" — so the
 * outcome is returned as data. What is left in the log after a partial failure
 * is precisely the part the server did not confirm, which is the same rule the
 * single-group case follows.
 */
export const flushPending = async function () {
    const pending = readPending();
    if (pending.length === 0) return { sent: 0, remaining: 0, error: null };

    const groups = new Map();
    pending.forEach((entry) => {
        if (!groups.has(entry.qq)) groups.set(entry.qq, []);
        groups.get(entry.qq).push(entry);
    });

    const acknowledged = new Set();
    let sent = 0;
    let error = null;
    for (const group of groups.values()) {
        // `BATCH_SIZE` at a time: see the note on the constant — one oversized
        // request would be trimmed by the server and then deleted here.
        for (let index = 0; index < group.length; index += BATCH_SIZE) {
            const chunk = group.slice(index, index + BATCH_SIZE);
            try {
                await reportPlays(group[0].qq, chunk);
                chunk.forEach((entry) => acknowledged.add(entry.eid));
                sent += chunk.length;
            } catch (err) {
                if (!error) error = err;
                // The rest of this number's log would be the same request
                // failing again (a dead network, a Worker that is down), and
                // nothing is lost by stopping — it all stays in the log.
                break;
            }
        }
    }

    // Re-read rather than reusing `pending`: a song may have started while the
    // requests were in flight, and that play must survive the rewrite.
    const remaining = readPending().filter((entry) => !acknowledged.has(entry.eid));
    writePending(remaining);
    return { sent, remaining: remaining.length, error };
};

/**
 * Records one play of one track.
 *
 * Called from the player's `play` event — i.e. from inside the listener's
 * browser, on the way to them hearing a song. Nothing here awaits anything: the
 * localStorage write is a few hundred bytes, and the network call is started
 * and dropped. A failure leaves the entry in the log (that is what the log is
 * for) and is otherwise invisible; there is deliberately no toast, because a
 * missed count is not something to interrupt listening for.
 *
 * A track with no bound QQ number is not recorded at all: the ranking is *per
 * QQ*, and a play with nobody to attribute it to would be a row that can never
 * appear in anyone's ranking.
 */
export const recordPlay = function (qq, track) {
    const digits = normalizeQq(qq);
    if (!digits || !track || !track.id) return;
    appendPending({
        eid: newEventId(),
        qq: digits,
        id: String(track.id),
        name: String(track.name || ''),
        at: Date.now(),
    });
    // Fire and forget. `flushPending` reports failures as data and never
    // rejects, but it is still not awaited and still gets a catch: a synchronous
    // throw here would land inside the audio element's event handler.
    flushPending().catch(() => { });
};

/**
 * The visitor's own rankings, straight from the Worker.
 *
 * Shape: `{ total, all, recent }` with `all` / `recent.list` being
 * `[{ id, name, count, lastAt }]`, already ordered by play count. Rows with no
 * name (an old event from a library that has since been renamed) are kept — the
 * count is still the visitor's, and dropping them would make the totals on the
 * card disagree with the list under it.
 */
export const fetchPlayStats = async function (qq) {
    const digits = normalizeQq(qq);
    if (!digits) throw new Error('还没有绑定 QQ 号');
    const base = workerBase();
    if (!base) throw new Error('未配置曲库 Worker 地址');

    const response = await fetch(`${base}/stats?qq=${encodeURIComponent(digits)}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    const list = function (rows) {
        return (Array.isArray(rows) ? rows : []).map((row) => ({
            id: String(row.id || ''),
            name: String(row.name || ''),
            count: Number(row.count) || 0,
            lastAt: Number(row.lastAt) || 0,
        })).filter((row) => row.id);
    };
    const total = data.total || {};
    const recent = data.recent || {};

    return {
        total: {
            plays: Number(total.plays) || 0,
            tracks: Number(total.tracks) || 0,
            firstAt: Number(total.firstAt) || 0,
            lastAt: Number(total.lastAt) || 0,
        },
        all: list(data.all),
        recent: {
            since: Number(recent.since) || 0,
            plays: Number(recent.plays) || 0,
            tracks: Number(recent.tracks) || 0,
            list: list(recent.list),
        },
    };
};

/**
 * "3 分钟前" / "2 天前" / a date, for the last-played column of the ranking.
 *
 * Coarse on purpose — the exact second a song was played is never the question;
 * "is this still something I listen to" is. Beyond a week it becomes a date,
 * because "23 天前" is arithmetic the reader has to do themselves.
 */
export const formatAgo = function (stamp) {
    const at = Number(stamp);
    if (!Number.isFinite(at) || at <= 0) return '';
    const elapsed = Date.now() - at;
    if (elapsed < 60 * 1000) return '刚刚';
    const minutes = Math.floor(elapsed / (60 * 1000));
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days === 1) return '昨天';
    if (days < 7) return `${days} 天前`;
    const date = new Date(at);
    return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
};
