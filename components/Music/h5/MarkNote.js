import React, { useEffect, useRef } from 'react';

import useBeat from './useBeat';
import styles from './MarkNote.module.scss';

/**
 * The app's mark: the way into 账号 — a rounded square of rainbow at the leading
 * end of the list's bar, with a note on it. While music plays it *widens* into
 * a bar that runs up to the trailing actions (`wide`, animated through
 * flex-grow), the rainbow heaves like the lines of a bouncing score, and a
 * family of smaller notes appears across it, each breathing at its own depth.
 * The QQ state dot that used to hang off the corner is gone: the state lives
 * in the `title`/`aria-label`, and a dot on a bar that changes width has no
 * corner to hang off.
 *
 * The backdrop used to be the published app icon's bitmap (`public/mark-bg.jpg`)
 * with the note masked off — and it became two things, because the note had to
 * move and a bitmap cannot: the picture as a background, the note as a path on
 * top. The picture is gone now: the rainbow is drawn on a `<canvas>` in this
 * file instead, the same way the note is. The canvas is sized once at 4× the
 * display size and downscaled by the browser, so the waves stay smooth at 40px.
 *
 * While the music plays the canvas is *redrawn* every frame — the seven band
 * boundaries drift on their own clocks and swell with the beat, so the waves
 * visibly undulate rather than sitting still. An earlier version drew once and
 * only scaled, and a 7% scale on a 40px box is 1.4px — motion nobody could
 * see. Seven 49-point polygons per frame is nothing, and the loop that drives
 * it (`useBeat`'s) already stops by itself when the music does, so the waves
 * freeze at rest for free.
 *
 * The note's path is the same trace it always was — see the comment on `NOTE`
 * below for where the numbers came from. What changed is what `paint` does to
 * it. It used to *jump*: a translateY plus a stretch/squash, so the note rose
 * off its head and landed back. It now *breathes*: a uniform scale about its
 * own centre, and the backdrop does the same — both grow and shrink with the
 * beat, together, so the mark reads as one thing pulsing rather than as a note
 * bouncing on a still picture. The level is `useBeat`'s, damped the same way
 * it always was; the only thing that moved is which axis the level drives.
 */

/**
 * The note, traced from the published icon. Read it as five parts, in the order
 * they are drawn: the rounded top of the stem; the flag sweeping out to the
 * right and down to its blunt tip; the notch back in under the flag to the
 * stem; down the stem's right edge and round the head — right side, bottom,
 * left side, top; and back up the stem's left edge, which leans, to close.
 */
const NOTE = `M288 109 L303 110 L382 153 L389 160 L394 169 L395 189 L393 195
L387 205 L378 212 L370 215 L358 215 L341 208 L339 206 L337 206 L312 193 L300 192
L295 194 L290 199 L287 211 L287 221 L286 222 L287 227 L286 228 L286 238 L285 239
L284 265 L283 266 L283 277 L282 278 L282 289 L281 290 L278 332 L274 348 L268 360
L263 367 L252 378 L247 382 L232 390 L213 395 L192 395 L180 392 L165 384 L159 379
L153 371 L147 355 L147 338 L149 330 L155 317 L161 309 L171 299 L179 293 L190 288
L192 286 L208 281 L220 280 L221 279 L241 280 L247 282 L252 282 L254 280 L271 126
L275 118 L281 112 L287 110 Z`;

/** How far each layer breathes at full level, as a fraction of its own size.
 *  The first cut (7% / 14%) was measured on the maths and invisible on the
 *  screen: 7% of a 40px box is 1.4px per side, half of it clipped away by
 *  `overflow: hidden`, and 14% of the ~19px note is under 3px — *less* travel
 *  than the jump it replaced (52/512 of the mark ≈ 4px). 10% / 24% is what
 *  actually reads; 24% is still geometrically safe (the note's corners stay
 *  inside the 512-unit viewBox with room to spare). */
const BREATH_BG = 0.10;
const BREATH_NOTE = 0.24;

/** The seven rainbow bands, top to bottom — approximations of the colours in
 *  the original `mark-bg.jpg`. They are not picked from it: that file is gone,
 *  and the canvas reads as "the same rainbow" without any single pixel having
 *  to match. Pink at the top, mauve at the bottom, with the spectrum between. */
const BAND_COLORS = [
    '#f5a3b8', // pink (top)
    '#ff8c5a', // orange
    '#ffdc7a', // yellow
    '#8fd688', // green
    '#5ea8d8', // blue
    '#8a7fcf', // purple
    '#d8a3c8', // mauve (bottom)
];

/** Number of polyline steps across the width for each wavy band edge. 48 is
 *  plenty at the 160px drawing buffer — the curves come out smooth when the
 *  browser downsamples to 40px. */
const STEPS = 48;
/** How tall the wave is, as a fraction of the canvas height, *at rest*. The
 *  first cut (2.8%) was one pixel at the 40px display size — the waves read as
 *  straight lines. 6% at rest, swelling to double that at full level, is where
 *  the bands stop looking ruled and start looking like water. */
const WAVE_AMP = 0.06;
/** How many full sine cycles fit across the width. 2.4 gives the gentle two-and-
 *  -a-bit humps the original artwork has. */
const WAVE_FREQ = 2.4;
/** How fast each boundary drifts, in radians per second. Every band gets its
 *  own speed (offset per index) so the waves slide over each other rather than
 *  undulating in lockstep — that phase difference is what makes it read as
 *  ripples instead of one wobbling picture. At ~1 rad/s a crest travels the
 *  canvas in a few seconds: slow enough to stay calm, fast enough to see. */
const waveDrift = function (b) { return 0.9 + b * 0.17; };
/** How far the band boundaries heave at full level, as a fraction of the
 *  canvas height — the "score bouncing" displacement. ±6% (≈2.4px at 40px,
 *  more across the wide bar) on top of the drifting wave; per-band phase
 *  `sin(b × 1.7)` makes adjacent bands move against each other instead of
 *  pumping in unison. */
const SCORE_BOUNCE = 0.12;

/** The small notes that appear on the wide mark while music plays — 大大小小:
 *  each with its own size (px), horizontal position (fraction of the bar's
 *  width), vertical seat (px from the bottom) and breathing depth. Three of
 *  them, plus the big traced note already at the leading end, is a family
 *  without turning the bar into a sticker sheet. Positions are percentages
 *  because the bar's width is whatever the flex row hands it. */
const FLOATING_NOTES = [
    { size: 20, left: 0.56, bottom: 7, breath: 0.26 },
    { size: 13, left: 0.72, bottom: 15, breath: 0.34 },
    { size: 16, left: 0.86, bottom: 5, breath: 0.30 },
];

/** The drawing buffer is 4× the 40px display size — high enough that the
 *  browser's downsampling kills the polyline joints before they reach the
 *  screen, low enough to stay trivial to rasterise. */
const DRAW_SIZE = 160;

/**
 * Draws the rainbow onto a 2D context, in `DRAW_SIZE`-unit space. Each band is
 * a closed polygon: its top edge is a sine wave, its bottom edge is the next
 * band's top edge, so adjacent bands share their boundary by construction and
 * there is no gap between them. The top and bottom of the canvas are flat
 * (boundary 0 and boundary `BAND_COLORS.length`) — a wave at the very edge
 * would clip against the rounded button and look cut off.
 *
 * `time` (seconds) and `level` (0..1) make the waves *move*, in two ways:
 * each boundary drifts on its own clock (`waveDrift`), and — the score part —
 * every boundary is displaced vertically by an amount *proportional to the
 * level*, with a fixed phase per band (`SCORE_BOUNCE` × `sin(b × 1.7)`), so a
 * kick makes the bands heave up and down against each other like the lines of
 * a staff jumping. Drift alone read as ripples; the beat-locked heave is what
 * reads as bouncing. This runs once per frame from `useBeat`'s loop while
 * anything is playing. The cost is seven 49-point polygons on a 160-unit
 * canvas, which is nothing; the bands cover the canvas completely and
 * opaquely, so no `clearRect` is needed.
 *
 * Band order survives the heave: worst case stacks a ±6% bounce on a ±6%
 * static wave across a 14.3% band height, which stays under half a band.
 *
 * `ctx` is expected to already be scaled to device pixels (see the `useEffect`
 * below), so all coordinates here are in the logical 160-unit space.
 */
const drawBackdrop = function (ctx, size, time, level) {
    const w = size;
    const h = size;
    const numBands = BAND_COLORS.length;
    const bandH = 1 / numBands;
    const twoPiFreq = Math.PI * 2 * WAVE_FREQ;
    const amp = WAVE_AMP * (0.55 + 0.45 * level);

    // Boundary y-values for every polyline step. Boundary 0 is the top of the
    // canvas, boundary `numBands` is the bottom — both flat. The interior ones
    // wave, drift, and heave with the beat.
    const boundaries = [];
    for (let b = 0; b <= numBands; b += 1) {
        const baseY = b * bandH;
        const isEdge = b === 0 || b === numBands;
        const phase = b * 0.85;
        const drift = time * waveDrift(b);
        // The beat-locked heave. Edges stay put (they would clip).
        const bounce = isEdge ? 0 : level * SCORE_BOUNCE * Math.sin(b * 1.7);
        const points = new Array(STEPS + 1);
        for (let s = 0; s <= STEPS; s += 1) {
            const t = s / STEPS;
            const wave = isEdge ? 0 : Math.sin(phase + drift + t * twoPiFreq) * amp;
            points[s] = { x: t * w, y: (baseY + wave + bounce) * h };
        }
        boundaries.push(points);
    }

    for (let i = 0; i < numBands; i += 1) {
        const top = boundaries[i];
        const bot = boundaries[i + 1];
        ctx.beginPath();
        ctx.moveTo(top[0].x, top[0].y);
        for (let s = 1; s <= STEPS; s += 1) ctx.lineTo(top[s].x, top[s].y);
        for (let s = STEPS; s >= 0; s -= 1) ctx.lineTo(bot[s].x, bot[s].y);
        ctx.closePath();
        ctx.fillStyle = BAND_COLORS[i];
        ctx.fill();
    }
};

const MarkNote = function ({ audioRef, playing, wide, qqBound, onOpen }) {
    const inkRef = useRef(null);
    const bgRef = useRef(null);
    const canvasRef = useRef(null);
    /** The 2D context, grabbed once — `getContext` per frame is wasted work. */
    const ctxRef = useRef(null);
    /** One ref per floating note, in `FLOATING_NOTES` order. */
    const floatRefs = useRef([]);

    // Sized once, on mount. The *drawing* happens per frame while the music
    // plays (see `paint`), but the buffer and the DPR transform never change.
    // The buffer is `DRAW_SIZE × devicePixelRatio` so the downsample is sharp
    // on retina screens without being wasteful on a 1× one. The CSS stretches
    // this square buffer across whatever width the wide bar has — bands stay
    // horizontal, the waves just read longer, which suits a bar.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;
        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = DRAW_SIZE * dpr;
        canvas.height = DRAW_SIZE * dpr;
        ctx.scale(dpr, dpr);
        ctxRef.current = ctx;
        drawBackdrop(ctx, DRAW_SIZE, 0, 0);
        return undefined;
    }, []);

    // Written straight to the elements rather than through state: this runs
    // every frame, and a transform is the one thing React does not need to
    // know about. `level < 0.004` is the same threshold `useBeat` uses to stop
    // its loop, so a settled note clears its transform and stays cleared.
    const paint = function (level) {
        const ink = inkRef.current;
        const bg = bgRef.current;
        if (!ink || !bg) return;
        if (level < 0.004) {
            ink.style.transform = '';
            bg.style.transform = '';
            floatRefs.current.forEach((el) => { if (el) el.style.transform = ''; });
            return;
        }
        // Uniform scale on every layer, from each one's own centre. No
        // translate, no stretch — the point was to stop the note jumping, and
        // a breathing scale is the motion that replaces it. Each floating
        // note breathes at its own depth (`breath`), so the family pulses
        // together but not in lockstep.
        const bgScale = 1 + BREATH_BG * level;
        const noteScale = 1 + BREATH_NOTE * level;
        bg.style.transform = `scale(${bgScale.toFixed(3)})`;
        ink.style.transform = `scale(${noteScale.toFixed(3)})`;
        FLOATING_NOTES.forEach((spec, i) => {
            const el = floatRefs.current[i];
            if (el) el.style.transform = `scale(${(1 + spec.breath * level).toFixed(3)})`;
        });
        // And the waves themselves drift and heave. `paint` runs once per
        // frame from `useBeat`'s loop while anything is playing — exactly the
        // lifecycle the motion wants (frozen at rest, running with the music)
        // — so no second rAF loop of its own. The clock is wall time, so the
        // phase keeps its speed no matter how the level wobbles.
        const ctx = ctxRef.current;
        if (ctx) drawBackdrop(ctx, DRAW_SIZE, performance.now() / 1000, level);
    };

    useBeat(audioRef, playing, paint);

    return (
        <button
            type="button"
            className={wide ? `${styles.mark} ${styles['mark-wide']}` : styles.mark}
            title={qqBound ? '账号 · 已确认 QQ' : '账号 · 未确认 QQ'}
            aria-label={qqBound ? '账号，已确认 QQ' : '账号，未确认 QQ'}
            onClick={onOpen}
        >
            {/* The rainbow backdrop, drawn on a canvas. `ref={bgRef}` is the
                element that `paint` scales — the canvas itself, not a wrapper,
                so there is no extra box between the transform and the pixels. */}
            <canvas
                ref={(node) => {
                    canvasRef.current = node;
                    bgRef.current = node;
                }}
                className={styles.bg}
                aria-hidden="true"
            />
            <svg className={styles.art} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
                <path ref={inkRef} className={styles.ink} d={NOTE} />
            </svg>
            {/* The floating family, visible only while music plays (`playing`
                drives opacity through CSS, so appearing and leaving is a
                transition, not a pop). Each one is the same traced NOTE path —
                the family shares one glyph, which is what makes it read as a
                choir rather than as clip art — at its own size, seat and
                breathing depth. First in the DOM after the big note's path, so
                the smoke test's `svg path` still lands on the big one. */}
            <span className={playing ? `${styles.notes} ${styles['notes-on']}` : styles.notes} aria-hidden="true">
                {FLOATING_NOTES.map((spec, i) => (
                    <span
                        key={i}
                        ref={(node) => { floatRefs.current[i] = node; }}
                        className={styles['note-float']}
                        style={{
                            width: spec.size,
                            height: spec.size,
                            left: `${Math.round(spec.left * 100)}%`,
                            bottom: spec.bottom,
                        }}
                    >
                        <svg viewBox="0 0 512 512" focusable="false">
                            <path className={styles['note-float-ink']} d={NOTE} />
                        </svg>
                    </span>
                ))}
            </span>
        </button>
    );
};

export default MarkNote;