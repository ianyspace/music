/**
 * Music library data sources.
 *
 * The player has two interchangeable libraries:
 *
 * - `cloud` (default): a public Cloudflare R2 bucket, listed by the Worker in
 *   `worker/`. Works with no Google authorization at all.
 * - `drive`: the visitor's own Google Drive folder, used only after they
 *   connect (implicit token flow, drive.readonly).
 *
 * Both produce the same track shape so the rest of the app never branches on
 * the source, and every track carries `source` so caches and downloads can be
 * routed correctly:
 *
 *   { id, name, size, source, url?, lyricsUrl?, lyricFile?, coverUrl?, coverFile? }
 *
 * The two `*File` fields are the Drive spelling of a sidecar file (the listing
 * gives us the whole file object, and the bytes are behind the visitor's
 * token); the two `*Url` fields are the cloud spelling (the Worker resolved
 * the pairing and handed back a public link). `lyricsUrlOf` and `coverUrlOf`
 * are what the rest of the app asks, so nobody has to know which is which.
 */

import { music } from 'config';

import { NEVER_EXPIRES } from './audioCache';
import {
    DRIVE_FILES_URL,
    listAllFiles,
    normalizeLyricKey,
    storageGet,
    storageSet,
} from './shared';

export const CLOUD_SOURCE = 'cloud';
export const DRIVE_SOURCE = 'drive';

const AUDIO_FILE = /\.(mp3|flac|m4a|wav|ogg|oga|opus|aac|wma|ape)$/i;
const LIST_CACHE_PREFIX = 'music:trackListCache:v2';

export const sourceLabel = function (source) {
    return source === DRIVE_SOURCE ? '我的 Google 云盘' : '公共曲库';
};

/* --- cache keys ---------------------------------------------------------- */

// Lists and audio blobs are keyed per source: a Drive list cached while
// connected must never surface as the public library after disconnecting, and
// R2 keys / Drive file ids must not collide in IndexedDB.
export const listCacheKey = function (source, clientId) {
    return source === DRIVE_SOURCE
        ? `${LIST_CACHE_PREFIX}:drive:${clientId || 'default'}`
        : `${LIST_CACHE_PREFIX}:cloud`;
};

export const audioCacheKey = function (track) {
    return `${track.source || CLOUD_SOURCE}:${track.id}`;
};

/**
 * Reads the cached list for a library.
 *
 * The list is kept forever (`expiresAt: NEVER_EXPIRES`), so the library is on
 * screen from the first paint instead of after the fetch resolves — and a failed
 * fetch does not wipe what the visitor already had. A refresh replaces it, it is
 * never invalidated by time. `forceRefresh` in the fetch helpers is how fresh
 * data gets in, not this.
 *
 * It is **not** the offline mechanism — the shell is (`public/sw.js`, which
 * serves the page offline). This is what *fills* that shell: offline, the list on
 * screen comes from here. Offline audio is the audio cache's job, and only for
 * songs already cached.
 *
 * Lists written before this became permanent still carry a real `expiresAt`,
 * and those are still honoured so an old entry cannot outlive its intent.
 */
export const readListCache = function (source, clientId) {
    let cached;
    try { cached = JSON.parse(storageGet(listCacheKey(source, clientId))); } catch (err) { cached = null; }
    if (!cached) return null;

    const trackCount = Array.isArray(cached.tracks) ? cached.tracks.length : 0;
    const expiry = Number(cached.expiresAt) || NEVER_EXPIRES;
    const legacyExpired = expiry !== NEVER_EXPIRES && expiry <= Date.now();
    // An empty cloud list is treated as "nothing cached" so a failed first
    // fetch cannot masquerade as a valid empty library.
    if (legacyExpired || (trackCount === 0 && !cached.savedAt)) return null;

    return {
        tracks: Array.isArray(cached.tracks) ? cached.tracks : [],
        folders: Array.isArray(cached.folders) ? cached.folders : [],
        folderId: cached.folderId || '',
        savedAt: Number(cached.savedAt) || 0,
    };
};

export const writeListCache = function (source, clientId, { tracks, folders = [], folderId = '' }) {
    storageSet(listCacheKey(source, clientId), JSON.stringify({
        savedAt: Date.now(),
        // Kept forever: the library paints from this instead of waiting for the
        // network, and a failed fetch leaves it in place.
        expiresAt: NEVER_EXPIRES,
        clientId: clientId || '',
        folderId,
        folders,
        tracks,
    }));
};

export const clearListCache = function (source, clientId) {
    storageSet(listCacheKey(source, clientId), '');
};

/* --- cloud (R2 via Worker) ---------------------------------------------- */

const absoluteUrl = function (url) {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    const base = String(music.r2BaseUrl || '').replace(/\/+$/, '');
    return base ? `${base}/${String(url).replace(/^\/+/, '')}` : '';
};

/**
 * The cover URL to use when the index says nothing about covers at all.
 *
 * The site and the Worker are deployed separately — the static export goes out
 * from this repository, the Worker from `cloudflare-worker/` — so a visitor can
 * be running a client that knows about covers against a Worker that predates
 * them. In that case the client falls back to the naming rule the Worker itself
 * uses: the same key with a `.jpg` extension. It costs a 404 per song that has
 * no cover, and the renderer answers that with the gradient it would have shown
 * anyway.
 *
 * A Worker that *does* answer is believed even when the answer is `null`: it
 * listed the bucket, so it knows whether a cover exists, and guessing on top of
 * that would only buy a 404. That is why the caller checks for the field rather
 * than for a truthy value — `''` means "no cover", `undefined` means "this
 * index never heard of covers".
 *
 * `.png` / `.webp` covers therefore need the current Worker; only `.jpg` can be
 * guessed. `AUDIO_FILE` anchors at the end of the string, so a URL that carries
 * a query string is left alone instead of being rewritten into a wrong guess.
 */
const guessCoverUrl = function (url) {
    return AUDIO_FILE.test(url) ? url.replace(AUDIO_FILE, '.jpg') : '';
};

// Ceiling on the library listing. Without one a half-open connection leaves
// `fetch` pending forever, which reads in the UI as "加载中…" that never ends —
// indistinguishable from an empty library, and impossible to retry. Failing
// fast is strictly better: `loadTracks` already degrades to the cached list.
const LIST_TIMEOUT_MS = 15000;

export const fetchCloudTracks = async function ({ forceRefresh = false } = {}) {
    const base = String(music.workerUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('未配置公共曲库地址（config/index.js 的 music.workerUrl）');

    const response = await fetch(`${base}/tracks${forceRefresh ? '?refresh=1' : ''}`, {
        signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    return {
        tracks: (data.tracks || [])
            .filter((item) => item && item.id && item.url)
            .filter((item) => AUDIO_FILE.test(item.name || item.key || ''))
            .map((item) => {
                const url = absoluteUrl(item.url);
                return {
                    id: item.id,
                    name: item.name || item.key || item.id,
                    size: item.size,
                    url,
                    lyricsUrl: absoluteUrl(item.lyricsUrl),
                    // See `guessCoverUrl`: a missing field is an old index, an
                    // empty one is a song without a cover.
                    coverUrl: 'coverUrl' in item ? absoluteUrl(item.coverUrl) : guessCoverUrl(url),
                    source: CLOUD_SOURCE,
                };
            }),
        folders: [],
    };
};

/* --- drive (visitor's own folder) --------------------------------------- */

export const fetchDriveTracks = async function ({ driveGet, token, folderId }) {
    if (!token) {
        const error = new Error('需要连接 Google 云盘');
        error.code = 'TOKEN_REQUIRED';
        throw error;
    }

    // Covers ride along with the lyrics: same-name sidecar files, matched with
    // the same normalisation (it drops the extension and the leading track
    // number, which is exactly the "same name" rule both of them follow), so
    // `01. 牵丝戏 - 银临.mp3` finds `牵丝戏-银临.jpg`.
    let q = "(mimeType contains 'audio' or mimeType contains 'image'"
        + " or name contains '.lrc' or name contains '.txt') and trashed=false";
    if (folderId) q += ` and '${folderId}' in parents`;

    // `thumbnailLink` is what makes a Drive cover showable at all: an `<img>`
    // cannot send the Authorization header that `?alt=media` needs, so a
    // cover URL has to be one the browser can just fetch. See `coverUrlOf`.
    const files = await listAllFiles(driveGet, {
        q,
        fields: 'files(id,name,mimeType,size,thumbnailLink)',
        pageSize: '200',
        orderBy: 'name',
    }, token);

    const lyricFiles = files.filter((file) => /\.(lrc|txt)$/i.test(file.name));
    const lyricByKey = new Map(lyricFiles.map((file) => [normalizeLyricKey(file.name), file]));
    const coverFiles = files.filter((file) => file.mimeType && file.mimeType.startsWith('image/'));
    const coverByKey = new Map(coverFiles.map((file) => [normalizeLyricKey(file.name), file]));

    return {
        tracks: files
            .filter((file) => file.mimeType && file.mimeType.startsWith('audio/'))
            .map((file) => ({
                ...file,
                source: DRIVE_SOURCE,
                lyricFile: lyricByKey.get(normalizeLyricKey(file.name)) || null,
                coverFile: coverByKey.get(normalizeLyricKey(file.name)) || null,
            })),
        folders: [],
    };
};

/* --- per-track data ----------------------------------------------------- */

export const lyricsUrlOf = function (track) {
    if (track.lyricsUrl) return track.lyricsUrl;
    if (track.lyricFile && track.lyricFile.id) return `${DRIVE_FILES_URL}/${track.lyricFile.id}?alt=media`;
    return '';
};

export const hasLyrics = function (track) {
    return Boolean(track && lyricsUrlOf(track));
};

/**
 * The artwork for a track, or `''` when it has none.
 *
 * Callers must treat a non-empty result as "try this", not as "this exists":
 * the cover is a sidecar file like the lyrics, so a song can lose it, the
 * Worker can be older than the feature (see `guessCoverUrl`), and a Drive
 * thumbnail expires after a few hours. Whoever renders it owns the fallback —
 * `components/Music/Cover.js` drops the image and the gradient underneath shows
 * through.
 */
export const coverUrlOf = function (track) {
    if (!track) return '';
    if (track.coverUrl) return track.coverUrl;
    if (track.coverFile && track.coverFile.thumbnailLink) return driveThumbnail(track.coverFile.thumbnailLink);
    return '';
};

// Drive hands out its thumbnails at `=s220`. The largest tile a cover lands in
// is 62px, so 512 is comfortable on a retina screen; the size is the last thing
// in the URL, so swapping it is safe, and the flags after it (`-c` for Drive's
// own square crop) are left exactly as Drive set them. If Google ever changes
// that shape the original link still works, only softer.
const driveThumbnail = function (link) {
    return String(link).replace(/=s\d+([-a-z]*)$/i, '=s512$1');
};

export const fetchLyricsText = async function (track, { token = '' } = {}) {
    const url = lyricsUrlOf(track);
    if (!url) return '';

    const isDrive = track.source === DRIVE_SOURCE || (!track.lyricsUrl && Boolean(track.lyricFile));
    if (isDrive && !token) return '';

    const response = await fetch(url, isDrive
        ? { headers: { Authorization: `Bearer ${token}` } }
        : undefined);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
};

// Downloads the audio bytes for a track. The caller is responsible for
// caching the blob and for turning it into an object URL.
//
// The timeout here is not decoration: `await response.blob()` has no deadline of
// its own, so a stream that stalls mid-download (R2 throttling, a dropped mobile
// connection) leaves the promise pending forever and playback sits on its
// loading spinner with no error and no retry. A stalled download must fail so
// the caller can surface it and the next attempt can start clean.
const AUDIO_TIMEOUT_MS = 120000;

export const downloadTrackBlob = async function (track, { token = '', timeoutMs = AUDIO_TIMEOUT_MS } = {}) {
    if (track.source === DRIVE_SOURCE) {
        if (!token) {
            const error = new Error('本地没有缓存音频');
            error.code = 'TOKEN_REQUIRED';
            throw error;
        }
        const response = await fetch(`${DRIVE_FILES_URL}/${track.id}?alt=media`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.status === 401) {
            const error = new Error('授权已过期，请重新连接');
            error.code = 'UNAUTHORIZED';
            throw error;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
    }

    if (!track.url) throw new Error('曲目缺少音频地址');
    const response = await fetch(track.url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.blob();
};
