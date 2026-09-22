import React, { useEffect, useRef } from 'react';

import styles from './MarkNote.module.scss';

/**
 * The app's mark: the way into 账号 — a rounded square of rainbow at the leading
 * end of the list's bar, with the traced note on top and the QQ state on its
 * corner. The state dot answers "did my number actually take?" from the list,
 * without opening a page; the same answer is in the button's title / aria-label,
 * so the dot itself is decorative.
 *
 * There is deliberately no audio analyser here. The rainbow is a fixed score:
 * its wave shape and its animation cadence are constants, not a frequency read
 * from the song. `playing` only toggles the score's CSS *play state* — the
 * animation is always applied, paused when playback stops — so the wave holds
 * the frame it was on and carries on from there when playback resumes, instead
 * of snapping back to the start. This keeps backgrounding out of the
 * animation's logic entirely — no AudioContext, no analyser, no retry/resume
 * path, no fallback synth.
 *
 * There is also no entry animation on the mark's *size* any more: it used to
 * enter as a bar the width of the row and shrink into the square. It is now the
 * square from the first paint, and the only thing that arrives is the note,
 * fading in over a second (`.art` in the stylesheet — a plain CSS animation, so
 * this component holds no state for it and nothing measures the layout).
 *
 * The note is otherwise static. It never scales, translates or breathes, and
 * playback does not touch the mark's size.
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

/**
 * The artwork, band by band, top to bottom. Each band is a *pair* — its colour
 * at the top and at the bottom — because the reference's bands are gradients,
 * not flat stripes: the orange runs from a deep #f6541c to a light #f9a832,
 * and the pale yellow barely moves at all. Sampled off the reference image.
 */
const BANDS = [
    ['#f6535f', '#f77080'], // 红
    ['#f6541c', '#f9a832'], // 橙
    ['#f9e08a', '#fbe79a'], // 黄（浅）
    ['#8bd19d', '#6dc8b5'], // 绿（薄荷）
    ['#43a9b6', '#419ce6'], // 蓝
    ['#505cd5', '#905fe6'], // 靛
    ['#a05fe8', '#c070f2'], // 紫
];

/**
 * Where each boundary sits when the wave is flat, as a fraction of the mark's
 * height — and how far it swings either side of that. Both are read off the
 * reference, and neither is even: its bands are 0.11 to 0.18 tall, and the
 * boundaries through the middle of the rainbow move about half as far as the
 * outer ones. That taper is what gives the bands their pinched-waist look; a
 * single amplitude for all six makes the rainbow look inflated instead.
 *
 * The first and last entries are the mark's own edges, so they never move.
 */
const BOUNDARIES = [0, 0.147, 0.324, 0.472, 0.612, 0.771, 0.89, 1];
const SWING = [0, 0.071, 0.064, 0.031, 0.034, 0.055, 0.055, 0];

/* --- the fixed score's geometry ------------------------------------------
 *
 * All of these are constants. Nothing here is derived from audio, and nothing
 * changes after the single draw on mount; the only motion is the CSS flow.
 */

/** The backing store. Wider than it is tall because the mark it fills is
 *  wider than it is tall too (see `.bg`) — matching the two means the wave is
 *  never stretched. */
const DRAW_W = 320;
const DRAW_H = 160;

/** Enough columns that the sweep below is smooth at this wavelength — one
 *  buffer pixel each. The score is drawn once on mount, so a fine step costs
 *  nothing per frame. */
const COLUMNS = DRAW_W;

/** How far either side of a boundary, as a fraction of the band it is in, the
 *  colour blends into its neighbour. Short on purpose: the reference's own
 *  edges take about a fifth of a band to turn over, and a longer blend keeps
 *  the rainbow continuous but swallows the ripple. */
const BLEND = 0.12;

/** One whole wavelength, in buffer px. The flow animation moves the canvas by
 *  50% of its own width — exactly this — so the loop closes with no seam. Half
 *  the buffer is also what puts 0.77 of a wave across the mark, which is the
 *  reference's own scale: one crest and one trough, not a rippled flag. */
const WAVE_LAMBDA = DRAW_W / 2;

/** Where the wave pushes its boundaries furthest down, in buffer px. The
 *  reference's crest sits about a fifth of the way across, not at the edge.
 *  Derivation, since it looks arbitrary otherwise: box x = 0.2 × 40px maps to
 *  buffer (0.2 × 40 + 56) / 0.325, from `.bg`'s 260% width and -140% left. */
const WAVE_ORIGIN = 197;

/** Mirrors `.bg` in MarkNote.module.scss: the canvas is 120% of the mark's
 *  height and sits 10% above it, so the mark shows the middle 1/1.2 of the
 *  buffer. The leftover sixth is the room the wave's amplitude spends, and it
 *  is what keeps the flat red top and violet bottom out of sight. */
const VISIBLE_FRACTION = 1 / 1.2;

/** Blend two hex colours. The two bands either side of a boundary are painted
 *  from the same gradient, so the colour each of them reaches *at* the boundary
 *  is this half-way mix — that is what keeps the rainbow continuous across it
 *  while the boundary itself still reads as an edge. */
const mix = function (a, b, t) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const channels = [16, 8, 0].map((shift) => {
        const va = (pa >> shift) & 255;
        const vb = (pb >> shift) & 255;
        return Math.round(va + (vb - va) * t);
    });
    return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
};

/**
 * Draw the fixed rainbow score into the canvas.
 *
 * It is painted as a sweep of one-pixel columns rather than as seven wavy
 * shapes. Each column gets its own vertical gradient whose stops sit on *that
 * column's* wave, which is the only way to get the blend between two bands to
 * follow the ripple: a single canvas-wide gradient cannot bend, so its stops
 * would cut a horizontal stripe of blended colour straight across the wave —
 * visible at 40px as a faint seam through the middle of a band.
 *
 * The columns tile the canvas exactly, so there is no gap between them, and
 * neighbouring columns differ by well under a pixel of colour — the wave moves
 * about 1.6 buffer px per column. Drawn once; CSS owns the only motion.
 */
const drawBackdrop = function (ctx) {
    const count = BANDS.length;
    const span = DRAW_H * VISIBLE_FRACTION;
    const top = (DRAW_H - span) / 2;
    const k = (Math.PI * 2) / WAVE_LAMBDA;
    const columnW = DRAW_W / COLUMNS;
    const at = (y) => Math.min(1, Math.max(0, y / DRAW_H));
    // One wave shared by every boundary: the reference's bands ripple together
    // like a flag, each by its own amount, rather than braiding out of phase.
    const ripple = (u) => Math.cos((u - WAVE_ORIGIN) * k);
    const edgeAt = (b, u) => top + (BOUNDARIES[b] + SWING[b] * ripple(u)) * span;

    for (let c = 0; c < COLUMNS; c += 1) {
        const u = c * columnW;
        const ramp = ctx.createLinearGradient(0, 0, 0, DRAW_H);
        ramp.addColorStop(0, BANDS[0][0]);
        for (let b = 0; b < count; b += 1) {
            const upper = edgeAt(b, u);
            const lower = edgeAt(b + 1, u);
            // The blend is measured off the band it is in, not off a nominal
            // band height: these bands pinch to two thirds of their average, and
            // a fixed width would spill one band's blend across its neighbour.
            const soft = (lower - upper) * BLEND;
            // The band above and the band below meet on the shared boundary at
            // the same half-way colour, which is what keeps the rainbow
            // continuous across it while the boundary still reads as an edge.
            if (b > 0) ramp.addColorStop(at(upper), mix(BANDS[b - 1][1], BANDS[b][0], 0.5));
            ramp.addColorStop(at(upper + soft), BANDS[b][0]);
            ramp.addColorStop(at(lower - soft), BANDS[b][1]);
            if (b < count - 1) ramp.addColorStop(at(lower), mix(BANDS[b][1], BANDS[b + 1][0], 0.5));
        }
        ramp.addColorStop(1, BANDS[count - 1][1]);
        ctx.fillStyle = ramp;
        ctx.fillRect(u, 0, columnW, DRAW_H);
    }
};

const MarkNote = function ({ playing, qqBound, onOpen }) {
    const canvasRef = useRef(null);

    // One draw on mount, one fixed-size buffer. The CSS animation moves this
    // finished image; it does not redraw or resize it per frame. Keeping the
    // canvas at ~3× the display size preserves the smooth wave edges at 40px.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;
        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = DRAW_W * dpr;
        canvas.height = DRAW_H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawBackdrop(ctx);
        return undefined;
    }, []);

    const className = [styles.mark, playing ? styles['mark-playing'] : ''].filter(Boolean).join(' ');
    const dotClass = qqBound ? `${styles.dot} ${styles['dot-on']}` : styles.dot;

    return (
        <button
            type="button"
            className={className}
            title={qqBound ? '账号 · 已确认 QQ' : '账号 · 未确认 QQ'}
            aria-label={qqBound ? '账号，已确认 QQ' : '账号，未确认 QQ'}
            onClick={onOpen}
        >
            {/* The canvas is oversized inside a clipping layer, never the mark
                itself: the extra width is the room the rightward flow travels
                through, and the clip is what keeps the rest of it out of sight.
                It is a layer of its own because the button must not clip — the
                state dot sits on the corner and would be cut by it. No scale is
                applied to the mark or the note. */}
            <span className={styles.clip}>
                <canvas ref={canvasRef} className={styles.bg} aria-hidden="true" />
            </span>
            <svg className={styles.art} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
                <path className={styles.ink} d={NOTE} />
            </svg>
            {/* Decorative: the state is already in the label above, and a screen
                reader does not need to be told about a coloured pixel. */}
            <span className={dotClass} aria-hidden="true" />
        </button>
    );
};

export default MarkNote;
