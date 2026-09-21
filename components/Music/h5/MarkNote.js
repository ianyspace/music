import React, { useEffect, useRef } from 'react';

import styles from './MarkNote.module.scss';

/**
 * The app's mark: the way into 账号 — a 40px rounded square of rainbow at the
 * leading end of the list's bar, with the traced note on top. The QQ state dot
 * is intentionally gone; the state remains in the button's title / aria-label.
 *
 * There is deliberately no audio analyser here. The rainbow is a fixed score:
 * its wave shape and its animation cadence are constants, not a frequency read
 * from the song. When `playing` is true, CSS moves the already-drawn canvas at
 * that fixed cadence; when playback stops, the class disappears and the canvas
 * stops. This keeps backgrounding out of the animation's logic entirely — no
 * AudioContext, no analyser, no retry/resume path, no fallback synth.
 *
 * The note is static. It does not scale, translate or breathe, and the mark
 * does not widen: the only playing motion is the rainbow canvas drifting inside
 * the same 40px logo box. A CSS animation is enough for that one fixed motion,
 * so the browser can keep it on the compositor without a per-frame React or
 * canvas loop.
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

const BAND_COLORS = [
    '#f5a3b8', // pink (top)
    '#ff8c5a', // orange
    '#ffdc7a', // yellow
    '#8fd688', // green
    '#5ea8d8', // blue
    '#8a7fcf', // purple
    '#d8a3c8', // mauve (bottom)
];

/** Fixed drawing parameters. These are intentionally not derived from audio:
 *  one stable score-like frequency is easier to understand and survives a
 *  background/foreground transition without having to resurrect an analyser. */
const DRAW_SIZE = 160;
const STEPS = 48;
const WAVE_AMP = 0.06;
const WAVE_FREQ = 2.4;
const WAVE_PHASES = [0.0, 0.85, 1.7, 2.55, 3.4, 4.25, 5.1, 5.95];

/**
 * Draw a fixed rainbow score into the canvas. The adjacent band boundaries
 * share the same points, so there are no hairline gaps. The per-band phase
 * makes the score read as a woven wave, but it never changes after drawing —
 * CSS is responsible for the one fixed-frequency motion.
 */
const drawBackdrop = function (ctx, size) {
    const bandH = size / BAND_COLORS.length;
    const twoPiFreq = Math.PI * 2 * WAVE_FREQ;
    const boundaries = [];
    for (let b = 0; b <= BAND_COLORS.length; b += 1) {
        const isEdge = b === 0 || b === BAND_COLORS.length;
        const points = new Array(STEPS + 1);
        for (let s = 0; s <= STEPS; s += 1) {
            const t = s / STEPS;
            const wave = isEdge
                ? 0
                : Math.sin(WAVE_PHASES[b] + t * twoPiFreq) * WAVE_AMP * size;
            points[s] = { x: t * size, y: b * bandH + wave };
        }
        boundaries.push(points);
    }

    for (let i = 0; i < BAND_COLORS.length; i += 1) {
        const top = boundaries[i];
        const bottom = boundaries[i + 1];
        ctx.beginPath();
        ctx.moveTo(top[0].x, top[0].y);
        for (let s = 1; s <= STEPS; s += 1) ctx.lineTo(top[s].x, top[s].y);
        for (let s = STEPS; s >= 0; s -= 1) ctx.lineTo(bottom[s].x, bottom[s].y);
        ctx.closePath();
        ctx.fillStyle = BAND_COLORS[i];
        ctx.fill();
    }
};

const MarkNote = function ({ playing, qqBound, onOpen }) {
    const canvasRef = useRef(null);

    // One draw on mount, one fixed-size buffer. The CSS animation moves this
    // finished image; it does not redraw or resize it per frame. Keeping the
    // canvas at 4× the display size preserves the smooth wave edges at 40px.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;
        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = DRAW_SIZE * dpr;
        canvas.height = DRAW_SIZE * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawBackdrop(ctx, DRAW_SIZE);
        return undefined;
    }, []);

    return (
        <button
            type="button"
            className={playing ? `${styles.mark} ${styles['mark-playing']}` : styles.mark}
            title={qqBound ? '账号 · 已确认 QQ' : '账号 · 未确认 QQ'}
            aria-label={qqBound ? '账号，已确认 QQ' : '账号，未确认 QQ'}
            onClick={onOpen}
        >
            {/* The canvas is oversized inside the clipped 40px square so a
                small fixed translate can move the score without exposing a
                transparent edge. No scale is applied to the mark or note. */}
            <canvas ref={canvasRef} className={styles.bg} aria-hidden="true" />
            <svg className={styles.art} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
                <path className={styles.ink} d={NOTE} />
            </svg>
        </button>
    );
};

export default MarkNote;
