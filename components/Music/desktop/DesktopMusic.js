import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
    IconArchive,
    IconChevronRight,
    IconCloud,
    IconClose,
    IconDislike,
    IconFolder,
    IconGear,
    IconGoogleDrive,
    IconLogout,
    IconLocate,
    IconMoon,
    IconMoreVertical,
    IconMusicSpace,
    IconNext,
    IconNote,
    IconPanel,
    IconPause,
    IconPlay,
    IconPrev,
    IconQueue,
    IconRefresh,
    IconRepeat,
    IconRepeatOne,
    IconRipple,
    IconSearch,
    IconShuffle,
    IconSun,
} from '../icons';
import {
    DESKTOP_LIST_KEY,
    emptyListMessage,
    formatSize,
    formatTime,
    parseTrackName,
    storageGet,
    storageSet,
    trackGradient,
} from '../shared';
import { DRIVE_SOURCE } from '../librarySource';
import Cover from '../Cover';
import Marquee from '../Marquee';

import styles from './DesktopMusic.module.scss';

// Playback modes of the player's single cycling control, in the order the
// button walks them: 关闭 → 列表循环 → 单曲循环 → 随机 → 关闭. Same order and
// same icons as the phone player, so both layouts teach one muscle memory.
const MODES = {
    off: { icon: <IconRepeat />, title: '循环关闭' },
    all: { icon: <IconRepeat />, title: '列表循环' },
    one: { icon: <IconRepeatOne />, title: '单曲循环' },
    shuffle: { icon: <IconShuffle />, title: '随机播放' },
};

// How long the landed row stays tinted after a jump, and how long the button
// hides itself for while the scroll is still travelling (see `jumpToCurrent`).
// Same numbers as the phone bar's button — one behaviour, two layouts.
const PULSE_MS = 1100;
const PULSE_MS_REDUCED = 400;
const SETTLE_MS = 700;

/**
 * Decorative tonearm, drawn in the record rig's own coordinate space
 * (100 × 122 — the rig's aspect ratio) so it scales with the record instead of
 * drifting off it. `playing` swings the arm down to track the groove. Geometry
 * is shared verbatim with the phone player (`NowPlaying.js`) so the desktop
 * record is the same object, just larger.
 */
const Tonearm = function ({ playing }) {
    return (
        <svg
            className={playing ? `${styles.arm} ${styles['arm-playing']}` : styles.arm}
            viewBox="0 0 100 122"
            aria-hidden="true"
            focusable="false"
        >
            <g className={styles['arm-swing']}>
                <path
                    d="M52.5 4.6 C 56 13, 62 21, 68.5 26 C 73 29.4, 76.5 30.2, 78.8 30.3"
                    fill="none"
                    stroke="#f2f3f7"
                    strokeWidth="3"
                    strokeLinecap="round"
                />
                <g transform="rotate(28 78.8 30.3)">
                    <rect x="76.6" y="27.5" width="11.6" height="5.6" rx="2.1" fill="#f2f3f7" />
                    <rect x="85.4" y="28.8" width="3.6" height="3" rx="1.2" fill="#dfe2ea" />
                    <rect x="79.4" y="29.2" width="1.7" height="2.2" rx="0.7" fill="#26272e" />
                </g>
                <circle cx="52.5" cy="4.6" r="5" fill="rgba(255, 255, 255, 0.12)" />
                <circle cx="52.5" cy="4.6" r="3" fill="#191a20" stroke="#f2f3f7" strokeWidth="1.6" />
                <circle cx="52.5" cy="4.6" r="1" fill="#f2f3f7" />
            </g>
        </svg>
    );
};

/**
 * Wide-screen (desktop) music workspace, used by `/desktop`.
 *
 * Layout follows the brief: the *player* owns the centre and gets the most
 * space, the *bottom bar* is the second most important surface (it is the
 * transport and is always reachable), and the *song list* lives on the left
 * where it can be folded away entirely.
 *
 * ┌──────────┬──────────────────────────────────────────┐
 * │ 列表(可藏) │               播放器(主题)                │
 * │          ├──────────────────────────────────────────┤
 * │          │              底部播放条(次要)              │
 * └──────────┴──────────────────────────────────────────┘
 *
 * Every feature of the phone layout is reproduced here: the same track list
 * (thumb + gradient cover, spinning loader, equalizer bars, search, refresh),
 * the same record rig (tonearm that drops onto the groove, ripples, lyrics
 * that swap in over the disc), the same single cycling playback-mode button
 * and the same settings (source, Drive connection, folder, theme, cache info).
 *
 * Glass is CSS, not WebGL: every surface is a `backdrop-filter` over the
 * `.backdrop` colour field, styled by `DesktopMusic.module.scss` from the
 * `--glass-*` tokens. There is no glass library, no `data-glass` attribute and
 * nothing to initialise — which also means nothing can fail to initialise.
 */
const DesktopMusic = function ({
    theme,
    onToggleTheme,
    connected,
    source,
    sourceName,
    hasLibrary,
    cached,
    gsiReady,
    clientIdDraft,
    onClientIdDraft,
    onConnect,
    onDisconnect,
    folders,
    folderId,
    folderName,
    onFolderChange,
    onRefresh,
    listLoading,
    visibleTracks,
    // Count the badge and the folder row show. `visibleTracks` is the list
    // after the visitor's preferences, so this is what agrees with what they
    // can actually see — a hidden song must not stay in the total.
    trackCount,
    search,
    onSearch,
    current,
    loadingId,
    isPlaying,
    onToggleTrack,
    onTogglePlay,
    onPrev,
    onNext,
    onSeek,
    progress,
    shuffle,
    repeat,
    onCycleRepeat,
    lyrics,
    lyricsLoading,
    lyricsVisible,
    onToggleLyrics,
    ripples = true,
    onToggleRipples,
    // Id of the row whose actions are open. The drawer itself belongs to the
    // shell (the same one the phone layout opens, in its own desktop dress), so
    // all this needs is the id to report which row's button is expanded — the
    // 置顶 / 移入不喜欢 callbacks live there, not here.
    rowMenuId,
    onOpenRowMenu,
    // The cache manager and the disliked-songs screen are shell-owned too —
    // they are rendered beside the layout, not inside it — so the desktop
    // layout only has to be able to ask for them.
    onOpenCache,
    onOpenDisliked,
    dislikedCount = 0,
    // The library *before* the list preferences and the search ran — the only
    // way to tell "this library is empty" from "this library is all hidden".
    // See `emptyListMessage`.
    libraryCount = 0,
}) {
    const searchInputRef = useRef(null);
    const activeLyricRef = useRef(null);
    const pressYRef = useRef(0);
    const [settingsOpen, setSettingsOpen] = useState(false);
    // `false` = folded away, only the rail button remains. Defaults to open.
    const [listOpen, setListOpen] = useState(true);
    const [searchOpen, setSearchOpen] = useState(false);
    // The list header's three-dots popover: 'more' | ''. It is only ever the
    // popover itself — the entries inside it open the shell-owned sheets
    // (settings, cache manager, disliked songs) and close this again.
    const [menu, setMenu] = useState('');
    // Playback mode announce, centred on the stage for a moment — same
    // behaviour as the phone player's mode toast.
    const [modeToast, setModeToast] = useState('');
    const lastModeRef = useRef('');
    const modeTimerRef = useRef(0);
    const menuRef = useRef(null);
    const [cacheCount, setCacheCount] = useState(0);

    // --- "jump to the playing track" ---------------------------------------
    //
    // The phone layout puts this button on the mini bar's shoulder, because the
    // bar is the one fixed thing there. The desktop has no bar over the list —
    // its equivalent fixed edge is the panel itself — so the button is pinned to
    // the scroller's bottom corner instead, and the row lookup runs against this
    // component's own ref rather than through the phone layout's list id.
    const listRef = useRef(null);
    // Hidden while the playing row is on screen: the button is a nudge back, not
    // a permanent fixture. Starts false so it cannot flash before the first
    // measurement lands, and is re-measured whenever the row might have moved
    // (song change, filtering, list reload).
    const [rowOffScreen, setRowOffScreen] = useState(false);
    // True for the length of a jump — the scroll is already on its way and the
    // list is about to move underneath, so the button is the wrong thing to
    // leave under the pointer.
    const [jumping, setJumping] = useState(false);
    const settleRef = useRef(null);
    const pulseRef = useRef(null);

    // Restored on mount and written back on every change, from one effect.
    //
    // One effect rather than a read-effect plus a write-effect: the two would
    // race on the mount commit, because effects run in declaration order and
    // the writer would still see the pre-restore default — storing it over the
    // visitor's choice. Both effects would look correct on their own.
    //
    // Restoring here rather than in `useState` is deliberate: this is a static
    // export, so an initialiser that touches localStorage would also run during
    // prerender and hand the client markup that disagrees with what it reads.
    //
    // Both values are matched explicitly, and nothing is written until the
    // visitor actually folds the panel away or back, so "no value saved yet"
    // stays a state of its own.
    const listPrefSyncedRef = useRef(false);
    useEffect(() => {
        if (!listPrefSyncedRef.current) {
            listPrefSyncedRef.current = true;
            const saved = storageGet(DESKTOP_LIST_KEY);
            if (saved === 'on') setListOpen(true);
            else if (saved === 'off') setListOpen(false);
            return;
        }
        storageSet(DESKTOP_LIST_KEY, listOpen ? 'on' : 'off');
    }, [listOpen]);

    const meta = current ? parseTrackName(current.track.name) : null;
    const title = meta ? meta.title : '还没有播放中的歌曲';
    const artist = meta ? meta.artist : `${sourceName} · 从左侧列表挑一首开始`;
    const gradient = current ? trackGradient(current.track.name) : 'linear-gradient(135deg, #fb5c74, #fa233b)';
    const percent = progress.duration > 0
        ? Math.min(100, Math.max(0, (progress.time / progress.duration) * 100))
        : 0;
    const keyword = search.trim();
    const currentId = current ? current.track.id : '';
    const eqClass = `${styles.eq}${isPlaying ? '' : ` ${styles['eq-paused']}`}`;

    // The phone layout folds shuffle and repeat into one cycling button; so
    // does this one, so the two layouts share the same interaction.
    const mode = shuffle ? 'shuffle' : repeat;
    const playback = MODES[mode] || MODES.off;

    const activeLyric = lyrics && lyrics.timed
        ? lyrics.lines.reduce((index, line, lineIndex) => (line.time <= progress.time ? lineIndex : index), -1)
        : -1;
    const canToggleLyrics = Boolean(lyrics) || lyricsLoading;
    const lyricsShown = Boolean(lyricsVisible && canToggleLyrics);

    const visibleCount = visibleTracks.length;

    useEffect(() => {
        if (activeLyric >= 0 && activeLyricRef.current) {
            activeLyricRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }, [activeLyric, lyricsShown]);

    useEffect(() => {
        if (!searchOpen) return;
        const input = searchInputRef.current;
        if (input) input.focus();
    }, [searchOpen]);

    // Announce each mode change on the stage, but never the mode the page
    // happens to mount with (that is not a tap).
    useEffect(() => {
        if (!current) { lastModeRef.current = mode; return undefined; }
        if (!lastModeRef.current) { lastModeRef.current = mode; return undefined; }
        if (lastModeRef.current === mode) return undefined;
        lastModeRef.current = mode;
        setModeToast((MODES[mode] || MODES.off).title);
        window.clearTimeout(modeTimerRef.current);
        modeTimerRef.current = window.setTimeout(() => setModeToast(''), 1400);
        return () => window.clearTimeout(modeTimerRef.current);
    }, [mode, current]);

    useEffect(() => {
        if (!settingsOpen) return undefined;
        const onKeyDown = (event) => { if (event.key === 'Escape') setSettingsOpen(false); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [settingsOpen]);

    // The three-dots menu closes on any outside click / Escape.
    useEffect(() => {
        if (!menu) return undefined;
        const onPointerDown = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) setMenu('');
        };
        const onKeyDown = (event) => { if (event.key === 'Escape') setMenu(''); };
        window.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [menu]);

    // How many tracks are already cached locally — the settings drawer reports
    // it the way the phone's cache manager does, so the number is honest.
    useEffect(() => {
        if (!settingsOpen) return undefined;
        let alive = true;
        const run = async function () {
            try {
                const { listCachedAudio } = await import('../audioCache');
                const entries = await listCachedAudio();
                if (alive) setCacheCount(Array.isArray(entries) ? entries.length : 0);
            } catch (err) { /* cache layer is best-effort */ }
        };
        run();
        return () => { alive = false; };
    }, [settingsOpen]);

    const closeSearch = function () {
        setSearchOpen(false);
        onSearch('');
    };

    // --- the jump button's bookkeeping -------------------------------------

    // `currentId` itself is declared with the other derived values above — the
    // row lookup reads the same one the list marks its rows with.
    const rowOf = useCallback(function () {
        const list = listRef.current;
        return list && currentId
            ? list.querySelector(`[data-track-id="${CSS.escape(currentId)}"]`)
            : null;
    }, [currentId]);

    // The scroller *is* the list here — the panel's header and footer are its
    // siblings, not overlays — so the plain viewport of `.list` is already the
    // right frame and no inset is needed (the phone layout needs its insets
    // because a floating header and the mini bar cover its list's ends).
    //
    // `visibleCount` is in the deps for the case where the playing row stops
    // being rendered at all — a search that filters it out. A removed node
    // generates no further entries, so without re-running here the last reading
    // would stick and the button would offer a jump to a row that is not there.
    useEffect(() => {
        const row = rowOf();
        if (!row) {
            setRowOffScreen(false);
            return undefined;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => setRowOffScreen(!entry.isIntersecting));
            },
            { root: listRef.current, threshold: 0 },
        );
        observer.observe(row);
        return () => observer.disconnect();
    }, [rowOf, listLoading, visibleCount]);

    useEffect(() => () => {
        window.clearTimeout(settleRef.current);
        window.clearTimeout(pulseRef.current);
    }, []);

    const jumpToCurrent = useCallback(function () {
        const row = rowOf();
        if (!row) return;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        row.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
        // The row was already the playing one, so the flash is what answers
        // "where did it go?" rather than the accent title the row always had.
        // It lands on the <li> and shows through the row's own tint — hence the
        // radius in `.track-pulse`, so the flash follows the row's rounding.
        row.classList.add(styles['track-pulse']);
        window.clearTimeout(pulseRef.current);
        pulseRef.current = window.setTimeout(
            () => row.classList.remove(styles['track-pulse']),
            reduced ? PULSE_MS_REDUCED : PULSE_MS,
        );
        setJumping(true);
        window.clearTimeout(settleRef.current);
        settleRef.current = window.setTimeout(() => setJumping(false), SETTLE_MS);
    }, [rowOf]);

    const openMenu = function (which) {
        setMenu((open) => (open === which ? '' : which));
    };

    const handleLyricsClick = function (event) {
        if (Math.abs(event.clientY - pressYRef.current) > 8) return;
        onToggleLyrics();
    };

    return (
        <div
            className={`${styles.root}${listOpen ? '' : ` ${styles['list-collapsed']}`}`}
        >
            {/* The colour field the frosted surfaces sample — the root's own
                background is never blurred by its children, so the gradients
                have to be painted by a layer *behind* them. */}
            <div className={styles.backdrop} aria-hidden="true" />

            {/* --- left: the song list (hideable) -------------------------- */}

            <aside className={`${styles.panel}${listOpen ? ` ${styles['panel-open']}` : ''}`}>
                <header className={styles['panel-head']}>
                    <div className={styles.brand}>
                        <span className={styles['brand-mark']}>
                            {source === DRIVE_SOURCE
                                ? <IconGoogleDrive size={22} />
                                : <IconMusicSpace size={24} />}
                        </span>
                        <span className={styles['brand-text']}>
                            <span className={styles['brand-name']}>
                                {source === DRIVE_SOURCE ? 'Google Drive' : 'Music Space'}
                            </span>
                            <span className={styles['brand-sub']}>
                                {listLoading ? '同步中…' : `${trackCount} 首`}
                                {folderName ? ` · ${folderName}` : ''}
                            </span>
                        </span>
                    </div>
                    <button
                        type="button"
                        className={`${styles['rail-btn']}${listLoading ? ` ${styles.spin}` : ''}`}
                        title="刷新列表"
                        aria-label="刷新列表"
                        disabled={listLoading}
                        onClick={onRefresh}
                    >
                        <IconRefresh />
                    </button>
                </header>

                <div className={styles['panel-tools']}>
                    {searchOpen ? (
                        <label className={styles.search}>
                            <span className={styles['search-icon']}><IconSearch /></span>
                            <input
                                ref={searchInputRef}
                                type="search"
                                value={search}
                                onChange={(event) => onSearch(event.target.value)}
                                onKeyDown={(event) => { if (event.key === 'Escape') closeSearch(); }}
                                placeholder="搜索歌曲或歌手"
                                aria-label="搜索歌曲或歌手"
                            />
                            <button
                                type="button"
                                className={styles['search-close']}
                                title="关闭搜索"
                                aria-label="关闭搜索"
                                onClick={closeSearch}
                            >
                                ×
                            </button>
                        </label>
                    ) : (
                        <button
                            type="button"
                            className={styles['tool-btn']}
                            title="搜索"
                            aria-label="搜索"
                            onClick={() => setSearchOpen(true)}
                        >
                            <IconSearch />
                            <span>搜索歌曲</span>
                        </button>
                    )}
                    <div className={styles['menu-wrap']} ref={menuRef}>
                        <button
                            type="button"
                            className={`${styles['rail-btn']}${menu ? ` ${styles['rail-btn-on']}` : ''}`}
                            title="更多"
                            aria-label="更多"
                            aria-haspopup="menu"
                            aria-expanded={Boolean(menu)}
                            onClick={() => openMenu('more')}
                        >
                            <IconMoreVertical />
                        </button>
                        {menu && (
                            <div className={styles.menu} role="menu" aria-label="更多功能">
                                <button
                                    type="button"
                                    className={styles['menu-item']}
                                    role="menuitem"
                                    onClick={() => { setMenu(''); setSettingsOpen(true); }}
                                >
                                    <span className={styles['menu-icon']} aria-hidden="true"><IconGoogleDrive size={20} /></span>
                                    <span className={styles['menu-text']}>
                                        <span className={styles['menu-title']}>谷歌云盘链接</span>
                                        <span className={styles['menu-sub']}>
                                            {connected ? '已连接，可在设置里切换或断开' : '连接或切换自己的云盘曲库'}
                                        </span>
                                    </span>
                                    <IconChevronRight />
                                </button>
                                {/* The cache manager and the disliked-songs
                                    screen are shell-owned sheets, the same ones
                                    the phone layout opens — so these entries
                                    raise them rather than dropping the visitor
                                    into the settings drawer, which only ever
                                    reported a count. */}
                                <button
                                    type="button"
                                    className={styles['menu-item']}
                                    role="menuitem"
                                    onClick={() => { setMenu(''); onOpenCache(); }}
                                >
                                    <span className={styles['menu-icon']} aria-hidden="true"><IconArchive size={20} /></span>
                                    <span className={styles['menu-text']}>
                                        <span className={styles['menu-title']}>缓存管理</span>
                                        <span className={styles['menu-sub']}>查看已缓存的歌曲，可单独或全部删除</span>
                                    </span>
                                    <IconChevronRight />
                                </button>
                                <button
                                    type="button"
                                    className={styles['menu-item']}
                                    role="menuitem"
                                    onClick={() => { setMenu(''); onOpenDisliked(); }}
                                >
                                    <span className={styles['menu-icon']} aria-hidden="true"><IconDislike size={20} /></span>
                                    <span className={styles['menu-text']}>
                                        <span className={styles['menu-title']}>不喜欢歌曲</span>
                                        <span className={styles['menu-sub']}>查看已隐藏的歌曲，可移出让它回到列表</span>
                                    </span>
                                    <span className={styles['menu-value']}>
                                        {dislikedCount > 0 ? `${dislikedCount} 首` : ''}
                                    </span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* `hasLibrary` — not `connected` — decides whether there is a
                    library to show. The public library needs no authorization,
                    so gating on the Google token meant the panel showed
                    「曲库里还没有歌曲 / 去连接」 on top of a fully loaded public
                    list and only revealed the songs once a drive was linked.
                    `connected` still drives the drive-specific rows further
                    down, which is what it actually means.

                    The `listLoading` guard keeps a first visit — no list cache
                    yet — from reading as "nothing here" while the public
                    library is still arriving. */}
                <div className={styles['list-wrap']}>
                    {!hasLibrary && !listLoading ? (
                        <section className={styles.connect}>
                            <span className={styles['connect-icon']}><IconQueue /></span>
                            <h2 className={styles['connect-title']}>曲库里还没有歌曲</h2>
                            <p className={styles['connect-sub']}>
                                公共曲库暂时是空的；也可以连接 Google 云盘，
                                播放你自己云盘里的音乐。
                            </p>
                            <button type="button" className={styles['connect-btn']} onClick={() => setSettingsOpen(true)}>
                                去连接
                            </button>
                        </section>
                    ) : visibleCount === 0 ? (
                        <p className={styles['list-empty']}>
                            {emptyListMessage({
                                listLoading,
                                keyword,
                                libraryCount,
                                folderHint: '设置',
                            })}
                        </p>
                    ) : (
                        <ul className={styles.list} ref={listRef}>
                            {visibleTracks.map((track) => {
                                const item = parseTrackName(track.name);
                                const active = track.id === currentId;
                                const loading = loadingId === track.id;
                                const rowMenuOpen = rowMenuId === track.id;
                                return (
                                    // Two sibling controls rather than a button
                                    // wrapping another button — the nested one is
                                    // invalid HTML and gets torn out of the
                                    // accessibility tree. The play target keeps the
                                    // row's width; the three-dots button sits beside
                                    // it and raises the same row drawer the phone
                                    // layout opens (置顶 / 移入不喜欢).
                                    <li key={track.id} data-track-id={track.id} className={styles['track-row']}>
                                        <button
                                            type="button"
                                            className={active ? styles['item-active'] : styles.item}
                                            disabled={loading}
                                            onClick={() => onToggleTrack(track)}
                                            title={`${item.title} - ${item.artist}`}
                                        >
                                            <span
                                                className={styles['item-thumb']}
                                                style={{ background: trackGradient(track.name) }}
                                                aria-hidden="true"
                                            >
                                                {/* First child on purpose: the
                                                    cover swallows the note glyph
                                                    underneath it, but the
                                                    play/pause scrim below has to
                                                    land on top of the photo. */}
                                                <Cover track={track} />
                                                {active && !loading ? (
                                                    <span className={styles['thumb-overlay']}>
                                                        {isPlaying ? <IconPause /> : <IconPlay />}
                                                    </span>
                                                ) : (
                                                    <IconNote />
                                                )}
                                            </span>
                                            <span className={styles['item-text']}>
                                                <span className={styles['item-title']}>{item.title}</span>
                                                <span className={styles['item-artist']}>{item.artist}</span>
                                            </span>
                                            {loading ? (
                                                <span className={`${styles['item-flag']} ${styles.spin}`} aria-hidden="true">
                                                    <IconRefresh />
                                                </span>
                                            ) : active ? (
                                                <span className={eqClass} aria-hidden="true"><i /><i /><i /></span>
                                            ) : null}
                                        </button>
                                        <button
                                            type="button"
                                            className={rowMenuOpen
                                                ? `${styles['item-more']} ${styles['item-more-on']}`
                                                : styles['item-more']}
                                            title="更多操作"
                                            aria-label={`${item.title} 的更多操作`}
                                            aria-haspopup="menu"
                                            aria-expanded={rowMenuOpen}
                                            onClick={() => onOpenRowMenu(track)}
                                        >
                                            <IconMoreVertical />
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}

                    {/* Pinned to the scroller's bottom corner, not to a row:
                        it has to stay put while the list moves under it. The
                        phone bar carries the same button on its shoulder. */}
                    {!listLoading && rowOffScreen && !jumping && (
                        <button
                            type="button"
                            className={styles['locate-btn']}
                            title="回到正在播放"
                            aria-label="回到正在播放"
                            onClick={jumpToCurrent}
                        >
                            <IconLocate />
                        </button>
                    )}
                </div>

                <footer className={styles['panel-foot']}>
                    {/* What this reports is where the *list* came from, not
                        whether the app works offline — with no service worker
                        it does not, so 「离线可用」 claimed something the site
                        cannot do. `cached` is `listCacheAvailable`: the library
                        was rendered from localStorage instead of a fresh
                        fetch. */}
                    <span>{cached ? '列表已缓存' : '在线'}</span>
                    <span className={styles['foot-sep']} aria-hidden="true">·</span>
                    <button type="button" className={styles['foot-link']} onClick={onToggleTheme}>
                        {theme === 'dark' ? '浅色' : '深色'}
                    </button>
                </footer>
            </aside>

            {/* Folded to a rail; the button is the way back. */}
            <button
                type="button"
                className={styles['rail-toggle']}
                onClick={() => setListOpen((open) => !open)}
                aria-expanded={listOpen}
                aria-label={listOpen ? '隐藏列表' : '显示列表'}
                title={listOpen ? '隐藏列表' : '显示列表'}
            >
                <IconPanel />
            </button>

            {/* --- centre: the player (the theme of the workspace) --------- */}

            {/* 1/4 — settings entry, top-right */}
            <button
                type="button"
                className={styles['settings-btn']}
                onClick={() => setSettingsOpen(true)}
                aria-label="打开设置"
                title="设置"
            >
                <IconGear />
            </button>

            {/* 2/4 — the record (glass) */}
            <div className={styles.stage}>
                <div className={styles.rig}>
                    <Tonearm playing={isPlaying} />
                    <button
                        type="button"
                        className={`${styles.disc}${isPlaying ? ` ${styles['disc-playing']}` : ''}`}
                        onClick={canToggleLyrics ? onToggleLyrics : onTogglePlay}
                        disabled={!current}
                        title={canToggleLyrics ? '查看歌词' : isPlaying ? '暂停' : '播放'}
                        aria-label={canToggleLyrics ? '查看歌词' : isPlaying ? '暂停' : '播放'}
                    >
                        {/* The `ripples` preference governs both layouts — it is
                            one display setting, not one per screen. */}
                        {ripples && (
                            <span className={styles.ripples} aria-hidden="true">
                                <span className={styles.ripple} />
                                <span className={styles.ripple} />
                                <span className={styles.ripple} />
                            </span>
                        )}
                        <span className={styles.rotor} aria-hidden="true">
                            <span className={styles['disc-grooves']} />
                            <span className={styles['disc-label']} style={{ background: gradient }}>
                                <Cover track={current ? current.track : null} />
                                {current ? <IconNote /> : <IconMusicSpace size={34} />}
                            </span>
                            <span className={styles['disc-sheen']} />
                        </span>
                    </button>
                </div>

                {modeToast && (
                    <span className={styles['mode-toast']} role="status">{modeToast}</span>
                )}

                <div className={styles.head}>
                    <Marquee text={`${title} - ${artist}`} className={styles['head-label']} center>
                        <span className={styles['head-title']}>{title}</span>
                        <span className={styles['head-artist']}> - {artist}</span>
                    </Marquee>
                    <span
                        className={styles['head-state']}
                        aria-hidden="true"
                    >
                        {current ? `${sourceName} · ${formatSize(current.track.size)}` : ''}
                    </span>
                </div>
            </div>

            {/* 3/4 — lyrics card, floats over the record's lower half */}
            {lyricsShown && (
                <div
                    className={styles.lyrics}
                    role="button"
                    tabIndex={0}
                    aria-label="歌词，点击返回唱片"
                    title="返回唱片"
                    onPointerDown={(event) => { pressYRef.current = event.clientY; }}
                    onClick={handleLyricsClick}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onToggleLyrics();
                        }
                    }}
                >
                    {lyrics ? lyrics.lines.map((line, index) => (
                        <p
                            key={`${line.time}-${index}`}
                            ref={index === activeLyric ? activeLyricRef : null}
                            className={index === activeLyric ? styles['lyric-active'] : styles.lyric}
                        >
                            {line.text}
                        </p>
                    )) : (
                        <p className={styles['lyrics-empty']}>歌词加载中…</p>
                    )}
                </div>
            )}

            {/* 4/4 — the bottom play bar (glass) */}
            <div className={styles.bar}>
                <input
                    className={styles.seek}
                    type="range"
                    min={0}
                    max={progress.duration > 0 ? progress.duration : 1}
                    step={0.1}
                    value={Math.min(progress.time, progress.duration > 0 ? progress.duration : 1)}
                    disabled={!current || progress.duration <= 0}
                    onChange={(event) => onSeek(Number(event.target.value))}
                    style={{ '--fill': `${percent}%` }}
                    aria-label="播放进度"
                />

                <div className={styles['bar-row']}>
                    {/* the song, once more — the bar stays useful on its own */}
                    <span className={styles['bar-track']}>
                        <span
                            className={`${styles['bar-disc']}${isPlaying ? '' : ` ${styles['bar-disc-paused']}`}`}
                            aria-hidden="true"
                        >
                            <span
                                className={styles['bar-disc-cover']}
                                style={{ background: gradient }}
                            >
                                <Cover track={current ? current.track : null} />
                                <IconNote />
                            </span>
                        </span>
                        <Marquee
                            text={current ? `${title} - ${artist}` : '还没有播放中的歌曲'}
                            className={styles['bar-label']}
                        >
                            <span className={styles['bar-title']}>{title}</span>
                            <span className={styles['bar-artist']}> - {artist}</span>
                        </Marquee>
                    </span>

                    <div className={styles.controls}>
                        <button
                            type="button"
                            className={`${styles['ctrl-btn']}${mode !== 'off' ? ` ${styles['ctrl-on']}` : ''}`}
                            onClick={onCycleRepeat}
                            title={playback.title}
                            aria-pressed={mode !== 'off'}
                        >
                            {playback.icon}
                        </button>
                        <button
                            type="button"
                            className={styles['ctrl-btn']}
                            onClick={onPrev}
                            disabled={!current}
                            title="上一首"
                            aria-label="上一首"
                        >
                            <IconPrev />
                        </button>
                        <button
                            type="button"
                            className={styles['ctrl-play']}
                            onClick={onTogglePlay}
                            disabled={!current}
                            title={isPlaying ? '暂停' : '播放'}
                            aria-label={isPlaying ? '暂停' : '播放'}
                        >
                            {isPlaying ? <IconPause /> : <IconPlay />}
                        </button>
                        <button
                            type="button"
                            className={styles['ctrl-btn']}
                            onClick={onNext}
                            disabled={!current}
                            title="下一首"
                            aria-label="下一首"
                        >
                            <IconNext />
                        </button>
                        <button
                            type="button"
                            className={`${styles['ctrl-btn']}${lyricsShown ? ` ${styles['ctrl-on']}` : ''}`}
                            onClick={onToggleLyrics}
                            disabled={!canToggleLyrics}
                            title={lyricsShown ? '收起歌词' : '显示歌词'}
                            aria-pressed={lyricsShown}
                        >
                            <IconQueue />
                        </button>
                    </div>

                    <span className={styles.times}>
                        <span className={styles.time}>{formatTime(progress.time)}</span>
                        <span className={styles['time-sep']}>/</span>
                        <span className={styles.time}>{formatTime(progress.duration)}</span>
                    </span>
                </div>
            </div>

            {/* --- settings drawer (glass, slides in from the right) ------- */}

            {settingsOpen && (
                <div className={styles['settings-scrim']} onClick={() => setSettingsOpen(false)} role="presentation">
                    <div
                        className={styles.settings}
                        role="dialog"
                        aria-modal="true"
                        aria-label="设置"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <header className={styles['settings-head']}>
                            <h2>设置</h2>
                            <button
                                type="button"
                                className={`${styles['rail-btn']} ${styles['rail-btn-plain']}`}
                                onClick={() => setSettingsOpen(false)}
                                aria-label="关闭设置"
                            >
                                <IconClose />
                            </button>
                        </header>

                        <section className={styles.group}>
                            <div className={styles['group-label']}>当前曲库</div>
                            <div className={styles.account}>
                                <span className={styles['account-icon']}><IconCloud /></span>
                                <span className={styles['account-text']}>
                                    <span className={styles['account-name']}>
                                        {connected ? '我的 Google 云盘' : sourceName}
                                    </span>
                                    <span className={styles['account-sub']}>
                                        {folderName || '整个云盘'} · {listLoading ? '加载中…' : `${trackCount} 首歌曲`}
                                    </span>
                                </span>
                            </div>
                        </section>

                        {connected ? (
                            <section className={styles.group}>
                                <div className={styles['group-label']}>音乐库</div>
                                <label className={styles.row} htmlFor="desktop-folder">
                                    <span className={styles['row-icon']}><IconFolder /></span>
                                    <span className={styles['row-label']}>文件夹</span>
                                    <select
                                        id="desktop-folder"
                                        className={styles['row-select']}
                                        value={folderId}
                                        onChange={onFolderChange}
                                    >
                                        <option value="">整个云盘</option>
                                        {folders.map((folder) => (
                                            <option key={folder.id} value={folder.id}>{folder.name}</option>
                                        ))}
                                    </select>
                                    <span className={styles['row-chev']}><IconChevronRight /></span>
                                </label>
                                <button
                                    type="button"
                                    className={`${styles.row} ${styles['row-btn']} ${styles['row-danger']}`}
                                    onClick={onDisconnect}
                                >
                                    <span className={styles['row-icon']}><IconLogout /></span>
                                    <span className={styles['row-label']}>断开连接，回到公共曲库</span>
                                </button>
                            </section>
                        ) : (
                            <section className={styles.group}>
                                <div className={styles['group-label']}>连接自己的云盘（可选）</div>
                                <p className={styles.hint}>
                                    默认播放公共曲库，不需要任何授权。连接 Google 云盘后会改用你自己云盘里的歌曲，
                                    播放、歌词和离线缓存体验完全一致。
                                </p>
                                <ol className={styles.steps}>
                                    <li>
                                        在{' '}
                                        <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
                                            Google Cloud Console
                                        </a>
                                        {' '}创建一个「Web 应用」类型的 OAuth 客户端 ID
                                    </li>
                                    <li>在「已获授权的 JavaScript 来源」里添加 <code>https://ianyspace.github.io</code></li>
                                    <li>把客户端 ID 粘贴到下面，点击连接</li>
                                </ol>
                                <input
                                    className={styles.input}
                                    type="text"
                                    value={clientIdDraft}
                                    onChange={(event) => onClientIdDraft(event.target.value)}
                                    placeholder="粘贴 OAuth 客户端 ID（xxxx.apps.googleusercontent.com）"
                                    aria-label="Google OAuth 客户端 ID"
                                />
                                <button
                                    type="button"
                                    className={styles['primary-btn']}
                                    onClick={onConnect}
                                    disabled={!gsiReady}
                                >
                                    {gsiReady ? '连接 Google 云盘' : '正在加载 Google 组件…'}
                                </button>
                            </section>
                        )}

                        <section className={styles.group}>
                            <div className={styles['group-label']}>外观</div>
                            <button type="button" className={`${styles.row} ${styles['row-btn']}`} onClick={onToggleTheme}>
                                <span className={styles['row-icon']}>
                                    {theme === 'dark' ? <IconSun /> : <IconMoon />}
                                </span>
                                <span className={styles['row-label']}>
                                    {theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
                                </span>
                                <span className={styles['row-value']}>{theme === 'dark' ? '深色' : '浅色'}</span>
                            </button>
                            <button
                                type="button"
                                className={`${styles.row} ${styles['row-btn']}`}
                                onClick={() => setListOpen((open) => !open)}
                            >
                                <span className={styles['row-icon']}><IconPanel /></span>
                                <span className={styles['row-label']}>左侧列表</span>
                                <span className={styles['row-value']}>{listOpen ? '显示中' : '已隐藏'}</span>
                            </button>
                            {/* Same preference as the phone player's drawer, so
                                the two layouts cannot disagree about it. */}
                            <button
                                type="button"
                                className={`${styles.row} ${styles['row-btn']} ${styles['row-btn-last']}`}
                                role="switch"
                                aria-checked={ripples}
                                onClick={onToggleRipples}
                            >
                                <span className={styles['row-icon']}><IconRipple /></span>
                                <span className={styles['row-label']}>唱片波纹</span>
                                <span className={styles['row-value']}>{ripples ? '开启' : '关闭'}</span>
                            </button>
                        </section>

                        <section className={styles.group}>
                            <div className={styles['group-label']}>缓存</div>
                            {/* Same sheet the phone layout opens, so the two
                                layouts cannot disagree about what is cached or
                                what deleting it does. */}
                            <button
                                type="button"
                                className={`${styles.row} ${styles['row-btn']}`}
                                onClick={onOpenCache}
                            >
                                <span className={styles['row-icon']}><IconArchive size={18} /></span>
                                <span className={styles['row-label']}>缓存管理</span>
                                <span className={styles['row-value']}>{cacheCount} 首</span>
                            </button>
                            {/* Used to read 「永久」, which stopped being true
                                when the 30-day expiry landed. */}
                            <div className={`${styles.row} ${styles['row-btn-last']}`}>
                                <span className={styles['row-icon']}><IconRefresh /></span>
                                <span className={styles['row-label']}>缓存策略</span>
                                <span className={styles['row-value']}>30 天过期</span>
                            </div>
                        </section>

                        <p className={styles.footnote}>
                            歌曲缓存在本机保留 30 天，期间每播一次就自动续期，30 天没播放过才会清除；
                            公共曲库来自 Cloudflare R2，无需登录即可播放。
                            <br />
                            界面为毛玻璃风格，浏览器不支持 backdrop-filter 时会自动回退为半透明底色。
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DesktopMusic;
