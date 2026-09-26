import React, { useEffect, useRef } from 'react';

import { createBandReader, readBands } from '../../core/audioAnalyser';
import { createBeatDetector } from '../../core/beat';

import styles from './ImmersiveLyrics.module.scss';

/**
 * The immersive page's lyrics: **one line at a time**, centred, and *on the
 * beat* (PRD v1.2 §6 — no karaoke sweep, no browsing, no neighbouring lines).
 *
 * ## The rhythm part
 *
 * Every frame, one rAF loop reads the shared spectrum and drives two effects
 * straight through the DOM — no React state, because a per-frame render would
 * be the one way to make this janky:
 *
 * - **beat pulse** — the line scales up a hair on each detected kick and
 *   eases back, so the words visibly breathe with the drummer;
 * - **loudness glow** — the line's brightness follows the overall level,
 *   quiet verse dimmer, loud chorus lit.
 *
 * Both land as CSS custom properties on the root, so the browser composites
 * them; nothing in the loop touches layout.
 *
 * ## Line changes
 *
 * There is exactly one `<p>` on screen. When the active index moves, the key
 * changes, React swaps the element, and the enter animation (old line floats
 * up and out is approximated by the new line arriving from below) plays —
 * the transition length is clamped by the gap to the next line so a fast
 * song's lines arrive before the previous one has settled.
 */

// A line's enter animation, clamped by the gap to the next line.
const LINE_MS_DEFAULT = 520;
const lineMsForGap = function (gapSeconds) {
    if (!Number.isFinite(gapSeconds) || gapSeconds <= 0) return LINE_MS_DEFAULT;
    // The animation may use at most ~55% of the line's own duration.
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
    // Everything the frame loop reads lives in one ref — progress and play
    // state arrive as props every render, and the loop must not re-arm.
    const liveRef = useRef({ analyser, isPlaying, intensity });
    liveRef.current.analyser = analyser;
    liveRef.current.isPlaying = isPlaying;
    liveRef.current.intensity = intensity;
    const linesRef = useRef(lyrics);
    linesRef.current = lyrics;
    const activeRefIdx = useRef(activeIndex);
    activeRefIdx.current = activeIndex;

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
        };

        frame = window.requestAnimationFrame(tick);
        return () => {
            dead = true;
            window.cancelAnimationFrame(frame);
        };
    }, []);

    // The enter animation's length follows the song's pace, and the font
    // shrinks for long lines so **one line stays one line** (PRD v1.2 §6):
    // CJK glyphs are ~1em wide, latin ones ~0.56em, so a weighted length
    // gives the size that just fits the viewport's usable width.
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const lines = linesRef.current;
        const active = activeRefIdx.current;
        const line = lines && lines.timed ? lines.lines[active] : null;
        const next = line && lines.lines ? lines.lines[active + 1] : null;
        const gap = line && next ? next.time - line.time : 0;
        root.style.setProperty('--lyr-line-ms', `${lineMsForGap(gap)}ms`);

        const text = line ? line.text : '';
        let units = 0;
        for (const ch of text) {
            units += /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch) ? 1 : 0.56;
        }
        const fit = Math.max(24, Math.min(
            window.innerHeight * 0.088,
            // The width budget mirrors the lyrics layer's content box: the
            // card stack takes the right ~34%, so the line fits in ~55%.
            (window.innerWidth * 0.55) / Math.max(units, 1),
        ));
        root.style.setProperty('--lyr-fit', `${Math.round(fit)}px`);
    }, [activeIndex]);

    const activeLine = lyrics && lyrics.timed && lyrics.lines[activeIndex];
    const staticText = lyricsLoading
        ? '歌词加载中…'
        : (lyrics ? '这首歌词没有时间轴，跟着感觉唱' : '这首歌没有歌词');

    return (
        <div
            ref={rootRef}
            className={styles.root}
            role="button"
            tabIndex={0}
            aria-label="歌词，点击播放或暂停"
            title="点击播放 / 暂停"
            onClick={onTogglePlay}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onTogglePlay();
                }
            }}
            aria-live="polite"
        >
            {activeLine ? (
                <p
                    key={`${activeLine.time}-${activeIndex}`}
                    className={styles.line}
                >
                    {activeLine.text}
                </p>
            ) : (
                <p className={styles['line-static']}>{staticText}</p>
            )}
        </div>
    );
};

export default ImmersiveLyrics;
