import React, { useEffect, useRef } from 'react';

import { createBandReader, readBands } from '../../core/audioAnalyser';
import { createBeatDetector } from '../../core/beat';

import styles from './NebulaCanvas.module.scss';

/**
 * The immersive page's whole background: the playing song's cover blown up
 * past the edges of the viewport and taken apart into a dense field of
 * particles — a portrait that still reads as the cover — with a sparse layer
 * of ambient dust behind it and a virtual camera that turns with the pointer.
 *
 * ## Inheritance
 *
 * This is the desktop stage's particle cloud (`visual/CoverParticles`) rebuilt
 * for the immersive page, then re-tuned against PRD v1.1 §3.1: the projection,
 * the pixel-sampling cover, the breathing zoom and the beat shockwave all
 * carry over. What changed is scale and density — the portrait now overflows
 * the viewport at ~160k particles, so a dot is a *pixel* of the picture, and
 * the cover's subject stays recognisable (the earlier 57k version read as a
 * swarm, not a face).
 *
 * ## Why still plain WebGL
 *
 * One program, two buffers, two draw calls per frame. A scene graph would not
 * shorten a line of the shader and would cost the page a dependency — the
 * static export stays at React and nothing else.
 *
 * ## The two draws
 *
 * - **Dust** (back): a few thousand faint points spread through the z range,
 *   drawn *additively* — they are light, not surface, and they are what makes
 *   the beat's shockwave visible out where the picture is not.
 * - **The portrait** (front): one particle per sampled cover pixel, drawn with
 *   normal alpha blending, because additive white-out is exactly what killed
 *   the first version of the cover cloud.
 */

// Sampled pixels per side of the cover. 400 → ~160k particles for a square
// cover — the density the portrait needs: at this pitch a dot is a *pixel*
// of the picture, not a mote in a swarm, and the cover's subject stays
// recognisable after particleisation (PRD v1.1 §3.1).
const GRID_HEIGHT = 400;

// Hard ceiling, so an unexpected aspect ratio cannot ask for a million.
const MAX_PARTICLES = 240_000;

// Ambient dust: a faint backdrop *behind* the portrait. Deliberately sparse —
// it is atmosphere at the edges of the frame, never a rival to the picture.
const DUST_COUNT = 4_000;

// Where the lens sits.
const CAMERA_Z = 3.4;
const FOCAL = 2.6;

// Seconds the particles take to fly into a newly loaded cover.
const GATHER_MS = 1100;

// Attack / release for the smoothed audio values: up quickly, down slowly.
const ATTACK = 0.35;
const RELEASE = 0.06;

const INTENSITY = {
    calm: 0.5,
    standard: 0.85,
    strong: 1.2,
};

// How much of the viewport height the cover portrait spans. Above 1 means
// the picture deliberately overflows the screen — the visitor sees the
// subject, the edges run off-frame, like the reference's wall-sized face.
const CLOUD_SCALE = 1.35;

const VERTEX_SHADER = `
precision mediump float;

attribute vec3 aTarget;
attribute vec3 aColor;
attribute float aSeed;

uniform float uTime;
uniform float uGather;
uniform float uBass;
uniform float uHigh;
uniform float uLevel;
uniform float uIntensity;
uniform float uFocal;
uniform float uCameraZ;
uniform vec2 uHalfViewport;
uniform float uPointSize;
uniform float uMotion;
uniform float uWaveAge;
uniform float uWaveAmp;
uniform float uScale;
uniform vec2 uParallax;
uniform float uMode;
uniform float uAspect;

varying vec3 vColor;
varying float vAlpha;

// Three decorrelated hashes from one seed: enough for a scatter direction
// and a per-particle weight, without a second buffer.
vec3 hash3(float n) {
    return fract(sin(vec3(n, n + 1.7, n + 3.3)) * vec3(43758.5453, 22578.1459, 19642.3491));
}

void main() {
    vec3 rand = hash3(aSeed);

    // The dust (uMode 0) has no scatter state: it is always where it lives.
    // The cloud (uMode 1) mixes from a shell to the cover's pixels as the
    // picture assembles.
    vec3 scatter = normalize(rand * 2.0 - 1.0) * (0.75 + rand.x * 0.55) / uScale;
    vec3 pos = mix(mix(scatter, aTarget, uGather), aTarget, uMode) * uScale;

    // Per-particle drift — small on the cloud so the picture stays legible,
    // larger on the dust, which has no picture to protect.
    float drift = mix(0.05, 0.008 + 0.02 * uLevel, uMode) * uMotion;
    pos += vec3(
        sin(uTime * 0.55 + aSeed * 6.283),
        cos(uTime * 0.47 + aSeed * 4.712),
        sin(uTime * 0.31 + aSeed * 3.141)
    ) * drift;

    // Bass is a coherent breathing zoom of the whole cloud — deep enough to
    // read as the cover pulsing with the kick (the earlier 0.05 vanished).
    // Per-particle displacement read as a twitch and smeared the image;
    // scaling everything together is what stays legible.
    float zoom = 1.0 + uBass * 0.10 * uIntensity;
    pos.xy *= zoom;

    // On a detected beat a ring rolls out from the centre: particles near the
    // wavefront are pushed radially outward. Coherent, so the picture visibly
    // ripples rather than trembling.
    float r = length(pos.xy);
    float waveR = uWaveAge * 2.4;
    float band = exp(-pow((r - waveR) / 0.32, 2.0));
    pos.xy += (r > 0.001 ? pos.xy / r : vec2(0.0)) * band * uWaveAmp * 0.38;

    // Treble sparkle on the cloud's surface highlights.
    float glint = 0.0;
    if (uMode > 0.5 && rand.z > 0.88) {
        float phase = uTime * (2.0 + rand.x * 3.0) + aSeed * 37.0;
        glint = pow(max(0.0, sin(phase)), 6.0) * uHigh * uIntensity;
    }
    // The dust twinkles instead: it is the sky, not the picture.
    float twinkle = 0.0;
    if (uMode < 0.5) {
        twinkle = 0.5 + 0.5 * sin(uTime * (0.4 + rand.y) + aSeed * 21.0);
    }

    // The cloud's edges dissolve: an alpha falloff over an ellipse inscribed
    // in the cover is what turns "a photo floating in space" into a nebula —
    // a hard rectangular boundary is the single biggest tell that this is a
    // picture and not a volume of glowing dust.
    float edge = 1.0;
    if (uMode > 0.5) {
        vec2 norm = vec2(aTarget.x / uAspect, aTarget.y);
        edge = 1.0 - smoothstep(0.55, 1.02, length(norm));
    }

    // A tiny oscillating sway — deliberately NOT a cumulative turn. The old
    // unbounded drift (uTime * 0.016 rad/s) rotated the portrait away from
    // face-on at ~0.9°/s, so minutes of listening left it visibly sideways.
    // A sine never accumulates: the resting cloud is always frontal.
    float angle = sin(uTime * 0.05) * 0.026 * uMotion;
    float c = cos(angle);
    float s = sin(angle);
    pos = vec3(pos.x * c + pos.z * s, pos.y, -pos.x * s + pos.z * c);

    // The virtual camera: pointer *movement* nudges the view, and the nudge
    // always decays home (the JS side drives both), so face-on is the resting
    // state. The gains are the hard limits — ±5° yaw, ±3.5° pitch at full
    // parallax — a tilt, never a turn; the portrait keeps reading frontal.
    float yaw = uParallax.x * 0.087;
    float pitch = uParallax.y * 0.061;
    float cy = cos(yaw);
    float sy = sin(yaw);
    pos = vec3(pos.x * cy + pos.z * sy, pos.y, -pos.x * sy + pos.z * cy);
    float cp = cos(pitch);
    float sp = sin(pitch);
    pos = vec3(pos.x, pos.y * cp - pos.z * sp, pos.y * sp + pos.z * cp);

    float depth = pos.z + uCameraZ;
    depth = max(depth, 0.35);

    gl_Position = vec4(
        uFocal * pos.x / depth / uHalfViewport.x,
        uFocal * pos.y / depth / uHalfViewport.y,
        0.0,
        1.0
    );

    float persp = uFocal / depth / uHalfViewport.y;
    gl_PointSize = clamp(uPointSize * persp * (1.0 + glint * 0.9), 0.8, 40.0);
    // uWaveAmp doubles as the beat flash: the whole field, portrait and dust
    // alike, brightens for the frames right after a kick and fades back.
    vColor = clamp(pow(aColor, vec3(0.68)) * 1.12 + glint * 0.5 + uWaveAmp * 0.09, 0.0, 1.0);

    // The cloud wants near-opaque dots (over-blending: the topmost dot wins);
    // the dust wants faint ones (additive: neighbours sum into glow), and the
    // dust's glow leans on the beat so the sky pulses with the drummer too.
    float base = mix(0.26 + 0.18 * twinkle + uWaveAmp * 0.10, 0.94 + 0.06 * uLevel * uIntensity, uMode);
    // Distance fade for both: the back of a field must read as behind. The
    // cloud additionally dissolves at its elliptical edge (see above).
    float fade = mix(clamp(persp * 0.9, 0.15, 1.0), clamp(persp, 0.75, 1.1), uMode);
    vAlpha = base * fade * edge;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;

varying vec3 vColor;
varying float vAlpha;

void main() {
    float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
    if (d > 1.0) discard;
    float falloff = 1.0 - d * d;
    gl_FragColor = vec4(vColor, vAlpha * falloff);
}
`;

const hexToRgb = function (gradient) {
    const match = /#([0-9a-f]{6})/i.exec(String(gradient || ''));
    if (!match) return [0.86, 0.36, 0.45];
    const value = parseInt(match[1], 16);
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
};

// --- cover loading: cache, timeout, retry --------------------------------
//
// The covers live on an r2.dev bucket whose reachability is *intermittent*
// (measured: 200 in 2.3 s one minute, dead the next — classic from-here
// Cloudflare flakiness). The first loader fired exactly one `Image` request;
// any transient failure stranded the nebula on the tint fallback for the
// whole session, which read as "the nebula is a coloured ball, not the
// cover". So now:
//   1. a successfully sampled cover is downscaled into a dataURL and kept
//      in localStorage, keyed by URL — after one good load the portrait
//      survives even a fully dead network;
//   2. a network load retries with backoff and every attempt is fenced by
//      a timeout, because an `Image` that neither fires load nor error
//      would otherwise hang the fallback forever.

const COVER_CACHE_PREFIX = 'music.nebula-cover.';
const COVER_CACHE_MAX_SIDE = 128;

const coverCacheGet = function (url) {
    try {
        return localStorage.getItem(COVER_CACHE_PREFIX + url);
    } catch (error) {
        return null;
    }
};

const coverCachePut = function (url, image) {
    let dataUrl = '';
    try {
        const side = Math.min(COVER_CACHE_MAX_SIDE, Math.max(image.naturalWidth, image.naturalHeight) || COVER_CACHE_MAX_SIDE);
        const canvas = document.createElement('canvas');
        canvas.width = side;
        canvas.height = side;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(image, 0, 0, side, side);
        dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    } catch (error) {
        return; // tainted or undecodable — nothing worth keeping
    }
    try {
        localStorage.setItem(COVER_CACHE_PREFIX + url, dataUrl);
    } catch (error) {
        // Quota: drop one older entry and try once more, else give up —
        // the cache is an accelerator, never a requirement.
        try {
            const keys = [];
            for (let i = 0; i < localStorage.length; i += 1) {
                const key = localStorage.key(i);
                if (key && key.startsWith(COVER_CACHE_PREFIX)) keys.push(key);
            }
            if (keys.length) localStorage.removeItem(keys[0]);
            localStorage.setItem(COVER_CACHE_PREFIX + url, dataUrl);
        } catch (ignored) {
            /* skip */
        }
    }
};

/** One `Image` load, fenced by a timeout. Resolves the image or null. */
const loadImageFenced = function (url, timeoutMs) {
    return new Promise((resolve) => {
        const image = new Image();
        // Before `src`, or the request goes out without CORS and the canvas
        // comes back tainted.
        image.crossOrigin = 'anonymous';
        let settled = false;
        const done = (result) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            resolve(result);
        };
        const timer = window.setTimeout(() => {
            image.src = ''; // abort an in-flight request
            done(null);
        }, timeoutMs);
        image.onload = () => done(image);
        image.onerror = () => done(null);
        image.src = url;
    });
};

const sleep = (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); });

/**
 * The nebula's cover, by whatever route works. Cache first (instant, works
 * offline), then up to three network attempts at 0 / 1.5 s / 4 s, each
 * fenced at 12 s. Resolves an `HTMLImageElement` or null — null means the
 * caller renders the tint fallback.
 */
const loadCoverResilient = async function (url) {
    const cached = coverCacheGet(url);
    if (cached) {
        const cachedImage = await loadImageFenced(cached, 4000);
        if (cachedImage) return cachedImage;
    }
    // The cover is ALSO requested by the card thumbnails as a plain `<img>` —
    // no CORS — and that response (no `Access-Control-Allow-Origin`, because
    // r2.dev only answers an `Origin`) lands in the HTTP cache. A CORS-mode
    // request for the same URL then hits that entry and fails the check
    // instantly — measured: `net::ERR_FAILED` in 1 ms, which read as "the
    // nebula lost its cover" plus a CORS error in the console. A stable query
    // param gives the nebula its own cache entry, written by a CORS-mode
    // request and therefore always safe for it to reuse.
    const corsUrl = url + (url.includes('?') ? '&' : '?') + 'nebula=1';
    const backoffs = [0, 1500, 4000];
    for (let attempt = 0; attempt < backoffs.length; attempt += 1) {
        if (backoffs[attempt]) await sleep(backoffs[attempt]);
        const image = await loadImageFenced(corsUrl, 12_000);
        if (image) {
            coverCachePut(url, image);
            return image;
        }
    }
    return null;
};

/** Ambient dust: a wide, deep disc of faint points tinted by the song. */
const dustField = function (tint) {
    const targets = new Float32Array(DUST_COUNT * 3);
    const colors = new Float32Array(DUST_COUNT * 3);
    const seeds = new Float32Array(DUST_COUNT);
    for (let index = 0; index < DUST_COUNT; index += 1) {
        // Uniform over a disc four times the cloud's size.
        const radius = Math.sqrt(Math.random()) * 3.6;
        const angle = Math.random() * Math.PI * 2;
        targets[index * 3] = Math.cos(angle) * radius;
        targets[index * 3 + 1] = Math.sin(angle) * radius;
        // Deep but never past the lens clamp.
        targets[index * 3 + 2] = -1.2 + Math.random() * 2.2;
        // Mostly the song's tint, a few whites: a sky, not a gradient fill.
        const white = Math.random() < 0.18;
        const shade = 0.6 + Math.random() * 0.4;
        colors[index * 3] = white ? shade : tint[0] * shade;
        colors[index * 3 + 1] = white ? shade : tint[1] * shade;
        colors[index * 3 + 2] = white ? shade : tint[2] * shade;
        seeds[index] = Math.random() * 100;
    }
    return { targets, colors, seeds, count: DUST_COUNT };
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

    // The cloud is laid out in cover proportions at unit height; uScale puts
    // it in the viewport.
    const halfHeight = 1;
    const halfWidth = halfHeight * aspect;

    // Downsample stride when the grid would exceed the budget: skip rows and
    // columns evenly instead of refusing the picture.
    const stride = rows * cols > MAX_PARTICLES
        ? Math.ceil(Math.sqrt((rows * cols) / MAX_PARTICLES))
        : 1;

    const estimate = Math.ceil((rows / stride) * (cols / stride)) + 1;
    const targets = new Float32Array(estimate * 3);
    const colors = new Float32Array(estimate * 3);
    const seeds = new Float32Array(estimate);

    let written = 0;
    for (let row = 0; row < rows; row += stride) {
        for (let col = 0; col < cols; col += stride) {
            const at = (row * cols + col) * 4;
            if (pixels[at + 3] / 255 < 0.08) continue;
            const r = pixels[at] / 255;
            const g = pixels[at + 1] / 255;
            const b = pixels[at + 2] / 255;
            const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

            targets[written * 3] = ((col / (cols - 1)) - 0.5) * 2 * halfWidth;
            targets[written * 3 + 1] = (0.5 - (row / (rows - 1))) * 2 * halfHeight;
            // Brighter pixels forward: the photo's highlights lift off it.
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

/** A disc of the song's own colour, for when the cover is missing or fails. */
const circleTargets = function (color) {
    const count = 30_000;
    const targets = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
        const radius = Math.sqrt(Math.random()) * 1.05;
        const angle = Math.random() * Math.PI * 2;
        targets[index * 3] = Math.cos(angle) * radius;
        targets[index * 3 + 1] = Math.sin(angle) * radius;
        targets[index * 3 + 2] = Math.sin(radius * Math.PI) * 0.18;
        const shade = 0.75 + Math.random() * 0.25;
        colors[index * 3] = color[0] * shade;
        colors[index * 3 + 1] = color[1] * shade;
        colors[index * 3 + 2] = color[2] * shade;
        seeds[index] = Math.random() * 100;
    }
    return { targets, colors, seeds, count };
};

const buildProgram = function (gl) {
    const compile = function (type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
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
const NebulaCanvas = function ({
    coverUrl = '',
    gradient = '',
    isPlaying = false,
    intensity = 'standard',
    analyser = null,
    onActivate,
}) {
    const canvasRef = useRef(null);
    const wrapRef = useRef(null);
    // Everything the loop reads lives here rather than in the effect's
    // dependencies: play state and intensity change often, and re-running the
    // effect would tear down and re-upload the whole field.
    const liveRef = useRef({ isPlaying, intensity, analyser, gradient });
    liveRef.current.isPlaying = isPlaying;
    liveRef.current.intensity = intensity;
    liveRef.current.analyser = analyser;
    liveRef.current.gradient = gradient;

    // Keyed on the cover: a new song is a new set of pixels. The dust stays
    // uploaded across songs — only its tint changes, and that is a uniform.
    useEffect(() => {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) {
            if (typeof console !== 'undefined') console.error('[nebula] no canvas/wrap');
            return undefined;
        }

        const gl = canvas.getContext('webgl', {
            alpha: true,
            antialias: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: false,
        });
        if (!gl) {
            if (typeof console !== 'undefined') console.error('[nebula] no webgl context');
            return undefined;
        }

        let program;
        try {
            program = buildProgram(gl);
        } catch (error) {
            if (typeof console !== 'undefined') console.error('[nebula]', error);
            return undefined;
        }

        gl.useProgram(program);

        const attribute = (name) => gl.getAttribLocation(program, name);
        const uniform = (name) => gl.getUniformLocation(program, name);
        const locations = {
            target: attribute('aTarget'),
            color: attribute('aColor'),
            seed: attribute('aSeed'),
            time: uniform('uTime'),
            gather: uniform('uGather'),
            bass: uniform('uBass'),
            high: uniform('uHigh'),
            level: uniform('uLevel'),
            intensity: uniform('uIntensity'),
            focal: uniform('uFocal'),
            cameraZ: uniform('uCameraZ'),
            halfViewport: uniform('uHalfViewport'),
            pointSize: uniform('uPointSize'),
            motion: uniform('uMotion'),
            waveAge: uniform('uWaveAge'),
            waveAmp: uniform('uWaveAmp'),
            scale: uniform('uScale'),
            parallax: uniform('uParallax'),
            mode: uniform('uMode'),
            aspect: uniform('uAspect'),
        };

        // Two dataset *slots*: the dust uploads once, the cloud once per song.
        // One shared triple would have the second upload overwrite the first —
        // the dust draw would silently draw cover pixels.
        const makeBuffers = function () {
            return {
                target: gl.createBuffer(),
                color: gl.createBuffer(),
                seed: gl.createBuffer(),
            };
        };
        const dustBuffers = makeBuffers();
        const cloudBuffers = makeBuffers();

        const upload = function (data, into) {
            gl.bindBuffer(gl.ARRAY_BUFFER, into.target);
            gl.bufferData(gl.ARRAY_BUFFER, data.targets, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, into.color);
            gl.bufferData(gl.ARRAY_BUFFER, data.colors, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, into.seed);
            gl.bufferData(gl.ARRAY_BUFFER, data.seeds, gl.STATIC_DRAW);
        };

        let cloudCount = 0;
        let cloudAspect = 1;
        let startedAt = performance.now();
        let dead = false;
        let reader = null;
        let tint = hexToRgb(liveRef.current.gradient);        const detector = createBeatDetector();

        const motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.15 : 1;

        // The dust goes up once, here. Re-tinting it on a song change is a
        // re-upload of its colour buffer — cheap — but only worth doing when
        // the colour actually changed.
        const dust = dustField(tint);
        upload(dust, dustBuffers);

        const renderFallbackCloud = function () {
            upload(circleTargets(tint), cloudBuffers);
            cloudCount = 30_000;
            startedAt = performance.now();
        };
        const renderCoverCloud = function (image) {
            const data = coverTargets(image);
            cloudAspect = image.naturalWidth / image.naturalHeight || 1;
            if (data) {
                upload(data, cloudBuffers);
                cloudCount = data.count;
            } else {
                renderFallbackCloud();
            }
            startedAt = performance.now();
        };
        const loadCloud = function () {
            cloudCount = 0;
            if (!coverUrl) {
                renderFallbackCloud();
                return;
            }
            // Async and guarded by `dead`: a slow cover load resolving after
            // a song change (the effect re-ran) must not touch the buffers.
            (async () => {
                const image = await loadCoverResilient(coverUrl);
                if (dead) return;
                if (image) renderCoverCloud(image);
                else renderFallbackCloud();
            })();
        };
        loadCloud();

        // --- sizing -------------------------------------------------------

        // Everything here is in *device* pixels: `gl.viewport` and
        // `gl_Position` are measured in them. Mixing CSS pixels in is the bug
        // that once drew the cloud at 1/dpr of its intended size.
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

        // --- the pointer ----------------------------------------------------
        //
        // The virtual camera's input: pointer *movement*, not position. Each
        // move event nudges the target toward the motion's direction and the
        // target always decays home, so a flick of the mouse is a small,
        // immediate tilt that springs back to frontal the moment the pointer
        // rests. Position-following (the old model) held a turn while the
        // pointer sat at a screen edge and lagged behind the gesture.
        const target = { x: 0, y: 0 };
        const eased = { x: 0, y: 0 };
        // A flick across the full viewport width ≈ the ±1 clamp (±5° yaw).
        const IMPULSE = 3;
        let lastX = null;
        let lastY = null;
        const onPointerMove = function (event) {
            if (lastX !== null) {
                target.x += ((event.clientX - lastX) / window.innerWidth) * IMPULSE;
                target.y += ((event.clientY - lastY) / window.innerHeight) * IMPULSE;
                target.x = Math.max(-1, Math.min(1, target.x));
                target.y = Math.max(-1, Math.min(1, target.y));
            }
            lastX = event.clientX;
            lastY = event.clientY;
        };
        window.addEventListener('pointermove', onPointerMove, { passive: true });

        // --- the loop -------------------------------------------------------

        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.clearColor(0, 0, 0, 0);

        let bass = 0;
        let level = 0;
        let high = 0;
        let frame = 0;

        const bindAndDraw = function (bufs, count, mode, pointSize) {
            gl.uniform1f(locations.mode, mode);
            gl.uniform1f(locations.scale, mode > 0.5 ? CLOUD_SCALE : 1);
            gl.uniform1f(locations.aspect, mode > 0.5 ? cloudAspect : 1);
            gl.uniform1f(locations.pointSize, pointSize * Math.min(window.devicePixelRatio || 1, 2));
            gl.bindBuffer(gl.ARRAY_BUFFER, bufs.target);
            gl.enableVertexAttribArray(locations.target);
            gl.vertexAttribPointer(locations.target, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, bufs.color);
            gl.enableVertexAttribArray(locations.color);
            gl.vertexAttribPointer(locations.color, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, bufs.seed);
            gl.enableVertexAttribArray(locations.seed);
            gl.vertexAttribPointer(locations.seed, 1, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.POINTS, 0, count);
        };

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
            // fallback is not "nothing" — it is a slow breath, which is what
            // a paused player should look like anyway.
            const playing = live.isPlaying && Boolean(live.analyser);
            const wantBass = playing ? sample.low : 0.06;
            const wantLevel = playing ? sample.level : 0.1;
            const wantHigh = playing ? sample.high : 0;
            bass += (wantBass - bass) * (wantBass > bass ? ATTACK : RELEASE);
            level += (wantLevel - level) * (wantLevel > level ? ATTACK : RELEASE);
            high += (wantHigh - high) * (wantHigh > high ? ATTACK : RELEASE);

            const beat = detector.update(now, bass, playing);
            const waveAge = beat.age;

            // Camera input: the target springs home continuously — at 60fps
            // a 0.94 decay is back within ~10° of centre about half a second
            // after the pointer stops — and the eased value chases it with
            // almost no lag, which is what makes the response read as
            // immediate. Both stay in [-1, 1] (the shader's hard limits).
            target.x *= 0.94;
            target.y *= 0.94;
            eased.x += (target.x - eased.x) * 0.3;
            eased.y += (target.y - eased.y) * 0.3;

            const t = Math.min(1, (now - startedAt) / GATHER_MS);
            const gather = 1 - (1 - t) * (1 - t) * (1 - t);

            const intensityValue = INTENSITY[live.intensity] || INTENSITY.standard;

            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.useProgram(program);
            gl.uniform1f(locations.time, (now - startedAt) / 1000);
            gl.uniform1f(locations.gather, gather);
            gl.uniform1f(locations.bass, bass);
            gl.uniform1f(locations.high, high);
            gl.uniform1f(locations.level, level);
            gl.uniform1f(locations.intensity, intensityValue);
            gl.uniform1f(locations.focal, FOCAL * Math.min(canvas.width, canvas.height) * 0.5);
            gl.uniform1f(locations.cameraZ, CAMERA_Z);
            gl.uniform2f(locations.halfViewport, canvas.width * 0.5, canvas.height * 0.5);
            gl.uniform1f(locations.motion, motion);
            gl.uniform1f(locations.waveAge, waveAge);
            gl.uniform1f(locations.waveAmp, beat.amp);
            gl.uniform2f(locations.parallax, eased.x, eased.y);

            // Back to front: additive dust first, the portrait over it.
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
            bindAndDraw(dustBuffers, DUST_COUNT, 0, 3.4);

            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            if (cloudCount) bindAndDraw(cloudBuffers, cloudCount, 1, 5);
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
            window.removeEventListener('pointermove', onPointerMove);
            if (observer) observer.disconnect();
            else window.removeEventListener('resize', resize);
            gl.deleteBuffer(dustBuffers.target);
            gl.deleteBuffer(dustBuffers.color);
            gl.deleteBuffer(dustBuffers.seed);
            gl.deleteBuffer(cloudBuffers.target);
            gl.deleteBuffer(cloudBuffers.color);
            gl.deleteBuffer(cloudBuffers.seed);
            gl.deleteProgram(program);
            // Deliberately *not* `WEBGL_lose_context.loseContext()` here: the
            // effect re-runs on the **same canvas**, and a context that has
            // been lost never comes back — every later song would render
            // nothing, silently. One context per canvas is the minimum.
        };
    }, [coverUrl]);

    return (
        <div
            ref={wrapRef}
            className={onActivate ? styles.stage : `${styles.stage} ${styles['stage-static']}`}
            role={onActivate ? 'button' : undefined}
            tabIndex={onActivate ? 0 : -1}
            onClick={onActivate}
            onKeyDown={onActivate
                ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onActivate();
                    }
                }
                : undefined}
            aria-label={onActivate ? '星云，点击播放或暂停' : '星云'}
        >
            <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
        </div>
    );
};

export default NebulaCanvas;
