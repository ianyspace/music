import React, { useEffect, useRef } from 'react';

import { createBandReader, readBands } from '../../core/audioAnalyser';
import { createBeatDetector } from '../../core/beat';

import styles from './ImmersiveLyrics.module.scss';

/**
 * The immersive page's lyrics: **a stage**, centred, and *on the beat*
 * (PRD v1.2 §6 — no karaoke sweep, no browsing).
 *
 * ## The rhythm part
 *
 * Every frame, one rAF loop reads the shared spectrum and drives two effects
 * straight through the DOM — no React state, because a per-frame render would
 * be the one way to make this janky:
 *
 * - **beat pulse** — the line swells ~9% and its letter-spacing breathes
 *   open on each detected kick, with a short brightness spike marking the
 *   exact instant of the hit — the words visibly play the drummer;
 * - **loudness glow** — the line's brightness follows the overall level,
 *   quiet verse dimmer, loud chorus lit.
 *
 * Both land as CSS custom properties on the root, so the browser composites
 * them; nothing in the loop touches layout.
 *
 * ## The stage
 *
 * Three shapes, chosen in the console:
 * - `single` — one line, the largest it can be;
 * - `double` — the line plus the next one underneath, so the eye can prepare;
 * - `cinema` — five lines with the current one in the middle, each step away
 *   smaller and dimmer, the way subtitles stack.
 *
 * Only the current line animates on arrival. The neighbours are deliberately
 * static: five lines each doing an entrance would be a firework, and the
 * point of showing them is that they are *waiting*.
 */

// A line's enter animation, clamped by the gap to the next line.
const LINE_MS_DEFAULT = 520;
const lineMsForGap = function (gapSeconds) {
    if (!Number.isFinite(gapSeconds) || gapSeconds <= 0) return LINE_MS_DEFAULT;
    // The animation may use at most ~55% of the line's own duration.
    return Math.round(Math.min(900, Math.max(280, gapSeconds * 550)));
};

// How much smaller a neighbour is than the line it is waiting behind.
const NEIGHBOUR_SCALE = {
    double: { 1: 0.4 },
    cinema: { '-2': 0.3, '-1': 0.46, 1: 0.46, 2: 0.3 },
};

/** The rows the stage shows right now, nearest-first. */
const stageRows = function (lyrics, activeIndex, stage) {
    if (!lyrics || !lyrics.timed || !lyrics.lines) return [];
    const lines = lyrics.lines;
    const push = (rows, index, offset) => {
        const line = lines[index];
        if (line) rows.push({ index, offset, text: line.text });
    };

    if (stage === 'cinema') {
        const rows = [];
        for (let offset = -2; offset <= 2; offset += 1) push(rows, activeIndex + offset, offset);
        return rows;
    }
    if (stage === 'double') {
        const rows = [];
        push(rows, activeIndex, 0);
        push(rows, activeIndex + 1, 1);
        return rows;
    }
    const rows = [];
    push(rows, activeIndex, 0);
    return rows;
};

const ImmersiveLyrics = function ({
    lyrics,
    lyricsLoading,
    activeIndex,
    progressTime,
    analyser,
    isPlaying,
    intensity = 0.85,
    glowBoost = 0.28,
    stage = 'single',
    enterFx = 'shine',
    palette = null,
    onTogglePlay,
}) {
    const rootRef = useRef(null);
    // Everything the frame loop reads lives in one ref — progress and play
    // state arrive as props every render, and the loop must not re-arm.
    const liveRef = useRef({ analyser, isPlaying, intensity, glowBoost });
    liveRef.current.analyser = analyser;
    liveRef.current.isPlaying = isPlaying;
    liveRef.current.intensity = intensity;
    liveRef.current.glowBoost = glowBoost;
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
        let flash = 0;
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
            // The console's 律动强度 arrives as a number now; anything that
            // is not a finite number is treated as the default.
            const rawGain = Number(live.intensity);
            const intensityK = Number.isFinite(rawGain) && rawGain > 0 ? rawGain : 0.85;

            // Beat pulse: fire on the kick, decay every frame. Three coupled
            // signals make the line visibly *play* the beat (the earlier
            // 4.5% scale was under the perception threshold):
            //   scale  — the line swells ~9% on the kick and eases back;
            //   track  — letter-spacing breathes open the same amount, so
            //            the line "takes a breath" rather than just zooming;
            //   flash  — a short brightness spike, faster than the loudness
            //            glow, that marks the exact instant of the hit.
            const beat = detector.update(now, sample.low, playing);
            if (beat.fired) { pulse = 1; flash = 1; }
            pulse *= 0.86;
            flash *= 0.87;
            const scale = 1 + pulse * 0.09 * intensityK;
            const track = pulse * 0.05 * intensityK;

            // Loudness glow, attack/release smoothed so it breathes rather
            // than flickers; the beat flash rides on top, capped so the
            // brightness filter never whites the words out.
            const boost = Number(live.glowBoost) || 0;
            const wantGlow = (playing ? 0.35 + sample.level * 1.3 : 0.35) + boost * 0.85;
            glow += (wantGlow - glow) * (wantGlow > glow ? 0.25 : 0.06);

            root.style.setProperty('--lyr-scale', scale.toFixed(4));
            root.style.setProperty('--lyr-track', track.toFixed(4));
            root.style.setProperty('--lyr-glow', Math.min(1.15, glow + flash * 0.35).toFixed(3));
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
        // A five-line stage cannot give the current line the whole frame.
        const stageBudget = stage === 'cinema' ? 0.78 : 1;
        const fit = Math.max(24, Math.min(
            window.innerHeight * 0.088 * stageBudget,
            // The width budget mirrors the lyrics layer's content box: the
            // list owns the left quarter, so the line fits in ~55%.
            (window.innerWidth * 0.55) / Math.max(units, 1),
        ));
        root.style.setProperty('--lyr-fit', `${Math.round(fit)}px`);
    }, [activeIndex, stage]);

    // The cover's accent, as a colour the stylesheet can use for the sweep
    // and the bloom. Without a palette it falls back to plain white.
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const accent = palette && palette.accent ? palette.accent : null;
        root.style.setProperty(
            '--lyr-accent',
            accent
                ? `rgb(${Math.round(accent[0] * 255)}, ${Math.round(accent[1] * 255)}, ${Math.round(accent[2] * 255)})`
                : '#ffffff',
        );
    }, [palette]);

    const rows = stageRows(lyrics, activeIndex, stage);
    const staticText = lyricsLoading
        ? '歌词加载中…'
        : (lyrics ? '这首歌词没有时间轴，跟着感觉唱' : '这首歌没有歌词');

    const enterClass = enterFx === 'shine'
        ? styles['fx-shine']
        : enterFx === 'glow' ? styles['fx-glow'] : '';

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
            {rows.length ? (
                <div className={styles.stack} data-stage={stage}>
                    {rows.map((row) => {
                        const current = row.offset === 0;
                        const table = NEIGHBOUR_SCALE[stage] || {};
                        const rowScale = table[String(row.offset)];
                        return (
                            <p
                                key={`${current ? 'line' : 'near'}-${row.index}`}
                                className={[
                                    styles.line,
                                    current ? '' : styles.neighbour,
                                    current ? enterClass : '',
                                ].filter(Boolean).join(' ')}
                                style={rowScale ? { '--lyr-row-scale': rowScale } : undefined}
                            >
                                {row.text}
                            </p>
                        );
                    })}
                </div>
            ) : (
                <p className={styles['line-static']}>{staticText}</p>
            )}
        </div>
    );
};

export default ImmersiveLyrics;
