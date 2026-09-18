/**
 * Tiny IndexedDB helper used by the 7-day audio cache (`shared.js`) and the
 * cache manager (`CacheManager.js`).
 *
 * Every function degrades gracefully: when IndexedDB is unavailable (private
 * mode, old WebView, quota exhausted) reads resolve to "nothing cached" and
 * writes resolve quietly instead of throwing, so playback keeps working from
 * the network and the UI never breaks because of the cache.
 */

const DB_NAME = 'music-space';
const DB_VERSION = 1;
const AUDIO_STORE_NAME = 'audio';

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
            if (!db.objectStoreNames.contains(AUDIO_STORE_NAME)) {
                db.createObjectStore(AUDIO_STORE_NAME, { keyPath: 'key' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

/** Runs `work` inside a transaction and resolves with its request result. */
const withStore = async function (mode, work) {
    const db = await openDatabase();
    try {
        return await new Promise((resolve, reject) => {
            const transaction = db.transaction(AUDIO_STORE_NAME, mode);
            const store = transaction.objectStore(AUDIO_STORE_NAME);
            let result;
            const request = work(store);
            if (request) request.onsuccess = () => { result = request.result; };
            transaction.oncomplete = () => resolve(result);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
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

/** Deletes several keys in one transaction (used by "全部删除"). */
export const deleteEntries = async function (keys) {
    const list = (keys || []).filter(Boolean);
    if (!list.length) return true;
    try {
        await withStore('readwrite', (store) => {
            list.forEach((key) => store.delete(key));
            return null;
        });
        return true;
    } catch (err) {
        return false;
    }
};

export { AUDIO_STORE_NAME, DB_NAME };
