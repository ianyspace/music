import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    DRIVE_FILES_URL,
    DRIVE_SCOPE,
    FOLDER_MIME,
    CLIENT_ID_KEY,
    TOKEN_KEY,
    FOLDER_ID_KEY,
    THEME_KEY,
    LAST_TRACK_KEY,
    LAST_PROGRESS_KEY,
    RIPPLES_KEY,
    SHUFFLE_KEY,
    REPEAT_KEY,
    REPEAT_MODES,
    ORDER_KEY,
    LIKED_KEY,
    QQ_KEY,
    storageGet,
    storageSet,
    readKeyList,
    writeKeyList,
    applyPinnedOrder,
    safePlay,
    isIOSLike,
    SILENT_WAV,
    normalizeQq,
    parseTrackName,
    mediaArtwork,
    listAllFiles,
    parseLyrics,
} from '../shared';
import { recordPlay } from '../playStats';
import {
    getCachedAudio,
    touchCachedAudio,
    pruneExpiredAudio,
    cacheAudio,
    listCachedAudio,
    deleteCachedAudioMany,
} from '../audioCache';
import {
    CLOUD_SOURCE,
    DRIVE_SOURCE,
    audioCacheKey,
    clearListCache,
    coverUrlOf,
    downloadTrackBlob,
    fetchCloudTracks,
    fetchDriveTracks,
    fetchLyricsText,
    hasLyrics,
    readListCache,
    sourceLabel,
    writeListCache,
} from '../librarySource';

/**
 * Every stateful piece of the music player, in one hook.
 *
 * Both layouts call this and get the same player: library sources (public R2 +
 * optional Google Drive), the permanent local caches, playback, lyrics and
 * Media Session. It exists so the phone and the desktop can be *independent
 * trees* — neither imports the other, and this is the only thing they share
 * besides the pure helpers next door.
 *
 * It returns one flat object rather than several focused hooks on purpose. The
 * pieces are heavily entangled (the visible list feeds playback, which feeds
 * Media Session, which feeds the prefetcher), and splitting them would mean
 * re-ordering hooks and threading setters between them — the kind of change
 * that alters behaviour in places nothing reports. Keeping it whole means the
 * body below is the original state machine, moved rather than rewritten.
 *
 * `lyricsAutoOpen` is the one thing the two layouts disagree about: the
 * wide-screen workspace shows the lyrics beside the cover and has no toggle, so
 * it opens on them, while the phone player opens on the record and reveals the
 * lyrics when the record is tapped. It is an option rather than a `variant`
 * string so this hook never has to know which layout is asking.
 *
 * Playback lives here (a single <audio> element, owned by `PlayerAudio`, so
 * music keeps running while screens switch): transport controls, shuffle/repeat,
 * seek, in-list search, background auto-advance and Media Session integration.
 * There is deliberately no volume control. The OAuth client ID is the only
 * setup: entered once, kept in localStorage, nothing secret committed.
 */

// How many audio downloads "全部缓存" keeps in flight. Three is the sweet spot
// for this app: enough that a long list finishes in a third of the serial time,
// low enough that a track the visitor taps mid-run still starts quickly, and
// safely under the browser's ~6-per-host connection cap — so the seed pass
// never starves playback or lyrics fetching. Raising it gains little: the
// bottleneck is bandwidth and IndexedDB writes, not the request count.
const CACHE_ALL_CONCURRENCY = 3;

const usePlayer = function ({ lyricsAutoOpen = false } = {}) {
    const [theme, setTheme] = useState('light');
    // Display preference of the now-playing page: the ripples travelling out
    // from the record. On unless the visitor turned them off — a decorative
    // effect that has to be switched *on* would be an odd default. Restored
    // and persisted below, next to the theme, since both are display settings.
    const [ripples, setRipples] = useState(true);
    // The pinned order, as a list of `<source>:<id>` keys.
    //
    // `order` records only the songs the visitor pinned, in the order they were
    // pinned — it is a ranking, not a full permutation of the library, so a
    // library refresh does not throw away positions the visitor never set, and
    // a key can leave it again (取消置顶) without the song needing a remembered
    // home to fall back to — see `unpinTrack`. It lives in localStorage next to
    // the theme and the ripples switch.
    const [order, setOrder] = useState([]);
    // 我喜欢 — the other list preference, and the only one that is a *keep-in*
    // list rather than an arrangement. It is a feature of the public library
    // specifically, so `toggleLike` refuses a Drive track; see `LIKED_KEY`.
    const [liked, setLiked] = useState([]);
    // 只看喜欢 — whether the list is narrowed to the liked songs. Deliberately
    // *not* persisted, and it sits next to `search` rather than next to the
    // preferences above because it is the same kind of thing: what the list is
    // currently showing, not what the visitor has decided. A reload that came
    // back with a short list and no visible reason for it would be worse than
    // having to tap again.
    const [likedOnly, setLikedOnly] = useState(false);
    // The visitor's QQ number, as typed on the phone's 账号 page. It lives here
    // rather than in `h5/MusicApp` because it is no longer only about the
    // avatar: it is also the key every play count is recorded under, and the
    // play counts are recorded by *this* hook, which all three layouts share.
    // A number read from storage by the shell and by the player separately
    // would be two answers to "who is listening".
    const [qq, setQq] = useState('');
    // The row drawer (置顶 / 喜欢 on the phone; 置顶 alone on the wide screen,
    // which has no like feature), opened from a row's own three-dots button.
    // The *track* is held rather than an id so the drawer can render the cover
    // and both labels with no lookup — and so it keeps rendering them while it
    // plays its exit animation.
    const [rowMenu, setRowMenu] = useState(null);
    const [rowMenuClosing, setRowMenuClosing] = useState(false);
    const [gsiReady, setGsiReady] = useState(false);
    const [clientId, setClientId] = useState('');
    const [clientIdDraft, setClientIdDraft] = useState('');
    const [token, setToken] = useState('');
    const [tokenExpiresAt, setTokenExpiresAt] = useState(0);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [folders, setFolders] = useState([]);
    const [folderId, setFolderId] = useState('');
    const [tracks, setTracks] = useState([]);
    const [listCacheAvailable, setListCacheAvailable] = useState(false);
    // 'cloud' = public R2 library (works with no authorization at all),
    // 'drive' = the visitor's own Google Drive, used once they connect.
    const [librarySource, setLibrarySource] = useState(CLOUD_SOURCE);
    const [search, setSearch] = useState('');
    const [listLoading, setListLoading] = useState(false);
    const [current, setCurrent] = useState(null);
    const [loadingId, setLoadingId] = useState('');
    const [isPlaying, setIsPlaying] = useState(false);
    // 随机 by default. `false` here is only the pre-restore value — the mode
    // effect below adopts whatever is stored, and a visitor who has ever picked
    // something else gets that back instead.
    const [shuffle, setShuffle] = useState(true);
    // 'off' → 'all' → 'one' → 'off'
    const [repeat, setRepeat] = useState('off');
    const [progress, setProgress] = useState({ time: 0, duration: 0 });
    // Id of the track whose audio blob is (or is being) prefetched.
    const [prefetchId, setPrefetchId] = useState('');
    // Shuffle has no fixed "next", so one is *drawn* when the current song
    // starts and kept until it is played or the song changes. Drawing it early
    // is the whole point: `upcomingTrack` can then hand it to the prefetcher,
    // which is what makes background auto-advance work on iOS (a cold fetch
    // there is suspended until the page returns). Without this, 随机 — the
    // default mode — would be the one mode that cannot pre-download.
    const [shuffleNext, setShuffleNext] = useState(null);
    const [lyrics, setLyrics] = useState(null);
    const [lyricsLoading, setLyricsLoading] = useState(false);
    const [lyricsVisible, setLyricsVisible] = useState(false);
    // Cache manager sheet: `open` mounts it, `closing` plays its exit first.
    // `entries` comes from IndexedDB and is re-read after every action, so the
    // list always reflects the store rather than a locally patched guess.
    const [cacheOpen, setCacheOpen] = useState(false);
    const [cacheClosing, setCacheClosing] = useState(false);
    const [cacheEntries, setCacheEntries] = useState([]);
    const [cacheLoading, setCacheLoading] = useState(false);
    const [cacheBusyId, setCacheBusyId] = useState('');
    const [cacheAllRunning, setCacheAllRunning] = useState(false);
    const [cacheProgress, setCacheProgress] = useState({ done: 0, total: 0 });
    // Drive connection sheet: same sheet mechanics as the cache manager, one
    // screen over. It is the only place that can raise Google's account picker.
    const [driveOpen, setDriveOpen] = useState(false);
    const [driveClosing, setDriveClosing] = useState(false);

    const audioRef = useRef(null);
    const tokenRestoreRef = useRef(false);
    const objectUrlRef = useRef('');
    // Guards against two blob downloads racing when several tracks are
    // clicked in quick succession — only the latest click may win.
    const playSeqRef = useRef(0);
    // iOS needs one synchronous `play()` inside the tap gesture before
    // async plays are allowed (Safari tolerates this; Alook-style WKWebView
    // shells do not) — done once per element.
    const unlockRef = useRef(false);
    // { id, promise } of the in-flight/finished next-track prefetch.
    const prefetchRef = useRef(null);
    const restoredTrackRef = useRef(false);
    // Id of the track whose play has already been counted for the ranking. The
    // `play` event fires again on every resume and once per loop in 单曲循环, so
    // "one play" has to be defined by something other than the event itself —
    // see `onAudioPlay` and the `repeat === 'one'` branch of `handleEnded`.
    const countedTrackRef = useRef('');
    // `loadTracks` writes the folder list into the cache; reading it through a
    // ref keeps `folders` out of the callback deps (which would re-trigger the
    // load effect every time the folder list arrives).
    const foldersRef = useRef([]);
    // Lets `loadTracks` tell "we already show a usable list" from "the list is
    // empty", so a failed refresh degrades into a quiet notice.
    const tracksRef = useRef([]);

    // Cached blobs are read first and are keyed per source, so a track already
    // downloaded from either library plays back with no network and no token.
    const fetchTrackUrl = useCallback(async function (track, accessToken) {
        const cacheKey = audioCacheKey(track);
        const cachedBlob = await getCachedAudio(cacheKey);
        if (cachedBlob) return URL.createObjectURL(cachedBlob);

        let blob;
        try {
            blob = await downloadTrackBlob(track, { token: accessToken });
        } catch (err) {
            if (err.code === 'UNAUTHORIZED') {
                storageSet(TOKEN_KEY, '');
                setToken('');
            }
            throw err;
        }
        // Awaited on purpose. Firing this and moving on let the write race the
        // caller, and on iOS the page is routinely backgrounded the moment
        // playback starts — which suspends a pending IndexedDB write and leaves
        // the track uncached, so the same song was re-downloaded every session.
        // The write is a local transaction (a few ms), so awaiting it does not
        // delay `play()` meaningfully; the blob is already in memory by here.
        await cacheAudio(cacheKey, blob);
        return URL.createObjectURL(blob);
    }, []);

    // Pre-download the next track while the current one still plays: iOS
    // suspends background `fetch`, so a cold download at `ended` in the
    // background only completes once the page is re-opened (the exact
    // "next song starts when I come back" symptom). With the blob already
    // cached, auto-advance is a synchronous src swap that keeps rolling in
    // the background.
    const startPrefetch = useCallback(async function (track) {
        if (!track) return;
        const old = prefetchRef.current;
        if (old && old.promise && old.id !== track.id) {
            // Abandoned prefetch (user skipped ahead) — free its blob.
            old.promise.then((r) => r.url && URL.revokeObjectURL(r.url)).catch(() => { });
        }
        const entry = { id: track.id, promise: null };
        entry.promise = fetchTrackUrl(track, token)
            .then((url) => ({ url }))
            .catch(() => ({ url: '' }));
        prefetchRef.current = entry;
        setPrefetchId(track.id);
    }, [token, fetchTrackUrl]);

    // Take the prefetched blob if it matches `track` (clearing the cache);
    // returns '' when nothing usable is cached.
    const claimPrefetch = useCallback(async function (track) {
        const entry = prefetchRef.current;
        if (!entry || entry.id !== track.id) return '';
        prefetchRef.current = null;
        setPrefetchId('');
        try {
            const result = await entry.promise;
            return result.url || '';
        } catch (err) { return ''; }
    }, []);

    /* --- theme --- */

    useEffect(() => {
        const saved = storageGet(THEME_KEY);
        if (saved === 'light' || saved === 'dark') setTheme(saved);
        else setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }, []);

    // The page owns the whole viewport; keep <body> in sync so overscroll
    // edges don't flash the blog background.
    useEffect(() => {
        const previous = document.body.style.background;
        document.body.style.background = theme === 'dark' ? '#08080d' : '#f6f6f7';
        return () => { document.body.style.background = previous; };
    }, [theme]);

    const toggleTheme = useCallback(function () {
        setTheme((mode) => {
            const next = mode === 'dark' ? 'light' : 'dark';
            storageSet(THEME_KEY, next);
            return next;
        });
    }, []);

    /* --- now-playing display preferences --- */

    // Stored as the strings 'on' / 'off' so "no value saved yet" is a state of
    // its own rather than something a boolean has to encode. Anything else in
    // the key (a hand-edit, a half-written value) leaves the default in place,
    // which is why this does not simply test for truthiness.
    useEffect(() => {
        const saved = storageGet(RIPPLES_KEY);
        if (saved === 'on') setRipples(true);
        else if (saved === 'off') setRipples(false);
    }, []);

    const toggleRipples = useCallback(function () {
        setRipples((on) => {
            storageSet(RIPPLES_KEY, on ? 'off' : 'on');
            return !on;
        });
    }, []);

    /* --- playback mode: shuffle + repeat --------------------------------- */

    // Restored on mount and written back on every change, from one effect.
    //
    // One effect rather than a read-effect plus a write-effect: the two would
    // race on the mount commit (the writer would see the pre-restore defaults
    // and store them over the visitor's choice), and nothing in the code would
    // look wrong. The `ref` is what makes the first run a read and every later
    // run a write, in that order and in one place.
    //
    // Restoring here rather than in `useState` is deliberate: this is a static
    // export, so an initialiser that touches localStorage would also run during
    // prerender and hand the client markup that disagrees with what it reads.
    //
    // Both values are matched explicitly. A key holding anything else — a
    // half-written value, an edit from devtools, a mode a future build drops —
    // leaves the default in place, so a corrupt preference can never put the
    // player into a mode the visitor did not choose. And because nothing is
    // written until the visitor actually changes something, "no value saved
    // yet" stays a state of its own rather than becoming a stored default —
    // which is what lets the default below be 随机 without pinning every
    // existing visitor to whatever the default was on their first visit.
    //
    // The mode is changed by three controls (the phone's combined button, and
    // the wide-screen shuffle and repeat buttons) and they all go through
    // `setShuffle`/`setRepeat`, so syncing here means no control can move the
    // mode without persisting it — which is the bug this fixes: the mode used
    // to reset to 关闭 on every reload.
    const modeSyncedRef = useRef(false);
    useEffect(() => {
        if (!modeSyncedRef.current) {
            modeSyncedRef.current = true;
            const savedShuffle = storageGet(SHUFFLE_KEY);
            if (savedShuffle === 'on') setShuffle(true);
            else if (savedShuffle === 'off') setShuffle(false);
            const savedRepeat = storageGet(REPEAT_KEY);
            if (REPEAT_MODES.includes(savedRepeat)) setRepeat(savedRepeat);
            return;
        }
        storageSet(SHUFFLE_KEY, shuffle ? 'on' : 'off');
        storageSet(REPEAT_KEY, repeat);
    }, [shuffle, repeat]);

    /* --- the visitor's QQ number --- */

    // Read on mount and written back when the visitor confirms one on 账号.
    //
    // Restored in an effect rather than in `useState` for the same reason as
    // the theme: this is a static export, so an initialiser that touched
    // localStorage would also run during prerender and hand the client markup
    // that disagrees with what it read. The stored value is re-validated on the
    // way in, so a hand-edited key degrades to "not bound" instead of becoming
    // a request for a nonsense avatar or a ranking under a nonsense number.
    useEffect(() => {
        setQq(normalizeQq(storageGet(QQ_KEY)));
    }, []);

    // `''` is a real value here — 清除 writes it — and every reader treats it as
    // "not bound" rather than as "no answer yet".
    const saveQq = useCallback(function (next) {
        const digits = normalizeQq(next);
        storageSet(QQ_KEY, digits);
        setQq(digits);
    }, []);

    /* --- list preferences: pinned order + 我喜欢 --- */

    useEffect(() => {
        setOrder(readKeyList(ORDER_KEY));
        setLiked(readKeyList(LIKED_KEY));
    }, []);

    // 置顶 — move the song to the head of the list.
    //
    // The stored `order` is a ranking of pinned keys, and "top" is expressed by
    // *unshifting* the key: whatever was pinned before keeps its relative order
    // behind it. The `filter` is not tidiness — this array is what gets stored,
    // so the key must never appear in it twice.
    const pinTrack = useCallback(function (track) {
        if (!track) return;
        const key = audioCacheKey(track);
        setOrder((keys) => {
            const next = [key].concat(keys.filter((entry) => entry !== key));
            writeKeyList(ORDER_KEY, next);
            return next;
        });
        setNotice(`已置顶：${parseTrackName(track.name).title}`);
    }, []);

    // 取消置顶 — the key leaves the ranking, and that is the whole of it.
    //
    // `order` only ever held the songs the visitor pinned, so a song with no
    // entry in it has no position at all; `applyPinnedOrder`' stable sort then
    // leaves it in the library's own order, exactly where it was before it was
    // ever pinned. So "back to the default sort" needs no second list
    // remembering where the song came from — forgetting *is* the restore. That
    // is the payoff of `order` being a ranking rather than a permutation, and
    // it is why this function is three lines.
    const unpinTrack = useCallback(function (track) {
        if (!track) return;
        const key = audioCacheKey(track);
        setOrder((keys) => {
            const next = keys.filter((entry) => entry !== key);
            writeKeyList(ORDER_KEY, next);
            return next;
        });
        setNotice(`已取消置顶：${parseTrackName(track.name).title}`);
    }, []);

    // A Set for the same reason as `likedSet` below: the drawer asks this, but
    // the question is "did the visitor pin it", never "is it sitting in the
    // first row". Those are different questions the moment anything pushes the
    // song down — a search, 只看喜欢, or a later pin landing on top of it — and
    // answering the wrong one is how the drawer would offer 取消置顶 on a song
    // that is not pinned, or refuse it on one that is.
    const pinnedSet = useMemo(() => new Set(order), [order]);

    const isPinned = useCallback(
        (track) => Boolean(track) && pinnedSet.has(audioCacheKey(track)),
        [pinnedSet],
    );

    // One action, because it is one button whose label follows its state — the
    // same shape as 喜欢. `pinTrack` and `unpinTrack` stay private to the hook
    // so both layouts ask the same question and neither of them re-derives the
    // decision from `order`.
    const togglePin = useCallback(function (track) {
        if (!track) return;
        if (pinnedSet.has(audioCacheKey(track))) unpinTrack(track);
        else pinTrack(track);
    }, [pinnedSet, pinTrack, unpinTrack]);

    /* --- 我喜欢 --- */

    // A Set, because the list asks this once per row on every render and the
    // array form would be a linear scan per row. Rebuilt only when the list
    // changes, which is a tap.
    const likedSet = useMemo(() => new Set(liked), [liked]);

    // The question the row drawer and the player both ask. Takes the track
    // rather than a key so neither of them has to know how keys are built —
    // `audioCacheKey` stays the one place that decides that.
    const isLiked = useCallback(
        (track) => Boolean(track) && likedSet.has(audioCacheKey(track)),
        [likedSet],
    );

    // 喜欢 / 取消喜欢 — one action, because it is one button whose label
    // follows its state. Toggling rather than two functions keeps the state and
    // the toast reading from the same decision, so they cannot disagree.
    //
    // A Drive track is refused rather than stored. The feature is the public
    // library's: a Drive file id means nothing outside the account that owns
    // it, so a like there would be a key that can never match a song again —
    // and the list would then hold something the visitor cannot see or remove.
    // Refusing keeps it honest; the UI does not offer the button in the first
    // place, so this is the guard behind that, not the thing that shows it.
    const toggleLike = useCallback(function (track) {
        if (!track) return;
        if (track.source === DRIVE_SOURCE) return;
        const key = audioCacheKey(track);
        const { title } = parseTrackName(track.name);
        const wasLiked = likedSet.has(key);
        setLiked((keys) => {
            const next = wasLiked ? keys.filter((entry) => entry !== key) : keys.concat(key);
            writeKeyList(LIKED_KEY, next);
            return next;
        });
        // Outside the updater on purpose: an updater has to be pure, and React
        // may run it more than once. `wasLiked` is read from the rendered set,
        // which is what the button the visitor just pressed was showing.
        setNotice(wasLiked ? `已取消喜欢：${title}` : `已喜欢：${title}`);
    }, [likedSet]);

    const toggleLikedOnly = useCallback(function () {
        setLikedOnly((on) => !on);
    }, []);

    /* --- row drawer (cover + 置顶 / 喜欢) --- */

    const openRowMenu = useCallback(function (track) {
        setRowMenuClosing(false);
        setRowMenu(track);
    }, []);

    const closeRowMenu = useCallback(function () {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setRowMenu(null);
            setRowMenuClosing(false);
            return;
        }
        setRowMenuClosing(true);
    }, []);

    useEffect(() => {
        if (!rowMenu) return undefined;
        const onKeyDown = (event) => { if (event.key === 'Escape') closeRowMenu(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [rowMenu, closeRowMenu]);

    // 谷歌云盘链接 — leaves the list for 「我的」, where the Google Drive
    // connection lives.
    /* --- drive sheet --- */

    // The drawer entry opens the Drive screen as a sheet, exactly like "缓存
    // 管理" next to it — the settings page is no longer a destination of its
    // own for this. Connecting stays the only action here that may raise
    // Google's UI.
    const openDriveSheet = useCallback(function () {
        setDriveClosing(false);
        setDriveOpen(true);
    }, []);

    const closeDriveSheet = useCallback(function () {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setDriveOpen(false);
            setDriveClosing(false);
            return;
        }
        setDriveClosing(true);
    }, []);

    useEffect(() => {
        if (!driveOpen) return undefined;
        const onKeyDown = (event) => { if (event.key === 'Escape') closeDriveSheet(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [driveOpen, closeDriveSheet]);

    /* --- cache manager --- */

    // Sweep the audio cache once per page load: anything not played for 30 days
    // goes. It is here — off the playback path — rather than in the read that
    // serves a song, because enforcing a TTL while a song is being fetched is
    // how a cache read ends up rewriting a multi-megabyte blob and blocking the
    // next play. Keys only, so the sweep itself is cheap.
    useEffect(() => {
        pruneExpiredAudio().catch(() => { });
    }, []);

    const readCache = useCallback(async function () {
        setCacheLoading(true);
        const entries = await listCachedAudio();
        // `null` means IndexedDB is unavailable (private mode, old browser) —
        // the sheet then reads as "nothing cached" instead of crashing.
        setCacheEntries(entries || []);
        setCacheLoading(false);
    }, []);

    const openCacheManager = useCallback(function () {
        setCacheClosing(false);
        setCacheOpen(true);
        readCache();
    }, [readCache]);

    const closeCacheManager = useCallback(function () {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setCacheOpen(false);
            setCacheClosing(false);
            return;
        }
        setCacheClosing(true);
    }, []);

    useEffect(() => {
        if (!cacheOpen) return undefined;
        const onKeyDown = (event) => { if (event.key === 'Escape') closeCacheManager(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [cacheOpen, closeCacheManager]);

    // 全部缓存: download every track that is not stored yet, `CACHE_ALL_CONCURRENCY`
    // at a time. A small pool rather than one at a time — a serial pass over a
    // long list takes minutes — but kept low so the audio the visitor may start
    // playing still gets its share of the pipe, and so the browser's per-host
    // connection cap is not saturated. Each task is a plain "download and let
    // `fetchTrackUrl` store it" unit: the object URL it returns is revoked
    // immediately, since this pass fills the cache rather than plays anything.
    const cacheAllTracks = useCallback(async function () {
        setCacheAllRunning(true);
        setCacheProgress({ done: 0, total: 0 });
        try {
            const stored = await listCachedAudio();
            const storedKeys = new Set((stored || []).map((entry) => entry.id));
            const pending = tracks.filter((track) => !storedKeys.has(audioCacheKey(track)));
            setCacheProgress({ done: 0, total: pending.length });

            let nextIndex = 0;
            let done = 0;
            const worker = async function () {
                while (nextIndex < pending.length) {
                    const track = pending[nextIndex];
                    nextIndex += 1;
                    const url = await fetchTrackUrl(track, token).catch(() => '');
                    if (url) URL.revokeObjectURL(url);
                    done += 1;
                    setCacheProgress({ done, total: pending.length });
                }
            };
            const pool = [];
            for (let i = 0; i < Math.min(CACHE_ALL_CONCURRENCY, pending.length); i += 1) {
                pool.push(worker());
            }
            await Promise.all(pool);
        } finally {
            setCacheAllRunning(false);
            await readCache();
        }
    }, [tracks, token, fetchTrackUrl, readCache]);

    // Removal is per-key, or the whole store when handed an empty list. The
    // playing track's blob may go too — the audio element already holds its
    // own decoded data, and the next play re-downloads it.
    const deleteCacheEntries = useCallback(async function (keys) {
        if (!Array.isArray(keys) || keys.length === 0) {
            setCacheBusyId('*');
            await deleteCachedAudioMany([]);
            setCacheBusyId('');
            await readCache();
            return;
        }
        setCacheBusyId(keys[0]);
        await deleteCachedAudioMany(keys);
        setCacheBusyId('');
        await readCache();
    }, [readCache]);

    // 缓存管理 — opens the sheet that lists every cached blob and lets the
    // visitor drop individual entries, clear the store, or fill it from the
    // whole list.
    const goCacheManager = useCallback(function () {
        openCacheManager();
    }, [openCacheManager]);

    /* --- toasts --- */

    useEffect(() => {
        if (!notice) return undefined;
        const timer = setTimeout(() => setNotice(''), 3200);
        return () => clearTimeout(timer);
    }, [notice]);

    /* --- Google Drive connection --- */

    useEffect(() => {
        const savedId = storageGet(CLIENT_ID_KEY);
        const savedFolder = storageGet(FOLDER_ID_KEY);
        setClientId(savedId);
        setClientIdDraft(savedId);
        if (savedFolder) setFolderId(savedFolder);
    }, []);

    // The public library is the default experience, so the page shows songs
    // straight from the permanent list cache with no authorization involved.
    useEffect(() => {
        const savedId = storageGet(CLIENT_ID_KEY);
        const cached = readListCache(CLOUD_SOURCE, savedId);
        if (!cached || cached.tracks.length === 0) return;
        setTracks(cached.tracks);
        setListCacheAvailable(true);
    }, []);

    useEffect(() => {
        foldersRef.current = folders;
    }, [folders]);

    useEffect(() => {
        tracksRef.current = tracks;
    }, [tracks]);

    const saveToken = useCallback(function (accessToken, expiresIn, id) {
        const expiresAt = Date.now() + Math.max(Number(expiresIn) || 3600, 60) * 1000;
        storageSet(TOKEN_KEY, JSON.stringify({ accessToken, expiresAt, clientId: id }));
        setTokenExpiresAt(expiresAt);
        setToken(accessToken);
    }, []);

    // Only ever called because something stopped working — never as the first
    // step of asking Google for a replacement.
    const clearSavedToken = useCallback(function () {
        storageSet(TOKEN_KEY, '');
        setTokenExpiresAt(0);
        setToken('');
    }, []);

    // Revoke the blob URLs (current + prefetched) when leaving the page.
    useEffect(() => () => {
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const entry = prefetchRef.current;
        if (entry && entry.promise) entry.promise.then((r) => r.url && URL.revokeObjectURL(r.url)).catch(() => { });
    }, []);

    const driveGet = useCallback(async (params, accessToken) => {
        const resp = await fetch(`${DRIVE_FILES_URL}?${new URLSearchParams(params)}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (resp.status === 401) {
            // Drive rejected the token: whatever we were holding is dead. Clear
            // it and let the caller step aside — the app must never answer a
            // 401 by asking Google for a fresh token on its own.
            clearSavedToken();
            setNotice('');
            throw new Error('授权已过期，请重新连接');
        }
        if (!resp.ok) {
            let message = `HTTP ${resp.status}`;
            try {
                const data = await resp.json();
                if (data.error && data.error.message) message = data.error.message;
            } catch (err) { /* fall back to the status line */ }
            throw new Error(message);
        }
        return resp.json();
    }, [clearSavedToken]);

    /**
     * Asks Google for an access token.
     *
     * `interactive` is the whole safety rail, and it must stay explicit:
     *
     * - `interactive: true` — the visitor just pressed a connect button. GIS
     *   may show account/consent UI, because a tap *is* the authorization.
     * - `interactive: false` — a background renewal. It must be impossible for
     *   this path to draw anything: not a consent screen, not an account
     *   chooser, not a popup. So it passes `prompt: 'none'` (documented as
     *   "no authentication or consent UI") *and* never runs without a stored
     *   `clientId`, because GIS defaults `prompt` to `select_account` and a
     *   request that reaches it with no hint is exactly what opens a chooser
     *   on every page load.
     *
     * A non-interactive failure is swallowed on purpose: the caller drops back
     * to the public library, and the visitor only ever re-authorizes by tapping
     * connect again.
     */
    const requestToken = useCallback(function (options) {
        const {
            clientId: id,
            interactive = false,
            onSuccess,
            onFailure,
        } = options || {};

        // No clientId means no *remembered* connection: an automatic request
        // here could only ever produce Google UI nobody asked for.
        if (!interactive && !id) return false;

        const google = window.google;
        if (!google || !google.accounts || !google.accounts.oauth2) {
            if (interactive) setError('Google 登录组件尚未加载完成，请稍后再试');
            return false;
        }

        try {
            google.accounts.oauth2
                .initTokenClient({
                    client_id: id,
                    scope: DRIVE_SCOPE,
                    prompt: interactive ? '' : 'none',
                    callback(resp) {
                        if (resp.error) {
                            if (interactive) {
                                setError(`连接失败：${resp.error}${resp.error_description ? `（${resp.error_description}）` : ''}`);
                            }
                            if (onFailure) onFailure(resp.error);
                            return;
                        }
                        saveToken(resp.access_token, resp.expires_in, id);
                        // Connected → the visitor's own Drive library takes
                        // over from the public one.
                        setLibrarySource(DRIVE_SOURCE);
                        if (interactive) setNotice('已连接 Google 云盘');
                        if (onSuccess) onSuccess(resp.access_token);
                    },
                })
                .requestAccessToken();
            return true;
        } catch (err) {
            if (interactive) setError(`无法打开 Google 登录窗口：${err.message}（请检查浏览器是否拦截了弹窗）`);
            return false;
        }
    }, [saveToken]);

    /**
     * Drops back to the public library.
     *
     * Used whenever an authorization we were still holding stops working — an
     * expired token we will not renew without a tap, or a 401 from Drive. The
     * visitor ends up somewhere they can still play music, and nothing Google
     * related happens again until they press connect.
     */
    const fallbackToPublicLibrary = useCallback(function (reason) {
        clearSavedToken();
        setLibrarySource(CLOUD_SOURCE);
        if (reason) setNotice(reason);
    }, [clearSavedToken]);

    // Restore the short-lived token between browser visits.
    //
    // Only ever a *read* of what the visitor already authorized: a stored token
    // that has not expired is reused, and anything else (no token, expired,
    // different client id) is left alone — the page simply stays on the public
    // library. No network call, no `initTokenClient`, so a refresh can never
    // reach Google on its own. Reconnecting is a tap on connect.
    useEffect(() => {
        if (!clientId || tokenRestoreRef.current) return;
        tokenRestoreRef.current = true;
        let saved;
        try { saved = JSON.parse(storageGet(TOKEN_KEY)); } catch (err) { saved = null; }
        if (!saved || !saved.clientId || saved.clientId !== clientId) return;
        if (saved.accessToken && saved.expiresAt > Date.now() + 60000) {
            setTokenExpiresAt(saved.expiresAt);
            setToken(saved.accessToken);
            setLibrarySource(DRIVE_SOURCE);
        }
    }, [clientId]);

    /**
     * Expiry is handled by letting the token lapse, never by renewing in the
     * background.
     *
     * Google access tokens live about an hour, so something has to notice. The
     * notice is local: once `tokenExpiresAt` passes, the token is cleared and
     * the app returns to the public library. Asking Google for a new one is
     * deliberately *not* the fallback — a hidden renewal is what popped auth UI
     * on every refresh, and it is not needed either, because the public library
     * needs no authorization at all.
     *
     * The check runs on mount and whenever the tab becomes visible again, which
     * covers the common case of a laptop that slept through the expiry.
     */
    useEffect(() => {
        if (!token || !tokenExpiresAt) return undefined;
        const dropIfExpired = function () {
            if (Date.now() < tokenExpiresAt) return;
            fallbackToPublicLibrary('Google 授权已过期，已切回公共曲库');
        };
        const timer = window.setTimeout(dropIfExpired, Math.max(0, tokenExpiresAt - Date.now()));
        const onVisibilityChange = function () {
            if (document.visibilityState === 'visible') dropIfExpired();
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [token, tokenExpiresAt, fallbackToPublicLibrary]);

    const connect = useCallback(function () {
        setError('');
        setNotice('');
        const id = clientIdDraft.trim();
        if (!id) {
            setError('请先填写 Google OAuth 客户端 ID');
            return;
        }
        storageSet(CLIENT_ID_KEY, id);
        setClientId(id);
        tokenRestoreRef.current = true;
        // The only place authorization may start, and the only place GIS is
        // allowed to show UI.
        requestToken({ clientId: id, interactive: true });
    }, [clientIdDraft, requestToken]);

    const disconnect = useCallback(function () {
        clearSavedToken();
        clearListCache(DRIVE_SOURCE, clientId);
        setFolders([]);
        setTracks([]);
        setListCacheAvailable(false);
        setCurrent(null);
        setIsPlaying(false);
        setSearch('');
        // Switching the source re-triggers the load effect, which pulls the
        // public library back in without touching Google again.
        setLibrarySource(CLOUD_SOURCE);
        setNotice('已断开 Google 云盘，已切回公共曲库');
    }, [clearSavedToken, clientId]);

    useEffect(() => {
        if (!token) return undefined;
        let cancelled = false;
        (async function loadFolders() {
            try {
                const files = await listAllFiles(driveGet, {
                    q: `mimeType='${FOLDER_MIME}' and trashed=false`,
                    fields: 'files(id,name)',
                    pageSize: '200',
                    orderBy: 'name',
                }, token);
                if (!cancelled) setFolders(files);
            } catch (err) {
                if (!cancelled) setError(`获取文件夹列表失败：${err.message}`);
            }
        }());
        return () => { cancelled = true; };
    }, [token, driveGet]);

    // Drop a remembered folder that no longer exists (deleted, or a different
    // account was connected) instead of silently listing nothing.
    useEffect(() => {
        if (!folderId || folders.length === 0) return;
        if (!folders.some((folder) => folder.id === folderId)) setFolderId('');
    }, [folderId, folders]);

    // Loads whichever library is active. The cloud source never needs a token,
    // so a visitor with no Google authorization still gets a full song list.
    const loadTracks = useCallback(async function (targetSource = librarySource, options = {}) {
        if (targetSource === DRIVE_SOURCE && !token) return;
        setListLoading(true);
        setError('');
        try {
            const result = targetSource === DRIVE_SOURCE
                ? await fetchDriveTracks({ driveGet, token, folderId })
                : await fetchCloudTracks({ forceRefresh: Boolean(options.forceRefresh) });

            setTracks(result.tracks);
            setListCacheAvailable(result.tracks.length > 0);
            writeListCache(targetSource, clientId, {
                tracks: result.tracks,
                folders: targetSource === DRIVE_SOURCE ? foldersRef.current : [],
                folderId: targetSource === DRIVE_SOURCE ? folderId : '',
            });
        } catch (err) {
            if (err.code === 'TOKEN_REQUIRED') {
                // Google authorization died mid-session. Step aside to the
                // public library rather than reaching for a new token — the
                // visitor reconnects by tapping connect, and nothing pops up
                // in the meantime.
                fallbackToPublicLibrary('Google 授权已失效，已切回公共曲库');
                try {
                    const fallback = await fetchCloudTracks();
                    setTracks(fallback.tracks);
                    setListCacheAvailable(fallback.tracks.length > 0);
                    writeListCache(CLOUD_SOURCE, clientId, { tracks: fallback.tracks });
                } catch (inner) {
                    setError(`获取音乐列表失败：${inner.message}`);
                }
                return;
            }
            // A failed refresh must not wipe out a list we can still play from,
            // so degrade to a quiet notice when cached songs are on screen.
            if (tracksRef.current.length > 0) {
                setNotice(`曲库暂时无法访问，正在使用本地缓存（${err.message}）`);
            } else {
                setError(`获取音乐列表失败：${err.message}`);
            }
        } finally {
            setListLoading(false);
        }
    }, [librarySource, driveGet, token, folderId, clientId, fallbackToPublicLibrary]);

    const refreshTracks = useCallback(function () {
        // Refreshing must never open Google UI, whichever library is active.
        // The public library is fetched directly; a Drive library is only
        // fetched while a live token is in hand, and without one the visitor is
        // told to reconnect — they are already in the panel that has the button.
        if (librarySource === CLOUD_SOURCE || !token) {
            if (librarySource === CLOUD_SOURCE) {
                loadTracks(CLOUD_SOURCE, { forceRefresh: true });
            } else {
                setError('Google 授权已失效，请点击「连接 Google 云盘」重新授权');
            }
            return;
        }
        loadTracks(DRIVE_SOURCE);
    }, [librarySource, token, loadTracks]);

    useEffect(() => {
        if (librarySource === DRIVE_SOURCE && !token) return;
        loadTracks(librarySource);
    }, [librarySource, token, loadTracks]);

    useEffect(() => {
        const track = current && current.track;
        const withLyrics = Boolean(track && hasLyrics(track));
        setLyrics(null);
        // The wide-screen layout shows the lyrics next to the cover and has no
        // toggle, so it opens on them; the phone player opens on the record and
        // reveals the lyrics when that record is tapped.
        setLyricsVisible(lyricsAutoOpen && withLyrics);
        if (!withLyrics) return undefined;
        let cancelled = false;
        setLyricsLoading(true);
        fetchLyricsText(track, { token })
            .then((text) => {
                if (!cancelled && text) setLyrics({ trackId: track.id, ...parseLyrics(text) });
            })
            .catch(() => { })
            .finally(() => {
                if (!cancelled) setLyricsLoading(false);
            });
        return () => { cancelled = true; };
    }, [current, token, lyricsAutoOpen]);

    const handleFolderChange = useCallback(function (event) {
        if (librarySource !== DRIVE_SOURCE) {
            setNotice('公共曲库没有文件夹，连接 Google 云盘后可按文件夹筛选');
            return;
        }
        if (!token) {
            setNotice('更换文件夹需要重新连接 Google 云盘');
            return;
        }
        const value = event.target.value;
        setFolderId(value);
        storageSet(FOLDER_ID_KEY, value);
    }, [librarySource, token]);

    /* --- playback --- */

    // One-time silent-source play INSIDE the tap gesture: WKWebView shells
    // like Alook reject `play()` calls that happen after an await, so the
    // element must be unlocked synchronously on the first user interaction.
    const unlockAudio = useCallback(function () {
        if (unlockRef.current || !isIOSLike()) return;
        const audio = audioRef.current;
        if (!audio) return;
        unlockRef.current = true;
        try {
            audio.src = SILENT_WAV;
            const request = audio.play();
            if (request && typeof request.then === 'function') {
                request.then(function () {
                    audio.pause();
                    audio.currentTime = 0;
                }).catch(() => { });
            } else {
                audio.pause();
            }
        } catch (err) { /* old webviews: element already unlocked or unusable */ }
    }, []);

    const play = useCallback(async function (track, startTime = 0, shouldPlay = true, accessTokenOverride = '') {
        setError('');
        setLoadingId(track.id);
        const seq = ++playSeqRef.current;
        const accessToken = accessTokenOverride || token;
        try {
            // Use the prefetched blob when it matches — instant start, and
            // the only path that survives background auto-advance on iOS.
            let url = await claimPrefetch(track);
            if (seq !== playSeqRef.current) {
                if (url) URL.revokeObjectURL(url);
                return;
            }
            if (!url) url = await fetchTrackUrl(track, accessToken);
            if (seq !== playSeqRef.current) {
                // A newer click superseded this download — drop its blob.
                if (url) URL.revokeObjectURL(url);
                return;
            }
            if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = url;
            setProgress({ time: startTime, duration: 0 });
            setCurrent({ track, url, startTime, shouldPlay });
        } catch (err) {
            if (seq === playSeqRef.current && err.code === 'TOKEN_REQUIRED') {
                // A Drive song cannot be played without authorization, and the
                // authorization we had has stopped working. Do not silently ask
                // Google for a new one — that is the auth UI the visitor never
                // requested. Say so and step aside to the public library; the
                // next tap on connect is what re-authorizes.
                fallbackToPublicLibrary('Google 授权已失效，已切回公共曲库');
                setError('Google 授权已失效，已切回公共曲库，可在「我的」页面重新连接');
                return;
            }
            if (seq === playSeqRef.current) setError(`播放「${track.name}」失败：${err.message}`);
        } finally {
            if (seq === playSeqRef.current) setLoadingId('');
        }
    }, [token, fetchTrackUrl, claimPrefetch, fallbackToPublicLibrary]);

    useEffect(() => {
        if (restoredTrackRef.current || tracks.length === 0 || (!token && !listCacheAvailable)) return;
        let savedTrack;
        let savedProgress;
        try { savedTrack = JSON.parse(storageGet(LAST_TRACK_KEY)); } catch (err) { savedTrack = null; }
        try { savedProgress = JSON.parse(storageGet(LAST_PROGRESS_KEY)); } catch (err) { savedProgress = null; }
        const track = savedTrack && tracks.find((item) => item.id === savedTrack.id);
        if (!track) return;
        restoredTrackRef.current = true;
        play(track, savedProgress && savedProgress.id === track.id ? savedProgress.time : 0, false);
    }, [tracks, token, listCacheAvailable, play]);

    useEffect(() => {
        if (!current) return;
        storageSet(LAST_TRACK_KEY, JSON.stringify({ id: current.track.id, name: current.track.name }));
    }, [current]);

    useEffect(() => {
        if (!current || !Number.isFinite(progress.time)) return;
        const timer = setTimeout(() => {
            storageSet(LAST_PROGRESS_KEY, JSON.stringify({ id: current.track.id, time: progress.time }));
        }, 500);
        return () => clearTimeout(timer);
    }, [current, progress.time]);

    // Tapping a list row starts playback or toggles the current track in place.
    // The mini player is the explicit entry point for the now-playing sheet.
    const toggleTrack = useCallback(function (track) {
        unlockAudio();
        if (current && current.track.id === track.id) {
            const audio = audioRef.current;
            if (!audio) return;
            if (audio.paused || audio.ended) safePlay(audio);
            else audio.pause();
            return;
        }
        play(track);
    }, [current, play, unlockAudio]);

    const togglePlay = useCallback(function () {
        const audio = audioRef.current;
        if (!audio || !current) return;
        if (audio.paused || audio.ended) safePlay(audio);
        else audio.pause();
    }, [current]);

    // The one list everything downstream reads: the rows, the total on the
    // brand badge, the cache manager's counts, the shuffle and repeat walks.
    //
    // Two things happen, in this order, and both of them are about *what is
    // shown* rather than about the library itself:
    //
    // 1. the pinned songs move to the top (`applyPinnedOrder`), which is an
    //    arrangement — nothing leaves the list;
    // 2. 只看喜欢 narrows what is left.
    //
    // Then the search runs on the result. 只看喜欢 has to come before it
    // because the search is a *narrowing of what is shown*, and the filter has
    // already decided what is shown — searching must not resurrect a song the
    // filter dropped, and turning the filter on must not disturb the search box.
    //
    // Filtering here rather than in the list component is what keeps the count
    // on the brand badge, the rows, and the prev/next walk agreeing. A
    // view-only filter would leave 下一首 stepping onto songs that are not on
    // screen.
    const visibleTracks = useMemo(function () {
        const ordered = applyPinnedOrder(tracks, order);
        const shown = likedOnly
            ? ordered.filter((track) => likedSet.has(audioCacheKey(track)))
            : ordered;
        const keyword = search.trim().toLowerCase();
        if (!keyword) return shown;
        return shown.filter((track) => {
            const { artist, title } = parseTrackName(track.name);
            return (
                track.name.toLowerCase().includes(keyword)
                || title.toLowerCase().includes(keyword)
                || artist.toLowerCase().includes(keyword)
            );
        });
    }, [tracks, order, search, likedOnly, likedSet]);

    const stepTrack = useCallback(function (delta) {
        if (!current || visibleTracks.length < 2) return;
        const index = visibleTracks.findIndex((track) => track.id === current.track.id);
        if (shuffle) {
            let next;
            do { next = Math.floor(Math.random() * visibleTracks.length); } while (next === index);
            play(visibleTracks[next]);
            return;
        }
        if (index === -1) {
            play(visibleTracks[delta > 0 ? 0 : visibleTracks.length - 1]);
            return;
        }
        play(visibleTracks[(index + delta + visibleTracks.length) % visibleTracks.length]);
    }, [current, visibleTracks, shuffle, play]);

    // 下一首. In shuffle this plays the song drawn for this track rather than
    // drawing a fresh one, so a manual skip is as instant as it is in the
    // sequential modes (where it lands on exactly the prefetched track) instead
    // of throwing that download away and waiting on a new one. Still random —
    // the pick was random, it was just made a little earlier.
    const playNext = useCallback(function () {
        const planned = shuffle
            && current
            && shuffleNext
            && shuffleNext.id !== current.track.id
            && visibleTracks.some((track) => track.id === shuffleNext.id);
        if (planned) play(shuffleNext);
        else stepTrack(1);
    }, [shuffle, current, shuffleNext, visibleTracks, play, stepTrack]);

    const playPrev = useCallback(function () {
        // Standard player behaviour: restart the current song first.
        const audio = audioRef.current;
        if (audio && audio.currentTime > 3) {
            audio.currentTime = 0;
            setProgress((state) => ({ ...state, time: 0 }));
            return;
        }
        // 上一首 draws fresh: replaying the song that was planned as the *next*
        // one would not be "previous" by any reading.
        stepTrack(-1);
    }, [stepTrack]);

    const cycleRepeat = useCallback(function () {
        setRepeat((mode) => (mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off'));
    }, []);

    // The phone player folds shuffle and repeat into one cycling button, in the
    // order 关闭 → 列表循环 → 单曲循环 → 随机 → 关闭; the wide-screen layout keeps
    // them as two separate buttons.
    const playbackMode = shuffle ? 'shuffle' : repeat;
    const cyclePlaybackMode = useCallback(function () {
        if (shuffle) {
            setShuffle(false);
            setRepeat('off');
            return;
        }
        if (repeat === 'one') {
            setShuffle(true);
            setRepeat('off');
            return;
        }
        setRepeat(repeat === 'off' ? 'all' : 'one');
    }, [shuffle, repeat]);

    // Draw the song shuffle will play after this one, once per song.
    //
    // Drawn here rather than inside `upcomingTrack` so the pick is stable: a
    // `useMemo` factory is allowed to run more than once for the same deps, and
    // a fresh random pick each time would make the prefetcher chase a different
    // track on every render. Keyed on `current`, so skipping to another song
    // (by hand or by auto-advance) draws a new one.
    useEffect(() => {
        if (!shuffle || repeat === 'one' || !current || visibleTracks.length < 2) {
            setShuffleNext(null);
            return;
        }
        const pool = visibleTracks.filter((track) => track.id !== current.track.id);
        if (!pool.length) { setShuffleNext(null); return; }
        setShuffleNext(pool[Math.floor(Math.random() * pool.length)]);
    }, [shuffle, repeat, current, visibleTracks]);

    // Which track auto-advance will pick up at `ended`. Sequential modes know
    // this from the list order; shuffle uses the song drawn above.
    const upcomingTrack = useMemo(function () {
        if (!current || repeat === 'one' || visibleTracks.length === 0) return null;
        if (shuffle) return shuffleNext;
        const index = visibleTracks.findIndex((track) => track.id === current.track.id);
        if (index === -1) return visibleTracks[0];
        return visibleTracks[index + 1] || (repeat === 'all' ? visibleTracks[0] : null);
    }, [current, repeat, shuffle, shuffleNext, visibleTracks]);

    // Keep the next song's blob downloaded while the current one plays, so
    // background auto-advance works on iOS (a cold fetch there is suspended
    // until the page returns to the foreground).
    useEffect(() => {
        if (!token || !isPlaying) return;
        if (!upcomingTrack || upcomingTrack.id === prefetchId) return;
        startPrefetch(upcomingTrack);
    }, [token, isPlaying, upcomingTrack, prefetchId, startPrefetch]);

    // Auto-advance at the end of a track. With the next blob already
    // prefetched this is a plain src swap — it keeps rolling even while the
    // page sits in the background on iOS. Every mode has a prefetch target now
    // (shuffle's comes from the draw above), so the foreground fallback is left
    // to genuinely un-cached cases: a dead prefetch, a pick the list dropped,
    // or a library that was never downloaded.
    const handleEnded = useCallback(function () {
        setIsPlaying(false);
        if (!current) return;
        if (repeat === 'one') {
            const audio = audioRef.current;
            if (audio) {
                audio.currentTime = 0;
                // A loop is a second listen, so the play-count guard is
                // cleared before it restarts — otherwise 单曲循环 would count
                // once and then keep going all night uncounted.
                countedTrackRef.current = '';
                safePlay(audio);
            }
            return;
        }
        if (shuffle && visibleTracks.length > 1) {
            // Play the song drawn when this one started, so the blob the
            // prefetcher already pulled is the one that plays — that is what
            // keeps auto-advance rolling while the page is in the background.
            // A fresh draw (`stepTrack`) is only the fallback for when the list
            // changed under us and the pick is no longer in it.
            const planned = shuffleNext
                && shuffleNext.id !== current.track.id
                && visibleTracks.some((track) => track.id === shuffleNext.id);
            if (planned) play(shuffleNext);
            else stepTrack(1);
            return;
        }
        const next = visibleTracks[visibleTracks.findIndex((track) => track.id === current.track.id) + 1];
        if (next) play(next);
        else if (repeat === 'all' && visibleTracks.length > 0) play(visibleTracks[0]);
    }, [current, repeat, shuffle, shuffleNext, visibleTracks, stepTrack, play]);

    // Mount the fetched blob into the audio element; browsers only allow
    // autoplay inside the user-gesture chain, so fall back to a hint.
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio || !current) return;
        audio.src = current.url;
        audio.load();
        const seekOnMetadata = () => {
            if (current.startTime > 0 && Number.isFinite(audio.duration)) {
                audio.currentTime = Math.min(current.startTime, Math.max(0, audio.duration - 0.25));
            }
        };
        audio.addEventListener('loadedmetadata', seekOnMetadata, { once: true });
        if (!current.shouldPlay) return () => audio.removeEventListener('loadedmetadata', seekOnMetadata);
        try {
            const request = audio.play();
            if (request && typeof request.catch === 'function') {
                request.catch(() => setNotice('浏览器阻止了自动播放，请点击播放按钮'));
            }
        } catch (err) {
            setNotice('浏览器阻止了自动播放，请点击播放按钮');
        }
        // Restart the song's 30 days. This is a few bytes into localStorage,
        // not a rewrite of the cached blob — see the note on CACHE_PLAYED_KEY.
        touchCachedAudio(audioCacheKey(current.track)).catch(() => { });
        return () => audio.removeEventListener('loadedmetadata', seekOnMetadata);
    }, [current]);

    /* --- media session (lock screen / hardware keys) --- */

    useEffect(() => {
        if (!current || typeof window === 'undefined' || !('mediaSession' in navigator)) return undefined;
        const session = navigator.mediaSession;
        const { artist, title } = parseTrackName(current.track.name);
        // The lock screen gets the song's own cover when the library has one,
        // and the gradient the rest of the UI draws when it does not.
        // `coverUrlOf` is the only thing that knows which field holds it.
        const coverUrl = coverUrlOf(current.track);
        const publish = function (artwork) {
            session.metadata = new window.MediaMetadata({
                title,
                artist,
                album: '云盘音乐',
                artwork,
            });
        };
        try { publish(mediaArtwork(coverUrl, current.track.name)); }
        catch (err) { /* MediaMetadata unavailable — metadata is optional */ }

        // The artwork is a URL the OS fetches on its own, so a cover that will
        // not load — the zero-byte objects the bucket currently holds, an
        // expired Drive thumbnail, an older Worker's guess — would leave the
        // lock screen blank, where the gradient at least gives it the song's
        // colour. `Cover` answers the same failure the same way in the list;
        // here it costs a second metadata write, because the failure is
        // reported to us and not to the metadata object.
        let probe = null;
        if (coverUrl) {
            probe = new window.Image();
            probe.onerror = () => {
                try { publish(mediaArtwork('', current.track.name)); }
                catch (err) { /* metadata is optional */ }
            };
            probe.src = coverUrl;
        }
        const actions = {
            play: () => { const a = audioRef.current; if (a) safePlay(a); },
            pause: () => { const a = audioRef.current; if (a) a.pause(); },
            previoustrack: playPrev,
            nexttrack: playNext,
        };
        Object.keys(actions).forEach((name) => {
            try { session.setActionHandler(name, actions[name]); } catch (err) { /* action unsupported */ }
        });
        return () => {
            // Detached first: switching songs must not let the outgoing song's
            // cover failure repaint the incoming song's metadata.
            if (probe) probe.onerror = null;
            Object.keys(actions).forEach((name) => {
                try { session.setActionHandler(name, null); } catch (err) { /* ignore on teardown */ }
            });
        };
    }, [current, playPrev, playNext]);

    useEffect(() => {
        if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }, [isPlaying]);

    // No auto-scrolling to the current row — switching tabs or auto-advance
    // must never yank the list position around.

    // Space = play/pause, ←/→ = seek ±10s (ignored while typing in a field).
    useEffect(() => {
        const onKeyDown = function (event) {
            const target = event.target;
            if (
                target
                && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
            ) return;
            const audio = audioRef.current;
            if (!audio || !current) return;
            if (event.code === 'Space') {
                event.preventDefault();
                if (audio.paused || audio.ended) safePlay(audio);
                else audio.pause();
            } else if (event.key === 'ArrowLeft') {
                audio.currentTime = Math.max(0, audio.currentTime - 10);
            } else if (event.key === 'ArrowRight') {
                audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [current]);
    /* --- shared controls, and what the layouts read off the player --- */

    // Seeking is the same operation on both layouts — the phone's sheet slider
    // and the wide-screen progress bar — so it lives here rather than being
    // written out again at each call site.
    const seek = useCallback(function (value) {
        const audio = audioRef.current;
        if (audio && Number.isFinite(value)) {
            audio.currentTime = value;
            setProgress((state) => ({ ...state, time: value }));
        }
    }, []);

    const toggleLyrics = useCallback(function () {
        setLyricsVisible((visible) => !visible);
    }, []);

    // The <audio> element's own handlers. Both layouts mount that element
    // through `PlayerAudio`, and these are handed over ready-made so the two
    // cannot end up wiring a different set of six.
    const onAudioPlay = useCallback(function () {
        setIsPlaying(true);
        // The play count is recorded here — on the element's own `play` event —
        // and not where the track is loaded, because loading is not listening:
        // a restored last track, an autoplay the browser blocked, or a blob
        // that arrived and was never started would all count as a play.
        //
        // Once per track, not once per event: pause/resume fires `play` again,
        // and counting those would make the number a measure of how often the
        // visitor tapped the screen. 单曲循环 resets the guard in `handleEnded`
        // so a genuine repeat still counts.
        //
        // Non-blocking by construction: `recordPlay` writes a few bytes to
        // localStorage and starts a request nobody awaits (see playStats.js),
        // so a slow or dead network cannot delay a note of the song.
        const track = current && current.track;
        if (track && countedTrackRef.current !== track.id) {
            countedTrackRef.current = track.id;
            recordPlay(qq, track);
        }
    }, [current, qq]);

    const onAudioPause = useCallback(function () {
        setIsPlaying(false);
    }, []);

    const onAudioTimeUpdate = useCallback(function (event) {
        setProgress((state) => ({ ...state, time: event.target.currentTime }));
    }, []);

    // `loadedmetadata` and `durationchange` report the same thing and both are
    // needed: the first for a normal load, the second for a stream whose
    // duration only settles once the file is open.
    const onAudioMetadata = useCallback(function (event) {
        setProgress((state) => ({ ...state, duration: event.target.duration || 0 }));
    }, []);

    const sourceName = sourceLabel(librarySource);

    const folderName = librarySource === CLOUD_SOURCE
        ? sourceLabel(CLOUD_SOURCE)
        : (folderId
            ? ((folders.find((folder) => folder.id === folderId) || {}).name || '')
            : '整个云盘');

    // The UI's "connected" flag now means "a library is available", not "Google
    // is authorized": the public R2 library needs no authorization at all.
    const hasLibrary = tracks.length > 0 || listCacheAvailable || Boolean(token);

    // Lyrics belong to the song that is playing; a fetch that lands after a skip
    // must not paint over the new song's panel.
    const currentLyrics = lyrics && current && lyrics.trackId === current.track.id ? lyrics : null;

    return {
        /* appearance */
        theme,
        toggleTheme,
        ripples,
        toggleRipples,

        /* list preferences */
        isPinned,
        togglePin,
        liked,
        isLiked,
        toggleLike,
        likedOnly,
        toggleLikedOnly,

        /* the visitor */
        qq,
        saveQq,

        /* library */
        tracks,
        visibleTracks,
        trackCount: visibleTracks.length,
        listCacheAvailable,
        librarySource,
        sourceName,
        folderName,
        folders,
        folderId,
        handleFolderChange,
        listLoading,
        refreshTracks,
        hasLibrary,
        search,
        setSearch,

        /* playback */
        current,
        loadingId,
        isPlaying,
        progress,
        shuffle,
        repeat,
        playbackMode,
        toggleTrack,
        togglePlay,
        playPrev,
        playNext,
        cycleRepeat,
        cyclePlaybackMode,
        seek,

        /* lyrics */
        lyrics: currentLyrics,
        lyricsLoading,
        lyricsVisible,
        toggleLyrics,

        /* the row drawer (置顶 / 喜欢) */
        rowMenu,
        rowMenuClosing,
        rowMenuId: rowMenu ? rowMenu.id : '',
        openRowMenu,
        closeRowMenu,
        setRowMenu,
        setRowMenuClosing,

        /* cache manager */
        cacheOpen,
        cacheClosing,
        setCacheOpen,
        setCacheClosing,
        cacheEntries,
        cacheLoading,
        cacheBusyId,
        cacheAllRunning,
        cacheProgress,
        goCacheManager,
        closeCacheManager,
        readCache,
        deleteCacheEntries,
        cacheAllTracks,

        /* Google Drive connection sheet */
        driveOpen,
        driveClosing,
        setDriveOpen,
        setDriveClosing,
        openDriveSheet,
        closeDriveSheet,

        /* Google */
        gsiReady,
        setGsiReady,
        clientId,
        clientIdDraft,
        setClientIdDraft,
        token,
        connect,
        disconnect,

        /* feedback */
        error,
        notice,
        setError,

        /* the one <audio> element, and the handlers that go on it.
           Named after the props `core/PlayerAudio` takes, so a shell can hand
           them straight over instead of remapping five names — a typo in a
           remap is a handler that silently never fires. */
        audioRef,
        onEnded: handleEnded,
        onPlay: onAudioPlay,
        onPause: onAudioPause,
        onTimeUpdate: onAudioTimeUpdate,
        onMetadata: onAudioMetadata,
    };
};

export default usePlayer;
