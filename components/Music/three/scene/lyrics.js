import * as THREE from 'three';

import { haloTexture } from './textures';

/**
 * The lyrics, as the biggest object in the room.
 *
 * Not a DOM panel over the canvas, and not a caption at the bottom of the
 * screen. The words are a plane standing in the scene, above the record, with
 * the dust drifting through them — which is the whole reason the camera rig
 * exists, because a camera that can walk around them is what makes them feel
 * like a thing in a room instead of a subtitle.
 *
 * Three layers, front to back:
 *
 *  1. **the glow** — an additive halo behind the active line, breathing with
 *     the beat. It is what puts light on the line being sung.
 *  2. **the text** — a 2048×1024 canvas, redrawn only when the line changes.
 *  3. **nothing else** — the plane sits inside the ring of dust, and the text
 *     has `depthTest: false`, so the dust passes in front of and behind the
 *     words without ever making them unreadable.
 *
 * ## The wipe
 *
 * The line being sung fills with light from left to right, which is the one
 * piece of karaoke grammar everyone already knows how to read. It is *not*
 * done by redrawing the canvas per frame — a 2048×1024 texture is eight
 * megabytes, and uploading that sixty times a second is most of a gigabyte of
 * bus traffic for one animation. Instead the canvas holds the line at full
 * brightness and a three-line shader hook, injected with `onBeforeCompile`,
 * multiplies the alpha down to `UNSUNG` to the right of a moving edge:
 *
 * ```glsl
 * float w = 1.0 - smoothstep(uWipe - 0.035, uWipe + 0.035, vMapUv.x);
 * diffuseColor.a *= mix(1.0, mix(UNSUNG, 1.0, w), band);
 * ```
 *
 * One uniform per frame, no upload, and the soft edge is free. `band` is what
 * keeps the wipe off the neighbouring lines: the active line is always drawn
 * at the canvas's vertical centre, so "the active line" is the strip of UV
 * space within `BAND` of `y = 0.5`, and everything outside it is left alone.
 * The red pool painted under the line gets wiped along with it, which is the
 * accident that makes it look deliberate — the light appears to be *filling*
 * the line as it is sung.
 *
 * A line change is not a cut. The whole plane starts 6cm low and 55% faded and
 * rises into place over about a fifth of a second, so the sheet reads as
 * *scrolling* even though only one line is ever drawn at a time. That is the
 * cheap version of a lyric scroll — the expensive one redraws a canvas per
 * frame, and a full song's worth of lines will not fit in a texture anyway.
 */

const WIDTH = 2048;
const HEIGHT = 1024;

/** Wide enough to read from across the room, tall enough to hold three lines. */
const PLANE_WIDTH = 5.6;
const PLANE_HEIGHT = PLANE_WIDTH * (HEIGHT / WIDTH);

const BASE_Y = 1.95;
const BASE_Z = 0.15;

/** How far the sheet rises when a line changes, in world units. */
const RISE = 0.06;

const FONT_STACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", -apple-system, sans-serif';

/** How many lines above and below the active one are drawn. */
const NEIGHBOURS = 2;

/** Type size on the canvas, and the gap between lines. */
const ACTIVE_SIZE = 108;
const LINE_GAP = 178;

/** Half-height of the active line, in UV space, for the wipe's mask. */
const BAND = 0.13;
/** How bright the part of the line that has not been sung yet stays. */
const UNSUNG = 0.45;
/** The softness of the wipe's edge, in UV space. */
const EDGE = 0.035;

/** How long the last line is assumed to take, with nothing after it to say. */
const LAST_LINE_SECONDS = 4.5;
/** Bounds on a line's length, so one long instrumental cannot stall the wipe. */
const MIN_LINE_SECONDS = 0.6;
const MAX_LINE_SECONDS = 8;

const ACCENT = 'rgba(250, 35, 59,';

export const createLyrics = function () {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;

    // Shared with the compiled shader, so it can be moved without a recompile.
    const wipe = { value: 1 };
    const band = { value: BAND };

    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        // The words are the one thing in the scene that is *read* rather than
        // looked at. Fog would dim them with distance and the ACES curve would
        // pull the white down to grey, which is right for a lamp and wrong for
        // a lyric sheet — so both are switched off for this material only.
        fog: false,
        toneMapped: false,
    });

    // The wipe. `onBeforeCompile` rather than a `ShaderMaterial` so that the
    // material keeps everything `MeshBasicMaterial` already does correctly —
    // the map, the alpha, the colour space — and only the one line changes.
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uWipe = wipe;
        shader.uniforms.uBand = band;
        shader.fragmentShader = shader.fragmentShader
            .replace(
                '#include <common>',
                `#include <common>
                uniform float uWipe;
                uniform float uBand;`,
            )
            .replace(
                '#include <opaque_fragment>',
                `float w = 1.0 - smoothstep(uWipe - ${EDGE}, uWipe + ${EDGE}, vMapUv.x);
                float mask = 1.0 - smoothstep(uBand * 0.7, uBand, abs(vMapUv.y - 0.5));
                diffuseColor.a *= mix(1.0, mix(${UNSUNG}, 1.0, w), mask);
                #include <opaque_fragment>`,
            );
    };

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_WIDTH, PLANE_HEIGHT), material);
    mesh.position.set(0, BASE_Y, BASE_Z);
    mesh.renderOrder = 3;
    mesh.visible = false;

    // --- the glow behind the active line -------------------------------------
    const glowMaterial = new THREE.MeshBasicMaterial({
        map: haloTexture(),
        color: 0xfa233b,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        fog: false,
        toneMapped: false,
    });
    const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(PLANE_WIDTH * 0.92, PLANE_HEIGHT * 0.46),
        glowMaterial,
    );
    glow.position.set(0, BASE_Y, BASE_Z - 0.02);
    glow.renderOrder = 2;
    glow.visible = false;

    let lastIndex = -2;
    let lastNotice = null;
    // 1 the instant a line changes, damped to 0 over the next few frames.
    let rise = 0;
    // The damped visibility, kept apart from `material.opacity` because the
    // rise is multiplied into it rather than being part of it.
    let shown = 0;
    let level = 0;
    // Where the wipe starts and ends, in UV, measured from the line's own
    // width rather than the canvas: a four-character line should be filled in
    // the time a twelve-character one is, not a third of it.
    let from = 0;
    let to = 1;

    const drawLine = function (text, y, size, alpha, glowBlur) {
        ctx.font = `600 ${size}px ${FONT_STACK}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.shadowColor = glowBlur ? 'rgba(250, 35, 59, 0.9)' : 'transparent';
        ctx.shadowBlur = glowBlur;
        ctx.fillText(text, WIDTH / 2, y, WIDTH - 200);
        ctx.shadowBlur = 0;
    };

    /** The drawn width of a line, in UV. `fillText` condenses at `maxWidth`. */
    const measure = function (text, size) {
        ctx.font = `600 ${size}px ${FONT_STACK}`;
        const drawn = Math.min(ctx.measureText(text).width, WIDTH - 200);
        return drawn / WIDTH;
    };

    /**
     * @param {Array<{time:number,text:string}>} lines
     * @param {number} index  index of the line being sung, or -1 for none yet
     * @param {string} notice drawn when the song has no lyrics at all
     */
    const render = function (lines, index, notice) {
        ctx.clearRect(0, 0, WIDTH, HEIGHT);
        from = 0;
        to = 1;

        if (notice) {
            drawLine(notice, HEIGHT / 2, 72, 0.34, 0);
            texture.needsUpdate = true;
            return;
        }

        if (!lines.length) return;

        // A pool of accent light on the line being sung, painted under it. It
        // is doing the job a bloom pass would, for one gradient.
        const pool = ctx.createRadialGradient(
            WIDTH / 2, HEIGHT / 2, 0,
            WIDTH / 2, HEIGHT / 2, WIDTH * 0.34,
        );
        pool.addColorStop(0, `${ACCENT} 0.17)`);
        pool.addColorStop(0.55, `${ACCENT} 0.06)`);
        pool.addColorStop(1, `${ACCENT} 0)`);
        ctx.fillStyle = pool;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        // The active line sits on the vertical centre, which is also the
        // plane's centre, so it stays put while its neighbours come and go.
        const active = lines[index] ? lines[index].text : '';
        drawLine(active, HEIGHT * 0.5, ACTIVE_SIZE, 0.99, 44);
        if (active) {
            const half = measure(active, ACTIVE_SIZE) / 2;
            from = 0.5 - half;
            to = 0.5 + half;
        }

        for (let step = 1; step <= NEIGHBOURS; step += 1) {
            const above = lines[index - step];
            const below = lines[index + step];
            // Fade and shrink with distance rather than clipping at a hard
            // edge: the plane has no frame, so an abrupt cut would read as a
            // rendering mistake instead of as "there is more".
            const size = ACTIVE_SIZE - step * 22;
            const alpha = 0.32 / (step * 1.3);
            const offset = step * LINE_GAP;
            if (above) drawLine(above.text, HEIGHT * 0.5 - offset, size, alpha, 0);
            if (below) drawLine(below.text, HEIGHT * 0.5 + offset, size, alpha, 0);
        }

        texture.needsUpdate = true;
    };

    return {
        mesh,
        glow,

        /**
         * @param {boolean} visible   the listener's toggle, and whether the
         *                            song has lyrics at all
         * @param {object|null} lyrics  `{ timed, lines }` from `usePlayer`
         * @param {number} time       current playback position, in seconds
         * @param {string} notice     shown instead of lines
         * @param {number} delta      seconds since the last frame, for the fade
         */
        update(visible, lyrics, time, notice, delta) {
            const lines = lyrics && lyrics.lines ? lyrics.lines : [];
            const index = lyrics && lyrics.timed
                ? lines.findIndex((line, i) => (
                    time >= line.time && (i === lines.length - 1 || time < lines[i + 1].time)
                ))
                : (lyrics ? 0 : -1);

            const on = visible && Boolean(lyrics || notice);
            mesh.visible = on;
            glow.visible = on;

            // A redraw is only needed when the line changes, but the notice can
            // change while the index does not (a song whose lyrics are still
            // loading becomes a song with none).
            if (on && (index !== lastIndex || notice !== lastNotice)) {
                render(lines, index, notice);
                // Not on the first draw of a song: a sheet that rises into
                // place before the visitor has read a word of it is motion for
                // nothing.
                if (lastIndex !== -2) rise = 1;
                lastIndex = index;
                lastNotice = notice;
            }
            if (!on) lastIndex = -2;

            // How far into the line the song is. Untimed lyrics — and the
            // notice — have no wipe at all, which is what `wipe = to` means.
            const line = lyrics && lyrics.timed ? lines[index] : null;
            if (line) {
                const next = lines[index + 1];
                const span = Math.min(
                    MAX_LINE_SECONDS,
                    Math.max(MIN_LINE_SECONDS, (next ? next.time : line.time + LAST_LINE_SECONDS) - line.time),
                );
                const progress = THREE.MathUtils.clamp((time - line.time) / span, 0, 1);
                wipe.value = from + (to - from) * progress;
            } else {
                wipe.value = 1;
            }

            rise = THREE.MathUtils.damp(rise, 0, 8, delta);
            shown = THREE.MathUtils.damp(shown, on ? 1 : 0, 6, delta);

            mesh.position.y = BASE_Y - rise * RISE;
            glow.position.y = mesh.position.y;
            material.opacity = shown * (1 - rise * 0.55);
            glowMaterial.opacity = shown * (0.1 + level * 0.34) * (1 - rise * 0.5);
        },

        /** The beat. Same 0..1 the record and the dust get. */
        setLevel(next) {
            level = next;
        },

        /** How far across the line the wipe has travelled, in UV. */
        get wipe() {
            return wipe.value;
        },

        dispose() {
            mesh.geometry.dispose();
            material.dispose();
            texture.dispose();
            glow.geometry.dispose();
            glowMaterial.map.dispose();
            glowMaterial.dispose();
        },
    };
};
