/**
 * Audio blob cache — the offline store behind "缓存管理".
 *
 * Downloaded audio is kept in IndexedDB (`lib/cache/indexedDb.js`) rather than
 * in memory, so a track plays back with no network and no Google token, and it
 * still survives a page reload on iOS where an HTTP cache would not.
 *
 * ## Expiry, and why the stamp is not in the record
 *
 * A cached song that has not been played for 30 days is dropped. The
 * "last played" stamp lives in localStorage (`CACHE_PLAYED_KEY`), *not* inside
 * the stored record, and that separation is the whole design:
 *
 * - Refreshing a stamp that sits in the record means rewriting the audio blob.
 *   IndexedDB serialises a `readwrite` transaction against every other
 *   transaction on the same store, so one multi-megabyte rewrite blocks the
 *   *next* song's cache read until the write finishes. On a phone that is the
 *   difference between the next song starting and never loading at all — the
 *   symptom being "the song is cached, so why does tapping it do nothing?".
 * - A stamp is a few bytes. The blob is megabytes. Keeping them in the same
 *   row is what forces the expensive write in the first place.
 *
 * So the read path is pure: `getCachedAudio` returns whatever is stored, with
 * no expiry test and no write of any kind. Expiry is enforced by
 * `pruneExpiredAudio`, a sweep that runs at app start and only ever deletes.
 * Nothing about the TTL can therefore slow down or fail a play.
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
    readAllKeys,
    readEntry,
    writeEntry,
} from 'lib/cache/indexedDb';

import { CACHE_PLAYED_KEY, storageGet, storageSet } from './shared';

/** How long a cached track stays alive without being played, in milliseconds. */
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Sentinel for "nothing dates this record", so it is never treated as stale. */
export const NEVER_EXPIRES = 0;

/* --- last-played stamps -------------------------------------------------- */

/**
 * Reads the stamp map.
 *
 * Anything that is not a plain object of positive finite numbers reads as
 * empty — a half-written value must degrade to "no stamps", which keeps every
 * record alive, rather than to "everything is stale", which would delete the
 * visitor's whole cache.
 */
const readPlayed = function () {
    let parsed;
    try { parsed = JSON.parse(storageGet(CACHE_PLAYED_KEY)); } catch (err) { parsed = null; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const stamps = {};
    Object.keys(parsed).forEach((key) => {
        const stamp = Number(parsed[key]);
        if (Number.isFinite(stamp) && stamp > 0) stamps[key] = stamp;
    });
    return stamps;
};

const writePlayed = function (stamps) {
    storageSet(CACHE_PLAYED_KEY, JSON.stringify(stamps || {}));
};

/**
 * When a cached key expires: its last play plus the TTL, falling back to when
 * it was saved. A record nothing dates reports `NEVER_EXPIRES` — "we do not
 * know when this was played" is not evidence that it is old.
 */
export const expiryOf = function (key, savedAt, stamps) {
    const played = Number((stamps || {})[key]) || 0;
    const stamp = played || Number(savedAt) || 0;
    return stamp ? stamp + CACHE_TTL_MS : NEVER_EXPIRES;
};

/** Whether a last-played stamp is old enough that its record should go. */
export const isStampExpired = function (stamp, now) {
    const played = Number(stamp) || 0;
    // A non-positive or unparseable stamp means "nothing dates this record",
    // which is never grounds for deleting it.
    if (played <= 0) return false;
    return played + CACHE_TTL_MS <= (Number(now) || Date.now());
};

/* --- reads and writes ---------------------------------------------------- */

/**
 * Reads a cached blob.
 *
 * Unconditional by design: if a blob is stored, it is served. Expiry must never
 * be able to turn a cached song into a network fetch at play time, and this
 * function must never write — see the note at the top of the file.
 */
export const getCachedAudio = async function (id) {
    const record = await readEntry(id);
    return record && record.blob ? record.blob : null;
};

export const cacheAudio = async function (id, blob) {
    if (!blob) return false;
    const now = Date.now();
    const stored = await writeEntry({ id, blob, savedAt: now });
    // Start the entry's 30 days now. Writing a stamp is a few bytes, so it can
    // sit on this path — unlike a blob rewrite, which cannot.
    const stamps = readPlayed();
    stamps[id] = now;
    writePlayed(stamps);
    return stored;
};

/**
 * Marks a cached track as played just now, which is what keeps it alive.
 *
 * Deliberately not "refresh the record's expiry": that would rewrite the blob
 * and block every other cache transaction. One number in localStorage instead.
 * Called after playback starts, so it is off the critical path either way.
 */
export const touchCachedAudio = async function (id) {
    if (!id) return;
    const stamps = readPlayed();
    stamps[id] = Date.now();
    writePlayed(stamps);
};

export const deleteCachedAudio = async function (id) {
    const stamps = readPlayed();
    if (Object.prototype.hasOwnProperty.call(stamps, id)) {
        delete stamps[id];
        writePlayed(stamps);
    }
    return deleteStoredEntry(id);
};

// Every cached entry with its metadata. The blob itself is left out of the
// result so a large library never gets copied into JS memory just to be
// rendered.
export const listCachedAudio = async function () {
    const entries = await readAllEntries();
    const stamps = readPlayed();
    return entries.map(({ id, blob, savedAt }) => ({
        id,
        size: blob ? blob.size : 0,
        savedAt: Number(savedAt) || 0,
        expiresAt: expiryOf(id, savedAt, stamps),
    }));
};

/**
 * Drops every cached blob that has not been played for `CACHE_TTL_MS`.
 *
 * Walks keys only, so it never pulls audio into memory, and it runs off the
 * playback path (app start, after a cache-manager action). Returns how many
 * records were dropped, which the caller may ignore.
 */
export const pruneExpiredAudio = async function () {
    const keys = await readAllKeys();
    if (!keys.length) return 0;
    const stamps = readPlayed();
    const now = Date.now();
    const dead = keys.filter((key) => isStampExpired(stamps[key], now));
    if (!dead.length) return 0;
    await deleteStoredEntries(dead);
    dead.forEach((key) => { delete stamps[key]; });
    writePlayed(stamps);
    return dead.length;
};

// Clears records by key, or the whole store when called with no keys — the
// cache manager's "全部删除".
export const deleteCachedAudioMany = async function (keys) {
    const list = (keys || []).filter(Boolean);
    const stamps = readPlayed();
    if (list.length) {
        list.forEach((key) => { delete stamps[key]; });
        writePlayed(stamps);
    } else {
        // Clearing everything takes the stamps with it, or they would outlive
        // the blobs they describe and date records that no longer exist.
        writePlayed({});
    }
    return deleteStoredEntries(keys);
};
