import React, { useEffect, useRef } from 'react';

import { createBandReader, readBands } from '../../core/audioAnalyser';

import styles from './CoverParticles.module.scss';

/**
 * The stage's centre: the playing song's cover, taken apart into a few
 * thousand particles that hold the picture, scatter on the beat, and gather
 * again.
 *
 * ## Why plain WebGL
 *
 * This is one draw call of `GL_POINTS`. Three.js would be a few hundred
 * kilobytes to express what is here a vertex shader, a fragment shader and
 * three buffers — and this site is a static export whose whole dependency
 * list is React. A particle cloud is the one 3D effect that is *simpler*
 * without a scene graph, so it gets none.
 *
 * ## What makes it a picture
 *
 * The cover is drawn into a small offscreen canvas and read back a pixel at a
 * time; every particle is one sampled pixel, carrying that pixel's colour and
 * sitting where that pixel sat in the photo. Luminance becomes depth —
 * brighter pixels sit nearer the camera — so the cloud keeps the photo's own
 * relief instead of being a flat card.
 *
 * Reading those pixels needs `crossOrigin="anonymous"` on the image and a CORS
 * header on the file. The R2 bucket echoes the request's `Origin`, so it
 * works; a cover that refuses CORS throws on `getImageData`, and the catch
 * below falls back to a disc of particles in the song's own colour. A song
 * with no cover takes that same path from the start.
 *
 * ## What moves it
 *
 * Two numbers per frame, both from the analyser: `bass` throws particles off
 * the picture, and `level` (overall loudness) lifts and brightens the whole
 * cloud. Both are smoothed asymmetrically — fast to rise, slow to fall — which
 * is the difference between reacting to the music and flickering. With no
 * signal at all the cloud just breathes.
 */

// Sampled pixels per side of the cover. This, the point size and the box the
// stage gives the cloud are tuned together: the dots have to *touch* for the
// picture to read as a picture — a grid with gaps between the dots is a
// dithered texture, not a cover. 120 across a ~500 px box is ~4 px of pitch
// against a ~3 px dot.
const GRID_HEIGHT = 180;

// Hard ceiling, so an unexpected aspect ratio cannot ask for a million.
const MAX_PARTICLES = 40000;

// Where the cloud sits and the lens in front of it. The pair decides how much
// of the frame the cover fills.
const CAMERA_Z = 3.4;
const FOCAL = 2.6;

// Seconds the particles take to fly into a newly loaded cover.
const GATHER_MS = 900;

// Attack / release for the smoothed audio values: up quickly, down slowly.
const ATTACK = 0.35;
const RELEASE = 0.06;

const INTENSITY = {
    calm: 0.5,
    standard: 0.85,
    strong: 1.2,
};

const VERTEX_SHADER = `
precision mediump float;

attribute vec3 aTarget;
attribute vec3 aColor;
attribute float aSeed;

uniform float uTime;
uniform float uGather;
uniform float uBass;
uniform float uLevel;
uniform float uIntensity;
uniform float uFocal;
uniform float uCameraZ;
uniform vec2 uHalfViewport;
uniform float uPointSize;
uniform float uMotion;

varying vec3 vColor;
varying float vAlpha;

// Three decorrelated hashes from one seed: enough for a scatter direction
// and a per-particle weight, without a second buffer.
vec3 hash3(float n) {
    return fract(sin(vec3(n, n + 1.7, n + 3.3)) * vec3(43758.5453, 22578.1459, 19642.3491));
}

void main() {
    vec3 rand = hash3(aSeed);

    // Where this particle goes when the picture comes apart: a direction on
    // the unit sphere, pushed out to a shell of varying radius, so the
    // scatter is a cloud rather than a balloon. The shell stays *inside* a
    // couple of cover-widths — a burst that throws dots off-screen reads as
    // the picture breaking, not as the picture dancing.
    vec3 scatter = normalize(rand * 2.0 - 1.0) * (0.75 + rand.x * 0.55);

    // Assembling: 0 is fully scattered, 1 is the finished picture.
    vec3 pos = mix(scatter, aTarget, uGather);

    // The beat pushes each particle a little way out along its own scatter
    // direction — a bounded breathing pulse, never a trip to the shell. The
    // magnitude (≤ ~0.4 world units on a 2-unit cover) is what keeps the
    // picture legible while it thumps; mixing towards the shell itself tore
    // the image into dust the moment the low end arrived.
    float burst = uBass * uIntensity * (0.3 + 0.7 * rand.y);
    vec3 away = normalize(scatter) * (0.08 + 0.3 * rand.z);
    pos += away * clamp(burst, 0.0, 1.0);

    // A slow drift, and a lift that follows loudness. Both scale with
    // uMotion, so a visitor who asked for less movement gets a still picture.
    float drift = (0.012 + 0.035 * uLevel) * uMotion;
    pos += vec3(
        sin(uTime * 0.55 + aSeed * 6.283),
        cos(uTime * 0.47 + aSeed * 4.712),
        sin(uTime * 0.31 + aSeed * 3.141)
    ) * drift;
    pos.y += uLevel * 0.12 * uIntensity;

    float angle = uTime * 0.07 * uMotion;
    float c = cos(angle);
    float s = sin(angle);
    pos = vec3(pos.x * c + pos.z * s, pos.y, -pos.x * s + pos.z * c);

    float depth = pos.z + uCameraZ;
    gl_Position = vec4(
        uFocal * pos.x / depth / uHalfViewport.x,
        uFocal * pos.y / depth / uHalfViewport.y,
        0.0,
        1.0
    );

    // The same projection applied to one unit of height. As a size it is a
    // plain number near 1, which is what uPointSize is measured in; dividing
    // by depth alone would give a length in pixels and land in the hundreds.
    float persp = uFocal / depth / uHalfViewport.y;
    gl_PointSize = clamp(uPointSize * persp, 0.8, 34.0);
    // A slight gamma lift on the sampled colour. The dots overlap additively,
    // so per-dot brightness has to sit well under 1 — the picture's value is
    // carried by the *sum* of neighbours, and unmoved it saturates to white.
    // A gamma lift on the sampled colour, now safe: with over-blending the
    // brightest visible dot wins, so the lift cannot saturate the way it
    // did under additive blending. Covers read darker as particle fields
    // than they do full-frame — gaps show the dark page through — so the
    // lift also compensates for that.
    vColor = clamp(pow(aColor, vec3(0.72)), 0.0, 1.0);
    // A fade with distance, so the back of the cloud reads as behind the
    // front of it rather than as more dots. Over-blending wants near-opaque
    // dots — the topmost dot's colour is what a pixel sees.
    vAlpha = (0.96 + 0.04 * uLevel * uIntensity) * clamp(persp, 0.75, 1.1);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;

varying vec3 vColor;
varying float vAlpha;

void main() {
    // A round sprite: GL_POINTS is a square, and a field of square dots reads
    // as noise rather than as anything.
    float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
    if (d > 1.0) discard;
    float falloff = 1.0 - d * d;
    gl_FragColor = vec4(vColor, vAlpha * falloff);
}
`;

let webglSupport = null;

/**
 * Whether this browser can draw the cloud at all.
 *
 * Asked once and remembered, and asked by the *stage* before it decides
 * whether to hand the centre of the screen over: a browser with no WebGL
 * would otherwise get an empty hole where the record used to be, which is
 * strictly worse than the record.
 */
export const supportsWebgl = function () {
    if (webglSupport !== null) return webglSupport;
    if (typeof document === 'undefined') return false;
    try {
        const probe = document.createElement('canvas');
        const gl = probe.getContext('webgl') || probe.getContext('experimental-webgl');
        webglSupport = Boolean(gl);
        // The probe's context is thrown away immediately — browsers only hand
        // out a handful per page, and the real one is still to come.
        if (gl) {
            const lose = gl.getExtension('WEBGL_lose_context');
            if (lose) lose.loseContext();
        }
    } catch (error) {
        webglSupport = false;
    }
    return webglSupport;
};

const hexToRgb = function (gradient) {
    const match = /#([0-9a-f]{6})/i.exec(String(gradient || ''));
    if (!match) return [0.86, 0.36, 0.45];
    const value = parseInt(match[1], 16);
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
};

/**
 * Particles for a cover we could not read: a filled disc in the song's own
 * colour, which is roughly the shape the record used to occupy.
 */
const circleTargets = function (color) {
    const count = 9000;
    const targets = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
        // sqrt keeps the density even — a uniform radius would crowd the middle.
        const radius = Math.sqrt(Math.random()) * 1.05;
        const angle = Math.random() * Math.PI * 2;
        targets[index * 3] = Math.cos(angle) * radius;
        targets[index * 3 + 1] = Math.sin(angle) * radius;
        targets[index * 3 + 2] = Math.sin(radius * Math.PI) * 0.18;
        colors[index * 3] = color[0];
        colors[index * 3 + 1] = color[1];
        colors[index * 3 + 2] = color[2];
        seeds[index] = Math.random() * 100;
    }
    return { targets, colors, seeds, count };
};

/** Particles from the cover's own pixels, one per sampled cell. */
const coverTargets = function (image) {
    const aspect = image.naturalWidth / image.naturalHeight || 1;
    const rows = GRID_HEIGHT;
    const cols = Math.max(8, Math.round(GRID_HEIGHT * aspect));
    if (rows * cols > MAX_PARTICLES) return null;

    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, cols, rows);

    let pixels;
    try {
        pixels = ctx.getImageData(0, 0, cols, rows).data;
    } catch (error) {
        // A tainted canvas: the image came back without CORS after all.
        return null;
    }

    const targets = new Float32Array(rows * cols * 3);
    const colors = new Float32Array(rows * cols * 3);
    const seeds = new Float32Array(rows * cols);

    // The cover is placed so its *height* is the same on screen whatever the
    // aspect: a wide photo becomes a wide cloud, not a bigger one.
    const halfHeight = 1;
    const halfWidth = halfHeight * aspect;

    let written = 0;
    for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
            const at = (row * cols + col) * 4;
            if (pixels[at + 3] / 255 < 0.08) continue;
            const r = pixels[at] / 255;
            const g = pixels[at + 1] / 255;
            const b = pixels[at + 2] / 255;
            const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

            targets[written * 3] = ((col / (cols - 1)) - 0.5) * 2 * halfWidth;
            targets[written * 3 + 1] = (0.5 - (row / (rows - 1))) * 2 * halfHeight;
            // Brighter pixels forward: the photo's own highlights lift off it.
            targets[written * 3 + 2] = (luminance - 0.5) * 0.4;
            colors[written * 3] = r;
            colors[written * 3 + 1] = g;
            colors[written * 3 + 2] = b;
            seeds[written] = Math.random() * 100;
            written += 1;
        }
    }

    if (written === 0) return null;
    return {
        targets: targets.subarray(0, written * 3),
        colors: colors.subarray(0, written * 3),
        seeds: seeds.subarray(0, written),
        count: written,
    };
};

const buildProgram = function (gl) {
    const compile = function (type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            // The info log is the only explanation the driver gives, and an
            // empty one means the failure was below the shader itself (a lost
            // context most often). Naming the stage is what makes either case
            // diagnosable from a console line.
            const log = gl.getShaderInfoLog(shader);
            const stage = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
            gl.deleteShader(shader);
            throw new Error(`${stage} shader: ${log || 'compiled clean but reported failure (context lost?)'}`);
        }
        return shader;
    };

    const vertexShader = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragmentShader = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || 'program link failed');
    }
    return program;
};

/**
 * @param {string} coverUrl   artwork to take apart; empty means "no cover".
 * @param {string} gradient   CSS gradient of the song, for the fallback colour.
 * @param {boolean} isPlaying drives the beat; paused just breathes.
 * @param {string} intensity  one of `calm` / `standard` / `strong`.
 * @param {AnalyserNode|null} analyser the shared spectrum source.
 * @param {Function} [onActivate] what clicking the cloud does.
 */
const CoverParticles = function ({
    coverUrl = '',
    gradient = '',
    isPlaying = false,
    intensity = 'standard',
    analyser = null,
    onActivate,
    label = '封面粒子',
}) {
    const canvasRef = useRef(null);
    const wrapRef = useRef(null);
    // Everything the loop reads lives here rather than in the effect's
    // dependencies: play state and intensity change often, and re-running the
    // effect would tear down and re-upload the whole cloud — the picture
    // would re-scatter every time someone hit pause.
    const liveRef = useRef({ isPlaying, intensity, analyser, gradient });
    liveRef.current.isPlaying = isPlaying;
    liveRef.current.intensity = intensity;
    liveRef.current.analyser = analyser;
    liveRef.current.gradient = gradient;

    // Keyed on the cover: a new song is a new set of pixels, and rebuilding
    // the context is the honest way to load them. The cleanup releases the old
    // one, because browsers only hand out a handful at a time.
    useEffect(() => {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) return undefined;

        const gl = canvas.getContext('webgl', {
            alpha: true,
            antialias: false,
            premultipliedAlpha: false,
            // The drawing buffer is never read back; saying so lets the
            // browser drop the CPU-side copy after each frame.
            preserveDrawingBuffer: false,
        });
        if (!gl) return undefined;

        let program;
        try {
            program = buildProgram(gl);
        } catch (error) {
            if (typeof console !== 'undefined') console.error('[particles]', error);
            return undefined;
        }

        gl.useProgram(program);

        const locations = {
            target: gl.getAttribLocation(program, 'aTarget'),
            color: gl.getAttribLocation(program, 'aColor'),
            seed: gl.getAttribLocation(program, 'aSeed'),
            time: gl.getUniformLocation(program, 'uTime'),
            gather: gl.getUniformLocation(program, 'uGather'),
            bass: gl.getUniformLocation(program, 'uBass'),
            level: gl.getUniformLocation(program, 'uLevel'),
            intensity: gl.getUniformLocation(program, 'uIntensity'),
            focal: gl.getUniformLocation(program, 'uFocal'),
            cameraZ: gl.getUniformLocation(program, 'uCameraZ'),
            halfViewport: gl.getUniformLocation(program, 'uHalfViewport'),
            pointSize: gl.getUniformLocation(program, 'uPointSize'),
            motion: gl.getUniformLocation(program, 'uMotion'),
        };

        const buffers = {
            target: gl.createBuffer(),
            color: gl.createBuffer(),
            seed: gl.createBuffer(),
        };

        let particleCount = 0;
        let frame = 0;
        let startedAt = performance.now();
        let dead = false;
        let reader = null;

        const motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.15 : 1;

        const upload = function (data) {
            particleCount = data.count;
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.target);
            gl.bufferData(gl.ARRAY_BUFFER, data.targets, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.color);
            gl.bufferData(gl.ARRAY_BUFFER, data.colors, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.seed);
            gl.bufferData(gl.ARRAY_BUFFER, data.seeds, gl.STATIC_DRAW);
            // A new picture always arrives by scattering.
            startedAt = performance.now();
        };

        const useFallback = () => upload(circleTargets(hexToRgb(liveRef.current.gradient)));

        // --- the cover -----------------------------------------------------

        let image = null;
        if (coverUrl) {
            image = new Image();
            // Before `src`, or the request goes out without CORS and the
            // canvas comes back tainted.
            image.crossOrigin = 'anonymous';
            image.onload = () => {
                if (dead) return;
                const data = coverTargets(image);
                if (data) upload(data);
                else useFallback();
            };
            image.onerror = () => { if (!dead) useFallback(); };
            image.src = coverUrl;
        } else {
            useFallback();
        }

        // --- sizing --------------------------------------------------------

        // Everything below is in *device* pixels, because that is what
        // `gl.viewport` and `gl_Position` are measured in. Mixing CSS pixels
        // in here is the bug that made the first version draw the cloud at
        // 1/dpr of its intended size on a HiDPI screen.
        const resize = function () {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.round(Math.max(1, wrap.clientWidth) * dpr);
            canvas.height = Math.round(Math.max(1, wrap.clientHeight) * dpr);
            gl.viewport(0, 0, canvas.width, canvas.height);
        };
        resize();

        let observer = null;
        if (typeof ResizeObserver === 'function') {
            observer = new ResizeObserver(resize);
            observer.observe(wrap);
        } else {
            window.addEventListener('resize', resize);
        }

        // --- the loop ------------------------------------------------------

        gl.disable(gl.DEPTH_TEST);
        // Normal alpha blending, not additive: the goal is a *legible* cover,
        // and additive turns every overlap into white — the picture drowns in
        // its own speckle. With over-blending the dots simply cover each
        // other, and the sampled colours survive as-is.
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);

        let bass = 0;
        let level = 0;

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
                : { low: 0, mid: 0, high: 0, level: 0 };

            // A silent track and a missing analyser look identical, so the
            // fallback is not "nothing" — it is a slow breath, which is what a
            // paused player should look like anyway.
            const playing = live.isPlaying && Boolean(live.analyser);
            const wantBass = playing ? sample.low : 0.06;
            const wantLevel = playing ? sample.level : 0.1;
            bass += (wantBass - bass) * (wantBass > bass ? ATTACK : RELEASE);
            level += (wantLevel - level) * (wantLevel > level ? ATTACK : RELEASE);

            const t = Math.min(1, (now - startedAt) / GATHER_MS);
            const eased = 1 - (1 - t) * (1 - t) * (1 - t);

            gl.clear(gl.COLOR_BUFFER_BIT);
            if (!particleCount) return;

            gl.useProgram(program);
            gl.uniform1f(locations.time, (now - startedAt) / 1000);
            gl.uniform1f(locations.gather, eased);
            gl.uniform1f(locations.bass, bass);
            gl.uniform1f(locations.level, level);
            gl.uniform1f(locations.intensity, INTENSITY[live.intensity] || INTENSITY.standard);
            gl.uniform1f(locations.focal, FOCAL * Math.min(canvas.width, canvas.height) * 0.5);
            gl.uniform1f(locations.cameraZ, CAMERA_Z);
            gl.uniform2f(locations.halfViewport, canvas.width * 0.5, canvas.height * 0.5);
            // Diameter ≈ 2 grid spacings (see the vertex shader's alpha
            // note): dense enough that the summed field is smooth, sparse
            // enough that faces stay recognisable.
            gl.uniform1f(locations.pointSize, 9 * Math.min(window.devicePixelRatio || 1, 2));
            gl.uniform1f(locations.motion, motion);

            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.target);
            gl.enableVertexAttribArray(locations.target);
            gl.vertexAttribPointer(locations.target, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.color);
            gl.enableVertexAttribArray(locations.color);
            gl.vertexAttribPointer(locations.color, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.seed);
            gl.enableVertexAttribArray(locations.seed);
            gl.vertexAttribPointer(locations.seed, 1, gl.FLOAT, false, 0, 0);

            gl.drawArrays(gl.POINTS, 0, particleCount);
        };

        frame = window.requestAnimationFrame(tick);

        const onLost = function (event) {
            event.preventDefault();
            dead = true;
            window.cancelAnimationFrame(frame);
        };
        canvas.addEventListener('webglcontextlost', onLost);

        return () => {
            dead = true;
            window.cancelAnimationFrame(frame);
            canvas.removeEventListener('webglcontextlost', onLost);
            if (observer) observer.disconnect();
            else window.removeEventListener('resize', resize);
            if (image) {
                image.onload = null;
                image.onerror = null;
            }
            gl.deleteBuffer(buffers.target);
            gl.deleteBuffer(buffers.color);
            gl.deleteBuffer(buffers.seed);
            gl.deleteProgram(program);
            // Deliberately *not* `WEBGL_lose_context.loseContext()` here, even
            // though "free the context" sounds like the tidy thing to do. This
            // effect re-runs on every song change, on the **same canvas** — and
            // `getContext` returns the canvas's existing context whatever state
            // it is in. Losing it would make every later song render nothing,
            // silently, forever: the context comes back lost, every shader
            // reports failure with an empty log, and the fallback picture never
            // appears. One context per canvas is what the browser guarantees,
            // and that is already the minimum.
        };
    }, [coverUrl]);

    return (
        <button
            type="button"
            className={onActivate ? styles.stage : `${styles.stage} ${styles['stage-static']}`}
            onClick={onActivate}
            aria-label={onActivate ? `${label}，点击查看歌词` : label}
            disabled={!onActivate}
            tabIndex={onActivate ? 0 : -1}
        >
            <span className={styles.wrap} ref={wrapRef}>
                <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
            </span>
        </button>
    );
};

export default CoverParticles;
