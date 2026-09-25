import React, { useEffect, useRef } from 'react';

import { createBandReader, readBands } from '../../core/audioAnalyser';
import { createBeatDetector } from '../../core/beat';

import styles from './ImmersiveLyrics.module.scss';

/**
 * The immersive page's lyrics: centred, karaoke-swept, and *on the beat*.
 *
 * ## The rhythm part
 *
 * Every frame, one rAF loop reads the shared spectrum and drives three
 * effects straight through the DOM — no React state, because a per-frame
 * render would be the one way to make this janky:
 *
 * - **beat pulse** — the active line scales up a hair on each detected kick
 *   and eases back, so the words visibly breathe with the drummer;
 * - **loudness glow** — the active line's brightness follows the overall
 *   level, quiet verse dimmer, loud chorus lit;
 * - **sweep** — the karaoke fill is one CSS variable on the active line
 *   (`--sweep`, a percentage), recomputed from the play clock each frame.
 *
 * All three land as CSS custom properties on the container, so the browser
 * composites them; nothing in the loop touches layout.
 *
 * ## Browsing
 *
 * The wheel unbinds the view from the playhead for three seconds — reading
 * ahead is a legitimate thing to want — then eases back to following. The
 * listener is passive and the scroll is the container's own, so there is
 * nothing to smooth manually.
 */

// After this long without wheel input, the view returns to the playhead.
const BROWSE_MS = 3000;

// A line's enter/exit animation, clamped by the gap to the next line so a
// fast song's lines arrive before the previous transition has cleared.
const LINE_MS_DEFAULT = 520;
const lineMsForGap = function (gapSeconds) {
    if (!Number.isFinite(gapSeconds) || gapSeconds <= 0) return LINE_MS_DEFAULT;
    // The transition may use at most ~55% of the line's own duration.
    return Math.round(Math.min(900, Math.max(280, gapSeconds * 550)));
};

const ImmersiveLyrics = function ({
    lyrics,
    lyricsLoading,
    activeIndex,
    progressTime,
    analyser,
    isPlaying,
    intensity = 'standard',
    onTogglePlay,
}) {
    const rootRef = useRef(null);
    const activeRef = useRef(null);
    // Everything the frame loop reads lives in one ref — progress and play
    // state arrive as props every render, and the loop must not re-arm.
    const liveRef = useRef({ analyser, isPlaying, intensity });
    liveRef.current.analyser = analyser;
    liveRef.current.isPlaying = isPlaying;
    liveRef.current.intensity = intensity;
    // `progressTime` is read through a ref too: timeupdate fires often enough
    // for the sweep, and the rAF loop reading the prop's ref stays current.
    const timeRef = useRef(progressTime);
    timeRef.current = progressTime;
    const linesRef = useRef(lyrics);
    linesRef.current = lyrics;
    const activeRefIdx = useRef(activeIndex);
    activeRefIdx.current = activeIndex;

    // Wheel browsing: a plain boolean plus a timer.
    const freeRef = useRef(false);
    const freeTimerRef = useRef(0);
    useEffect(() => () => window.clearTimeout(freeTimerRef.current), []);

    // The one effect that never re-runs: it owns the frame loop for the
    // component's whole life. All per-frame values arrive through refs.
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return undefined;

        let reader = null;
        const detector = createBeatDetector();
        let pulse = 0;
        let glow = 0.6;
        let frame = 0;
        let dead = false;

        const tick = function (now) {
            if (dead) return;
            frame = window.requestAnimationFrame(tick);
            if (document.hidden) return;

            const live = liveRef.current;
            if (live.analyser && (!reader || reader.analyser !== live.analyser)) {
                reader = createBandReader(live.analyser);
            }
            const sample = reader && live.analyser
                ? readBands(reader)
                : { low: 0, level: 0 };

            const playing = live.isPlaying && Boolean(live.analyser);
            const intensityK = live.intensity === 'calm' ? 0.5 : live.intensity === 'strong' ? 1.2 : 0.85;

            // Beat pulse: fire on the kick, decay every frame. The scale is
            // deliberately small — the line must stay readable, and a big
            // pulse reads as a glitch rather than as rhythm.
            const beat = detector.update(now, sample.low, playing);
            if (beat.fired) pulse = 1;
            pulse *= 0.86;
            const scale = 1 + pulse * 0.045 * intensityK;

            // Loudness glow, attack/release smoothed so it breathes rather
            // than flickers.
            const wantGlow = playing ? 0.35 + sample.level * 1.3 : 0.35;
            glow += (wantGlow - glow) * (wantGlow > glow ? 0.25 : 0.06);

            root.style.setProperty('--lyr-scale', scale.toFixed(4));
            root.style.setProperty('--lyr-glow', glow.toFixed(3));

            // Karaoke sweep, driven by the play clock against the active
            // line's own window.
            const lines = linesRef.current;
            const active = activeRefIdx.current;
            const line = lines && lines.timed && lines.lines[active];
            if (line) {
                const next = lines.lines[active + 1];
                const gap = next ? next.time - line.time : 0;
                const done = gap > 0
                    ? Math.min(1, Math.max(0, (timeRef.current - line.time) / gap))
                    : 1;
                root.style.setProperty('--lyr-sweep', `${(done * 100).toFixed(2)}%`);
                root.style.setProperty('--lyr-line-ms', `${lineMsForGap(gap)}ms`);
            } else {
                root.style.setProperty('--lyr-sweep', '100%');
            }
        };

        frame = window.requestAnimationFrame(tick);
        return () => {
            dead = true;
            window.cancelAnimationFrame(frame);
        };
    }, []);

    // Bring the active line to the middle of the container — by hand, inside
    // the container's own scroll range. `scrollIntoView` would also scroll
    // every ancestor (including the page shell's `overflow: hidden` box,
    // which is programmatically scrollable) and shove the play bar out of
    // the viewport.
    const followActive = function (smooth) {
        const root = rootRef.current;
        const line = activeRef.current;
        if (!root || !line) return;
        const top = line.offsetTop - (root.clientHeight - line.offsetHeight) / 2;
        root.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
    };

    // Follow the playhead — unless the visitor is browsing.
    useEffect(() => {
        if (freeRef.current) return;
        followActive(true);
    }, [activeIndex]);

    const onWheel = function (event) {
        // The container scrolls natively (it is an overflow-y box); the
        // handler only re-arms the browse window and, on its expiry, walks
        // the view back to the playhead.
        freeRef.current = true;
        window.clearTimeout(freeTimerRef.current);
        freeTimerRef.current = window.setTimeout(() => {
            freeRef.current = false;
            followActive(true);
        }, BROWSE_MS);
    };

    return (
        <div
            ref={rootRef}
            className={styles.root}
            role="button"
            tabIndex={0}
            aria-label="歌词，点击播放或暂停"
            title="点击播放 / 暂停"
            onWheel={onWheel}
            onClick={onTogglePlay}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onTogglePlay();
                }
            }}
        >
            {lyrics && lyrics.timed ? (
                lyrics.lines.map((line, index) => (
                    <p
                        key={`${line.time}-${index}`}
                        ref={index === activeIndex ? activeRef : null}
                        className={index === activeIndex
                            ? `${styles.line} ${styles['line-active']}`
                            : (index === activeIndex + 1 || index === activeIndex - 1)
                                ? `${styles.line} ${styles['line-near']}`
                                : styles.line}
                    >
                        {line.text}
                    </p>
                ))
            ) : (
                <p className={styles['line-static']}>
                    {lyricsLoading ? '歌词加载中…' : (lyrics ? '这首歌词没有时间轴，跟着感觉唱' : '这首歌没有歌词')}
                </p>
            )}
        </div>
    );
};

export default ImmersiveLyrics;
