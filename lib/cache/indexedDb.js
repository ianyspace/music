/**
 * Tiny IndexedDB helper used by the audio cache (`audioCache.js`) and the
 * cache manager (`CacheManager.js`).
 *
 * Every function degrades gracefully: when IndexedDB is unavailable (private
 * mode, old WebView, quota exhausted) reads resolve to "nothing cached" and
 * writes resolve quietly instead of throwing, so playback keeps working from
 * the network and the UI never breaks because of the cache.
 */

const DB_NAME = 'music-space';
// v1 shipped with `keyPath: 'key'`, which no record ever carried — so the store
// accepted nothing and every write failed silently. v2 recreates it with the
// correct key. The bump matters: an existing visitor already has the broken v1
// store on disk, and `createObjectStore` is a no-op once the name exists, so
// without it the fix would never reach them.
const DB_VERSION = 2;
const AUDIO_STORE_NAME = 'audio';
// The primary key is `id` (`<source>:<track id>`), and it must match what
// `audioCache.js` puts into every record — a `keyPath` that the stored object
// does not carry makes `put()` throw `DataError` and, because this layer is
// best-effort, the failure is silent: nothing is ever cached and the cache
// list stays empty. Keep this in lockstep with `writeEntry`'s payload.
const AUDIO_KEY_PATH = 'id';

// "全部缓存" downloads a handful of tracks at once; each one opens its own
// short-lived transaction, so this module deliberately keeps no shared handle.
const openDatabase = function () {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB unavailable'));
            return;
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            const upgrade = request.transaction;
            const existing = db.objectStoreNames.contains(AUDIO_STORE_NAME)
                ? upgrade.objectStore(AUDIO_STORE_NAME)
                : null;
            // Nothing could ever have been stored under the wrong keyPath, so
            // dropping the broken store loses no audio. Recreate it with the
            // right key instead of trying to migrate rows that do not exist.
            if (existing && existing.keyPath !== AUDIO_KEY_PATH) {
                db.deleteObjectStore(AUDIO_STORE_NAME);
            }
            if (!db.objectStoreNames.contains(AUDIO_STORE_NAME)) {
                db.createObjectStore(AUDIO_STORE_NAME, { keyPath: AUDIO_KEY_PATH });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

/**
 * Runs `work` inside a transaction and resolves with its request result.
 *
 * Two things here are deliberate rather than incidental:
 *
 * - The result is read in the request's own `onsuccess`, then the promise is
 *   settled on `oncomplete`. A transaction can still abort *after* a request
 *   succeeded (quota exhaustion is the usual way), so resolving on success
 *   would report a write that never committed.
 * - `work(store)` is called inside `try`, because `put()` throws synchronously
 *   on a payload that does not match the store's `keyPath`. Left unguarded the
 *   throw escapes the executor and the transaction is never handed back.
 */
const withStore = async function (mode, work) {
    const db = await openDatabase();
    try {
        return await new Promise((resolve, reject) => {
            const transaction = db.transaction(AUDIO_STORE_NAME, mode);
            const store = transaction.objectStore(AUDIO_STORE_NAME);
            let result;
            let request = null;
            try {
                request = work(store);
            } catch (err) {
                reject(err);
                return;
            }
            if (request) request.onsuccess = () => { result = request.result; };
            transaction.oncomplete = () => resolve(result);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('transaction aborted'));
        });
    } finally {
        if (db && typeof db.close === 'function') db.close();
    }
};

export const readEntry = async function (key) {
    try {
        return (await withStore('readonly', (store) => store.get(key))) || null;
    } catch (err) {
        return null;
    }
};

export const readAllEntries = async function () {
    try {
        const rows = await withStore('readonly', (store) => store.getAll());
        return Array.isArray(rows) ? rows : [];
    } catch (err) {
        return [];
    }
};

export const writeEntry = async function (entry) {
    try {
        await withStore('readwrite', (store) => store.put(entry));
        return true;
    } catch (err) {
        return false;
    }
};

export const deleteEntry = async function (key) {
    try {
        await withStore('readwrite', (store) => store.delete(key));
        return true;
    } catch (err) {
        return false;
    }
};

/**
 * Deletes several keys in one transaction (used by "全部删除").
 *
 * An empty list means "clear the store", not "do nothing" — the cache
 * manager's 全部删除 calls it with `[]`, and short-circuiting there made the
 * button silently no-op. Callers that genuinely want a no-op should simply
 * not call it.
 */
export const deleteEntries = async function (keys) {
    const list = (keys || []).filter(Boolean);
    try {
        await withStore('readwrite', (store) => {
            if (!list.length) return store.clear();
            list.forEach((key) => store.delete(key));
            return null;
        });
        return true;
    } catch (err) {
        return false;
    }
};

export { AUDIO_STORE_NAME, DB_NAME };
