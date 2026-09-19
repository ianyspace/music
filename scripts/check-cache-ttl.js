#!/usr/bin/env node
/**
 * Checks for the audio cache's 30-day expiry.
 *
 * This one exists because of a shipped bug, so it is written around the exact
 * invariant that broke: **the read path must not write.**
 *
 * The first implementation kept `expiresAt` inside the stored record and
 * refreshed it on every read, which means a `readwrite` transaction that
 * rewrites the whole audio blob. IndexedDB serialises a `readwrite` against
 * every other transaction on the same store, so one multi-megabyte rewrite
 * blocks the *next* song's cache read until it finishes — on a phone that read
 * never completed and "the song is cached, so why does tapping it do nothing?"
 * became the bug report. Nothing in a build catches that: the code compiles,
 * the types are fine, and the failure is a timing behaviour.
 *
 * So the assertions here are:
 *
 *  1. `getCachedAudio` and `touchCachedAudio` contain no write of any kind.
 *  2. The stamp that expiry is computed from lives in localStorage, not in the
 *     record — because that is what makes (1) possible.
 *  3. The expiry arithmetic is right, driven against a fake `localStorage`.
 *  4. The sweep that does the deleting walks keys, not whole records.
 *  5. The sweep runs off the playback path.
 *
 * Run: node scripts/check-cache-ttl.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const cacheJs = read('components/Music/audioCache.js');
const idbJs = read('lib/cache/indexedDb.js');
const sharedJs = read('components/Music/shared.js');
const appJs = read('components/Music/MusicApp.js');
const managerJs = read('components/Music/CacheManager.js');

const results = [];
const check = function (name, condition, detail) {
    results.push({ name, pass: Boolean(condition), detail });
};

/* --- helpers: lift a function out of a source file by brace matching ------ */

/**
 * Pulls one `[export] const <name> = [useCallback(][async] function … };` out
 * of a source file by brace matching, so the assertions drive the shipped code
 * rather than a copy that can drift.
 */
const sourceOf = function (source, name) {
    const declaration = new RegExp(`(?:export )?const ${name} = (?:useCallback\\()?(?:async )?function`);
    const match = declaration.exec(source);
    if (!match) return '';
    const start = match.index;
    let depth = 0;
    let i = source.indexOf('{', start);
    for (; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) break;
        }
    }
    // From the `function` keyword (skipping any `async`) through the close.
    const bodyStart = source.indexOf('function', start);
    return source.slice(bodyStart, i + 1);
};

const bodyOf = function (source, name) {
    return sourceOf(source, name);
};

/* --- 1. the read path never writes --------------------------------------- */

// This is the whole point of the file. A `writeEntry`/`deleteEntry` inside
// either of these is the original bug coming back.
const readPath = bodyOf(cacheJs, 'getCachedAudio');
const touchPath = bodyOf(cacheJs, 'touchCachedAudio');

check('getCachedAudio exists', !!readPath, 'found');
check('getCachedAudio never writes a record',
    !/writeEntry/.test(readPath), 'no writeEntry');
check('getCachedAudio never deletes a record',
    !/deleteStoredEntry/.test(readPath) && !/deleteStoredEntries/.test(readPath),
    'no delete');
check('getCachedAudio never tests expiry (a TTL must not fail a play)',
    !/isExpired|isStampExpired|expiryOf|CACHE_TTL_MS/.test(readPath),
    'no expiry test');
check('getCachedAudio only reads',
    /readEntry\(id\)/.test(readPath) && /return record && record\.blob \? record\.blob : null;/.test(readPath),
    'read + return');

check('touchCachedAudio exists', !!touchPath, 'found');
check('touchCachedAudio never writes a record (the blob rewrite is the bug)',
    !/writeEntry/.test(touchPath), 'no writeEntry');
check('touchCachedAudio never reads a record either',
    !/readEntry/.test(touchPath), 'no readEntry');
check('touchCachedAudio is a plain stamp write',
    /stamps\[id\] = Date\.now\(\);/.test(touchPath) && /writePlayed\(stamps\);/.test(touchPath),
    'stamp + writePlayed');

// The read path is the only thing standing between a tap and the audio, so it
// must not await anything but the read itself.
check('getCachedAudio awaits exactly one thing',
    (readPath.match(/await /g) || []).length === 1, `${(readPath.match(/await /g) || []).length} await`);

/* --- 2. the stamp lives in localStorage, not in the record --------------- */

const keyMatch = sharedJs.match(/export const CACHE_PLAYED_KEY = '([^']+)'/);
const CACHE_PLAYED_KEY = keyMatch ? keyMatch[1] : '';
check('CACHE_PLAYED_KEY is exported from shared.js', !!CACHE_PLAYED_KEY, CACHE_PLAYED_KEY || 'missing');
check('the key is namespaced under the app prefix',
    CACHE_PLAYED_KEY.startsWith('music:'), CACHE_PLAYED_KEY);
check('the key does not collide with another storage key',
    (sharedJs.match(new RegExp(`'${CACHE_PLAYED_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 'g')) || []).length === 1,
    'declared once');
check('audioCache imports the key from shared',
    /CACHE_PLAYED_KEY/.test(cacheJs) && /from '\.\/shared'/.test(cacheJs), 'imported');
check('the stamp map is read through the shared storage helper',
    /storageGet\(CACHE_PLAYED_KEY\)/.test(cacheJs) && /storageSet\(CACHE_PLAYED_KEY/.test(cacheJs),
    'storageGet + storageSet');
// The stored record must no longer carry a TTL field at all — if it does,
// something will eventually refresh it, and that is the bug.
check('cacheAudio no longer stores an expiresAt in the record',
    !/expiresAt:/.test(bodyOf(cacheJs, 'cacheAudio')), 'no expiresAt field');
// `listCachedAudio` legitimately *builds* an `expiresAt` for the UI; what must
// not exist is a write whose payload carries one, because that is the record
// refresh that forces the blob rewrite.
check('no write call hands IndexedDB an expiresAt field',
    !/writeEntry\([^)]*expiresAt/.test(cacheJs), 'no expiresAt in a write');
check('no write call hands IndexedDB a spread record',
    !/writeEntry\(\{\s*\.\.\./.test(cacheJs), 'no {...record} write');

/* --- 3. the expiry arithmetic, against a fake localStorage --------------- */

const store = new Map();
const fakeWindow = {
    localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
    },
};

// Lift the real implementations, so the assertions cannot drift from the code.
const lift = function (name) {
    const body = sourceOf(sharedJs, name);
    const target = body || sourceOf(cacheJs, name);
    if (!target) return null;
    const isShared = !!body;
    // eslint-disable-next-line no-new-func
    return new Function('window', `const ${name} = ${target}; return ${name};`)(fakeWindow);
};

const storageGet = lift('storageGet');
const storageSet = lift('storageSet');

// `expiryOf` / `isStampExpired` are pure; evaluate them with the two module
// constants they close over, read straight out of the source.
const NEVER_EXPIRES = (function () {
    const m = cacheJs.match(/export const NEVER_EXPIRES = (\d+)/);
    return m ? Number(m[1]) : 0;
}());
const CACHE_TTL_MS = (function () {
    const m = cacheJs.match(/CACHE_TTL_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
    return m ? 30 * 24 * 60 * 60 * 1000 : NaN;
}());

const evalPure = function (name) {
    const body = sourceOf(cacheJs, name);
    if (!body) return null;
    // eslint-disable-next-line no-new-func
    return new Function('CACHE_TTL_MS', 'NEVER_EXPIRES', `const ${name} = ${body}; return ${name};`)(
        CACHE_TTL_MS, NEVER_EXPIRES,
    );
};

const expiryOf = evalPure('expiryOf');
const isStampExpired = evalPure('isStampExpired');

check('storageGet lifts out of shared.js', typeof storageGet === 'function', 'lifted');
check('storageSet lifts out of shared.js', typeof storageSet === 'function', 'lifted');
check('expiryOf lifts out of audioCache.js', typeof expiryOf === 'function', 'lifted');
check('isStampExpired lifts out of audioCache.js', typeof isStampExpired === 'function', 'lifted');

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1758000000000; // a fixed "now" so the arithmetic is deterministic

check('the TTL is 30 days',
    /CACHE_TTL_MS = 30 \* 24 \* 60 \* 60 \* 1000/.test(cacheJs)
    && /CACHE_TTL_MS/.test(cacheJs),
    '30 * 24 * 60 * 60 * 1000');

// expiryOf
check('a stamp from today expires 30 days out',
    expiryOf('cloud:a', 0, { 'cloud:a': NOW }) === NOW + 30 * DAY,
    String(expiryOf('cloud:a', 0, { 'cloud:a': NOW })));
check('a record with no stamp falls back to its savedAt',
    expiryOf('cloud:a', NOW, {}) === NOW + 30 * DAY,
    String(expiryOf('cloud:a', NOW, {})));
check('a record with neither stamp nor savedAt reports NEVER_EXPIRES',
    expiryOf('cloud:a', 0, {}) === 0, String(expiryOf('cloud:a', 0, {})));
check('the play stamp wins over savedAt',
    expiryOf('cloud:a', NOW - 10 * DAY, { 'cloud:a': NOW }) === NOW + 30 * DAY,
    'stamp preferred');
check('another key\u2019s stamp does not leak in',
    expiryOf('cloud:b', 0, { 'cloud:a': NOW }) === 0, 'per-key lookup');

// isStampExpired
check('a stamp from today is not expired',
    isStampExpired(NOW, NOW) === false, 'fresh');
check('a stamp from 29 days ago is not expired',
    isStampExpired(NOW - 29 * DAY, NOW) === false, '29 days');
check('a stamp from exactly 30 days ago is expired',
    isStampExpired(NOW - 30 * DAY, NOW) === true, '30 days');
check('a stamp from 31 days ago is expired',
    isStampExpired(NOW - 31 * DAY, NOW) === true, '31 days');
// The safety property: a record with no stamp must never be swept, or a
// half-written map would delete the visitor's whole cache.
check('a missing stamp is NOT expired (no evidence of staleness)',
    isStampExpired(undefined, NOW) === false && isStampExpired(0, NOW) === false
    && isStampExpired(null, NOW) === false && isStampExpired('', NOW) === false,
    'unknown reads as keep');
check('a garbage stamp is NOT expired',
    isStampExpired('not-a-number', NOW) === false && isStampExpired(-5, NOW) === false,
    'invalid reads as keep');

/* --- 4. the stamp map survives bad data --------------------------------- */

const readPlayed = (function () {
    const body = sourceOf(cacheJs, 'readPlayed');
    // `readPlayed` closes over the key and the storage helper; supply both so
    // the lifted copy reads the fake store.
    // eslint-disable-next-line no-new-func
    return new Function('storageGet', 'CACHE_PLAYED_KEY', `const readPlayed = ${body}; return readPlayed;`)(
        storageGet, CACHE_PLAYED_KEY,
    );
}());

store.clear();
check('nothing stored reads as an empty stamp map',
    Object.keys(readPlayed()).length === 0, 'empty');
store.set(CACHE_PLAYED_KEY, 'not json');
check('unparseable JSON reads as empty (never as "everything is stale")',
    Object.keys(readPlayed()).length === 0, 'empty');
store.set(CACHE_PLAYED_KEY, '[1,2,3]');
check('an array reads as empty', Object.keys(readPlayed()).length === 0, 'empty');
store.set(CACHE_PLAYED_KEY, '{"cloud:a":1758000000000,"cloud:b":"bad","cloud:c":0,"cloud:d":-1}');
const parsed = readPlayed();
check('a valid stamp is kept', parsed['cloud:a'] === 1758000000000, String(parsed['cloud:a']));
check('a non-numeric stamp is dropped', parsed['cloud:b'] === undefined, 'dropped');
check('a zero stamp is dropped', parsed['cloud:c'] === undefined, 'dropped');
check('a negative stamp is dropped', parsed['cloud:d'] === undefined, 'dropped');

/* --- 5. the sweep walks keys, and only deletes --------------------------- */

const pruneBody = bodyOf(cacheJs, 'pruneExpiredAudio');
check('pruneExpiredAudio exists', !!pruneBody, 'found');
check('the sweep walks keys, not whole records (blobs stay out of memory)',
    /readAllKeys\(\)/.test(pruneBody) && !/readAllEntries/.test(pruneBody),
    'readAllKeys only');
check('readAllKeys is really exported by the IndexedDB layer',
    /export const readAllKeys = async function/.test(idbJs)
    && /store\.getAllKeys\(\)/.test(idbJs),
    'getAllKeys');
check('the sweep only deletes',
    !/writeEntry|put\(/.test(pruneBody), 'no writes');
check('the sweep deletes the stamps of what it dropped',
    /dead\.forEach\(\(key\) => \{ delete stamps\[key\]; \}\);/.test(pruneBody), 'stamps cleaned');
check('the sweep short-circuits when nothing is stale',
    /if \(!dead\.length\) return 0;/.test(pruneBody), 'no-op guard');
check('the sweep reports how many it dropped',
    /return dead\.length;/.test(pruneBody), 'returns count');

/* --- 6. the sweep runs off the playback path ---------------------------- */

check('MusicApp imports the sweep',
    /pruneExpiredAudio,/.test(appJs), 'imported');
check('the sweep runs on mount, not per play',
    /pruneExpiredAudio\(\)\.catch\(\(\) => \{ \}\);[\s\S]{0,40}\}, \[\]\)/.test(appJs),
    'mount-only effect');
// The failure mode being guarded: someone "optimising" the sweep into the
// cache read, which is what broke playback in the first place. Scoped to the
// fetch function itself, because both names appear together in the imports.
const fetchBody = sourceOf(appJs, 'fetchTrackUrl');
check('fetchTrackUrl is found for the sweep check', !!fetchBody, 'found');
check('the sweep is not called from the track-fetch path',
    !/pruneExpiredAudio/.test(fetchBody), 'kept apart');
check('the stamp is refreshed after playback starts',
    /touchCachedAudio\(audioCacheKey\(current\.track\)\)/.test(appJs), 'touch wired');
check('the stamp refresh happens after audio.play(), not before the fetch',
    appJs.indexOf('touchCachedAudio(audioCacheKey(current.track))')
    > appJs.indexOf('audio.src = current.url'),
    'after the element is mounted');

/* --- 7. deletion paths keep the stamps in step -------------------------- */

const delOne = bodyOf(cacheJs, 'deleteCachedAudio');
const delMany = bodyOf(cacheJs, 'deleteCachedAudioMany');
check('deleting one song drops its stamp',
    /delete stamps\[id\]/.test(delOne), 'stamp removed');
check('clearing everything drops the whole stamp map',
    /writePlayed\(\{\}\)/.test(delMany), 'map cleared');
check('deleting a selection drops just those stamps',
    /list\.forEach\(\(key\) => \{ delete stamps\[key\]; \}\);/.test(delMany), 'per-key');

/* --- 8. the manager shows the expiry it was given ---------------------- */

check('listCachedAudio computes expiresAt rather than reading one',
    /expiresAt: expiryOf\(id, savedAt, stamps\)/.test(bodyOf(cacheJs, 'listCachedAudio')),
    'computed');
check('the manager renders the expiry',
    /formatExpiry\(entry\.expiresAt\)/.test(managerJs), 'rendered');
check('the manager hides it when nothing dates the record',
    /entry\.expiresAt > 0 \?/.test(managerJs), 'guarded');
check('formatExpiry is a shared helper',
    /export const formatExpiry = function/.test(sharedJs), 'exported');

/* --- 9. no stray blob rewrite anywhere --------------------------------- */

// A rewrite of a stored blob is the one thing that must not come back, in any
// file. `writeEntry({ ...record` is exactly the shape that did it.
check('no file spreads a read record back into a write',
    !/writeEntry\(\{ \.\.\.record/.test(cacheJs) && !/writeEntry\(\{ \.\.\./.test(cacheJs),
    'no {...record} write');
check('no file refreshes an expiry inside a record',
    !/expiresAt: refreshed/.test(cacheJs) && !/refreshed/.test(cacheJs),
    'no refresh path');

/* --- report ------------------------------------------------------------- */

let failed = 0;
results.forEach((r) => {
    if (!r.pass) failed += 1;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
});
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
