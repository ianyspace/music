import React, { useEffect, useRef } from 'react';

import { createBandReader, readBands } from '../../core/audioAnalyser';
import { createBeatDetector } from '../../core/beat';
import { loadCoverResilient } from '../../core/coverImage';
import { DENSITY_GRID, MOTION_SCALE, PRESET_INDEX } from './visualPresets';

import styles from './VisualCanvas.module.scss';

/**
 * The immersive page's background: **one particle field, many presets.**
 *
 * Every preset is a different placement function over the *same* buffer of
 * cover-sampled particles, picked by a `uPreset` uniform in the vertex
 * shader. That is the whole trick behind having eight visual modes at the
 * cost of one WebGL program: switching mode is a uniform write, not a reload,
 * so the console's mode buttons are instant and there is no white frame
 * between them.
 *
 * ## Why one program and not eight components
 *
 * The presets share everything that is expensive and disagree only about
 * where a particle goes: the same cover sampling, the same camera, the same
 * beat/spectrum plumbing, the same ripple and camera-shake passes. Eight
 * components would duplicate all of that eight times and could not cross
 * fade, because each would own its own canvas.
 *
 * ## What every preset is fed
 *
 * - `aUv` — where the particle came from on the cover (0–1 both axes);
 * - `aColor` — that pixel's colour;
 * - `aSeed` — a stable per-particle random, for scatter and variation.
 *
 * ## The layers that ride on top of every preset
 *
 * - **ripples** — a bass hit spawns a ring that rolls outward, pushing and
 *   brightening the particles it crosses;
 * - **the beat camera** — a kick dollies the lens in and shakes it a hair;
 * - **the star river** — an ambient dust field behind the picture, tinted by
 *   the cover's own palette.
 */

const MAX_PARTICLES = 300_000;

// Ambient dust behind the picture: atmosphere at the edges of the frame,
// never a rival to the picture itself.
const DUST_COUNT = 4_000;

const CAMERA_Z = 3.4;
const FOCAL = 2.6;

// Seconds the particles take to fly into a newly loaded cover.
const GATHER_MS = 1100;

const ATTACK = 0.35;
const RELEASE = 0.06;

const INTENSITY = { calm: 0.5, standard: 0.85, strong: 1.2 };

// Spectrum bands handed to the terrain preset. A power of two keeps the
// texture fetch cheap and the grid readable.
const BANDS = 32;

const TAU = Math.PI * 2;

const VERTEX_SHADER = `
precision highp float;

attribute vec2 aUv;
attribute vec3 aColor;
attribute float aSeed;

uniform float uTime;
uniform float uGather;
uniform float uAspect;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uLevel;
uniform float uIntensity;
uniform float uMotion;
uniform float uPreset;
uniform float uFlow;
uniform float uSpin;
uniform float uBeat;
uniform float uBeatAge;
uniform float uRipplesOn;
uniform float uCinemaOn;
uniform vec3 uRipple0;
uniform vec3 uRipple1;
uniform vec3 uRipple2;
uniform vec2 uParallax;
uniform float uFocal;
uniform float uCameraZ;
uniform vec2 uHalfViewport;
uniform float uPointSize;
uniform float uMode;
uniform vec3 uTint;
uniform vec3 uAccent;
uniform sampler2D uSpectrum;

varying vec3 vColor;
varying float vAlpha;

const float PI = 3.14159265;
const float TAU = 6.28318531;

float hash11(float n) {
    return fract(sin(n * 78.233) * 43758.5453123);
}

vec3 hash31(float n) {
    return fract(sin(vec3(n, n + 1.7, n + 3.3)) * vec3(43758.5453, 22578.1459, 19642.3491));
}

// One ripple: a ring whose push and glow fall off gaussianly on both sides,
// so it reads as a wave travelling outward and not as a static band.
float rippleAt(float r, vec3 ripple) {
    float radius = ripple.x * 2.3;
    return exp(-pow((r - radius) / 0.34, 2.0)) * ripple.y;
}

void main() {
    float lum = dot(aColor, vec3(0.2126, 0.7152, 0.0722));
    vec3 rand = hash31(aSeed);

    vec3 pos = vec3(0.0);
    vec3 col = aColor;
    float alpha = 1.0;
    float glint = 0.0;
    float sizeBoost = 1.0;

    // The star river (uMode 0) carries no cover pixels: its placement comes
    // from its own uv (angle, radius) and its colour from the cover palette,
    // so a new song re-tints it with nothing but a uniform write.
    if (uMode < 0.5) {
        float ang = aUv.x * TAU;
        float rad = aUv.y * 3.6;
        float z = -1.2 + hash11(aSeed + 5.1) * 2.2;
        pos = vec3(cos(ang) * rad, sin(ang) * rad, z);
        pos.xy *= 1.0 + uBeat * 0.02 * uIntensity;
        float twinkle = 0.5 + 0.5 * sin(uTime * (0.4 + rand.y) + aSeed * 21.0);
        float white = step(0.82, hash11(aSeed + 9.4));
        col = mix(uTint * (0.6 + rand.x * 0.4), vec3(1.0), white);
        alpha = 0.26 + 0.18 * twinkle + uBeat * 0.10;
        sizeBoost = 0.8;
    }

    // --- preset 0: NEBULA — the cover, taken apart -------------------------
    else if (uPreset < 0.5) {
        vec2 nrm = vec2((aUv.x - 0.5) * 2.0, (aUv.y - 0.5) * 2.0);
        pos = vec3(nrm.x * uAspect, -nrm.y, (lum - 0.5) * 0.4) * 1.35;
        pos.xy *= 1.0 + uBass * 0.10 * uIntensity;
        pos += vec3(
            sin(uTime * 0.55 + aSeed * 6.283),
            cos(uTime * 0.47 + aSeed * 4.712),
            sin(uTime * 0.31 + aSeed * 3.141)
        ) * 0.02 * uMotion;
        // The rectangle is the tell that this is a picture: an elliptical
        // falloff is what turns it into a cloud.
        alpha *= 1.0 - smoothstep(0.55, 1.02, length(vec2(nrm.x / uAspect, nrm.y)));
    }

    // --- preset 1: TUNNEL — the cover rolled into a tube -------------------
    else if (uPreset < 1.5) {
        float seg = fract(aUv.y + uFlow);
        float zPos = (seg - 0.5) * 9.0;
        float ang = aUv.x * TAU + uSpin + sin(zPos * 1.2 + uTime * 0.8) * 0.05 * uLevel;
        float rr = 2.05 - uBass * 0.30 * uIntensity
            + sin(ang * 5.0 + zPos * 1.4 + uTime * 2.0) * 0.10 * (uMid + uHigh) * uIntensity;
        pos = vec3(cos(ang) * rr, sin(ang) * rr, zPos);
        // Fade in at the far mouth and out again just before the lens, so
        // particles neither pop into existence nor smear across the screen.
        alpha *= 0.18 + 0.9 * smoothstep(-4.5, -1.6, zPos) * (1.0 - smoothstep(2.4, 4.5, zPos));
    }

    // --- preset 2: ORBIT — the cover gathered into a planet ----------------
    else if (uPreset < 2.5) {
        float theta = aUv.x * TAU + uTime * 0.10 * uMotion;
        float phi = aUv.y * PI;
        float atmo = step(0.74, hash11(aSeed + 3.7));
        float rr = (1.12 + (lum - 0.5) * 0.14 + uBass * 0.09 * uIntensity)
            * (1.0 + atmo * (0.30 + hash11(aSeed + 1.3) * 0.55 + uLevel * 0.18));
        pos = vec3(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta)) * rr;
        float facing = dot(normalize(pos), vec3(0.0, 0.0, 1.0));
        alpha *= (0.30 + 0.70 * smoothstep(-0.35, 0.55, facing)) * mix(1.0, 0.25, atmo);
        col = mix(col, uAccent, atmo * 0.6);
        sizeBoost = mix(1.0, 1.5, atmo);
    }

    // --- preset 3: GALAXY — aurora ribbons across the frame -----------------
    else if (uPreset < 3.5) {
        float lane = floor(hash11(aSeed + 7.3) * 3.0);
        float x = fract(aUv.x + uTime * (0.03 + uLevel * 0.06)) * 4.4 - 2.2;
        float y = (lane - 1.0) * 0.52
            + sin(aUv.x * TAU + uTime * 0.45 + lane) * 0.14
            + (aUv.y - 0.5) * 0.35;
        float z = (hash11(aSeed + 2.9) - 0.5) * 2.4;
        pos = vec3(x, y + sin(uTime * 0.6 + x * 0.8) * 0.09 * (1.0 + uBass * 2.0), z);
        col = mix(uTint, uAccent, clamp((x + 2.2) / 4.4, 0.0, 1.0));
        alpha *= 0.35 + 0.65 * clamp(1.0 - abs(y) * 0.9, 0.0, 1.0);
        sizeBoost = 1.1;
    }

    // --- preset 4: HALO — an eclipse ring and its corona -------------------
    else if (uPreset < 4.5) {
        float ang = aUv.x * TAU + uTime * 0.07 * uMotion;
        float isCorona = step(0.46, hash11(aSeed + 4.5));
        float rad = 1.22 + sin(ang * 3.0 + uTime * 0.35) * 0.05 * (1.0 + uBass);
        float rr = rad + isCorona * (0.12 + hash11(aSeed + 8.1) * 1.15) * (1.0 + uBass * 0.18 * uIntensity);
        float zz = (hash11(aSeed + 6.6) - 0.5) * (0.35 + isCorona * 1.2);
        pos = vec3(cos(ang) * rr, sin(ang) * rr * 0.9, zz);
        // Backlight: the ring is brightest where the sightline grazes it.
        float graz = abs(sin(ang));
        col = mix(col, uAccent, 0.35 + isCorona * 0.5);
        alpha *= mix(0.95, 0.30, isCorona) * (0.55 + 0.45 * graz);
        sizeBoost = mix(1.0, 0.8, isCorona);
    }

    // --- preset 5: RAIN — neon drizzle falling through frame ---------------
    else if (uPreset < 5.5) {
        float lanes = 200.0;
        float laneIdx = floor(aUv.x * lanes);
        float speed = 0.55 + hash11(laneIdx + 3.3) * 1.5;
        float x = (laneIdx / lanes - 0.5) * 4.6 + (hash11(laneIdx) - 0.5) * 0.02;
        float y = fract(aUv.y - uTime * speed * 0.09 * (1.0 + uLevel * 0.7));
        float z = -1.0 + hash11(laneIdx + 7.7) * 2.0;
        pos = vec3(x, (0.5 - y) * 3.4, z);
        // Hundreds of particles per lane, sorted by y: that density is what
        // reads as a thread of rain rather than as a row of dots.
        col = mix(uTint, uAccent, hash11(laneIdx + 1.9));
        alpha *= 0.30 + 0.70 * smoothstep(0.0, 0.35, y) * (1.0 - smoothstep(0.75, 1.0, y));
        sizeBoost = 0.75;
    }

    // --- preset 6: TERRAIN — the spectrum as a landscape -------------------
    else if (uPreset < 6.5) {
        float fi = floor(aUv.x * 32.0);
        float spec = texture2D(uSpectrum, vec2((fi + 0.5) / 32.0, 0.5)).r;
        float h = spec * (0.85 + uBass * 0.35);
        pos = vec3((aUv.x - 0.5) * 4.2, -1.25 + h + (lum - 0.5) * 0.05, (aUv.y - 0.5) * 4.2);
        col = mix(uTint, uAccent, clamp(h * 1.5, 0.0, 1.0));
        alpha *= 0.45 + 0.55 * clamp(h * 1.3, 0.0, 1.0);
        sizeBoost = 0.9;
    }

    // --- preset 7: VOID — near-empty, for the artwork behind ---------------
    else {
        pos = vec3((aUv.x - 0.5) * 3.0, (aUv.y - 0.5) * 3.0, -2.0);
        alpha *= 0.05;
        sizeBoost = 0.6;
    }

    // --- assembly: gather, ripples, beat, camera, projection ---------------

    // A new cover does not blink into place: the field flies in from a shell.
    if (uMode > 0.5) {
        vec3 scatter = normalize(rand * 2.0 - 1.0) * (0.75 + rand.x * 0.55);
        pos = mix(scatter, pos, uGather);

        // Treble sparkle on the picture's highlights.
        if (rand.z > 0.88) {
            float phase = uTime * (2.0 + rand.x * 3.0) + aSeed * 37.0;
            glint = pow(max(0.0, sin(phase)), 6.0) * uHigh * uIntensity;
        }
    }

    // Ripples and the beat's shockwave both push radially in screen space,
    // which is coherent across every preset: the field visibly ripples
    // instead of trembling per-particle.
    float rl = length(pos.xy);
    vec2 dir = rl > 0.001 ? pos.xy / rl : vec2(0.0);
    if (uRipplesOn > 0.5 && uMode > 0.5) {
        float rip = rippleAt(rl, uRipple0) + rippleAt(rl, uRipple1) + rippleAt(rl, uRipple2);
        pos.xy += dir * rip * 0.22;
        col += rip * 0.10;
    }
    float waveR = uBeatAge * 2.4;
    float band = exp(-pow((rl - waveR) / 0.32, 2.0));
    pos.xy += dir * band * uBeat * 0.38;

    // The beat camera: a kick dollies in and shakes, both scaled by the
    // intensity the visitor chose. The shake is deterministic per frame so
    // there is no jitter when nothing is playing.
    float dolly = uCinemaOn > 0.5 ? uBeat * 0.32 * uIntensity : 0.0;
    if (uCinemaOn > 0.5) {
        pos.xy += vec2(sin(uTime * 61.0), cos(uTime * 53.0)) * uBeat * 0.015 * uIntensity;
    }

    // A sine sway, never a cumulative turn: the resting field is frontal.
    float sway = sin(uTime * 0.05) * 0.026 * uMotion;
    float cs = cos(sway);
    float ss = sin(sway);
    pos = vec3(pos.x * cs + pos.z * ss, pos.y, -pos.x * ss + pos.z * cs);

    // The pointer's virtual camera: a tilt with hard limits (±5° yaw,
    // ±3.5° pitch) that always decays back to face-on.
    float yaw = uParallax.x * 0.087;
    float pitch = uParallax.y * 0.061;
    float cy = cos(yaw);
    float sy = sin(yaw);
    pos = vec3(pos.x * cy + pos.z * sy, pos.y, -pos.x * sy + pos.z * cy);
    float cp = cos(pitch);
    float sp = sin(pitch);
    pos = vec3(pos.x, pos.y * cp - pos.z * sp, pos.y * sp + pos.z * cp);

    float depth = max(pos.z + uCameraZ - dolly, 0.35);

    gl_Position = vec4(
        uFocal * pos.x / depth / uHalfViewport.x,
        uFocal * pos.y / depth / uHalfViewport.y,
        0.0,
        1.0
    );

    float persp = uFocal / depth / uHalfViewport.y;
    gl_PointSize = clamp(uPointSize * persp * sizeBoost * (1.0 + glint * 0.9), 0.8, 48.0);
    vColor = clamp(col + glint * 0.5 + uBeat * 0.09, 0.0, 1.0);

    // Distance is depth: the back of the field must read as behind. The
    // cloud is near-opaque, the dust is light and additive (see the blend
    // modes in the draw loop).
    float fade = mix(clamp(persp * 0.9, 0.15, 1.0), clamp(persp, 0.7, 1.15), uMode);
    vAlpha = alpha * fade;
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

/** Ambient dust: its uv is (angle, radius), its colour comes from a uniform. */
const dustField = function () {
    const uvs = new Float32Array(DUST_COUNT * 2);
    const colors = new Float32Array(DUST_COUNT * 3);
    const seeds = new Float32Array(DUST_COUNT);
    for (let index = 0; index < DUST_COUNT; index += 1) {
        uvs[index * 2] = Math.random();
        // sqrt keeps the disc's area uniform: a linear radius would crowd
        // the centre and leave the rim bare.
        uvs[index * 2 + 1] = Math.sqrt(Math.random());
        seeds[index] = Math.random() * 100;
    }
    return { uvs, colors, seeds, count: DUST_COUNT };
};

/** Cover pixels, one particle per sampled cell. */
const coverField = function (image, gridHeight) {
    const aspect = image.naturalWidth / image.naturalHeight || 1;
    const rows = gridHeight;
    const cols = Math.max(8, Math.round(gridHeight * aspect));

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
        return null; // tainted canvas — the image arrived without CORS
    }

    const stride = rows * cols > MAX_PARTICLES
        ? Math.ceil(Math.sqrt((rows * cols) / MAX_PARTICLES))
        : 1;
    const estimate = Math.ceil((rows / stride) * (cols / stride)) + 1;
    const uvs = new Float32Array(estimate * 2);
    const colors = new Float32Array(estimate * 3);
    const seeds = new Float32Array(estimate);

    let written = 0;
    for (let row = 0; row < rows; row += stride) {
        for (let col = 0; col < cols; col += stride) {
            const at = (row * cols + col) * 4;
            if (pixels[at + 3] / 255 < 0.08) continue;
            uvs[written * 2] = cols > 1 ? col / (cols - 1) : 0.5;
            uvs[written * 2 + 1] = rows > 1 ? row / (rows - 1) : 0.5;
            colors[written * 3] = pixels[at] / 255;
            colors[written * 3 + 1] = pixels[at + 1] / 255;
            colors[written * 3 + 2] = pixels[at + 2] / 255;
            seeds[written] = Math.random() * 100;
            written += 1;
        }
    }

    if (written === 0) return null;
    return {
        uvs: uvs.subarray(0, written * 2),
        colors: colors.subarray(0, written * 3),
        seeds: seeds.subarray(0, written),
        count: written,
        aspect,
    };
};

/** A disc of the song's colour, for when there is no cover to sample. */
const fallbackField = function (color) {
    const count = 30_000;
    const uvs = new Float32Array(count * 2);
    const colors = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
        const radius = Math.sqrt(Math.random()) * 0.5;
        const angle = Math.random() * TAU;
        uvs[index * 2] = 0.5 + Math.cos(angle) * radius;
        uvs[index * 2 + 1] = 0.5 + Math.sin(angle) * radius;
        const shade = 0.75 + Math.random() * 0.25;
        colors[index * 3] = color[0] * shade;
        colors[index * 3 + 1] = color[1] * shade;
        colors[index * 3 + 2] = color[2] * shade;
        seeds[index] = Math.random() * 100;
    }
    return { uvs, colors, seeds, count, aspect: 1 };
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
            throw new Error(`${stage} shader: ${log || 'compiled clean but reported failure'}`);
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
 * @param {string} coverUrl     artwork to take apart; empty means "no cover".
 * @param {string} gradient     CSS gradient of the song, for the fallback.
 * @param {boolean} isPlaying   drives the beat; paused just breathes.
 * @param {string} intensity    `calm` / `standard` / `strong`.
 * @param {string} preset       one of `visualPresets.PRESET_IDS`.
 * @param {string} density      `low` / `medium` / `high` — sampled rows.
 * @param {string} motion       `calm` / `standard` / `strong`.
 * @param {object} fx           the console's layer switches.
 * @param {number[]|null} palette the cover's primary colour, or null.
 * @param {AnalyserNode|null} analyser the shared spectrum source.
 * @param {Function} [onActivate] what clicking the field does.
 */
const VisualCanvas = function ({
    coverUrl = '',
    gradient = '',
    isPlaying = false,
    intensity = 'standard',
    preset = 'nebula',
    density = 'medium',
    motion = 'standard',
    fx = null,
    palette = null,
    analyser = null,
    onActivate,
}) {
    const canvasRef = useRef(null);
    const wrapRef = useRef(null);
    const liveRef = useRef({
        isPlaying, intensity, analyser, gradient, preset, motion, fx, palette, density,
    });
    liveRef.current.isPlaying = isPlaying;
    liveRef.current.intensity = intensity;
    liveRef.current.analyser = analyser;
    liveRef.current.gradient = gradient;
    liveRef.current.preset = preset;
    liveRef.current.motion = motion;
    liveRef.current.fx = fx;
    liveRef.current.palette = palette;
    liveRef.current.density = density;

    useEffect(() => {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) return undefined;

        const gl = canvas.getContext('webgl', {
            alpha: true,
            antialias: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: false,
        });
        if (!gl) return undefined;

        let program;
        try {
            program = buildProgram(gl);
        } catch (error) {
            if (typeof console !== 'undefined') console.error('[visual]', error);
            return undefined;
        }

        gl.useProgram(program);

        const attribute = (name) => gl.getAttribLocation(program, name);
        const uniform = (name) => gl.getUniformLocation(program, name);
        const locations = {
            uv: attribute('aUv'),
            color: attribute('aColor'),
            seed: attribute('aSeed'),
            time: uniform('uTime'),
            gather: uniform('uGather'),
            aspect: uniform('uAspect'),
            bass: uniform('uBass'),
            mid: uniform('uMid'),
            high: uniform('uHigh'),
            level: uniform('uLevel'),
            intensity: uniform('uIntensity'),
            motion: uniform('uMotion'),
            preset: uniform('uPreset'),
            flow: uniform('uFlow'),
            spin: uniform('uSpin'),
            beat: uniform('uBeat'),
            beatAge: uniform('uBeatAge'),
            ripplesOn: uniform('uRipplesOn'),
            cinemaOn: uniform('uCinemaOn'),
            ripple0: uniform('uRipple0'),
            ripple1: uniform('uRipple1'),
            ripple2: uniform('uRipple2'),
            parallax: uniform('uParallax'),
            focal: uniform('uFocal'),
            cameraZ: uniform('uCameraZ'),
            halfViewport: uniform('uHalfViewport'),
            pointSize: uniform('uPointSize'),
            mode: uniform('uMode'),
            tint: uniform('uTint'),
            accent: uniform('uAccent'),
            spectrum: uniform('uSpectrum'),
        };

        // Two dataset slots: the dust uploads once, the field once per song.
        const makeBuffers = function () {
            return { uv: gl.createBuffer(), color: gl.createBuffer(), seed: gl.createBuffer() };
        };
        const dustBuffers = makeBuffers();
        const cloudBuffers = makeBuffers();

        const upload = function (data, into) {
            gl.bindBuffer(gl.ARRAY_BUFFER, into.uv);
            gl.bufferData(gl.ARRAY_BUFFER, data.uvs, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, into.color);
            gl.bufferData(gl.ARRAY_BUFFER, data.colors, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, into.seed);
            gl.bufferData(gl.ARRAY_BUFFER, data.seeds, gl.STATIC_DRAW);
        };

        // --- the spectrum texture (the terrain preset's input) --------------
        //
        // A 32×1 RGBA strip updated every frame. A texture, not a uniform
        // array because a vertex shader may index a sampler freely while a
        // uniform array's dynamic index is only *usually* supported.
        const spectrumData = new Uint8Array(BANDS * 4);
        const spectrumTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, spectrumTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, BANDS, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, spectrumData);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const spectrumBins = new Uint8Array(1024);

        let cloudCount = 0;
        let cloudAspect = 1;
        let startedAt = performance.now();
        let dead = false;
        let reader = null;
        const detector = createBeatDetector();

        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const motionBase = reduced ? 0.15 : 1;

        const dust = dustField();
        upload(dust, dustBuffers);

        const gridHeight = DENSITY_GRID[density] || DENSITY_GRID.medium;

        const renderFallback = function () {
            upload(fallbackField(hexToRgb(liveRef.current.gradient)), cloudBuffers);
            cloudCount = 30_000;
            cloudAspect = 1;
            startedAt = performance.now();
        };
        const renderCover = function (image) {
            const data = coverField(image, gridHeight);
            if (data) {
                upload(data, cloudBuffers);
                cloudCount = data.count;
                cloudAspect = data.aspect;
            } else {
                renderFallback();
            }
            startedAt = performance.now();
        };
        const loadField = function () {
            cloudCount = 0;
            if (!coverUrl) {
                renderFallback();
                return;
            }
            (async () => {
                const image = await loadCoverResilient(coverUrl);
                if (dead) return;
                if (image) renderCover(image);
                else renderFallback();
            })();
        };
        loadField();

        // --- sizing -------------------------------------------------------

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

        // --- the pointer ---------------------------------------------------

        const target = { x: 0, y: 0 };
        const eased = { x: 0, y: 0 };
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
        let mid = 0;
        let frame = 0;
        let flow = 0;
        let spin = 0;
        let lastNow = performance.now();

        // Three ripple slots in a ring: a new bass hit overwrites the oldest,
        // so a busy track shows overlapping rings and never runs out.
        const ripples = [
            { age: 0, amp: 0 },
            { age: 0, amp: 0 },
            { age: 0, amp: 0 },
        ];
        let rippleCursor = 0;
        let rippleFloor = 0.12;
        let lastRippleAt = -10_000;

        const bindAndDraw = function (bufs, count, mode, pointSize) {
            gl.uniform1f(locations.mode, mode);
            gl.uniform1f(locations.pointSize, pointSize * Math.min(window.devicePixelRatio || 1, 2));
            gl.bindBuffer(gl.ARRAY_BUFFER, bufs.uv);
            gl.enableVertexAttribArray(locations.uv);
            gl.vertexAttribPointer(locations.uv, 2, gl.FLOAT, false, 0, 0);
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

            const dt = Math.min(0.05, Math.max(0, (now - lastNow) / 1000));
            lastNow = now;

            const live = liveRef.current;
            if (live.analyser && (!reader || reader.analyser !== live.analyser)) {
                reader = createBandReader(live.analyser);
            }
            const sample = reader && live.analyser
                ? readBands(reader)
                : { low: 0, mid: 0, high: 0, level: 0 };

            const playing = live.isPlaying && Boolean(live.analyser);
            bass += ((playing ? sample.low : 0.06) - bass) * (sample.low > bass ? ATTACK : RELEASE);
            level += ((playing ? sample.level : 0.1) - level) * (sample.level > level ? ATTACK : RELEASE);
            high += ((playing ? sample.high : 0) - high) * (sample.high > high ? ATTACK : RELEASE);
            mid += ((playing ? sample.mid : 0) - mid) * (sample.mid > mid ? ATTACK : RELEASE);

            const beat = detector.update(now, bass, playing);
            const intensityValue = INTENSITY[live.intensity] || INTENSITY.standard;
            const motionValue = (MOTION_SCALE[live.motion] || 1) * motionBase;

            // The tunnel's two accumulators: distance travelled around the
            // tube and the tube's own spin. Both speed up with the bass and
            // kick, so the sprint is audible as well as visible.
            flow += dt * (0.055 + bass * 0.09 + beat.amp * 0.10) * motionValue;
            spin += dt * (0.10 + bass * 0.25 + beat.amp * 0.50) * motionValue;

            // Ripples: a bass transient spawns a ring. The floor tracks the
            // song's own bass level slowly, so a sustained bass note does not
            // fire one per frame.
            const fxFlags = live.fx || {};
            rippleFloor += (bass - rippleFloor) * 0.01;
            if (fxFlags.ripples && playing && bass > 0.2
                && bass > rippleFloor * 1.16 && now - lastRippleAt > 340) {
                lastRippleAt = now;
                const slot = ripples[rippleCursor % ripples.length];
                slot.age = 0;
                slot.amp = Math.min(1, 0.35 + (bass - rippleFloor) * 1.6);
                rippleCursor += 1;
            }
            for (let i = 0; i < ripples.length; i += 1) {
                const ripple = ripples[i];
                ripple.age += dt;
                if (ripple.age > 2.4) ripple.amp = 0;
                else ripple.amp *= 0.985;
            }

            target.x *= 0.94;
            target.y *= 0.94;
            eased.x += (target.x - eased.x) * 0.3;
            eased.y += (target.y - eased.y) * 0.3;

            const t = Math.min(1, (now - startedAt) / GATHER_MS);
            const gather = 1 - (1 - t) * (1 - t) * (1 - t);

            // The palette drives the dust and the preset's own accent. Off,
            // everything falls back to the song's gradient tint.
            const paletteOn = fxFlags.palette !== false;
            const tint = paletteOn && live.palette && !live.palette.monochrome
                ? live.palette.primary
                : hexToRgb(live.gradient);
            const accent = paletteOn && live.palette && !live.palette.monochrome
                ? live.palette.accent
                : hexToRgb(live.gradient);

            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.useProgram(program);
            gl.uniform1f(locations.time, (now - startedAt) / 1000);
            gl.uniform1f(locations.gather, gather);
            gl.uniform1f(locations.aspect, cloudAspect);
            gl.uniform1f(locations.bass, bass);
            gl.uniform1f(locations.mid, mid);
            gl.uniform1f(locations.high, high);
            gl.uniform1f(locations.level, level);
            gl.uniform1f(locations.intensity, intensityValue);
            gl.uniform1f(locations.motion, motionValue);
            gl.uniform1f(locations.preset, PRESET_INDEX[live.preset] || 0);
            gl.uniform1f(locations.flow, flow);
            gl.uniform1f(locations.spin, spin);
            gl.uniform1f(locations.beat, beat.amp);
            gl.uniform1f(locations.beatAge, beat.age);
            gl.uniform1f(locations.ripplesOn, fxFlags.ripples ? 1 : 0);
            gl.uniform1f(locations.cinemaOn, fxFlags.cinema ? 1 : 0);
            gl.uniform3f(locations.ripple0, ripples[0].age, ripples[0].amp, 0);
            gl.uniform3f(locations.ripple1, ripples[1].age, ripples[1].amp, 0);
            gl.uniform3f(locations.ripple2, ripples[2].age, ripples[2].amp, 0);
            gl.uniform1f(locations.focal, FOCAL * Math.min(canvas.width, canvas.height) * 0.5);
            gl.uniform1f(locations.cameraZ, CAMERA_Z);
            gl.uniform2f(locations.halfViewport, canvas.width * 0.5, canvas.height * 0.5);
            gl.uniform2f(locations.parallax, eased.x, eased.y);
            gl.uniform3f(locations.tint, tint[0], tint[1], tint[2]);
            gl.uniform3f(locations.accent, accent[0], accent[1], accent[2]);

            // The terrain preset needs the spectrum as a texture. Only worth
            // uploading while that preset is actually on screen.
            if ((PRESET_INDEX[live.preset] || 0) === 6 && live.analyser) {
                const bins = spectrumBins.length >= live.analyser.frequencyBinCount
                    ? spectrumBins
                    : new Uint8Array(live.analyser.frequencyBinCount);
                live.analyser.getByteFrequencyData(bins);
                // A logarithmic band split: the interesting detail lives at
                // the bottom of the spectrum, and a linear split would give
                // thirty of the thirty-two bands to silence.
                const usable = Math.floor(bins.length * 0.62);
                for (let band = 0; band < BANDS; band += 1) {
                    const from = Math.floor(Math.pow(band / BANDS, 2.1) * usable);
                    const to = Math.max(from + 1, Math.floor(Math.pow((band + 1) / BANDS, 2.1) * usable));
                    let sum = 0;
                    for (let i = from; i < to; i += 1) sum += bins[i];
                    const value = Math.min(255, Math.round(sum / (to - from) * 1.15));
                    spectrumData[band * 4] = value;
                    spectrumData[band * 4 + 1] = value;
                    spectrumData[band * 4 + 2] = value;
                    spectrumData[band * 4 + 3] = 255;
                }
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, spectrumTexture);
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BANDS, 1, gl.RGBA, gl.UNSIGNED_BYTE, spectrumData);
                gl.uniform1i(locations.spectrum, 0);
            }

            // Back to front: additive dust first, the picture over it.
            if (fxFlags.starRiver !== false) {
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
                bindAndDraw(dustBuffers, DUST_COUNT, 0, 3.4);
            }

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
            gl.deleteBuffer(dustBuffers.uv);
            gl.deleteBuffer(dustBuffers.color);
            gl.deleteBuffer(dustBuffers.seed);
            gl.deleteBuffer(cloudBuffers.uv);
            gl.deleteBuffer(cloudBuffers.color);
            gl.deleteBuffer(cloudBuffers.seed);
            gl.deleteTexture(spectrumTexture);
            gl.deleteProgram(program);
        };
        // The field is keyed on the cover and the sampling density: both
        // change *which particles exist*. Everything else is a uniform.
    }, [coverUrl, density]);

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
            aria-label={onActivate ? '视觉背景，点击播放或暂停' : '视觉背景'}
        >
            <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
        </div>
    );
};

export default VisualCanvas;
