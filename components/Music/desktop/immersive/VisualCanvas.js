import React, { useEffect, useRef } from 'react';

import { createBandReader, readBands } from '../../core/audioAnalyser';
import { createBeatDetector } from '../../core/beat';
import { loadCoverResilient } from '../../core/coverImage';
import {
    PRESET_FRAME,
    buildField,
    buildRequiemField,
    dustField,
    fallbackSamples,
    sampleCover,
} from './presetFields';
import { PRESETS_BY_ID, PRESET_INDEX, gridForRes } from './visualPresets';

import styles from './VisualCanvas.module.scss';

/**
 * The immersive page's background: **one particle field, twelve shapes.**
 *
 * There is a single WebGL program. Each preset is a branch in the vertex
 * shader, and each preset also builds its own attribute buffers (see
 * `presetFields.js`) so the十二 modes are genuinely different objects — a
 * grooved record, a sphere, a tunnel, a flock — rather than one rectangle of
 * cover pixels being moved twelve ways.
 *
 * Switching preset re-uploads buffers for the new shape (a few milliseconds,
 * once) and then costs nothing per frame beyond a uniform write. That is why
 * twelve modes can live in one program without the bundle noticing.
 *
 * ## What every particle carries
 *
 * - `aUv`    — two numbers whose meaning belongs to the preset's branch;
 * - `aExtra` — two more (group flags, band index, butterfly id, jaw flag…);
 * - `aColor` — the cover pixel this particle carries, or bone shade;
 * - `aSeed`  — a stable per-particle random, for scatter and variation.
 *
 * ## The layers that ride on top of every preset
 *
 * - **ripples** — a bass hit spawns a ring that rolls outward, pushing and
 *   brightening the particles it crosses;
 * - **the beat camera** — a kick dollies the lens in and shakes it a hair;
 * - **the star river** — an ambient dust field behind the picture, tinted by
 *   the cover's own palette.
 */

// Ambient dust behind the picture: atmosphere at the edges of the frame,
// never a rival to the picture itself.
const DUST_COUNT = 4_000;

const CAMERA_Z = 3.4;
const FOCAL = 2.6;

// Seconds the particles take to fly into a newly loaded cover. The cover
// preset arrives faster than the others: it is the default, so it is the one
// people see assemble most often.
const GATHER_MS = {
    emily: 850,
    tunnel: 1100,
    orbit: 1200,
    void: 900,
    vinyl: 1000,
    galaxy: 1200,
    requiem: 1400,
    sonic: 1100,
    halo: 1200,
    rain: 1100,
    prism: 1200,
    abyss: 1200,
};

const ATTACK = 0.35;
const RELEASE = 0.06;

// Spectrum bands handed to the terrain preset. A power of two keeps the
// texture fetch cheap and the grid readable.
const BANDS = 32;

const VERTEX_SHADER = `
precision highp float;

attribute vec2 aUv;
attribute vec2 aExtra;
attribute vec3 aColor;
attribute float aSeed;

uniform float uTime;
uniform float uGather;
uniform float uAspect;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uLevel;
uniform float uGain;
uniform float uDepth;
uniform float uPreset;
uniform float uFlow;
uniform float uSpin;
uniform float uBeat;
uniform float uBeatAge;
uniform float uRipplesOn;
uniform float uCinemaOn;
uniform float uShake;
uniform vec3 uRipple0;
uniform vec3 uRipple1;
uniform vec3 uRipple2;
uniform vec2 uParallax;
uniform float uFocal;
uniform float uCameraZ;
uniform vec2 uHalfViewport;
uniform float uPointSize;
uniform float uFrameScale;
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
        pos.xy *= 1.0 + uBeat * 0.02 * uGain;
        float twinkle = 0.5 + 0.5 * sin(uTime * (0.4 + rand.y) + aSeed * 21.0);
        float white = step(0.82, hash11(aSeed + 9.4));
        col = mix(uTint * (0.6 + rand.x * 0.4), vec3(1.0), white);
        alpha = 0.26 + 0.18 * twinkle + uBeat * 0.10;
        sizeBoost = 0.8;
    }

    // --- 0: emily专辑封面 — the cover, taken apart ------------------------
    else if (uPreset < 0.5) {
        vec2 nrm = vec2((aUv.x - 0.5) * 2.0, (aUv.y - 0.5) * 2.0);
        pos = vec3(nrm.x * uAspect, -nrm.y, (aExtra.x - 0.5) * 0.55) * 1.35 * uFrameScale;
        // A silk wave rolling across the picture: the cover breathes with the
        // bass instead of only scaling with it.
        float wave = sin(aUv.x * 6.0 + uTime * 0.7) * cos(aUv.y * 5.0 - uTime * 0.5);
        pos.z += wave * 0.11 * (0.35 + uBass * uGain);
        pos.xy *= 1.0 + uBass * 0.10 * uGain;
        pos += vec3(
            sin(uTime * 0.55 + aSeed * 6.283),
            cos(uTime * 0.47 + aSeed * 4.712),
            0.0
        ) * 0.02;
        // The rectangle is the tell that this is a picture: an elliptical
        // falloff is what turns it into a cloud.
        alpha *= 1.0 - smoothstep(0.55, 1.04, length(vec2(nrm.x / uAspect, nrm.y)));
    }

    // --- 1: 滚筒 — the cover rolled into a tube ---------------------------
    else if (uPreset < 1.5) {
        float seg = fract(aUv.y + uFlow);
        float zPos = (seg - 0.5) * 9.0;
        float ang = aUv.x * TAU + uSpin + sin(zPos * 1.1 + uTime * 0.7) * 0.06 * uLevel;
        float rr = 2.05 - uBass * 0.32 * uGain
            + sin(ang * 5.0 + zPos * 1.4 + uTime * 2.0) * 0.12 * (uMid + uHigh) * uGain;
        pos = vec3(cos(ang) * rr, sin(ang) * rr, zPos);
        // Fade in at the far mouth and out again just before the lens, so
        // particles neither pop into existence nor smear across the screen.
        alpha *= 0.16 + 0.92 * smoothstep(-4.5, -1.8, zPos) * (1.0 - smoothstep(2.4, 4.5, zPos));
    }

    // --- 2: 星球 — the cover gathered onto a shell ------------------------
    else if (uPreset < 2.5) {
        float theta = aUv.x * TAU + uTime * 0.10;
        float phi = aUv.y * PI;
        float rr = (1.14 + (aExtra.y - 0.5) * 0.16 + uBass * 0.10 * uGain)
            * (1.0 + aExtra.x * (0.28 + hash11(aSeed + 1.3) * 0.60 + uLevel * 0.20));
        pos = vec3(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta)) * rr * uFrameScale;
        float facing = dot(normalize(pos), vec3(0.0, 0.0, 1.0));
        alpha *= (0.28 + 0.72 * smoothstep(-0.40, 0.60, facing)) * mix(1.0, 0.22, aExtra.x);
        col = mix(col, uAccent, aExtra.x * 0.65);
        sizeBoost = mix(1.0, 1.6, aExtra.x);
    }

    // --- 3: 虚空 — near-empty, for the artwork behind ---------------------
    else if (uPreset < 3.5) {
        pos = vec3((aUv.x - 0.5) * 3.0, (aUv.y - 0.5) * 3.0, -2.0);
        alpha *= 0.05;
        sizeBoost = 0.6;
    }

    // --- 4: 唱片 — a grooved disc with the cover on its label -------------
    else if (uPreset < 4.5) {
        if (aExtra.x < 0.5) {
            // The grooves: the cover wrapped into a spiral, darkened to
            // vinyl, with a specular arc where the light grazes it.
            float ang = aUv.x * TAU * 3.0 + aUv.y * 1.2 + uSpin;
            float rad = 0.36 + aUv.y * 1.20;
            float groove = 0.5 + 0.5 * sin(rad * 190.0);
            pos = vec3(cos(ang) * rad, sin(ang) * rad, groove * 0.008) * uFrameScale;
            float sheen = pow(max(0.0, sin(ang * 0.5 + 2.2)), 3.0);
            col = mix(col * 0.20 + vec3(0.035), col * (0.30 + 0.45 * groove), 0.35);
            col += sheen * uAccent * 0.20;
            alpha *= 0.50 + 0.50 * groove;
            sizeBoost = 0.85;
        } else {
            // The label: the whole cover, printed small, dead centre.
            vec2 p = vec2((aUv.x - 0.5) * 2.0 * uAspect, -(aUv.y - 0.5) * 2.0);
            pos = vec3(p.x * 0.34, p.y * 0.34, 0.03) * uFrameScale;
            alpha *= 1.0;
            sizeBoost = 1.05;
        }
        // The record sits tilted, the way one does on a deck.
        float tilt = -0.42;
        float ct = cos(tilt);
        float st = sin(tilt);
        pos = vec3(pos.x, pos.y * ct - pos.z * st, pos.y * st + pos.z * ct);
    }

    // --- 5: 星河 — aurora ribbons across the frame ------------------------
    else if (uPreset < 5.5) {
        float lane = aExtra.x;
        float x = fract(aUv.x + uTime * (0.03 + uLevel * 0.06)) * 4.6 - 2.3;
        float y = (lane - 1.0) * 0.55
            + sin(aUv.x * TAU + uTime * 0.45 + lane) * 0.16
            + (aUv.y - 0.5) * 0.32;
        float z = (aExtra.y - 0.5) * 2.4;
        pos = vec3(x, y + sin(uTime * 0.6 + x * 0.8) * 0.10 * (1.0 + uBass * 2.0), z);
        col = mix(uTint, uAccent, clamp((x + 2.3) / 4.6, 0.0, 1.0));
        alpha *= 0.32 + 0.68 * clamp(1.0 - abs(y) * 0.85, 0.0, 1.0);
        sizeBoost = 1.1;
    }

    // --- 6: 安魂 — the skull ----------------------------------------------
    else if (uPreset < 6.5) {
        pos = vec3(aUv.x, aUv.y, aExtra.x) * uFrameScale;
        // The jaw drops on the kick: the one part of a skull that can move.
        if (aExtra.y > 0.5) {
            float open = 0.06 + uBeat * 0.30 * uGain;
            vec3 rel = pos - vec3(0.0, -0.30, 0.0);
            float co = cos(open);
            float so = sin(open);
            rel = vec3(rel.x, rel.y * co - rel.z * so, rel.y * so + rel.z * co);
            pos = rel + vec3(0.0, -0.30, 0.0);
        }
        // A slow float and a breath on the bass, so it never looks like a
        // frozen model dropped into the frame.
        pos.y += sin(uTime * 0.5) * 0.045;
        pos *= 1.0 + uBass * 0.035 * uGain;
        float bone = dot(aColor, vec3(0.3333));
        col = mix(vec3(0.93, 0.91, 0.86) * bone, uTint, 0.18);
        col += uBeat * 0.10 * uAccent;
        alpha *= 0.85;
    }

    // --- 7: 音域回响 — the spectrum as a landscape ------------------------
    else if (uPreset < 7.5) {
        float fi = aExtra.y;
        float spec = texture2D(uSpectrum, vec2((fi + 0.5) / 32.0, 0.5)).r;
        float h = spec * (0.9 + uBass * 0.35);
        pos = vec3((aUv.x - 0.5) * 4.4, -1.35 + h * 1.5 + (aExtra.x - 0.5) * 0.06, (aUv.y - 0.5) * 4.4);
        col = mix(uTint, uAccent, clamp(h * 1.6, 0.0, 1.0));
        alpha *= 0.40 + 0.60 * clamp(h * 1.4, 0.0, 1.0);
        sizeBoost = 0.9;
    }

    // --- 8: 月蚀圣环 — an eclipse ring and its corona ---------------------
    else if (uPreset < 8.5) {
        float ang = aUv.x * TAU + uTime * 0.07;
        float isCorona = aExtra.x;
        float rad = 1.20 + sin(ang * 3.0 + uTime * 0.35) * 0.05 * (1.0 + uBass);
        float rr = rad + isCorona * (0.10 + aExtra.y * 1.15) * (1.0 + uBass * 0.20 * uGain);
        float zz = (hash11(aSeed + 6.6) - 0.5) * (0.30 + isCorona * 1.30);
        pos = vec3(cos(ang) * rr, sin(ang) * rr * 0.92, zz) * uFrameScale;
        // Backlight: the ring is brightest where the sightline grazes it.
        float graz = abs(sin(ang));
        col = mix(col, uAccent, 0.30 + isCorona * 0.55);
        alpha *= mix(0.95, 0.28, isCorona) * (0.50 + 0.50 * graz);
        sizeBoost = mix(1.0, 0.8, isCorona);
    }

    // --- 9: 雨幕霓虹 — neon drizzle falling through frame -----------------
    else if (uPreset < 9.5) {
        float lanes = 220.0;
        float laneIdx = floor(aUv.x * lanes);
        float speed = 0.55 + aExtra.x * 1.5;
        float x = (laneIdx / lanes - 0.5) * 4.6 + (hash11(laneIdx) - 0.5) * 0.02;
        float y = fract(aUv.y - uTime * speed * 0.09 * (1.0 + uLevel * 0.7));
        float z = -1.0 + aExtra.y * 2.0;
        pos = vec3(x, (0.5 - y) * 3.4, z);
        // Hundreds of particles per lane, sorted by y: that density is what
        // reads as a thread of rain rather than as a row of dots.
        col = mix(uTint, uAccent, aExtra.x);
        alpha *= 0.28 + 0.72 * smoothstep(0.0, 0.35, y) * (1.0 - smoothstep(0.72, 1.0, y));
        sizeBoost = 0.75;
    }

    // --- 10: 折光蝶群 — a flock of folded wings ---------------------------
    else if (uPreset < 10.5) {
        float id = aExtra.x;
        vec3 r1 = hash31(id * 91.7);
        vec3 r2 = hash31(id * 41.3 + 7.7);
        // The migration: every butterfly circuits the frame at its own rate.
        float t = uTime * (0.10 + r1.x * 0.10) + r1.y * TAU;
        vec3 center = vec3(
            sin(t) * (1.1 + r1.z * 1.5),
            sin(t * 1.7 + r2.x * 6.0) * 0.70 + (r2.y - 0.5) * 0.90,
            cos(t) * (1.1 + r2.z * 1.4)
        );
        // The wing, in the butterfly's own frame: the cover pixel it carries
        // decides where on the wing it sits.
        float side = aExtra.y * 2.0 - 1.0;
        vec2 local = vec2(side * (0.10 + aUv.x * 0.52), (aUv.y - 0.5) * 0.62);
        float flap = sin(uTime * (5.0 + r1.x * 3.0) + r2.y * 6.28) * 0.85;
        vec3 wing = vec3(local.x * cos(flap), local.y, local.x * sin(flap) + abs(local.x) * 0.15);
        pos = center + wing * (0.90 + r2.z * 0.50);
        // A folded-paper silhouette: soft shoulders, no hard rectangle.
        float d = length(vec2(local.x / 0.60, local.y / 0.36));
        alpha *= 1.0 - smoothstep(0.72, 1.02, d);
        col = mix(col, uAccent, 0.25 + 0.30 * r1.z);
        col += uBeat * 0.08;
        sizeBoost = 0.9;
    }

    // --- 11: 深海绽放 — a bioluminescent corona ---------------------------
    else {
        float theta = aUv.x * TAU + uTime * 0.05;
        float layer = aExtra.x;
        float petals = 5.0 + layer;
        float rose = abs(cos(petals * theta * 0.5));
        float open = 0.55 + 0.45 * (0.5 + 0.5 * sin(uTime * 0.35)) + uBass * 0.25 * uGain;
        float rad = (0.35 + aUv.y * 1.15) * (0.35 + 0.65 * rose) * open;
        float lift = sin(theta * 2.0 + layer) * 0.10 * (1.0 - aUv.y);
        pos = vec3(
            cos(theta) * rad,
            sin(theta) * rad * 0.95 + lift,
            (aExtra.y - 0.5) * 0.70 * (1.0 - aUv.y * 0.5)
        ) * uFrameScale;
        col = mix(uAccent, uTint, clamp(aUv.y, 0.0, 1.0));
        alpha *= 0.35 + 0.65 * (1.0 - smoothstep(0.60, 1.15, rad));
        sizeBoost = 1.05;
    }

    // --- assembly: gather, ripples, beat, camera, projection ---------------

    // A new cover does not blink into place: the field flies in from a shell.
    if (uMode > 0.5) {
        vec3 scatter = normalize(rand * 2.0 - 1.0) * (0.75 + rand.x * 0.55);
        pos = mix(scatter, pos, uGather);

        // Treble sparkle on the picture's highlights.
        if (rand.z > 0.88) {
            float phase = uTime * (2.0 + rand.x * 3.0) + aSeed * 37.0;
            glint = pow(max(0.0, sin(phase)), 6.0) * uHigh * uGain;
        }
    }

    // Depth: the console's 立体感, applied as a z stretch so a flat preset
    // can be pushed towards the visitor or away from them.
    pos.z *= uDepth;

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
    // console's own shake amount. The shake is deterministic per frame so
    // there is no jitter when nothing is playing.
    float dolly = uCinemaOn > 0.5 ? uBeat * 0.32 * uGain : 0.0;
    if (uCinemaOn > 0.5 && uShake > 0.001) {
        pos.xy += vec2(sin(uTime * 61.0), cos(uTime * 53.0)) * uBeat * 0.016 * uShake;
    }

    // A sine sway, never a cumulative turn: the resting field is frontal.
    float sway = sin(uTime * 0.05) * 0.026;
    float cs = cos(sway);
    float ss = sin(sway);
    pos = vec3(pos.x * cs + pos.z * ss, pos.y, -pos.x * ss + pos.z * cs);

    // The pointer's virtual camera: a tilt with hard limits (±5° yaw,
    // ±3.5° pitch) that always decays back to face-on.
    float yaw = uParallax.x * 0.087 * uDepth;
    float pitch = uParallax.y * 0.061 * uDepth;
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
 * @param {string} preset       one of `visualPresets.PRESET_IDS`.
 * @param {object} fx           the console's sliders and layer switches.
 * @param {number[]|null} palette the cover's primary colour, or null.
 * @param {AnalyserNode|null} analyser the shared spectrum source.
 * @param {Function} [onActivate] what clicking the field does.
 */
const VisualCanvas = function ({
    coverUrl = '',
    gradient = '',
    isPlaying = false,
    preset = 'emily',
    fx = null,
    palette = null,
    analyser = null,
    onActivate,
}) {
    const canvasRef = useRef(null);
    const wrapRef = useRef(null);
    const liveRef = useRef({ isPlaying, analyser, gradient, preset, fx, palette });
    liveRef.current.isPlaying = isPlaying;
    liveRef.current.analyser = analyser;
    liveRef.current.gradient = gradient;
    liveRef.current.preset = preset;
    liveRef.current.fx = fx;
    liveRef.current.palette = palette;

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
            extra: attribute('aExtra'),
            color: attribute('aColor'),
            seed: attribute('aSeed'),
            time: uniform('uTime'),
            gather: uniform('uGather'),
            aspect: uniform('uAspect'),
            bass: uniform('uBass'),
            mid: uniform('uMid'),
            high: uniform('uHigh'),
            level: uniform('uLevel'),
            gain: uniform('uGain'),
            depth: uniform('uDepth'),
            preset: uniform('uPreset'),
            flow: uniform('uFlow'),
            spin: uniform('uSpin'),
            beat: uniform('uBeat'),
            beatAge: uniform('uBeatAge'),
            ripplesOn: uniform('uRipplesOn'),
            cinemaOn: uniform('uCinemaOn'),
            shake: uniform('uShake'),
            ripple0: uniform('uRipple0'),
            ripple1: uniform('uRipple1'),
            ripple2: uniform('uRipple2'),
            parallax: uniform('uParallax'),
            focal: uniform('uFocal'),
            cameraZ: uniform('uCameraZ'),
            halfViewport: uniform('uHalfViewport'),
            pointSize: uniform('uPointSize'),
            frameScale: uniform('uFrameScale'),
            mode: uniform('uMode'),
            tint: uniform('uTint'),
            accent: uniform('uAccent'),
            spectrum: uniform('uSpectrum'),
        };

        // Two dataset slots: the dust uploads once, the field once per song
        // (and again whenever the preset's shape changes).
        const makeBuffers = function () {
            return {
                uv: gl.createBuffer(),
                extra: gl.createBuffer(),
                color: gl.createBuffer(),
                seed: gl.createBuffer(),
            };
        };
        const dustBuffers = makeBuffers();
        const cloudBuffers = makeBuffers();

        const upload = function (data, into) {
            gl.bindBuffer(gl.ARRAY_BUFFER, into.uv);
            gl.bufferData(gl.ARRAY_BUFFER, data.uvs, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, into.extra);
            gl.bufferData(gl.ARRAY_BUFFER, data.extras, gl.STATIC_DRAW);
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

        // --- the fields -----------------------------------------------------

        let cloudCount = 0;
        let cloudAspect = 1;
        let builtPreset = '';
        let builtGrid = 0;
        let samples = null;
        let startedAt = performance.now();
        let dead = false;
        let reader = null;
        const detector = createBeatDetector();

        const dust = dustField(DUST_COUNT);
        upload(dust, dustBuffers);

        const applyField = function (field, aspect) {
            upload(field, cloudBuffers);
            cloudCount = field.count;
            if (aspect) cloudAspect = aspect;
            startedAt = performance.now();
        };

        const buildFor = function (presetId) {
            if (!samples) return;
            if (presetId === 'requiem') {
                // The skull is async (a model may have to be fetched), so the
                // old shape keeps rendering until it arrives.
                buildRequiemField(120_000).then((field) => {
                    if (dead || !field || liveRef.current.preset !== 'requiem') return;
                    applyField(field, 1);
                }).catch(() => {
                    // No skull available: the cover cloud stands in.
                    if (!dead && samples) applyField(buildField('emily', samples), samples.aspect);
                });
                builtPreset = presetId;
                return;
            }
            applyField(buildField(presetId, samples), samples.aspect);
            builtPreset = presetId;
        };

        const renderFallback = function () {
            samples = fallbackSamples(hexToRgb(liveRef.current.gradient));
            buildFor(liveRef.current.preset);
        };
        const renderCover = function (image) {
            const grid = gridForRes((liveRef.current.fx || {}).coverRes);
            const sampled = sampleCover(image, grid);
            if (sampled) {
                samples = sampled;
                builtGrid = grid;
                buildFor(liveRef.current.preset);
            } else {
                renderFallback();
            }
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
            gl.bindBuffer(gl.ARRAY_BUFFER, bufs.extra);
            gl.enableVertexAttribArray(locations.extra);
            gl.vertexAttribPointer(locations.extra, 2, gl.FLOAT, false, 0, 0);
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
            const fxFlags = live.fx || {};

            // The console's own knobs, with the defaults they fall back to.
            const gain = Number.isFinite(fxFlags.gain) ? fxFlags.gain : 0.85;
            const depth = Number.isFinite(fxFlags.depth) ? fxFlags.depth : 1;
            const shake = Number.isFinite(fxFlags.shake) ? fxFlags.shake : 0.5;

            // A preset change rebuilds the shape; so does a resolution change
            // big enough to be worth the re-sample.
            if (live.preset !== builtPreset && samples) buildFor(live.preset);
            const wantedGrid = gridForRes(fxFlags.coverRes);
            if (samples && wantedGrid !== builtGrid && live.preset !== 'requiem'
                && Math.abs(wantedGrid - builtGrid) > 20) {
                builtGrid = wantedGrid;
                buildFor(live.preset);
            }

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

            // The tunnel's and the record's accumulators: distance travelled
            // and spin. Both speed up with the bass and the kick.
            flow += dt * (0.055 + bass * 0.09 + beat.amp * 0.10) * gain;
            spin += dt * (0.10 + bass * 0.25 + beat.amp * 0.50) * gain;

            // Ripples: a bass transient spawns a ring. The floor tracks the
            // song's own bass level slowly, so a sustained bass note does not
            // fire one per frame.
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

            const gatherMs = GATHER_MS[live.preset] || 1100;
            const t = Math.min(1, (now - startedAt) / gatherMs);
            const gather = 1 - (1 - t) * (1 - t) * (1 - t);

            // The palette drives the dust and the preset's own accent. Off,
            // everything falls back to the song's gradient tint.
            const paletteOn = fxFlags.palette !== false;
            const tint = paletteOn && live.palette && !live.palette.monochrome
                ? live.palette.primary
                : hexToRgb(live.gradient);
            let accent = paletteOn && live.palette && !live.palette.monochrome
                ? live.palette.accent
                : hexToRgb(live.gradient);
            // The premium visuals ship their own two-colour identity; a
            // cover palette would wash them out.
            const meta = PRESETS_BY_ID[live.preset];
            if (meta && meta.accent) accent = hexToRgb(meta.accent);

            const frameCfg = PRESET_FRAME[live.preset] || PRESET_FRAME.emily;

            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.useProgram(program);
            gl.uniform1f(locations.time, (now - startedAt) / 1000);
            gl.uniform1f(locations.gather, gather);
            gl.uniform1f(locations.aspect, cloudAspect);
            gl.uniform1f(locations.bass, bass);
            gl.uniform1f(locations.mid, mid);
            gl.uniform1f(locations.high, high);
            gl.uniform1f(locations.level, level);
            gl.uniform1f(locations.gain, gain);
            gl.uniform1f(locations.depth, depth);
            gl.uniform1f(locations.preset, PRESET_INDEX[live.preset] || 0);
            gl.uniform1f(locations.flow, flow);
            gl.uniform1f(locations.spin, spin);
            gl.uniform1f(locations.beat, beat.amp);
            gl.uniform1f(locations.beatAge, beat.age);
            gl.uniform1f(locations.ripplesOn, fxFlags.ripples ? 1 : 0);
            gl.uniform1f(locations.cinemaOn, fxFlags.cinema ? 1 : 0);
            gl.uniform1f(locations.shake, shake);
            gl.uniform3f(locations.ripple0, ripples[0].age, ripples[0].amp, 0);
            gl.uniform3f(locations.ripple1, ripples[1].age, ripples[1].amp, 0);
            gl.uniform3f(locations.ripple2, ripples[2].age, ripples[2].amp, 0);
            gl.uniform1f(locations.focal, FOCAL * Math.min(canvas.width, canvas.height) * 0.5);
            gl.uniform1f(locations.cameraZ, frameCfg.cameraZ || CAMERA_Z);
            gl.uniform2f(locations.halfViewport, canvas.width * 0.5, canvas.height * 0.5);
            gl.uniform2f(locations.parallax, eased.x, eased.y);
            gl.uniform1f(locations.frameScale, frameCfg.scale);
            gl.uniform3f(locations.tint, tint[0], tint[1], tint[2]);
            gl.uniform3f(locations.accent, accent[0], accent[1], accent[2]);

            // The terrain preset needs the spectrum as a texture. Only worth
            // uploading while that preset is actually on screen.
            if ((PRESET_INDEX[live.preset] || 0) === 7 && live.analyser) {
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
            if (cloudCount) bindAndDraw(cloudBuffers, cloudCount, 1, frameCfg.pointSize);
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
            [dustBuffers, cloudBuffers].forEach((bufs) => {
                gl.deleteBuffer(bufs.uv);
                gl.deleteBuffer(bufs.extra);
                gl.deleteBuffer(bufs.color);
                gl.deleteBuffer(bufs.seed);
            });
            gl.deleteTexture(spectrumTexture);
            gl.deleteProgram(program);
        };
        // The field is keyed on the cover: that is what decides which pixels
        // exist. Everything else is a uniform or a rebuild inside the loop.
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
            aria-label={onActivate ? '视觉背景，点击播放或暂停' : '视觉背景'}
        >
            <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
        </div>
    );
};

export default VisualCanvas;
