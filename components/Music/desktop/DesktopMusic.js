import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
    IconArchive,
    IconChevronRight,
    IconCloud,
    IconDislike,
    IconFolder,
    IconGear,
    IconLocate,
    IconLogout,
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
    formatTime,
    parseTrackName,
    storageGet,
    storageSet,
    trackGradient,
} from '../shared';
import Cover from '../Cover';
import Marquee from '../Marquee';
import DesktopSheetChrome from './DesktopSheetChrome';

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

// How long the list waits, once music is playing and the pointer is elsewhere,
// before folding itself away. See the effect that owns this.
const LIST_HIDE_MS = 3000;

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
 * One idea: **the record owns the screen.**
 *
 * The stage fills the viewport and is the only block with a layout of its own.
 * Everything else — the song list, the capsule play bar, the settings button —
 * is absolutely positioned *over* it, so nothing a visitor does to them can
 * move the record by a pixel: folding the list away, opening the settings
 * dialog, or swapping in the lyrics all happen in boxes the stage never sees.
 *
 * The stage holds the record, the lyrics when they are shown, and is where any
 * future audio-visual surface goes — it is the one block with room for it.
 *
 * That is the deliberate difference from the phone layout, where the list *is*
 * the page and the player is a screen pushed on top of it. The two layouts
 * share the playback state (`core/usePlayer`) and the pure helpers, and
 * nothing else.
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
    sourceName,
    gsiReady,
    clientIdDraft,
    onClientIdDraft,
    onConnect,
    onDisconnect,
    folders,
    folderId,
    folderName,
    onFolderChange,
    listLoading,
    visibleTracks,
    // Count the settings dialog and the library card show. `visibleTracks` is
    // the list after the visitor's preferences, so this is what agrees with
    // what they can actually see — a hidden song must not stay in the total.
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
    const [settingsClosing, setSettingsClosing] = useState(false);
    // `false` = folded away, only the toggle button remains. Defaults to open.
    const [listOpen, setListOpen] = useState(true);
    const [searchOpen, setSearchOpen] = useState(false);
    // Playback mode announce, centred on the stage for a moment — same
    // behaviour as the phone player's mode toast.
    const [modeToast, setModeToast] = useState('');
    const lastModeRef = useRef('');
    const modeTimerRef = useRef(0);
    const [cacheCount, setCacheCount] = useState(0);

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

    // --- the list steps aside while the music plays -------------------------
    //
    // Three seconds after playback starts, and only while the pointer is
    // nowhere near the list, the list folds itself away: the record is the
    // point of the screen and the list is one click from the toggle button.
    //
    // It is a *fold*, not a preference. `listOpen` is what the visitor chose
    // and what gets stored; `autoHidden` is what the player then did about it.
    // That split is why nothing below writes to localStorage, and why pausing,
    // searching, opening the menu or hovering brings the list straight back —
    // none of those are a decision to put it away.
    const [autoHidden, setAutoHidden] = useState(false);
    const [listHover, setListHover] = useState(false);
    const hideTimerRef = useRef(0);
    const listVisible = listOpen && !autoHidden;

    // Anything the visitor is *doing* with the list counts as being in range,
    // not just the pointer: a half-typed search, or a row whose drawer is open
    // over it, must not vanish under them either.
    const listBusy = listHover || searchOpen || keyword !== '' || Boolean(rowMenuId);
    // Booleans, not `current` itself: the effect below arms a timer, and a
    // dependency that changed identity on every render would clear and re-arm
    // it forever — the list would simply never fold.
    const hasCurrent = Boolean(current);

    useEffect(() => {
        window.clearTimeout(hideTimerRef.current);
        if (!hasCurrent || !isPlaying || !listOpen || listBusy) {
            setAutoHidden(false);
            return undefined;
        }
        hideTimerRef.current = window.setTimeout(() => setAutoHidden(true), LIST_HIDE_MS);
        return () => window.clearTimeout(hideTimerRef.current);
    }, [hasCurrent, isPlaying, listOpen, listBusy]);

    useEffect(() => () => window.clearTimeout(hideTimerRef.current), []);

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

    // Escape backs out of the dialog, which is the only thing here that traps
    // the visitor. The list is not a layer to escape from: it is one button.
    const closeSettings = useCallback(function () {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setSettingsOpen(false);
            setSettingsClosing(false);
            return;
        }
        setSettingsClosing(true);
    }, []);

    useEffect(() => {
        if (!settingsOpen) return undefined;
        const onKeyDown = (event) => { if (event.key === 'Escape') closeSettings(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [settingsOpen, closeSettings]);

    // How many tracks are already cached locally — the settings dialog reports
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

    // --- "jump to the playing track" ---------------------------------------
    //
    // The phone layout puts this button on the mini bar's shoulder, because the
    // bar is the one fixed thing there. The desktop has no bar over the list —
    // its equivalent fixed edge is the list itself — so the button is pinned to
    // the list's bottom corner instead, and the row lookup runs against this
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
    // Which ends of the list still have rows beyond them. The panel has no
    // frame, so these two fades are the list's only way of saying "there is
    // more" — and they have to be *earned*: a list short enough to fit shows
    // neither, and one scrolled to the bottom stops fading at the bottom.
    // `false` both ways on the first render, so nothing fades before the first
    // measurement lands.
    const [listEnds, setListEnds] = useState({ top: false, bottom: false });

    // `currentId` itself is declared with the other derived values above — the
    // row lookup reads the same one the list marks its rows with.
    const rowOf = useCallback(function () {
        const list = listRef.current;
        return list && currentId
            ? list.querySelector(`[data-track-id="${CSS.escape(currentId)}"]`)
            : null;
    }, [currentId]);

    // The list's own ends, read off the scroller rather than guessed from the
    // row count: how many rows fit depends on the window, so "is there more"
    // is only ever true of a measurement.
    //
    // Three inputs, because the answer changes for three different reasons —
    // the visitor scrolls (the listener), the window or the panel resizes (the
    // observer), or the rows themselves change (the deps, since a scroller
    // whose box did not move tells the observer nothing about its content).
    // The state is written as a whole object and only when it actually differs,
    // so a scroll that changes nothing costs no render.
    useEffect(() => {
        const list = listRef.current;
        if (!list) return undefined;
        const measure = function () {
            const top = list.scrollTop > 1;
            // A pixel of slack: at the true bottom `scrollTop + clientHeight`
            // can land a fraction short of `scrollHeight`, which would leave
            // the fade on over the last row forever.
            const bottom = list.scrollTop + list.clientHeight < list.scrollHeight - 1;
            setListEnds((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
        };
        measure();
        list.addEventListener('scroll', measure, { passive: true });
        const observer = new ResizeObserver(measure);
        observer.observe(list);
        return () => {
            list.removeEventListener('scroll', measure);
            observer.disconnect();
        };
    }, [listLoading, visibleCount]);

    // The scroller *is* the list here — the tool row is its sibling, not an
    // overlay — so the plain viewport of `.list` is already the right frame and
    // no inset is needed (the phone layout needs its insets because a floating
    // header and the mini bar cover its list's ends).
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

    const handleLyricsClick = function (event) {
        if (Math.abs(event.clientY - pressYRef.current) > 8) return;
        onToggleLyrics();
    };

    return (
        <div className={styles.root}>
            {/* The colour field the frosted surfaces sample — the root's own
                background is never blurred by its children, so the gradients
                have to be painted by a layer *behind* them. */}
            <div className={styles.backdrop} aria-hidden="true" />

            {/* The song's own colours, blooming behind the record. A radial
                mask rather than a blur: the same soft edge, one paint. */}
            <div className={styles.glow} style={{ background: gradient }} aria-hidden="true" />

            {/* --- the theme: the record, the lyrics, and whatever comes
                next (a visualiser, a spectrum) — the stage is the one block
                with room for it -------------------------------------------- */}
            <div className={`${styles.stage}${lyricsShown ? ` ${styles['stage-lyrics']}` : ''}`}>
                {/* The record stays mounted under the lyrics rather than being
                    swapped out: the rotor keeps its angle, so coming back from
                    the words is coming back to the same groove, not to a record
                    that restarted. */}
                <div className={styles['stage-record']}>
                    <div className={styles.rig}>
                        <Tonearm playing={isPlaying} />

                        <button
                            type="button"
                            className={`${styles.disc}${isPlaying ? ` ${styles['disc-playing']}` : ''}`}
                            onClick={canToggleLyrics ? onToggleLyrics : onTogglePlay}
                            disabled={!current}
                            aria-hidden={lyricsShown || undefined}
                            tabIndex={lyricsShown ? -1 : 0}
                            title={canToggleLyrics ? '查看歌词' : isPlaying ? '暂停' : '播放'}
                            aria-label={canToggleLyrics ? '查看歌词' : isPlaying ? '暂停' : '播放'}
                        >
                            {/* The `ripples` preference governs both layouts — it
                                is one display setting, not one per screen. */}
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

                    <div className={styles.head}>
                        <Marquee text={`${title} - ${artist}`} className={styles['head-label']} center>
                            <span className={styles['head-title']}>{title}</span>
                            <span className={styles['head-artist']}> - {artist}</span>
                        </Marquee>
                    </div>
                </div>

                {modeToast && (
                    <span className={styles['mode-toast']} role="status">{modeToast}</span>
                )}

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
            </div>

            {/* --- left: the song list, floating over the stage -------------- */}

            {/* The column is a hover region and a home for two controls, not a
                surface — hence `pointer-events: none` on it and `auto` on the
                two things inside. Without that the empty half of the column
                would swallow clicks meant for the record behind it. */}
            <div className={`${styles.side}${listVisible ? '' : ` ${styles['side-folded']}`}`}>
                <button
                    type="button"
                    className={styles['side-toggle']}
                    onClick={() => setListOpen((open) => !open)}
                    onPointerEnter={() => setListHover(true)}
                    onPointerLeave={() => setListHover(false)}
                    aria-expanded={listVisible}
                    aria-label={listVisible ? '收起列表' : '展开列表'}
                    title={listVisible ? '收起列表' : '展开列表'}
                >
                    <IconPanel />
                </button>

                <div
                    className={styles.panel}
                    onPointerEnter={() => setListHover(true)}
                    onPointerLeave={() => setListHover(false)}
                >
                    <div className={styles.tools}>
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
                                className={styles['search-btn']}
                                title="搜索"
                                aria-label="搜索歌曲"
                                onClick={() => setSearchOpen(true)}
                            >
                                <IconSearch />
                            </button>
                        )}
                    </div>

                    {/* The list is the only content here: no library card, no
                        source badge, no panel of its own. It scrolls straight
                        over the colour field, and a row only paints itself —
                        background, and its own actions — under the pointer. */}
                    <div className={styles['list-wrap']}>
                        {visibleCount === 0 ? (
                            <p className={styles['list-empty']}>
                                {emptyListMessage({
                                    listLoading,
                                    keyword,
                                    libraryCount,
                                    folderHint: '设置',
                                })}
                            </p>
                        ) : (
                            <ul
                                className={`${styles.list}${listEnds.top ? ` ${styles['list-fade-top']}` : ''}${listEnds.bottom ? ` ${styles['list-fade-bottom']}` : ''}`}
                                ref={listRef}
                            >
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
                                        // it and only exists under the pointer, so a
                                        // long list does not turn into a column of dots.
                                        //
                                        // The *row* carries the hover tint, not the play
                                        // target: the dots are part of the row, and a
                                        // highlight that stopped short of them read as
                                        // two controls instead of one.
                                        <li
                                            key={track.id}
                                            data-track-id={track.id}
                                            className={active ? styles['track-row-active'] : styles['track-row']}
                                        >
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

                        {/* Pinned to the list's bottom corner, not to a row: it
                            has to stay put while the list moves under it. The
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
                </div>
            </div>

            {/* --- top right: the settings entry --------------------------- */}
            <button
                type="button"
                className={styles['settings-btn']}
                onClick={() => setSettingsOpen(true)}
                aria-label="打开设置"
                title="设置"
            >
                <IconGear />
            </button>

            {/* --- bottom: the capsule play bar ---------------------------- */}
            <div className={styles.bar}>
                {/* The progress rides the capsule's own lower edge instead of
                    taking a row of its own: the pill keeps one line of content
                    and still has a real, draggable seek target. */}
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

            {/* --- settings, as a dialog -----------------------------------
                The same chrome the cache and disliked panels use: a centred
                glass card over a dimmed scrim. It used to slide in from the
                right edge, which on a screen whose whole point is the record
                read as a second app docked to the side. */}
            {settingsOpen && (
                <DesktopSheetChrome
                    title="设置"
                    closing={settingsClosing}
                    onClosed={() => { setSettingsOpen(false); setSettingsClosing(false); }}
                    onCancelClose={() => setSettingsClosing(false)}
                    onClose={closeSettings}
                >
                    <div className={styles['settings-body']}>
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

                        {/* The three-dots popover that used to live above the
                            list held three entries; two of them (the Drive
                            account, the cache manager) already had a row in
                            here, and this is the third. It sits outside the
                            `connected` branch on purpose: the public library
                            has hidden songs too. */}
                        <section className={styles.group}>
                            <div className={styles['group-label']}>曲库</div>
                            <button
                                type="button"
                                className={`${styles.row} ${styles['row-btn']} ${styles['row-btn-last']}`}
                                onClick={onOpenDisliked}
                            >
                                <span className={styles['row-icon']}><IconDislike /></span>
                                <span className={styles['row-label']}>不喜欢歌曲</span>
                                <span className={styles['row-value']}>{dislikedCount} 首</span>
                            </button>
                        </section>

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
                            浮层（胶囊播放条、列表、这个弹窗）为毛玻璃风格，浏览器不支持 backdrop-filter
                            时会自动回退为半透明底色。
                        </p>
                    </div>
                </DesktopSheetChrome>
            )}
        </div>
    );
};

export default DesktopMusic;
