/**
 * Audio blob cache — the offline store behind "缓存管理".
 *
 * Downloaded audio is kept in IndexedDB (`lib/cache/indexedDb.js`) rather than
 * in memory, so a track plays back with no network and no Google token, and it
 * still survives a page reload on iOS where an HTTP cache would not.
 *
 * Every cached entry carries an `expiresAt` timestamp. A song that has not been
 * played for 30 days is considered stale and is dropped on the next read, which
 * keeps the store from growing forever while still letting favourites stay
 * offline indefinitely — every play resets the clock.
 *
 * Records are keyed per library (`<source>:<track id>`), so an R2 object and a
 * Drive file with the same name never collide and a Drive entry never surfaces
 * after disconnecting.
 *
 * Every function is best effort: when IndexedDB is unavailable or the quota is
 * exhausted, playback keeps working from the network and the UI stays usable.
 */

import {
    deleteEntries as deleteStoredEntries,
    deleteEntry as deleteStoredEntry,
    readAllEntries,
    readEntry,
    writeEntry,
} from 'lib/cache/indexedDb';

/** How long a cached track stays alive without being played, in milliseconds. */
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Sentinel stored in `expiresAt` for "no expiry" (legacy rows). */
export const NEVER_EXPIRES = 0;

/**
 * Whether a stored row is past its expiry.
 *
 * Legacy rows that carry `NEVER_EXPIRES` are treated as "no expiry" and are
 * left alone — they were written when the app did not have TTL, and forcing
 * an expiry on them now would silently drop audio the visitor expected to keep.
 */
const isExpired = function (expiresAt) {
    const expiry = Number(expiresAt) || NEVER_EXPIRES;
    return expiry !== NEVER_EXPIRES && expiry <= Date.now();
};

/**
 * Reads a cached blob and refreshes its expiry on every hit.
 *
 * A play is the signal that the visitor still cares about the song, so the
 * clock resets to 30 days from now. An expired row is dropped rather than
 * served, so stale audio never surprises the visitor with a network fetch
 * mid-playback.
 */
export const getCachedAudio = async function (id) {
    const record = await readEntry(id);
    if (!record || !record.blob) return null;
    if (isExpired(record.expiresAt)) {
        await deleteStoredEntry(id);
        return null;
    }
    // Refresh the expiry — this is a "touch" that costs one small write but
    // keeps the song alive as long as it is being played.
    const refreshed = Date.now() + CACHE_TTL_MS;
    if (record.expiresAt !== refreshed) {
        await writeEntry({ ...record, expiresAt: refreshed });
    }
    return record.blob;
};

export const cacheAudio = async function (id, blob) {
    if (!blob) return false;
    return writeEntry({ id, blob, expiresAt: Date.now() + CACHE_TTL_MS, savedAt: Date.now() });
};

export const deleteCachedAudio = async function (id) {
    return deleteStoredEntry(id);
};

// Every cached entry with its metadata. The blob itself is left out of the
// result so a large library never gets copied into JS memory just to be
// rendered.
export const listCachedAudio = async function () {
    const entries = await readAllEntries();
    return entries.map(({ id, blob, expiresAt, savedAt }) => ({
        id,
        size: blob ? blob.size : 0,
        expiresAt: Number(expiresAt) || NEVER_EXPIRES,
        savedAt: Number(savedAt) || 0,
    }));
};

// Clears records by key, or the whole store when called with no keys — the
// cache manager's "全部删除".
export const deleteCachedAudioMany = async function (keys) {
    return deleteStoredEntries(keys);
};
