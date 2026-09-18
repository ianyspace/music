import React, { useEffect, useRef, useState } from 'react';

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
} from './icons';
import { parseTrackName, trackGradient, formatTime } from './shared';
import Marquee from './Marquee';

import styles from './NowPlaying.module.scss';

// Playback modes of the single cycling control, in the order the button walks
// them: 关闭 → 列表循环 → 单曲循环 → 随机 → 关闭.
const MODES = {
    off: { icon: <IconRepeat />, title: '循环关闭' },
    all: { icon: <IconRepeat />, title: '列表循环' },
    one: { icon: <IconRepeatOne />, title: '单曲循环' },
    shuffle: { icon: <IconShuffle />, title: '随机播放' },
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
 */
const NowPlaying = function ({
    track,
    isPlaying,
    progress,
    mode = 'off',
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
    const activeLyricRef = useRef(null);
    // Tap position, so a finger that was really scrolling the lyrics does not
    // also count as "back to the record".
    const pressYRef = useRef(0);

    // Every mode tap names the mode it just switched into, centred on the
    // stage for a moment. The first render is the page opening, not a tap, so
    // the initial mode is remembered and never announced.
    const [modeToast, setModeToast] = useState('');
    const lastModeRef = useRef(mode);
    const modeTimerRef = useRef(0);

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

    /* --- lyrics --- */

    const handleLyricsClick = function (event) {
        if (Math.abs(event.clientY - pressYRef.current) > 8) return;
        onToggleLyrics();
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
                    {/* Placeholder action, kept for future use: it is the
                        equal-width twin of the collapse button, which also
                        keeps the song line centred when lyrics are shown.
                        Deliberately inert for now — no menu attached yet. */}
                    <button
                        type="button"
                        className={styles['top-btn']}
                        title="更多"
                        aria-label="更多"
                    >
                        <IconMoreVertical />
                    </button>
                </div>

                <div className={styles.body}>
                    <div className={`${styles.stage}${lyricsShown ? ` ${styles['stage-lyrics']}` : ''}`}>
                        {/* Record + tonearm share one scaling unit so they stay
                            locked together whatever space the stage gets. */}
                        <div className={styles.rig}>
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
            </div>
        </div>
    );
};

export default NowPlaying;
