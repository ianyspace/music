/**
 * Audio blob cache — the 7-day offline store behind "缓存管理".
 *
 * Downloaded audio is kept in IndexedDB (`lib/cache/indexedDb.js`) rather than
 * in memory, so a track plays back with no network and no Google token, and it
 * still survives a page reload on iOS where an HTTP cache would not.
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

export const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

/** Reads a cached blob, dropping the record when it has expired. */
export const getCachedAudio = async function (id) {
    const record = await readEntry(id);
    if (!record || !record.blob) return null;
    if (Number(record.expiresAt) <= Date.now()) {
        await deleteStoredEntry(id);
        return null;
    }
    return record.blob;
};

export const cacheAudio = async function (id, blob) {
    if (!blob) return false;
    return writeEntry({ id, blob, expiresAt: Date.now() + CACHE_TTL });
};

export const deleteCachedAudio = async function (id) {
    return deleteStoredEntry(id);
};

/** Drops every expired record. Called once on mount. */
export const pruneCachedAudio = async function () {
    const entries = await readAllEntries();
    const expired = entries
        .filter((entry) => Number(entry.expiresAt) <= Date.now())
        .map((entry) => entry.id);
    if (expired.length) await deleteStoredEntries(expired);
    return expired.length;
};

// Every cached entry with its metadata, expired ones included — the cache
// manager lists what is actually stored, so a still-listed-but-expired blob is
// shown (and can be cleared) rather than hidden. The blob itself is left out of
// the result so a large library never gets copied into JS memory just to be
// rendered.
export const listCachedAudio = async function () {
    const entries = await readAllEntries();
    return entries.map(({ id, blob, expiresAt }) => ({
        id,
        size: blob ? blob.size : 0,
        expiresAt: Number(expiresAt) || 0,
    }));
};

// Clears records by key, or the whole store when called with no keys — the
// cache manager's "全部删除".
export const deleteCachedAudioMany = async function (keys) {
    return deleteStoredEntries(keys);
};
