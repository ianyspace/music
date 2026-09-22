import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
    IconHeart,
    IconLocate,
    IconMoreVertical,
    IconMusicSpace,
    IconNext,
    IconNote,
    IconPanel,
    IconPanelFold,
    IconPause,
    IconPlay,
    IconPrev,
    IconQueue,
    IconRefresh,
    IconRepeat,
    IconRepeatOne,
    IconSearch,
    IconShuffle,
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
import MarkNote from '../core/MarkNote';
import { coverUrlOf } from '../librarySource';

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
 * (100 × 122 — the phone player's rig) so it scales with the record instead of
 * drifting off it. `playing` swings the arm down to track the groove.
 *
 * The path data is the phone player's (`NowPlaying.js`), verbatim — and, since
 * `.arm` in this file's stylesheet sizes the box so that one unit is the same
 * fraction of the disc on both screens, it is now the same *object* at two
 * sizes rather than the same outline at two scales. That distinction is the
 * whole fix: the box used to be 46% of the disc, which made this arm 2.5×
 * smaller than the one a phone draws over the same record.
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
                {/* curved tube: one gentle sweep from the pivot onto the rim */}
                <path
                    d="M52.5 4.6 C 56 13, 62 21, 68.5 26 C 73 29.4, 76.5 30.2, 78.8 30.3"
                    fill="none"
                    stroke="#f2f3f7"
                    strokeWidth="3"
                    strokeLinecap="round"
                />
                {/* headshell resting on the record's upper-right rim */}
                <g transform="rotate(28 78.8 30.3)">
                    <rect x="76.6" y="27.5" width="11.6" height="5.6" rx="2.1" fill="#f2f3f7" />
                    <rect x="85.4" y="28.8" width="3.6" height="3" rx="1.2" fill="#dfe2ea" />
                    <rect x="79.4" y="29.2" width="1.7" height="2.2" rx="0.7" fill="#26272e" />
                </g>
                {/* pivot: halo ring back and clearly wider, body shrunk */}
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
 * Everything else — the song list and the capsule play bar — is absolutely
 * positioned *over* it, so nothing a visitor does to them can move the record
 * by a pixel: folding the list away, searching it, or swapping in the lyrics
 * all happen in boxes the stage never sees.
 *
 * There is no settings surface on this layout at all — no gear button, no
 * settings dialog. Everything one used to hold was either about the Drive
 * library or about the record's ripples, and this layout has neither. The one
 * dialog it does raise is 账号, and that belongs to the shell: the app's mark
 * at the leading end of the list column opens it, exactly as the phone's mark
 * does in the phone's bar. `core/MarkNote` is the same component in both.
 *
 * The list's top row is where the list is *about* itself: the mark (who is
 * listening), the fold toggle (is the list out), 只看喜欢 and the search (what
 * it is showing). The two filters sit after the toggle and the field is last,
 * so opening the search grows it into the empty half of the row and moves
 * nothing under the pointer.
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
    listLoading,
    visibleTracks,
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
    // Id of the row whose actions are open. The drawer itself belongs to the
    // shell (the same one the phone layout opens, in its own desktop dress), so
    // all this needs is the id to report which row's button is expanded — the
    // 置顶 / 喜欢 callbacks live there, not here.
    rowMenuId,
    onOpenRowMenu,
    // 只看喜欢, and whether one song is liked — the same two halves of the
    // feature the phone's list bar carries. Neither is gated on the track's
    // source the way the phone's are: that check exists to keep a Drive track
    // out of 我喜欢, and this layout only ever plays the public library.
    likedOnly,
    onToggleLikedOnly,
    isLiked,
    // The visitor's number, for the mark's state dot, and the way into the
    // account card — which the shell raises, because it is a dialog centred on
    // the viewport rather than something inside this column.
    qqBound,
    onOpenAccount,
}) {
    const searchInputRef = useRef(null);
    const activeLyricRef = useRef(null);
    const pressYRef = useRef(0);
    // `false` = folded away, only the toggle button remains. Defaults to open.
    const [listOpen, setListOpen] = useState(true);
    const [searchOpen, setSearchOpen] = useState(false);
    // Playback mode announce, centred on the stage for a moment — same
    // behaviour as the phone player's mode toast.
    const [modeToast, setModeToast] = useState('');
    const lastModeRef = useRef('');
    const modeTimerRef = useRef(0);

    const meta = current ? parseTrackName(current.track.name) : null;
    const title = meta ? meta.title : '还没有播放中的歌曲';
    const artist = meta ? meta.artist : '从左侧列表挑一首开始';
    const gradient = current ? trackGradient(current.track.name) : 'linear-gradient(135deg, #fb5c74, #fa233b)';
    // The playing song's artwork, for the layer behind everything. Empty for a
    // song the library has no cover for — and that is not a special case to
    // handle: an empty `background-image` simply leaves the colour field the
    // page has always had, which is what the four gradients in `.backdrop` are
    // for. `.glow` is dimmed when this is set, because it is a palette derived
    // from the song's *name* and has nothing to do with the photo.
    const coverUrl = current ? coverUrlOf(current.track) : '';
    const percent = progress.duration > 0
        ? Math.min(100, Math.max(0, (progress.time / progress.duration) * 100))
        : 0;
    const keyword = search.trim();
    const currentId = current ? current.track.id : '';
    // Whether the song in the bar is liked. The bar is the one place this
    // layout shows the like state of what is playing: the list marks a liked
    // row with nothing (a heart on every liked row would turn the list into a
    // column of hearts), and the row drawer only says it while it is open.
    const liked = current ? isLiked(current.track) : false;
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
        <div className={`${styles.root}${coverUrl ? ` ${styles['has-cover']}` : ''}`}>
            {/* The colour field the frosted surfaces sample — the root's own
                background is never blurred by its children, so the gradients
                have to be painted by a layer *behind* them. */}
            <div className={styles.backdrop} aria-hidden="true" />

            {/* The song's own colours, blooming behind the record. A radial
                mask rather than a blur: the same soft edge, one paint. */}
            <div className={styles.glow} style={{ background: gradient }} aria-hidden="true" />

            {/* --- the background: the playing song's own artwork -------------
                Painted above the two colour layers rather than replacing them,
                so a song with no cover keeps exactly the background it had
                before this existed. `background-size: cover` is what makes it
                fill the screen without stretching — `100% 100%` is the version
                that distorts, and at a wide aspect ratio it is the one thing
                that looks wrong on every cover. The layer is blurred and held
                at a low opacity by `.cover-bg`, which is the whole "淡淡的、
                虚化" part: it is the page's light source, not a picture on it. */}
            {coverUrl && (
                <div
                    className={styles['cover-bg']}
                    style={{ backgroundImage: `url("${coverUrl}")` }}
                    aria-hidden="true"
                />
            )}

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

            {/* The column is a hover region and a home for a few controls, not
                a surface — hence `pointer-events: none` on it and `auto` on
                the things inside. Without that the empty half of the column
                would swallow clicks meant for the record behind it. */}
            <div className={`${styles.side}${listVisible ? '' : ` ${styles['side-folded']}`}`}>
                {/* One row, four controls: the mark, the fold toggle, 只看喜欢
                    and the search. The toggle and the search used to be stacked
                    — the toggle alone at the top of the column, the search
                    button on the panel's own tool row below it — which spent two
                    rows on two 36px squares and pushed the first song down by a
                    full row.

                    `pointer-events: none` on the row and `auto` on each control,
                    exactly like the column itself: the empty half of the row
                    sits over the record, and a dead strip that swallows clicks
                    is the one thing this page must not have. */}
                <div className={styles['side-head']}>
                    {/* The app's mark, at the top-left corner of the column and
                        at the leading end of this row — the same
                        `core/MarkNote` the phone's bar draws, so the two
                        layouts cannot end up with two different logos. Its
                        corner dot is the QQ state, readable from the list; the
                        button opens 账号, which the shell centres over this
                        workspace (a `position: fixed` child in here would be
                        sized to the column).

                        `side-mark` is the one thing a caller may change about
                        the mark: this row is a line of 36px tiles, so the mark
                        is 36px and flush with the column's edge instead of the
                        40px box with a 6px inset that the phone's bar gives it. */}
                    <MarkNote
                        className={styles['side-mark']}
                        playing={isPlaying}
                        qqBound={qqBound}
                        onOpen={onOpenAccount}
                    />

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
                        {/* The chevron follows the state, not the label: it
                            points the way the list will move. */}
                        {listVisible ? <IconPanelFold /> : <IconPanel />}
                    </button>

                    {/* 只看喜欢 — a filter, not a destination: it narrows the
                        list below and stays lit while it does. The phone's bar
                        carries the same button with the same paint, and it is
                        *not* gated on a QQ number there or here: a guest's
                        likes are real likes, they simply live in this browser.

                        It sits between the toggle and the search because the
                        search is the only tile that has to be able to grow (it
                        becomes the field) and so has to be last. */}
                    <button
                        type="button"
                        className={likedOnly
                            ? `${styles['side-heart']} ${styles['side-heart-on']}`
                            : styles['side-heart']}
                        title={likedOnly ? '显示全部歌曲' : '只看喜欢的歌曲'}
                        aria-label={likedOnly ? '显示全部歌曲' : '只看喜欢的歌曲'}
                        aria-pressed={likedOnly}
                        onClick={onToggleLikedOnly}
                    >
                        {/* `size={18}`: the heart's own default is 22, which in
                            a row of an 18px panel glyph and a 16px search glyph
                            would read as a bigger control than its neighbours.
                            The tile normalises the size, the same way the phone
                            bar's `.nav-btn` does. */}
                        <IconHeart size={18} filled={likedOnly} />
                    </button>

                    {/* The closed state is a *button*, not an empty search
                        field. It used to be a full-width pill carrying the
                        placeholder 「搜索歌曲」, which looks like an input you
                        can type into and is not one — and it spent the column's
                        widest row saying nothing. Same 36px square as the toggle
                        beside it, so the row is one line whether the field is
                        open or shut and the list never shifts. */}
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

                <div
                    className={styles.panel}
                    onPointerEnter={() => setListHover(true)}
                    onPointerLeave={() => setListHover(false)}
                >
                    {/* The list is the only content here: no library card, no
                        source badge, no panel of its own. It scrolls straight
                        over the colour field, and a row only paints itself —
                        background, and its own actions — under the pointer. */}
                    <div className={styles['list-wrap']}>
                        {visibleCount === 0 ? (
                            <p className={styles['list-empty']}>
                                {/* No `folderHint`, and `likedOnly` passed in:
                                    the hint sentence ends in "go pick another
                                    folder", and this layout has neither a
                                    folder picker nor a second library to pick
                                    one from. An empty list here is a fact, not
                                    a step — see `emptyListMessage`. */}
                                {emptyListMessage({ listLoading, keyword, likedOnly })}
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
                                            className={`${styles['track-row']}${active ? ` ${styles['track-row-active']}` : ''}`}
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

            {/* --- bottom: the capsule play bar ---------------------------- */}
            <div className={styles.bar}>
                {/* The progress rides the capsule's *upper* edge — inside the
                    glass, one hairline above the content row, so the bar still
                    reads as one line of content and the seek target spans the
                    full width of the pill. */}
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
                    {/* the record, then the song, once more — the bar stays
                        useful on its own */}
                    <span className={styles['bar-track']}>
                        {/* The same object the stage draws, at the size the
                            phone's mini bar draws it. It is not decoration: it
                            is the only part of the record that is on screen
                            while the lyrics are up, and it is the one thing in
                            the bar that says "playing" without being read. */}
                        <span
                            className={`${styles['bar-disc']}${isPlaying ? '' : ` ${styles['bar-disc-paused']}`}`}
                            aria-hidden="true"
                        >
                            <span className={styles['bar-disc-cover']} style={{ background: gradient }}>
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

                    <span className={styles['bar-end']}>
                        {/* The bar's heart, for the song that is playing. The
                            phone's player carries the same control beside its
                            title; here it is at the bar's trailing end, because
                            the title cell is hidden below 1180px and a like
                            button that disappears on a small laptop is worse
                            than one next to the clock.

                            It borrows the transport button's own class rather
                            than getting one of its own: same 36px ring, same
                            hover, same "on" — a bright glyph on a soft chip.
                            Deliberately *not* `--accent`, which is what the
                            phone's player paints a liked heart: the bar has a
                            written rule that its only accent is the play button
                            and the rail's fill, and the filled glyph plus the
                            chip say "liked" without a second red thing in the
                            capsule. */}
                        <button
                            type="button"
                            className={liked
                                ? `${styles['ctrl-btn']} ${styles['ctrl-on']}`
                                : styles['ctrl-btn']}
                            onClick={() => { if (current) onToggleLike(current.track); }}
                            disabled={!current}
                            title={liked ? '取消喜欢' : '喜欢'}
                            aria-label={liked ? '取消喜欢' : '喜欢'}
                            aria-pressed={liked}
                        >
                            <IconHeart filled={liked} />
                        </button>
                        <span className={styles.times}>
                            <span className={styles.time}>{formatTime(progress.time)}</span>
                            <span className={styles['time-sep']}>/</span>
                            <span className={styles.time}>{formatTime(progress.duration)}</span>
                        </span>
                    </span>
                </div>
            </div>

        </div>
    );
};

export default DesktopMusic;
