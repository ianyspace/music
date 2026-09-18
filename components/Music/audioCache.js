/**
 * Audio blob cache — the permanent offline store behind "缓存管理".
 *
 * Downloaded audio is kept in IndexedDB (`lib/cache/indexedDb.js`) rather than
 * in memory, so a track plays back with no network and no Google token, and it
 * still survives a page reload on iOS where an HTTP cache would not.
 *
 * Stored audio never expires on its own: `expiresAt: NEVER_EXPIRES` means "keep
 * forever", and the only way a record leaves is an explicit delete from the
 * cache manager. That is deliberate — the point of the app is to work offline
 * like a native player, and a track that silently aged out would come back as
 * a network-only song the user never asked for.
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

/** Sentinel stored in `expiresAt` for "no expiry". */
export const NEVER_EXPIRES = 0;

/**
 * Whether a stored row is past its expiry. Rows written before the store became
 * permanent still carry a real timestamp, so they are still honoured instead of
 * being served forever by accident.
 */
const isExpired = function (expiresAt) {
    const expiry = Number(expiresAt) || NEVER_EXPIRES;
    return expiry !== NEVER_EXPIRES && expiry <= Date.now();
};

/** Reads a cached blob. Legacy expiring rows are dropped once they are past. */
export const getCachedAudio = async function (id) {
    const record = await readEntry(id);
    if (!record || !record.blob) return null;
    if (isExpired(record.expiresAt)) {
        await deleteStoredEntry(id);
        return null;
    }
    return record.blob;
};

export const cacheAudio = async function (id, blob) {
    if (!blob) return false;
    return writeEntry({ id, blob, expiresAt: NEVER_EXPIRES, savedAt: Date.now() });
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
