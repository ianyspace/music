/* Shared constants + pure helpers for the music app. */

export const GSI_SRC = 'https://accounts.google.com/gsi/client';
export const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const CLIENT_ID_KEY = 'music:googleClientId';
export const TOKEN_KEY = 'music:googleToken';
export const FOLDER_ID_KEY = 'music:folderId';
export const THEME_KEY = 'music:theme';
export const LAST_TRACK_KEY = 'music:lastTrack';
export const LAST_PROGRESS_KEY = 'music:lastProgress';
export const TRACK_LIST_CACHE_KEY = 'music:trackListCache';
// Display preferences of the now-playing page (the ripples around the record).
// Kept apart from `THEME_KEY` because it is a *player* setting rather than an
// app-wide one, and apart from the playback keys because it is a preference
// the visitor chose rather than state the app restored.
export const RIPPLES_KEY = 'music:setting:ripples';
// The two list preferences. Both are *sets/orders of track keys* — the same
// `<source>:<id>` form `audioCacheKey` builds — held as a JSON array in
// localStorage rather than in IndexedDB: they are small, they are read on
// every render of the list, and `storageGet`/`storageSet` already cover them.
// Keeping them next to the theme/ripples keys also means "clear site data"
// wipes the visitor's taste along with the rest of their settings, which is
// what you want — an orphaned dislike list would silently hide songs.
export const DISLIKED_KEY = 'music:setting:disliked';
export const ORDER_KEY = 'music:setting:order';
// Drive returns at most `pageSize` files per response; follow nextPageToken
// so libraries bigger than one page still show up (capped to stay sane).
export const LIST_HARD_CAP = 1000;

const ART_GRADIENTS = [
    ['#fb5c74', '#fa233b'],
    ['#64d2ff', '#0a84ff'],
    ['#bf5af2', '#5e5ce6'],
    ['#ffd60a', '#ff9f0a'],
    ['#30d158', '#00c7be'],
    ['#ff9f0a', '#fa2d9c'],
    ['#8e8ef7', '#4150d8'],
    ['#66d1ba', '#1d9a8a'],
];

export const formatSize = function (bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size <= 0) return '';
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

/**
 * Formats a cache expiry timestamp for the cache manager list.
 *
 * Returns a human-friendly string like "30 天后过期" or "今天过期" so the
 * visitor can see at a glance which cached songs are fresh and which are about
 * to drop. The exact date is shown when the expiry is within a week, because
 * "3 天后过期" is more useful than "2024-10-15 过期".
 */
export const formatExpiry = function (expiresAt) {
    const remaining = Number(expiresAt) - Date.now();
    if (!Number.isFinite(remaining)) return '';
    if (remaining <= 0) return '已过期';
    const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
    if (days >= 30) return '30 天后过期';
    if (days >= 7) return `${days} 天后过期`;
    if (days >= 2) return `${days} 天后过期`;
    if (days === 1) return '明天过期';
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    if (hours >= 1) return `${hours} 小时后过期`;
    return '即将过期';
};

export const formatTime = function (seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60)
        .toString()
        .padStart(2, '0');
    return `${mins.toString().padStart(2, '0')}:${secs}`;
};

export const storageGet = function (key) {
    try {
        return window.localStorage.getItem(key) || '';
    } catch (err) { return ''; }
};

export const storageSet = function (key, value) {
    try {
        window.localStorage.setItem(key, value);
    } catch (err) { /* private mode etc. — keep working without persistence */ }
};

/**
 * Reads a stored array of track keys (`<source>:<id>`).
 *
 * Anything that is not an array of non-empty strings reads as empty rather than
 * throwing: a half-written value (or one from a future shape) must degrade to
 * "no preference", never to a broken list. Order is preserved because the
 * caller may be the pinned-order list, where order *is* the payload.
 */
export const readKeyList = function (key) {
    let parsed;
    try { parsed = JSON.parse(storageGet(key)); } catch (err) { parsed = null; }
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    const keys = [];
    parsed.forEach((entry) => {
        if (typeof entry !== 'string' || !entry) return;
        if (seen.has(entry)) return;
        seen.add(entry);
        keys.push(entry);
    });
    return keys;
};

export const writeKeyList = function (key, keys) {
    try {
        storageSet(key, JSON.stringify(keys || []));
    } catch (err) { /* see storageSet */ }
};

/**
 * Applies the visitor's list preferences to a raw track list.
 *
 * Two things happen, in this order:
 *
 * 1. Tracks whose key is in `disliked` are dropped. This is what makes "移入
 *    不喜欢" remove a song from the list *and* from every count derived from
 *    the result — there is exactly one filtered list downstream, so the row,
 *    the total on the brand badge and the cache-manager totals agree.
 * 2. The survivors are reordered so that the keys in `order` come first, in
 *    that order, with everything else keeping its source order behind them.
 *
 * The reorder is a *stable partial* sort rather than "sort by index in
 * `order`": `order` only ever holds keys the visitor pinned, and a song that
 * has never been pinned has no position in it. Sorting by a lookup would push
 * every unpinned track to one arbitrary end (a `-1` index sorts first, an
 * `Infinity` last), so the list would reshuffle itself the moment one song was
 * pinned. Ranking by presence instead leaves the untouched library exactly as
 * it was, which is what the visitor expects.
 *
 * Fresh library loads keep their positions too, so a refresh does not throw
 * away what the visitor arranged.
 */
export const applyListPrefs = function (tracks, disliked, order) {
    const hidden = new Set(disliked || []);
    const kept = (tracks || []).filter((track) => !hidden.has(`${track.source || ''}:${track.id}`));
    const ranking = new Map();
    (order || []).forEach((key, index) => { ranking.set(key, index); });
    if (ranking.size === 0) return kept;
    const pinned = [];
    const rest = [];
    kept.forEach((track) => {
        const key = `${track.source || ''}:${track.id}`;
        if (ranking.has(key)) pinned.push([ranking.get(key), track]);
        else rest.push(track);
    });
    // One pinned song still moves to the head — only an *empty* pin list is a
    // no-op, and that is caught above.
    if (pinned.length === 0) return kept;
    pinned.sort((a, b) => a[0] - b[0]);
    return pinned.map((entry) => entry[1]).concat(rest);
};

// iOS (and iOS-only browsers like Alook — they are all WKWebView) needs the
// audio element to have played once inside a real user gesture before later
// async `play()` calls (after a Drive blob download) are allowed.
export const isIOSLike = function () {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const iOSUA = /iP(hone|ad|od)/.test(ua);
    // iPadOS 13+ reports a Macintosh UA but still behaves like iOS.
    const iPadOS = ua.includes('Macintosh')
        && typeof navigator.maxTouchPoints === 'number'
        && navigator.maxTouchPoints > 1;
    return iOSUA || iPadOS;
};

// ~0.01s of silence — lets the unlock `play()` resolve promptly instead of
// hanging with an empty src (which would leave the element "playing").
export const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

// `audio.play()` may reject as a promise OR throw synchronously (Safari has
// been observed doing the latter, which crashes the whole page when it
// happens inside an event handler) — swallow both failure modes.
export const safePlay = function (audio) {
    try {
        const request = audio.play();
        if (request && typeof request.catch === 'function') request.catch(() => { });
    } catch (err) { /* autoplay denied etc. */ }
};

// "01. Artist - Title.mp3" → { artist: 'Artist', title: 'Title', ext: 'MP3' }
export const parseTrackName = function (name) {
    const extMatch = name.match(/\.([a-z0-9]+)$/i);
    const ext = extMatch ? extMatch[1].toUpperCase() : '';
    const base = name
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/^\s*\d{1,3}[\s._-]+/, '');
    const parts = base.split(/\s+[-—–]\s+/);
    if (parts.length >= 2) {
        return { artist: parts[0].trim() || '未知艺术家', title: parts.slice(1).join(' - ').trim(), ext };
    }
    // The music library convention is also `Title-Artist`, often without
    // spaces, so keep the first separator as the title/artist boundary.
    const compactParts = base.split(/\s*[-—–]\s*/);
    if (compactParts.length >= 2) {
        return {
            artist: compactParts.slice(1).join('-').trim() || '未知艺术家',
            title: compactParts[0].trim(),
            ext,
        };
    }
    return { artist: '未知艺术家', title: base, ext };
};

const hashTrack = function (name) {
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) {
        hash = (hash * 31 + name.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % ART_GRADIENTS.length;
};

export const trackGradient = function (name) {
    const [from, to] = ART_GRADIENTS[hashTrack(name)];
    return `linear-gradient(135deg, ${from}, ${to})`;
};

// Lock-screen / media-key artwork: render the track gradient to a canvas.
export const makeArtwork = function (name) {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 320;
        const ctx = canvas.getContext('2d');
        const [from, to] = ART_GRADIENTS[hashTrack(name)];
        const gradient = ctx.createLinearGradient(0, 0, 320, 320);
        gradient.addColorStop(0, from);
        gradient.addColorStop(1, to);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 320, 320);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.font = '170px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('♪', 160, 178);
        return canvas.toDataURL('image/png');
    } catch (err) { return ''; }
};

export const listAllFiles = async function (driveGet, params, accessToken) {
    const files = [];
    let pageToken = '';
    do {
        const data = await driveGet(pageToken ? { ...params, pageToken } : params, accessToken);
        files.push(...(data.files || []));
        pageToken = data.nextPageToken || '';
    } while (pageToken && files.length < LIST_HARD_CAP);
    return files;
};

export const normalizeLyricKey = function (name) {
    return name
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/^\s*\d{1,3}[\s._-]+/, '')
        .toLowerCase()
        .replace(/[\s._()[\]{}-]+/g, '');
};

export const parseLyrics = function (text) {
    const lines = [];
    const lrcPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]([^\r\n]*)/g;
    let match;
    while ((match = lrcPattern.exec(text)) !== null) {
        const fraction = match[3] ? Number(`0.${match[3].padEnd(3, '0')}`) : 0;
        const lyric = match[4].trim();
        if (lyric) lines.push({ time: Number(match[1]) * 60 + Number(match[2]) + fraction, text: lyric });
    }
    if (lines.length > 0) return { timed: true, lines: lines.sort((a, b) => a.time - b.time) };
    return {
        timed: false,
        lines: text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => ({ time: 0, text: line })),
    };
};
