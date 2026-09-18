import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Script from 'next/script';

import { site } from 'config';

import {
    GSI_SRC,
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
    storageGet,
    storageSet,
    safePlay,
    isIOSLike,
    SILENT_WAV,
    parseTrackName,
    makeArtwork,
    listAllFiles,
    parseLyrics,
} from 'components/Music/shared';
import {
    getCachedAudio,
    cacheAudio,
    listCachedAudio,
    deleteCachedAudioMany,
} from 'components/Music/audioCache';
import {
    CLOUD_SOURCE,
    DRIVE_SOURCE,
    audioCacheKey,
    clearListCache,
    downloadTrackBlob,
    fetchCloudTracks,
    fetchDriveTracks,
    fetchLyricsText,
    hasLyrics,
    readListCache,
    sourceLabel,
    writeListCache,
} from 'components/Music/librarySource';
import TrackList from 'components/Music/TrackList';
import NowPlaying from 'components/Music/NowPlaying';
import CacheManager from 'components/Music/CacheManager';
import DriveSheet from 'components/Music/DriveSheet';
import Profile from 'components/Music/Profile';
import MiniPlayer from 'components/Music/MiniPlayer';
import DesktopMusic from 'components/Music/DesktopMusic';
import {
    IconArchive,
    IconGoogleDrive,
    IconMoon,
    IconSun,
} from 'components/Music/icons';

import styles from './MusicApp.module.scss';

/**
 * Shared music app shell, rendered by both routes:
 *
 * - `/h5`      → `variant="h5"` (phone-width: list, profile, player sheet)
 * - `/desktop` → `variant="desktop"` (wide-screen workspace)
 *
 * Every stateful piece lives here exactly once — library sources (public R2 +
 * optional Google Drive), the permanent local caches, playback, lyrics and
 * Media Session — and `variant` only swaps the rendered UI. Authorization never
 * happens on its own: the public library needs none, and Google is only
 * contacted when the visitor asks for it.
 *
 * Playback lives here (single <audio> element, so music keeps running while
 * screens switch): transport controls, shuffle/repeat, seek, in-list search,
 * background auto-advance and Media Session integration. There is
 * deliberately no volume control. The OAuth client ID is the only setup:
 * entered once, kept in localStorage, nothing secret committed.
 */

// How many audio downloads "全部缓存" keeps in flight. Three is the sweet spot
// for this app: enough that a long list finishes in a third of the serial time,
// low enough that a track the visitor taps mid-run still starts quickly, and
// safely under the browser's ~6-per-host connection cap — so the seed pass
// never starves playback or lyrics fetching. Raising it gains little: the
// bottleneck is bandwidth and IndexedDB writes, not the request count.
const CACHE_ALL_CONCURRENCY = 3;

const MusicApp = function ({ variant = 'h5' }) {
    const [theme, setTheme] = useState('light');
    // Display preference of the now-playing page: the ripples travelling out
    // from the record. On unless the visitor turned them off — a decorative
    // effect that has to be switched *on* would be an odd default. Restored
    // and persisted below, next to the theme, since both are display settings.
    const [ripples, setRipples] = useState(true);
    // 'list' | 'profile' — which tab page is showing; the full-screen
    // now-playing page floats above it while `playerOpen` is true.
    const [tab, setTab] = useState('list');
    const [playerOpen, setPlayerOpen] = useState(false);
    // While true the sheet plays its slide-down exit animation and only
    // unmounts when that finishes (`onClosed`).
    const [playerClosing, setPlayerClosing] = useState(false);
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
    const [shuffle, setShuffle] = useState(false);
    // 'off' → 'all' → 'one' → 'off'
    const [repeat, setRepeat] = useState('off');
    const [progress, setProgress] = useState({ time: 0, duration: 0 });
    // Id of the track whose audio blob is (or is being) prefetched.
    const [prefetchId, setPrefetchId] = useState('');
    const [lyrics, setLyrics] = useState(null);
    const [lyricsLoading, setLyricsLoading] = useState(false);
    const [lyricsVisible, setLyricsVisible] = useState(false);
    // The song list's three-dots drawer. It is owned by this shell — not by
    // `TrackList` — because the list column sits under a `transform`ed
    // ancestor, which would break `position: fixed` inside it (see the drawer
    // note in MusicApp.module.scss). `open` mounts it, `closing` plays the exit
    // animation first (the sheet-unmount-via-animation-end trick).
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuClosing, setMenuClosing] = useState(false);
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

    /* --- three-dots drawer --- */

    const closeMenu = useCallback(function () {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setMenuOpen(false);
            setMenuClosing(false);
            return;
        }
        setMenuClosing(true);
    }, []);

    const openMenu = useCallback(function () {
        setMenuClosing(false);
        setMenuOpen(true);
    }, []);

    // Escape closes the drawer while it is open.
    useEffect(() => {
        if (!menuOpen) return undefined;
        const onKeyDown = (event) => { if (event.key === 'Escape') closeMenu(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [menuOpen, closeMenu]);

    // 谷歌云盘链接 — leaves the list for 「我的」, where the Google Drive
    // connection lives.
    /* --- drive sheet --- */

    // The drawer entry opens the Drive screen as a sheet, exactly like "缓存
    // 管理" next to it — the settings page is no longer a destination of its
    // own for this. Connecting stays the only action here that may raise
    // Google's UI.
    const openDriveSheet = useCallback(function () {
        closeMenu();
        setDriveClosing(false);
        setDriveOpen(true);
    }, [closeMenu]);

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

    const readCache = useCallback(async function () {
        setCacheLoading(true);
        const entries = await listCachedAudio();
        // `null` means IndexedDB is unavailable (private mode, old browser) —
        // the sheet then reads as "nothing cached" instead of crashing.
        setCacheEntries(entries || []);
        setCacheLoading(false);
    }, []);

    const openCacheManager = useCallback(function () {
        closeMenu();
        setCacheClosing(false);
        setCacheOpen(true);
        readCache();
    }, [closeMenu, readCache]);

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
        setLyricsVisible(variant === 'desktop' && withLyrics);
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
    }, [current, token, variant]);

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

    const visibleTracks = useMemo(function () {
        const keyword = search.trim().toLowerCase();
        if (!keyword) return tracks;
        return tracks.filter((track) => {
            const { artist, title } = parseTrackName(track.name);
            return (
                track.name.toLowerCase().includes(keyword)
                || title.toLowerCase().includes(keyword)
                || artist.toLowerCase().includes(keyword)
            );
        });
    }, [tracks, search]);

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

    const playNext = useCallback(function () {
        stepTrack(1);
    }, [stepTrack]);

    const playPrev = useCallback(function () {
        // Standard player behaviour: restart the current song first.
        const audio = audioRef.current;
        if (audio && audio.currentTime > 3) {
            audio.currentTime = 0;
            setProgress((state) => ({ ...state, time: 0 }));
            return;
        }
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

    /* --- now-playing transitions (mini bar ⇄ sheet) --- */

    const openPlayer = useCallback(function () {
        setPlayerClosing(false);
        setPlayerOpen(true);
    }, []);

    // Dismiss = slide the sheet back down; it unmounts via `onClosed`.
    // With reduced motion the CSS animation never fires an end event, so
    // unmount immediately instead.
    const closePlayer = useCallback(function (nextTab) {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setPlayerOpen(false);
            setPlayerClosing(false);
        } else {
            setPlayerClosing(true);
        }
        if (nextTab) setTab(nextTab);
    }, []);

    const finishClosePlayer = useCallback(function () {
        setPlayerOpen(false);
        setPlayerClosing(false);
    }, []);

    // A new tap while the exit animation runs — bring the sheet back.
    const cancelClosePlayer = useCallback(function () {
        setPlayerClosing(false);
    }, []);

    // Which track auto-advance will pick up at `ended` (sequential only —
    // shuffle chooses randomly at the last moment, so nothing to prefetch).
    const upcomingTrack = useMemo(function () {
        if (!current || repeat === 'one' || visibleTracks.length === 0) return null;
        if (shuffle) return null;
        const index = visibleTracks.findIndex((track) => track.id === current.track.id);
        if (index === -1) return visibleTracks[0];
        return visibleTracks[index + 1] || (repeat === 'all' ? visibleTracks[0] : null);
    }, [current, repeat, shuffle, visibleTracks]);

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
    // page sits in the background on iOS; only the rare un-cached case
    // (shuffle, dead prefetch) falls back to a foreground fetch.
    const handleEnded = useCallback(function () {
        setIsPlaying(false);
        if (!current) return;
        if (repeat === 'one') {
            const audio = audioRef.current;
            if (audio) {
                audio.currentTime = 0;
                safePlay(audio);
            }
            return;
        }
        if (shuffle && visibleTracks.length > 1) {
            stepTrack(1);
            return;
        }
        const next = visibleTracks[visibleTracks.findIndex((track) => track.id === current.track.id) + 1];
        if (next) play(next);
        else if (repeat === 'all' && visibleTracks.length > 0) play(visibleTracks[0]);
    }, [current, repeat, shuffle, visibleTracks, stepTrack, play]);

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
        return () => audio.removeEventListener('loadedmetadata', seekOnMetadata);
    }, [current]);

    /* --- media session (lock screen / hardware keys) --- */

    useEffect(() => {
        if (!current || typeof window === 'undefined' || !('mediaSession' in navigator)) return undefined;
        const session = navigator.mediaSession;
        const { artist, title } = parseTrackName(current.track.name);
        try {
            const metadata = new window.MediaMetadata({
                title,
                artist,
                album: '云盘音乐',
            });
            const artwork = makeArtwork(current.track.name);
            if (artwork) {
                metadata.artwork = [{ src: artwork, sizes: '320x320', type: 'image/png' }];
            }
            session.metadata = metadata;
        } catch (err) { /* MediaMetadata unavailable — metadata is optional */ }
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

    /* --- render --- */

    const folderName = librarySource === CLOUD_SOURCE
        ? sourceLabel(CLOUD_SOURCE)
        : (folderId
            ? ((folders.find((folder) => folder.id === folderId) || {}).name || '')
            : '整个云盘');

    // The UI's "connected" flag now means "a library is available", not "Google
    // is authorized": the public R2 library needs no authorization at all.
    const hasLibrary = tracks.length > 0 || listCacheAvailable || Boolean(token);

    return (
        <div className={`${styles.page} ${theme === 'dark' ? styles['theme-dark'] : ''}`}>
            <Head>
                <title>{`音乐 | ${site.title}`}</title>
                <meta name="description" content={site.description} />
            </Head>

            <Script
                src={GSI_SRC}
                strategy="afterInteractive"
                onLoad={() => setGsiReady(true)}
                onError={() => setError('Google 登录组件加载失败，请检查网络')}
            />

            {/* Ambient blobs belong to the phone layout only — the desktop
                workspace paints its own flat background. */}
            {variant !== 'desktop' && (
                <div className={styles.bg} aria-hidden="true">
                    <span className={`${styles.blob} ${styles['blob-1']}`} />
                    <span className={`${styles.blob} ${styles['blob-2']}`} />
                    <span className={`${styles.blob} ${styles['blob-3']}`} />
                </div>
            )}

            {variant === 'desktop' ? (
                <DesktopMusic
                    theme={theme}
                    onToggleTheme={toggleTheme}
                    connected={!!token}
                    source={librarySource}
                    sourceName={sourceLabel(librarySource)}
                    hasLibrary={hasLibrary}
                    cached={listCacheAvailable}
                    gsiReady={gsiReady}
                    clientIdDraft={clientIdDraft}
                    onClientIdDraft={setClientIdDraft}
                    onConnect={connect}
                    onDisconnect={disconnect}
                    folders={folders}
                    folderId={folderId}
                    folderName={folderName}
                    onFolderChange={handleFolderChange}
                    onRefresh={refreshTracks}
                    listLoading={listLoading}
                    tracks={tracks}
                    visibleTracks={visibleTracks}
                    search={search}
                    onSearch={setSearch}
                    current={current}
                    loadingId={loadingId}
                    isPlaying={isPlaying}
                    onToggleTrack={toggleTrack}
                    onTogglePlay={togglePlay}
                    onPrev={playPrev}
                    onNext={playNext}
                    onSeek={(value) => {
                        const audio = audioRef.current;
                        if (audio && Number.isFinite(value)) {
                            audio.currentTime = value;
                            setProgress((state) => ({ ...state, time: value }));
                        }
                    }}
                    progress={progress}
                    shuffle={shuffle}
                    repeat={repeat}
                    onToggleShuffle={() => setShuffle((on) => !on)}
                    onCycleRepeat={cycleRepeat}
                    lyrics={lyrics && current && lyrics.trackId === current.track.id ? lyrics : null}
                    lyricsLoading={lyricsLoading}
                    lyricsVisible={lyricsVisible}
                    onToggleLyrics={() => setLyricsVisible((visible) => !visible)}
                    ripples={ripples}
                    onToggleRipples={toggleRipples}
                />
            ) : (
                <>
                    <div className={styles.app}>
                        {/* Both tab pages stay mounted (scroll position survives the
                    switch); the shown one replays its enter transition. */}
                        <div
                            className={`${styles.view}${tab === 'list' ? ` ${styles['view-in']}` : ''}`}
                            style={{ display: tab === 'list' ? undefined : 'none' }}
                        >
                            <TrackList
                                connected={hasLibrary}
                                source={librarySource}
                                listLoading={listLoading}
                                visibleTracks={visibleTracks}
                                search={search}
                                onSearch={setSearch}
                                current={current}
                                loadingId={loadingId}
                                isPlaying={isPlaying}
                                onToggleTrack={toggleTrack}
                                onGoProfile={() => setTab('profile')}
                                menuOpen={menuOpen && !menuClosing}
                                onOpenMenu={openMenu}
                            />
                        </div>
                        <div
                            className={`${styles.view}${tab === 'profile' ? ` ${styles['view-in']}` : ''}`}
                            style={{ display: tab === 'profile' ? undefined : 'none' }}
                        >
                            <Profile
                                sourceName={sourceLabel(librarySource)}
                                driveConnected={!!token}
                                folders={folders}
                                folderId={folderId}
                                folderName={folderName}
                                onFolderChange={handleFolderChange}
                                onRefresh={refreshTracks}
                                loading={listLoading}
                                trackCount={tracks.length}
                                onGoList={() => setTab('list')}
                            />
                        </div>
                    </div>

                    {/* Mini bar belongs to the song list only — the profile page
                shows settings, not playback UI. It also carries the jump-to-
                the-playing-track button, which is why it is the one place the
                list's loading state is still needed. */}
                    {tab === 'list' && current && !playerOpen && (
                        <MiniPlayer
                            current={current}
                            isPlaying={isPlaying}
                            progress={progress}
                            listLoading={listLoading}
                            onTogglePlay={togglePlay}
                            onNext={playNext}
                            onOpenPlayer={openPlayer}
                        />
                    )}

                    {playerOpen && current && (
                        <NowPlaying
                            track={current.track}
                            isPlaying={isPlaying}
                            progress={progress}
                            mode={playbackMode}
                            listLoading={listLoading}
                            closing={playerClosing}
                            onClosed={finishClosePlayer}
                            onCancelClose={cancelClosePlayer}
                            onCycleMode={cyclePlaybackMode}
                            onTogglePlay={togglePlay}
                            onPrev={playPrev}
                            onNext={playNext}
                            onSeek={(value) => {
                                const audio = audioRef.current;
                                if (audio && Number.isFinite(value)) {
                                    audio.currentTime = value;
                                    setProgress((state) => ({ ...state, time: value }));
                                }
                            }}
                            onClose={() => closePlayer()}
                            onOpenList={() => closePlayer('list')}
                            lyrics={lyrics && lyrics.trackId === current.track.id ? lyrics : null}
                            lyricsLoading={lyricsLoading}
                            lyricsVisible={lyricsVisible}
                            onToggleLyrics={() => setLyricsVisible((visible) => !visible)}
                            ripples={ripples}
                            onToggleRipples={toggleRipples}
                        />
                    )}
                </>
            )}

            {/* Bottom drawer opened by the song list's three-dots button. It
                belongs to the shell, so on a wide screen it stays centred over
                the phone column instead of hanging off the list. */}
            {menuOpen && (
                <div
                    className={menuClosing
                        ? `${styles['menu-scrim']} ${styles['menu-scrim-out']}`
                        : styles['menu-scrim']}
                    role="presentation"
                    onClick={closeMenu}
                    onAnimationEnd={(event) => {
                        // Only the scrim's own fade ends the drawer; the sheet
                        // and its children animate independently.
                        if (menuClosing && event.target === event.currentTarget) {
                            setMenuOpen(false);
                            setMenuClosing(false);
                        }
                    }}
                >
                    <div
                        className={menuClosing
                            ? `${styles.menu} ${styles['menu-out']}`
                            : styles.menu}
                        role="menu"
                        aria-label="更多功能"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <span className={styles['menu-grip']} aria-hidden="true" />
                        <button
                            type="button"
                            className={styles['menu-item']}
                            role="menuitem"
                            onClick={openDriveSheet}
                        >
                            <span className={styles['menu-icon']} aria-hidden="true">
                                <IconGoogleDrive size={20} />
                            </span>
                            <span className={styles['menu-text']}>
                                <span className={styles['menu-title']}>谷歌云盘链接</span>
                                <span className={styles['menu-sub']}>连接或切换自己的云盘曲库</span>
                            </span>
                        </button>
                        <button
                            type="button"
                            className={styles['menu-item']}
                            role="menuitem"
                            onClick={goCacheManager}
                        >                            <span className={styles['menu-icon']} aria-hidden="true">
                                <IconArchive size={20} />
                            </span>
                            <span className={styles['menu-text']}>
                                <span className={styles['menu-title']}>缓存管理</span>
                                <span className={styles['menu-sub']}>查看已缓存的歌曲，可单独或全部删除</span>
                            </span>
                        </button>
                        {/* Appearance sits below the cache entry so the drawer
                            reads as app actions first, display preference last. */}
                        <button
                            type="button"
                            className={styles['menu-item']}
                            role="menuitem"
                            onClick={toggleTheme}
                        >
                            <span className={styles['menu-icon']} aria-hidden="true">
                                {theme === 'dark' ? <IconSun size={20} /> : <IconMoon size={20} />}
                            </span>
                            <span className={styles['menu-text']}>
                                <span className={styles['menu-title']}>切换外观</span>
                                <span className={styles['menu-sub']}>
                                    {theme === 'dark' ? '当前深色模式，点击切换到浅色' : '当前浅色模式，点击切换到深色'}
                                </span>
                            </span>
                            <span className={styles['menu-value']}>
                                {theme === 'dark' ? '深色' : '浅色'}
                            </span>
                        </button>
                    </div>
                </div>
            )}

            {cacheOpen && (
                <CacheManager
                    entries={cacheEntries}
                    tracks={tracks}
                    loading={cacheLoading}
                    busyId={cacheBusyId}
                    caching={cacheAllRunning}
                    cacheProgress={cacheProgress}
                    closing={cacheClosing}
                    onClosed={() => { setCacheOpen(false); setCacheClosing(false); }}
                    onCancelClose={() => setCacheClosing(false)}
                    onClose={closeCacheManager}
                    onRefresh={readCache}
                    onDelete={deleteCacheEntries}
                    onCacheAll={cacheAllTracks}
                />
            )}

            {driveOpen && (
                <DriveSheet
                    driveConnected={!!token}
                    sourceName={sourceLabel(librarySource)}
                    gsiReady={gsiReady}
                    clientId={clientId}
                    clientIdDraft={clientIdDraft}
                    onClientIdDraft={setClientIdDraft}
                    onConnect={connect}
                    onDisconnect={disconnect}
                    folders={folders}
                    folderId={folderId}
                    onFolderChange={handleFolderChange}
                    loading={listLoading}
                    trackCount={tracks.length}
                    closing={driveClosing}
                    onClosed={() => { setDriveOpen(false); setDriveClosing(false); }}
                    onCancelClose={() => setDriveClosing(false)}
                    onClose={closeDriveSheet}
                    onRefresh={refreshTracks}
                    onGoList={() => { closeDriveSheet(); setTab('list'); }}
                />
            )}

            {(error || notice) && (
                <div className={`${styles.toast}${error ? ` ${styles['toast-error']}` : ''}`} role="status">
                    {error || notice}
                </div>
            )}

            <audio
                ref={audioRef}
                preload="auto"
                playsInline
                onEnded={handleEnded}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onTimeUpdate={(event) => setProgress((state) => ({ ...state, time: event.target.currentTime }))}
                onLoadedMetadata={(event) => setProgress((state) => ({ ...state, duration: event.target.duration || 0 }))}
                onDurationChange={(event) => setProgress((state) => ({ ...state, duration: event.target.duration || 0 }))}
            >
                <track kind="captions" />
            </audio>
        </div>
    );
};

export default MusicApp;
