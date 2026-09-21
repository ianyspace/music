import React, { useRef } from 'react';

import { assetUrl } from '../shared';

import useBeat from './useBeat';
import styles from './MarkNote.module.scss';

/**
 * The app's mark: the way into 账号, and the answer to "is my number in?" — a
 * rounded square of rainbow at the leading end of the list's bar, with a note on
 * it and a state dot on its corner.
 *
 * It used to be the published app icon, drawn as one `<img>`. It is now two
 * things, because the note has to move and a bitmap cannot: the backdrop is
 * still a picture (the artwork without the note on it), and the note on top of
 * it is a path — the same note, redrawn, so it can be lifted and stretched to
 * the music without smearing.
 *
 * The path was traced off the published icon rather than drawn by eye, and the
 * trace was checked against the bitmap it came from: rasterised at the icon's
 * own 512px, it differs from the original silhouette in 1.7% of its pixels, all
 * of them inside the one-pixel edge where the original's own antialiasing is.
 * At the 40px this is actually drawn at, that is a quarter of a pixel. The
 * coordinates below are in that 512-unit space, which is also the `viewBox`, so
 * every number here is the icon's own.
 *
 * Nothing about the mark's shape, size, radius, position or dot changed with the
 * redraw: the button is still the 40px rounded square at `margin-left: 6px` that
 * lines up with the covers below it, and the dot is still grey / green.
 *
 * Motion is `useBeat`'s job — see that file for what the level is and where it
 * comes from. The note is the only thing that moves: the backdrop stays put, so
 * the mark reads as the same icon rather than as a spinning widget.
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
 * How far the note moves at full level, in the path's own units. 52 of 512 is a
 * tenth of the mark — 4px at the 40px it is drawn at, which is as much as reads
 * as a jump rather than as a glitch. It is also as far as it can go: the note
 * stretches upward from its head, and the flag's tip is 286 units above that, so
 * anything much past this puts the tip through the top of the mark.
 */
const JUMP = 52;
/** Stretch up / pinch in, as fractions, at full level. A note that only
 *  translates looks like it is floating; the squash is what makes it land. */
const STRETCH = 0.14;
const SQUASH = 0.08;

const MarkNote = function ({ audioRef, playing, qqBound, onOpen }) {
    const inkRef = useRef(null);

    // Written straight to the element rather than through state: this runs
    // every frame, and a transform is the one thing React does not need to know
    // about. `px` inside an SVG is the local user unit, so these are the same
    // numbers as the path's.
    const paint = function (level) {
        const ink = inkRef.current;
        if (!ink) return;
        if (level < 0.004) {
            ink.style.transform = '';
            return;
        }
        const lift = -JUMP * level;
        const scaleX = 1 - SQUASH * level;
        const scaleY = 1 + STRETCH * level;
        ink.style.transform = `translateY(${lift}px) scale(${scaleX}, ${scaleY})`;
    };

    useBeat(audioRef, playing, paint);

    return (
        <button
            type="button"
            className={styles.mark}
            // The backdrop is the published artwork with the note taken off it,
            // so the mark is still one picture — just one the note can move
            // over. Inline rather than in the stylesheet because `assetUrl` is
            // what adds the basePath.
            style={{ backgroundImage: `url("${assetUrl('/mark-bg.jpg')}")` }}
            title={qqBound ? '账号 · 已确认 QQ' : '账号 · 未确认 QQ'}
            aria-label={qqBound ? '账号，已确认 QQ' : '账号，未确认 QQ'}
            onClick={onOpen}
        >
            <svg className={styles.art} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
                <path ref={inkRef} className={styles.ink} d={NOTE} />
            </svg>
            {/* Decorative: the state is already in the label above, and a
                screen reader does not need to be told about a coloured pixel. */}
            <span
                className={qqBound
                    ? `${styles.dot} ${styles['dot-on']}`
                    : styles.dot}
                aria-hidden="true"
            />
        </button>
    );
};

export default MarkNote;
