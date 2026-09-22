import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
    IconNote,
    IconPlay,
    IconPause,
    IconPrev,
    IconNext,
    IconShuffle,
    IconRepeat,
    IconRepeatOne,
    IconQueue,
    IconChevronDown,
    IconMoreVertical,
    IconHeart,
    IconRipple,
} from '../icons';
import { parseTrackName, trackGradient, formatTime } from '../shared';
import Cover from '../Cover';
import Marquee from '../Marquee';

import styles from './NowPlaying.module.scss';

// Playback modes of the single cycling control, in the order the button walks
// them: 关闭 → 列表循环 → 单曲循环 → 随机 → 关闭.
const MODES = {
    off: { icon: <IconRepeat />, title: '循环关闭' },
    all: { icon: <IconRepeat />, title: '列表循环' },
    one: { icon: <IconRepeatOne />, title: '单曲循环' },
    shuffle: { icon: <IconShuffle />, title: '随机播放' },
};

// The lyric styles the drawer offers, in the order it lists them. `plain` is
// first because it is the default and the one the rest are departures from.
//
// `LYRIC_STYLE_CLASS` is built once, at module scope, rather than as
// `styles['lyrics-' + variant]` at the point of use: a computed lookup returns
// `undefined` for a name that is not in the stylesheet, and the template
// literal would then put the string "undefined" on the element — a class that
// silently matches nothing, in the one place where "nothing matched" is also
// the correct answer.
const LYRIC_OPTIONS = [
    { key: 'plain', title: '普通', sub: '当前行放大，前后文都在' },
    { key: 'rise', title: '逐行上浮', sub: '换行时从下方升起并淡入' },
    { key: 'solo', title: '沉浸单行', sub: '只留当前行和上下各一行' },
    { key: 'wipe', title: '卡拉OK 扫光', sub: '当前行从左向右点亮' },
];

const LYRIC_STYLE_CLASS = {
    plain: '',
    rise: styles['lyrics-rise'],
    solo: styles['lyrics-solo'],
    wipe: styles['lyrics-wipe'],
};

// How long a line is assumed to last, for the wipe. Same three numbers as the
// three.js lyrics use (`three/scene/lyrics.js`), so the same song sweeps at the
// same speed in both renderers. `MIN` keeps a very short line from snapping
// across in a blink, `MAX` keeps a long instrumental gap from leaving the line
// half-lit for twenty seconds, and `LAST_LINE_SECONDS` is the stand-in for the
// last line, which has no next line to measure against.
const MIN_LINE_SECONDS = 0.6;
const MAX_LINE_SECONDS = 8;
const LAST_LINE_SECONDS = 4.5;

/** How long the line at `index` is assumed to last, in seconds. */
const lineSpan = function (lines, index) {
    const line = lines[index];
    if (!line) return 0;
    const next = lines[index + 1];
    const raw = (next ? next.time : line.time + LAST_LINE_SECONDS) - line.time;
    return Math.min(MAX_LINE_SECONDS, Math.max(MIN_LINE_SECONDS, raw));
};

/**
 * Decorative tonearm, drawn in the record rig's own coordinate space
 * (100 × 122 — the rig's aspect ratio) so it scales with the record instead of
 * drifting off it: a small pivot high above the disc, the longer curved tube
 * bending down onto the record's upper-right rim, like the reference. The rest
 * pose is solved backwards from the 15° tracking swing, so the stylus lands on
 * exactly the same spot as before. `playing` swings the arm down to track.
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
 * Now-playing page (the reference's dark player), rendered as a phone-width
 * sheet that slides up over the dimmed tab pages — same gesture language as
 * the mini bar: tap the bar to expand, tap 收起 to collapse back. The stage
 * shows the spinning record; tapping it swaps in the lyrics, tapping the
 * lyrics swaps the record back (only when the track has lyrics). `closing`
 * triggers the reverse animation; `onClosed` fires when the exit finished and
 * the shell may unmount. Fixed dark palette regardless of the app theme; no
 * volume control by design.
 *
 * The three-dots button raises a bottom drawer of player preferences. `ripples`
 * / `onToggleRipples` come from the shell, which owns the localStorage read and
 * write, so this page stays a plain view of the setting — the same shape the
 * shell already uses for the theme. `liked` / `onToggleLike` arrive the same
 * way, and for the same reason: the heart says what it is told.
 *
 * The heart sits at the right end of the song line and is a child of `.np-head`
 * rather than of `.np-meta`, which is the column holding the title and artist.
 * That is what puts it at the far right, and it is also what keeps the whole
 * row out of the way in lyrics mode: `.stage-lyrics ~ .np-head` folds the row
 * away, so the heart is on screen exactly in the record mode and gone with the
 * title in the lyrics mode, without a second rule to say so.
 *
 * ## The lyric styles
 *
 * The same drawer carries a radio group that picks how the words are drawn —
 * see `LYRIC_OPTIONS`. Three of the four are new, and they divide cleanly into
 * two kinds:
 *
 *  - `rise` and `solo` are triggered *by a line change*. The page already
 *    re-renders when the active line moves, so they are pure CSS hung off
 *    classes this component was already computing. No clock, no timers.
 *  - `wipe` moves *between* the lines, which is a different problem: the only
 *    clock the page has is the `<audio>` element's `timeupdate`, about four
 *    times a second, and a sweeping edge driven at 4 Hz reads as a stutter.
 *    That one gets the effect below, which reads the element's own
 *    `currentTime` once a frame and writes a single custom property.
 *
 * All three are about following the clock, so they are gated on `lyrics.timed`:
 * lyrics without timestamps have no clock to follow, and fall back to `plain`
 * rather than to a style that would look broken. (`solo` in particular would
 * hide every line but the last, because untimed lyrics put every line at
 * `time: 0` and the "active" line is then whichever one the reduce lands on.)
 */
const NowPlaying = function ({
    track,
    isPlaying,
    progress,
    mode = 'off',
    liked = false,
    canLike = false,
    onToggleLike,
    closing,
    onClosed,
    onCancelClose,
    onCycleMode,
    onTogglePlay,
    onPrev,
    onNext,
    onSeek,
    onClose,
    onOpenList,
    lyrics,
    lyricsLoading,
    lyricsVisible,
    onToggleLyrics,
    ripples = true,
    onToggleRipples,
    lyricStyle = 'plain',
    onChooseLyricStyle,
    audioRef,
}) {
    const meta = parseTrackName(track.name);
    const gradient = trackGradient(track.name);
    const { time, duration } = progress;
    const seekPercent = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
    const playback = MODES[mode] || MODES.off;
    // The record only doubles as a lyrics switch when there is something to
    // show — a track without lyrics keeps it as plain artwork.
    const canToggleLyrics = Boolean(lyrics) || lyricsLoading;
    const lyricsShown = Boolean(lyricsVisible && canToggleLyrics);
    const activeLyric = lyrics && lyrics.timed
        ? lyrics.lines.reduce((index, line, lineIndex) => (line.time <= time ? lineIndex : index), -1)
        : -1;
    // The chosen style, downgraded to `plain` when there is no clock to follow.
    // The drawer still shows the choice — it is remembered, and it applies
    // again on the next song that has timestamps.
    const lyricVariant = lyrics && lyrics.timed ? lyricStyle : 'plain';
    const activeLyricRef = useRef(null);
    // Tap position, so a finger that was really scrolling the lyrics does not
    // also count as "back to the record".
    const pressYRef = useRef(0);
    // The radio rows, so the arrow keys can put focus on the row they selected.
    const styleRowRefs = useRef({});

    // Every mode tap names the mode it just switched into, centred on the
    // stage for a moment. The first render is the page opening, not a tap, so
    // the initial mode is remembered and never announced.
    const [modeToast, setModeToast] = useState('');
    const lastModeRef = useRef(mode);
    const modeTimerRef = useRef(0);

    // Bottom drawer of player preferences, toggled by the top bar's three-dots
    // button. `sheetClosing` drives the reverse animation; the panel is
    // unmounted once that animation reports it has finished.
    const [sheetOpen, setSheetOpen] = useState(false);
    const [sheetClosing, setSheetClosing] = useState(false);

    useEffect(() => {
        if (lastModeRef.current === mode) return undefined;
        lastModeRef.current = mode;
        setModeToast((MODES[mode] || MODES.off).title);
        window.clearTimeout(modeTimerRef.current);
        modeTimerRef.current = window.setTimeout(() => setModeToast(''), 1400);
        return () => window.clearTimeout(modeTimerRef.current);
    }, [mode]);

    useEffect(() => {
        if (activeLyricRef.current) {
            activeLyricRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }, [activeLyric, lyricsShown]);

    // 卡拉OK: how much of the current line has been sung, written straight onto
    // the element every frame as `--wipe`.
    //
    // Straight onto the element, not into state, and that is the whole point of
    // this effect existing separately from everything else on the page: the
    // position of the edge changes sixty times a second, and routing that
    // through `setState` would re-render the page — the record, the transport,
    // the slider — sixty times a second to move one gradient stop.
    //
    // Only while playing, because a paused song has a fixed answer; but the
    // effect paints once before it decides, so pausing mid-line, seeking, or
    // opening the drawer all leave the right amount of fill on screen instead
    // of whatever the last playing frame happened to write.
    //
    // `prefers-reduced-motion` is deliberately *not* checked here. The other two
    // styles are decoration and the stylesheet turns them off; this one is a
    // position readout — the same information the progress slider carries —
    // and a visitor who asked for less motion has not asked for a lyric sheet
    // that cannot tell them which word is being sung.
    useEffect(() => {
        if (lyricVariant !== 'wipe' || !lyricsShown || activeLyric < 0) return undefined;
        const element = activeLyricRef.current;
        const lines = lyrics ? lyrics.lines : null;
        if (!element || !lines) return undefined;
        const span = lineSpan(lines, activeLyric);
        if (!span) return undefined;

        const paint = function () {
            const audio = audioRef ? audioRef.current : null;
            if (!audio) return;
            const ratio = (audio.currentTime - lines[activeLyric].time) / span;
            const clamped = Math.min(1, Math.max(0, ratio));
            element.style.setProperty('--wipe', `${(clamped * 100).toFixed(2)}%`);
        };

        paint();
        if (!isPlaying) return undefined;
        let frame = requestAnimationFrame(function tick() {
            paint();
            frame = requestAnimationFrame(tick);
        });
        return () => cancelAnimationFrame(frame);
    }, [lyricVariant, lyricsShown, isPlaying, activeLyric, lyrics, audioRef]);

    const closeSheet = useCallback(function () {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setSheetOpen(false);
            setSheetClosing(false);
            return;
        }
        setSheetClosing(true);
    }, []);

    const openSheet = useCallback(function () {
        setSheetClosing(false);
        setSheetOpen(true);
    }, []);

    // Escape backs out of the drawer first, then the player itself — otherwise
    // one Escape would tear the whole page down from under the open drawer.
    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            if (sheetOpen) {
                event.stopPropagation();
                closeSheet();
            } else {
                onClose();
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [sheetOpen, closeSheet, onClose]);

    /* --- lyrics --- */

    const handleLyricsClick = function (event) {
        if (Math.abs(event.clientY - pressYRef.current) > 8) return;
        onToggleLyrics();
    };

    // The style rows are a radio group, so the arrow keys have to move the
    // choice: a `role="radio"` is a promise that the arrows work, and the
    // roving `tabIndex` that keeps the group to one Tab stop is what takes the
    // other three options off the Tab order in the first place. Without this
    // the group would be four rows a keyboard could not reach past the first.
    const handleStyleKeys = function (event) {
        const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const at = LYRIC_OPTIONS.findIndex((option) => option.key === lyricStyle);
        const next = LYRIC_OPTIONS[(at + step + LYRIC_OPTIONS.length) % LYRIC_OPTIONS.length];
        onChooseLyricStyle(next.key);
        // Focus follows the selection, or the next arrow press would arrive on
        // the row that is still focused rather than on the one just chosen.
        const row = styleRowRefs.current[next.key];
        if (row) row.focus();
    };

    return (
        <div
            className={closing ? `${styles.veil} ${styles['veil-out']}` : styles.veil}
            onAnimationEnd={() => { if (closing) onClosed(); }}
            onPointerDown={() => { if (closing) onCancelClose(); }}
        >
            <div
                className={closing ? `${styles.page} ${styles['page-out']}` : styles.page}
                style={{ '--np-grad': gradient }}
            >
                <div className={styles.topbar}>
                    <button type="button" className={styles['top-btn']} title="收起" aria-label="收起" onClick={onClose}>
                        <IconChevronDown />
                    </button>
                    {/* Lyrics mode moves the song line up here, centre-aligned,
                        scrolling like the mini bar's label when it is too long. */}
                    {lyricsShown && (
                        <Marquee
                            text={`${meta.title} - ${meta.artist}`}
                            className={styles['np-marquee']}
                            center
                        >
                            <span className={styles['np-line-title']}>{meta.title}</span>
                            <span className={styles['np-line-artist']}> - {meta.artist}</span>
                        </Marquee>
                    )}
                    {/* Player preferences. The equal-width twin of the collapse
                        button, which also keeps the song line centred when
                        lyrics are shown. */}
                    <button
                        type="button"
                        className={`${styles['top-btn']}${sheetOpen ? ` ${styles['top-btn-on']}` : ''}`}
                        title="播放设置"
                        aria-label="播放设置"
                        aria-haspopup="dialog"
                        aria-expanded={sheetOpen}
                        onClick={openSheet}
                    >
                        <IconMoreVertical />
                    </button>
                </div>

                <div className={styles.body}>
                    <div className={`${styles.stage}${lyricsShown ? ` ${styles['stage-lyrics']}` : ''}`}>
                        {/* Record + tonearm share one scaling unit so they stay
                            locked together whatever space the stage gets. */}
                        <div className={`${styles.rig}${ripples ? '' : ` ${styles['rig-no-ripples']}`}`}>
                            <Tonearm playing={isPlaying} />

                            <button
                                type="button"
                                className={`${styles.disc}${isPlaying ? ` ${styles['disc-playing']}` : ''}`}
                                onClick={canToggleLyrics ? onToggleLyrics : undefined}
                                disabled={!canToggleLyrics}
                                aria-hidden={lyricsShown}
                                tabIndex={lyricsShown ? -1 : 0}
                                title={canToggleLyrics ? '查看歌词' : '这首歌没有歌词'}
                                aria-label={canToggleLyrics ? '查看歌词' : '这首歌没有歌词'}
                            >
                                {/* Under the record, so each ring emerges at
                                    the rim and travels outwards. */}
                                <span className={styles.ripples} aria-hidden="true">
                                    <span className={styles.ripple} />
                                    <span className={styles.ripple} />
                                    <span className={styles.ripple} />
                                </span>
                                <span className={styles.rotor} aria-hidden="true">
                                    <span className={styles['disc-grooves']} />
                                    <span className={styles['disc-label']} style={{ background: gradient }}>
                                        <Cover track={track} />
                                        <IconNote />
                                    </span>
                                    <span className={styles['disc-sheen']} />
                                </span>
                            </button>
                        </div>

                        {modeToast && (
                            <span className={styles['mode-toast']} role="status">
                                {modeToast}
                            </span>
                        )}

                        {lyricsShown && (
                            <div
                                className={`${styles.lyrics} ${LYRIC_STYLE_CLASS[lyricVariant]}`}
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
                                {lyrics ? lyrics.lines.map((line, index) => {
                                    // `lyric-far` is always written and the
                                    // stylesheet decides whether it means
                                    // anything — only 沉浸单行 acts on it.
                                    // Keeping it out of the className
                                    // arithmetic here means one rule to read
                                    // rather than a condition per mode.
                                    const far = activeLyric >= 0 && Math.abs(index - activeLyric) > 1;
                                    return (
                                        <p
                                            key={`${line.time}-${index}`}
                                            ref={index === activeLyric ? activeLyricRef : null}
                                            className={[
                                                index === activeLyric ? styles['lyric-active'] : styles.lyric,
                                                far ? styles['lyric-far'] : '',
                                            ].filter(Boolean).join(' ')}
                                        >
                                            {line.text}
                                        </p>
                                    );
                                }) : (
                                    <p className={styles['lyrics-empty']}>
                                        {lyricsLoading ? '歌词加载中…' : '这首歌没有歌词'}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    <div className={styles['np-head']}>
                        <div className={styles['np-meta']}>
                            <span className={styles['np-title']}>{meta.title}</span>
                            <span className={styles['np-artist']}>
                                {meta.artist}
                            </span>
                        </div>
                        {/* 喜欢 / 取消喜欢. The label and the glyph both follow
                            `liked`, so the button never describes a state the
                            song is not in. */}
                        {canLike && (
                            <button
                                type="button"
                                className={liked
                                    ? `${styles['like-btn']} ${styles['like-btn-on']}`
                                    : styles['like-btn']}
                                title={liked ? '取消喜欢' : '喜欢'}
                                aria-label={liked ? '取消喜欢' : '喜欢'}
                                aria-pressed={liked}
                                onClick={onToggleLike}
                            >
                                <IconHeart filled={liked} />
                            </button>
                        )}
                    </div>

                    <div className={styles['np-progress']}>
                        <input
                            className={styles.slider}
                            type="range"
                            min={0}
                            max={duration > 0 ? duration : 1}
                            step={0.1}
                            value={Math.min(time, duration > 0 ? duration : 1)}
                            disabled={duration <= 0}
                            aria-label="播放进度"
                            onChange={(event) => onSeek(Number(event.target.value))}
                            style={{ '--fill': `${seekPercent}%` }}
                        />
                        <div className={styles['time-row']}>
                            <span>{formatTime(time)}</span>
                            <span>{formatTime(duration)}</span>
                        </div>
                    </div>

                    <div className={styles['np-controls']}>
                        <button
                            type="button"
                            className={`${styles['mode-btn']}${mode !== 'off' ? ` ${styles['mode-btn-on']}` : ''}`}
                            aria-pressed={mode !== 'off'}
                            title={playback.title}
                            onClick={onCycleMode}
                        >
                            {playback.icon}
                        </button>
                        <button
                            type="button"
                            className={styles['skip-btn']}
                            title="上一首"
                            onClick={onPrev}
                        >
                            <IconPrev />
                        </button>
                        <button
                            type="button"
                            className={styles['play-btn']}
                            title={isPlaying ? '暂停' : '播放'}
                            onClick={onTogglePlay}
                        >
                            {isPlaying ? <IconPause /> : <IconPlay />}
                        </button>
                        <button
                            type="button"
                            className={styles['skip-btn']}
                            title="下一首"
                            onClick={onNext}
                        >
                            <IconNext />
                        </button>
                        <button
                            type="button"
                            className={styles['mode-btn']}
                            title="播放列表"
                            onClick={onOpenList}
                        >
                            <IconQueue />
                        </button>
                    </div>
                </div>

                {/* Player preferences. Sits inside the page element so it shares
                    the sheet's own stacking context — it must cover the sheet's
                    content without escaping over the mini bar's layer, and it is
                    torn down with the player. */}
                {sheetOpen && (
                    <div
                        className={sheetClosing
                            ? `${styles['sheet-scrim']} ${styles['sheet-scrim-out']}`
                            : styles['sheet-scrim']}
                        role="presentation"
                        onClick={closeSheet}
                        onAnimationEnd={(event) => {
                            // Only the scrim's own fade ends the drawer; the panel
                            // and its children animate independently.
                            if (sheetClosing && event.target === event.currentTarget) {
                                setSheetOpen(false);
                                setSheetClosing(false);
                            }
                        }}
                    >
                        <div
                            className={sheetClosing
                                ? `${styles.sheet} ${styles['sheet-out']}`
                                : styles.sheet}
                            role="dialog"
                            aria-modal="true"
                            aria-label="播放设置"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <span className={styles['sheet-grip']} aria-hidden="true" />
                            <h2 className={styles['sheet-title']}>播放设置</h2>
                            {/* `aria-checked` rides on the row, so the switch's
                                visual state and what a screen reader announces
                                are written from the same boolean. */}
                            <button
                                type="button"
                                className={styles['sheet-row']}
                                role="switch"
                                aria-checked={ripples}
                                onClick={onToggleRipples}
                            >
                                <span className={styles['sheet-row-icon']} aria-hidden="true">
                                    <IconRipple />
                                </span>
                                <span className={styles['sheet-row-text']}>
                                    <span className={styles['sheet-row-title']}>唱片波纹</span>
                                    <span className={styles['sheet-row-sub']}>
                                        {ripples ? '唱片周围有一圈扩散的声波' : '唱片周围保持干净'}
                                    </span>
                                </span>
                                <span
                                    className={ripples ? `${styles.switch} ${styles['switch-on']}` : styles.switch}
                                    aria-hidden="true"
                                />
                            </button>

                            {/* How the lyrics are drawn. A radio group rather
                                than four switches, because the four are
                                alternatives to each other and not four things
                                that can each be on — and the roving `tabIndex`
                                is what makes that a keyboard-visible fact: the
                                group is one Tab stop, and the arrows (see
                                `handleStyleKeys`) move within it. */}
                            <h2 className={`${styles['sheet-title']} ${styles['sheet-group']}`} id="np-lyric-style">
                                歌词样式
                            </h2>
                            <div
                                role="radiogroup"
                                aria-labelledby="np-lyric-style"
                                onKeyDown={handleStyleKeys}
                            >
                                {LYRIC_OPTIONS.map((option) => (
                                    <button
                                        key={option.key}
                                        type="button"
                                        ref={(node) => { styleRowRefs.current[option.key] = node; }}
                                        className={lyricStyle === option.key
                                            ? `${styles['sheet-row']} ${styles['sheet-row-choice']} ${styles['sheet-row-on']}`
                                            : `${styles['sheet-row']} ${styles['sheet-row-choice']}`}
                                        role="radio"
                                        aria-checked={lyricStyle === option.key}
                                        tabIndex={lyricStyle === option.key ? 0 : -1}
                                        onClick={() => onChooseLyricStyle(option.key)}
                                    >
                                        <span className={styles['sheet-row-text']}>
                                            <span className={styles['sheet-row-title']}>{option.title}</span>
                                            <span className={styles['sheet-row-sub']}>{option.sub}</span>
                                        </span>
                                        {/* Drawn, and lit from `aria-checked`
                                            rather than from a second boolean —
                                            the same rule the switch above
                                            follows, so the dot cannot end up
                                            saying something the screen reader
                                            does not. */}
                                        <span className={styles['radio-dot']} aria-hidden="true" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default NowPlaying;
