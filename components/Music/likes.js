/**
 * 我喜欢 — the liked songs, stored per QQ number in the Worker's D1 database
 * and mirrored into this browser.
 *
 * ## Why there is a cache at all
 *
 * The list asks "is this song liked?" **once per row, on every render**, and it
 * asks it while painting a page that must also work offline (the audio cache is
 * the app's only offline capability, and it is deliberate). A network round trip
 * cannot be on that path, and neither can an await. So the liked set lives in
 * localStorage as a plain array of keys and is read synchronously — the list is
 * correct from the first paint, with or without a connection.
 *
 * ## The caching rules
 *
 * 1. **The server is the source of truth; the mirror is a cache.** Every
 *    successful `GET /likes` *replaces* the mirror. There is no TTL and there
 *    does not need to be one: a like never expires (the opposite of the audio
 *    cache's 30 days), so "replace with the truth" beats "expire after a while"
 *    — it is both simpler and more correct.
 * 2. **A failed fetch never wipes the mirror.** Same rule as the library list
 *    cache (`readListCache`): being offline means "keep showing what we had",
 *    not "you have no likes".
 * 3. **The mirror is keyed by QQ** (`music:likes:<qq>`). Switching numbers must
 *    never show the previous number's likes — the same reason the list cache is
 *    keyed per source.
 * 4. **Writes are optimistic and queued.** A tap updates the mirror at once (so
 *    the heart lights up now) and records the *desired state* in an outbox.
 *    The request is fire-and-forget; anything unacknowledged stays queued and is
 *    re-sent later, by hand or on the next tap. Only acknowledged entries are
 *    removed from the outbox.
 * 5. **What the UI shows is mirror ⊕ outbox** (`readLikedKeys`). An entry still
 *    in the outbox has not been confirmed, so it beats whatever the mirror says
 *    — otherwise a `GET /likes` landing in between a tap and its confirmation
 *    would undo the tap on screen.
 *
 * The outbox is a **map of track id → desired state**, not a log of taps. That
 * is what makes it safe to collapse an entire offline session into one request:
 * liking and unliking the same song three times is one entry saying "liked",
 * and the server's `INSERT OR IGNORE` / `DELETE` converge on it however many
 * times the batch arrives. (The play log next door *is* a log, because a play is
 * an event that happened — this is a state, and states overwrite.)
 */

import { music } from 'config';

import { normalizeQq, readKeyList, storageGet, storageSet } from './shared';
import { CLOUD_SOURCE } from './librarySource';

// One mirror per QQ number, as `[{ id, name, at }]`.
const MIRROR_PREFIX = 'music:likes:';
// The outbox, as `{ [qq]: { [trackId]: { liked, name } } }`.
const PENDING_KEY = 'music:likesPending';
// The old (pre-D1) shape: a flat list of `<source>:<id>` keys, one visitor, this
// browser only. Read once to carry those likes into the database, then dropped —
// see `migrateLegacyLikes`.
const LEGACY_KEY = 'music:setting:liked';

const REQUEST_TIMEOUT_MS = 10000;
// Must match `MAX_LIKES_PER_REQUEST` in the Worker — a batch the server trims
// would come back 200 and then be deleted here, losing the rest silently.
const BATCH_SIZE = 500;

const workerBase = function () {
    return String(music.workerUrl || '').replace(/\/+$/, '');
};

/**
 * The list key for a stored track id.
 *
 * A like is a feature of the public library only (`toggleLike` refuses a Drive
 * track), so the source is always `cloud` and this is a constant rather than a
 * guess. It is built through the same prefix `audioCacheKey` uses so the two
 * cannot drift — the list's own key shape stays decided in one place.
 */
export const likeKeyOf = function (id) {
    return `${CLOUD_SOURCE}:${id}`;
};

const readMirror = function (qq) {
    const digits = normalizeQq(qq);
    if (!digits) return [];
    let parsed;
    try { parsed = JSON.parse(storageGet(MIRROR_PREFIX + digits)); } catch (err) { parsed = null; }
    if (!Array.isArray(parsed)) return [];
    return parsed
        .filter((entry) => entry && typeof entry.id === 'string' && entry.id)
        .map((entry) => ({
            id: entry.id,
            name: String(entry.name || ''),
            at: Number(entry.at) || 0,
        }));
};

const writeMirror = function (qq, entries) {
    const digits = normalizeQq(qq);
    if (!digits) return;
    try { storageSet(MIRROR_PREFIX + digits, JSON.stringify(entries)); } catch (err) { /* private mode / quota */ }
};

/**
 * The liked keys for a number — **what the UI should show**, which is the mirror
 * with anything still queued applied on top.
 *
 * Synchronous on purpose — this is what the list reads. Returns `[]` for "not
 * bound", which is also the honest answer: no number, no likes.
 *
 * The outbox *wins* over the mirror, and that is the whole reason this is not a
 * bare `readMirror(...).map(...)`: a tap updates the mirror and the outbox at
 * once, but the request that would confirm it is in flight, and a `GET /likes`
 * that happens to land in between would otherwise replace the mirror with an
 * answer that predates the tap — the heart would flip back on screen, and then
 * flip forward again when the queue flushed. An unconfirmed decision is still
 * the visitor's decision; the server catches up to it, not the other way round.
 */
export const readLikedKeys = function (qq) {
    const digits = normalizeQq(qq);
    if (!digits) return [];
    const keys = new Set(readMirror(digits).map((entry) => likeKeyOf(entry.id)));
    const queued = readOutbox()[digits];
    if (queued) {
        Object.keys(queued).forEach((id) => {
            if (queued[id].liked) keys.add(likeKeyOf(id));
            else keys.delete(likeKeyOf(id));
        });
    }
    return Array.from(keys);
};

/**
 * Fetches the number's likes, replaces the mirror, and returns the keys to show.
 *
 * Throws on failure and leaves the mirror alone — the caller keeps whatever it
 * already had on screen.
 *
 * The return value goes through `readLikedKeys` rather than straight from the
 * response, so a change the visitor made while this request was in flight is not
 * quietly undone by it (see that function's note).
 */
export const refreshLikes = async function (qq) {
    const digits = normalizeQq(qq);
    if (!digits) return [];
    const base = workerBase();
    if (!base) throw new Error('未配置曲库 Worker 地址');

    const response = await fetch(`${base}/likes?qq=${encodeURIComponent(digits)}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    const entries = (Array.isArray(data.likes) ? data.likes : [])
        .map((row) => ({ id: String(row.id || ''), name: String(row.name || ''), at: Number(row.at) || 0 }))
        .filter((row) => row.id);
    writeMirror(digits, entries);
    return readLikedKeys(digits);
};

/* --- the outbox ---------------------------------------------------------- */

const readOutbox = function () {
    let parsed;
    try { parsed = JSON.parse(storageGet(PENDING_KEY)); } catch (err) { parsed = null; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    Object.keys(parsed).forEach((qq) => {
        if (!normalizeQq(qq)) return;
        const entries = parsed[qq];
        if (!entries || typeof entries !== 'object') return;
        const kept = {};
        Object.keys(entries).forEach((id) => {
            const entry = entries[id];
            if (!id || !entry || typeof entry.liked !== 'boolean') return;
            kept[id] = { liked: entry.liked, name: String(entry.name || '') };
        });
        if (Object.keys(kept).length > 0) out[qq] = kept;
    });
    return out;
};

const writeOutbox = function (outbox) {
    try { storageSet(PENDING_KEY, JSON.stringify(outbox)); } catch (err) { /* see writeMirror */ }
};

/** How many like changes are waiting to reach the database, across all numbers. */
export const pendingLikeCount = function () {
    const outbox = readOutbox();
    return Object.keys(outbox).reduce((sum, qq) => sum + Object.keys(outbox[qq]).length, 0);
};

/**
 * Records a like / unlike: mirror first (the UI is already showing it), outbox
 * second (so it survives a reload), request last (fire and forget).
 *
 * Nothing here awaits anything. The caller is a tap handler, and the tap has
 * already been answered by the optimistic mirror update.
 */
export const applyLikeChange = function (qq, track, liked) {
    const digits = normalizeQq(qq);
    if (!digits || !track || !track.id) return;
    const id = String(track.id);
    const name = String(track.name || '');

    const entries = readMirror(digits).filter((entry) => entry.id !== id);
    if (liked) entries.unshift({ id, name, at: Date.now() });
    writeMirror(digits, entries);

    const outbox = readOutbox();
    const forQq = outbox[digits] || {};
    forQq[id] = { liked, name };
    outbox[digits] = forQq;
    writeOutbox(outbox);

    flushLikes().catch(() => { });
};

/* --- flushing ------------------------------------------------------------ */

/**
 * Sends every queued change and clears exactly what the server acknowledged.
 *
 * **Never throws** (see `flushPending` in `playStats.js` for the same shape):
 * callers are a background flush with nowhere to report, or a settings row
 * whose feedback is "N 条没成功，还留在本机".
 *
 * An entry is cleared only if its desired state is *still* the one that was
 * sent — the visitor may have tapped the same song again while the request was
 * in flight, and that newer decision has to survive.
 */
export const flushLikes = async function () {
    const outbox = readOutbox();
    const groups = Object.keys(outbox);
    if (groups.length === 0) return { sent: 0, remaining: 0, error: null };

    const base = workerBase();
    let sent = 0;
    let error = null;

    for (const qq of groups) {
        const entries = Object.keys(outbox[qq]).map((id) => ({ id, ...outbox[qq][id] }));
        for (let index = 0; index < entries.length; index += BATCH_SIZE) {
            const chunk = entries.slice(index, index + BATCH_SIZE);
            const adds = chunk.filter((entry) => entry.liked);
            const removes = chunk.filter((entry) => !entry.liked);
            try {
                if (!base) throw new Error('未配置曲库 Worker 地址');
                const response = await fetch(`${base}/likes`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        qq,
                        add: adds.map((entry) => ({ id: entry.id, name: entry.name })),
                        remove: removes.map((entry) => entry.id),
                    }),
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                    keepalive: true,
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                // Re-read: a tap during the request must not be cleared by it.
                const current = readOutbox();
                const forQq = current[qq] || {};
                chunk.forEach((entry) => {
                    const now = forQq[entry.id];
                    if (now && now.liked === entry.liked) delete forQq[entry.id];
                });
                if (Object.keys(forQq).length > 0) current[qq] = forQq;
                else delete current[qq];
                writeOutbox(current);
                sent += chunk.length;
            } catch (err) {
                if (!error) error = err;
                // The rest of this number's queue would be the same request
                // failing again; nothing is lost by stopping.
                break;
            }
        }
    }

    return { sent, remaining: pendingLikeCount(), error };
};

/**
 * Carries the pre-D1 likes (one flat local list, no number attached) into the
 * database the first time a number is bound.
 *
 * Those likes were real taps, and dropping them would read as "the update ate
 * my likes". They go through the outbox like any other change, so this works
 * offline too. The old key is removed either way — a second run must not
 * re-queue them.
 *
 * The ids in that list are `<source>:<id>` keys, so the source prefix comes off
 * here; only `cloud:` ones are kept, for the same reason `toggleLike` refuses a
 * Drive track.
 */
export const migrateLegacyLikes = function (qq) {
    const digits = normalizeQq(qq);
    if (!digits) return 0;
    const legacy = readKeyList(LEGACY_KEY);
    if (legacy.length === 0) return 0;

    const prefix = `${CLOUD_SOURCE}:`;
    const outbox = readOutbox();
    const forQq = outbox[digits] || {};
    let migrated = 0;
    legacy.forEach((key) => {
        if (!key.startsWith(prefix)) return;
        const id = key.slice(prefix.length);
        if (!id) return;
        // An entry the visitor has already decided about wins: it is newer.
        if (forQq[id]) return;
        forQq[id] = { liked: true, name: '' };
        migrated += 1;
    });
    outbox[digits] = forQq;
    writeOutbox(outbox);

    // The mirror gets them too, so they show up before the first fetch answers.
    const entries = readMirror(digits);
    const known = new Set(entries.map((entry) => entry.id));
    legacy.forEach((key) => {
        if (!key.startsWith(prefix)) return;
        const id = key.slice(prefix.length);
        if (!id || known.has(id)) return;
        entries.push({ id, name: '', at: 0 });
    });
    writeMirror(digits, entries);

    try { storageSet(LEGACY_KEY, ''); } catch (err) { /* see writeMirror */ }
    return migrated;
};
