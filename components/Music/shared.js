/* Shared constants + pure helpers for the music app. */

import { site } from 'config';

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
// How the phone's now-playing page draws the lyrics. One key holding the *name*
// of a style rather than one boolean per style: they are a choice, not
// independent switches, so a stored value that is not one of them has to fall
// back to the default instead of turning into a combination nobody picked —
// the same reasoning as `REPEAT_KEY`, and `LYRIC_STYLES` is the same kind of
// whitelist as `REPEAT_MODES`.
//
// That whitelist is now load-bearing rather than hypothetical: the drawer used
// to offer 逐行上浮 and 卡拉OK 扫光 as well, and a visitor who picked one of them
// is still carrying that name in storage. Dropping it from this list is the
// whole migration — the restore in `usePlayer` checks membership and leaves the
// default in place, so those visitors open the player on 普通 instead of on a
// style that no longer has any CSS behind it.
//
// The wide-screen layouts do not read this yet; the lyrics they draw are a
// different renderer each, so the key is stored under the shared `music:setting:`
// prefix to keep the visitor's taste in one place when they catch up.
export const LYRIC_STYLE_KEY = 'music:setting:lyricStyle';
export const LYRIC_STYLES = ['plain', 'solo'];
// Playback mode. Shuffle and repeat are two independent states — the phone
// player folds them into one cycling button, the wide-screen layout shows two
// buttons — so they get one key each rather than one packed value, and the
// phone's four modes (关闭 / 列表循环 / 单曲循环 / 随机) are simply the four
// combinations of the pair.
//
// `shuffle` is stored as 'on'/'off' like the ripples switch. `repeat` is stored
// as one of `REPEAT_MODES`; the mode is the payload here, so there is no
// "absent" value to encode and an unrecognised string must fall back to the
// default rather than be coerced into a mode nobody picked.
export const SHUFFLE_KEY = 'music:setting:shuffle';
export const REPEAT_KEY = 'music:setting:repeat';
export const REPEAT_MODES = ['off', 'all', 'one'];
// Whether the wide-screen layout shows its playlist panel. A layout preference
// like the theme, and it sits next to the theme and the ripples switch in the
// desktop settings drawer — so it has to survive a reload for the same reason
// they do: a setting that silently reverts reads as a broken switch rather than
// as a default.
export const DESKTOP_LIST_KEY = 'music:setting:desktopList';
// The wide-screen layout's visual effects. Two keys, not one packed value:
// whether the 3D stage is on at all, and how hard it pushes. They are
// independent — turning the stage off and back on must land on the intensity
// the visitor was using, not on a default — and the intensity is a whitelist
// like `LYRIC_STYLES`, for the same reason: a stored name that is no longer
// offered has to fall back rather than be coerced into a step nobody picked.
//
// Desktop-only on purpose. The phone layout keeps its 2D record; a particle
// cloud is not something to run on a phone, so these keys are read by
// `DesktopApp` only and the phone never looks at them.
export const VISUAL_3D_KEY = 'music:setting:visual3d';
export const VISUAL_INTENSITY_KEY = 'music:setting:visualIntensity';
export const VISUAL_INTENSITIES = ['calm', 'standard', 'strong'];
// The immersive page (the desktop layout's only form since the redesign).
// Background is a *mode name* — the nebula is the default and the custom
// library is opt-in — so an unrecognised stored value falls back to `nebula`
// rather than to a mode nobody picked, the same whitelist reasoning as
// `LYRIC_STYLES` and `VISUAL_INTENSITIES`.
export const IMMERSIVE_BG_KEY = 'music:setting:immersiveBg';
export const IMMERSIVE_BGS = ['nebula', 'custom'];
// The visual console's whole state — chosen preset, the three amounts, the
// layer switches and the lyric stage — as one JSON blob. One key instead of
// eight: the console's settings are always read and written together, and a
// half-applied set (a preset with somebody else's switches) is worse than a
// reset to defaults.
export const IMMERSIVE_FX_KEY = 'music:setting:immersiveFx';
// The visitor's own backgrounds: a JSON array of `{ id, type, url }` plus the
// id of the one on screen. The preset ships with the page and needs no entry.
export const IMMERSIVE_CUSTOM_KEY = 'music:setting:immersiveCustom';
// Readability filter strength for a picture/video background, 0–100.
export const IMMERSIVE_FILTER_KEY = 'music:setting:immersiveFilter';
// Whether the lyrics stay visible while the nebula is on. The custom
// background is *for* the lyrics, so that side has no switch.
export const IMMERSIVE_LYRIC_KEY = 'music:setting:immersiveLyric';
// Whether the playlist panel folds itself away while music plays.
export const IMMERSIVE_PANEL_KEY = 'music:setting:immersivePanel';
// The immersive page's own volume, 0–100 — separate from any other layout.
export const IMMERSIVE_VOLUME_KEY = 'music:setting:immersiveVolume';
// The two list preferences. Both are *sets/orders of track keys* — the same
// `<source>:<id>` form `audioCacheKey` builds — held as a JSON array in
// localStorage rather than in IndexedDB: they are small, they are read on
// every render of the list, and `storageGet`/`storageSet` already cover them.
// Keeping them next to the theme/ripples keys also means "clear site data"
// wipes the visitor's taste along with the rest of their settings.
export const ORDER_KEY = 'music:setting:order';
// 我喜欢 lives in the Worker's D1 database now, keyed by the visitor's QQ
// number, with a local mirror per number — see `likes.js`, which owns all of
// it (`LEGACY_KEY` there is the pre-D1 key this module used to export).
// Last-played stamps for cached audio, as `{ '<source>:<id>': timestamp }`.
//
// Deliberately NOT stored inside the cached record itself. Refreshing a stamp
// that lives in the record means rewriting the audio blob, and a `readwrite`
// transaction on the audio store blocks every other transaction against it —
// so one multi-megabyte rewrite makes the *next* song's cache read wait for
// the whole write, which on a phone is the difference between the next song
// starting and never loading. A stamp is a few bytes; the blob is megabytes.
export const CACHE_PLAYED_KEY = 'music:cachePlayed';
// The visitor's QQ number, typed on the phone's 账号 page. It buys exactly one
// thing: the header avatar.
//
// Stored as bare digits rather than as JSON, because it is a single value and
// "nothing saved yet" is a state of its own (the note placeholder) rather than
// something a parsed object has to encode — the same shape as `THEME_KEY`. The
// value is re-validated on the way out (`normalizeQq`), so a hand-edited or
// half-written key degrades to "not bound" instead of becoming a broken image.
export const QQ_KEY = 'music:setting:qq';

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

/**
 * A URL for a file under `public/`.
 *
 * The basePath has to be added by hand: Next prefixes `next/link` and `_next/*`
 * itself, but `public/**` is copied to the site root verbatim. On this project
 * page (`/music/`) a bare `/icon-192.png` therefore points at the user's site
 * root and 404s — which is exactly how the site had a broken favicon for a
 * while. `pages/_document.js` spells the prefix out for the `<link>` tags for
 * the same reason; this is the same rule for anything React renders.
 */
export const assetUrl = function (file) {
    const path = String(file || '');
    return `${site.pathPrefix || ''}${path.startsWith('/') ? path : `/${path}`}`;
};

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
 * The digits of a QQ number, or `''` if what was typed is not one.
 *
 * One place decides what a valid QQ number is, and it decides it by *length*
 * only (5–11 digits, which is what the service has ever issued). There is no
 * check digit, no prefix rule and no way to verify an account from here, so
 * anything stricter would be inventing authority the app does not have — the
 * number is the visitor's own label for their avatar, not a credential.
 *
 * Everything else is stripped first: people paste "QQ：1234567" or a number
 * with spaces from a contact card, and rejecting that teaches nothing.
 */
export const normalizeQq = function (value) {
    const digits = String(value == null ? '' : value).replace(/\D/g, '');
    return /^\d{5,11}$/.test(digits) ? digits : '';
};

/**
 * The avatar image for a QQ number, from Tencent's public head-image endpoint.
 *
 * It is the endpoint every third-party client uses (`q1.qlogo.cn` with
 * `b=qq`), and it needs no key, no token and no CORS: it is consumed as an
 * `<img src>`, which is not a cross-origin request the page has to be allowed
 * to make. That is also the whole of the guarantee — the app cannot tell a
 * wrong number from a right one, because the service answers a nonexistent QQ
 * with a *placeholder picture* rather than a 404. So the fallback below is for
 * the network being unreachable, not for the number being wrong.
 *
 * Returns `''` when there is nothing to ask for, which is what the avatar
 * reads as "draw the note instead".
 */
export const qqAvatarUrl = function (qq) {
    const digits = normalizeQq(qq);
    return digits ? `https://q1.qlogo.cn/g?b=qq&nk=${digits}&s=100` : '';
};

/**
 * Puts the pinned songs at the top of a raw track list.
 *
 * The only thing that moves is the ranking: the keys in `order` come first, in
 * that order, with everything else keeping its source order behind them. No
 * track is dropped — this is an arrangement, not a filter, so the row, the
 * total on the brand badge and the cache-manager totals all count the same
 * library.
 *
 * It is a *stable partial* sort rather than "sort by index in `order`": `order`
 * only ever holds keys the visitor pinned, and a song that has never been
 * pinned has no position in it. Sorting by a lookup would push every unpinned
 * track to one arbitrary end (a `-1` index sorts first, an `Infinity` last), so
 * the list would reshuffle itself the moment one song was pinned. Ranking by
 * presence instead leaves the untouched library exactly as it was, which is
 * what the visitor expects.
 *
 * That is also what makes 取消置顶 free: removing the key from `order` leaves
 * the song with no position again, and it lands back in the library's own order
 * without anything having remembered where it used to be.
 *
 * Fresh library loads keep their positions too, so a refresh does not throw
 * away what the visitor arranged.
 */
export const applyPinnedOrder = function (tracks, order) {
    const ranking = new Map();
    (order || []).forEach((key, index) => { ranking.set(key, index); });
    if (ranking.size === 0) return tracks || [];
    const pinned = [];
    const rest = [];
    (tracks || []).forEach((track) => {
        const key = `${track.source || ''}:${track.id}`;
        if (ranking.has(key)) pinned.push([ranking.get(key), track]);
        else rest.push(track);
    });
    // One pinned song still moves to the head — only an *empty* pin list is a
    // no-op, and that is caught above.
    if (pinned.length === 0) return tracks || [];
    pinned.sort((a, b) => a[0] - b[0]);
    return pinned.map((entry) => entry[1]).concat(rest);
};

/**
 * What to show in place of the list when there is no row to show.
 *
 * Both layouts ask this one question, and they have to answer it the same way:
 * a phone list and a wide-screen panel with the same filters applied must not
 * word the same emptiness differently. The answer depends on *why* the list is
 * empty, which "zero rows" alone does not tell you:
 *
 * 1. still loading — not empty yet, so say that instead of diagnosing;
 * 2. a search that matched nothing — name the keyword back;
 * 3. 只看喜欢 is on — the library is fine and so is the filter, there is simply
 *    nothing in it yet, and "no audio files" would send the visitor to the
 *    folder picker for a problem that does not exist;
 * 4. otherwise the library itself is empty, and the folder picker *is* the fix
 *    — `folderHint` names it, because the phone calls that screen 「我的」 and
 *    the wide-screen layout calls it 「设置」.
 *
 * There used to be a fifth branch for "the library has songs but the list
 * preferences hid them all", from when 移入不喜欢 could take every row away. No
 * preference filters any more — the pin ranking only reorders — so an empty
 * list now *is* an empty library, and the fallback covers it. `libraryCount` is
 * gone from the arguments for the same reason: nothing here needs to know how
 * big the library is to explain why nothing is on screen.
 *
 * The keyword branch comes first even when 只看喜欢 is on, because the visitor
 * typed something and that is the thing they are waiting to hear about — but it
 * says *where* it looked, since "no match" while a filter is silently on is the
 * confusing version of the same sentence.
 */
export const emptyListMessage = function ({ listLoading, keyword, folderHint, likedOnly }) {
    if (listLoading) return '加载中…';
    if (keyword) {
        return likedOnly
            ? `喜欢的歌曲里没有匹配「${keyword}」的`
            : `没有匹配「${keyword}」的歌曲`;
    }
    if (likedOnly) return '还没有喜欢的歌曲，在歌曲右侧的「更多」里可以喜欢';
    // No `folderHint` = a layout with no folder picker to send them to. The
    // desktop plays the public library and nothing else, so there is no second
    // library to suggest — the sentence stops at the fact.
    if (!folderHint) return '公共曲库里还没有歌曲';
    return `没有找到音频文件，去「${folderHint}」换个文件夹试试？`;
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

/**
 * The `MediaMetadata.artwork` list for a track: the real cover when the library
 * has one, the drawn gradient when it does not.
 *
 * The cover URL is an argument rather than the track, because working out
 * *which* URL is the cover is `coverUrlOf`'s job in `librarySource.js` — and
 * that module imports this one, so asking back would be a cycle.
 *
 * `sizes` is claimed only for the gradient, which is 320×320 by construction.
 * A cover's real dimensions are not known here (the Drive thumbnail is asked
 * for at 512 and the bucket's images have whatever size they were uploaded
 * with), and a wrong `sizes` is worse than none: it is a promise the lock
 * screen lays the image out against.
 */
export const mediaArtwork = function (coverUrl, name) {
    if (coverUrl) return [{ src: coverUrl }];
    const drawn = makeArtwork(name);
    return drawn ? [{ src: drawn, sizes: '320x320', type: 'image/png' }] : [];
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
