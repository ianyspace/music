import React, { useEffect, useRef } from 'react';

import { createBandReader, readBands } from '../../core/audioAnalyser';
import { createBeatDetector } from '../../core/beat';

import styles from './LyricStarRiver.module.scss';

/**
 * The lyric star river: a few hundred sparks living in the words' own band of
 * the frame, brightest right where the line is.
 *
 * This is the layer that makes the lyrics stop reading as a caption printed
 * over the scene. Motes drift through the same slab of space the sentence
 * occupies, catch the beat, and glow in the cover's accent colour — so the
 * words sit *inside* the picture with the same light on them as everything
 * else.
 *
 * It is deliberately not the main field's own dust layer: that one
 * is whole-frame atmosphere, this one is a spotlight on the text.
 */

const COUNT = 420;

// The slab the sparks occupy — roughly where a centred line sits.
const SPREAD_X = 2.3;
const SPREAD_Y = 0.42;
const DEPTH_FROM = 0.1;
const DEPTH_TO = 1.5;

const VERTEX_SHADER = `
precision mediump float;

attribute vec3 aTarget;
attribute float aSeed;

uniform float uTime;
uniform float uLevel;
uniform float uBeat;
uniform float uIntensity;
uniform float uHalfViewportX;
uniform vec3 uTint;

varying vec3 vColor;
varying float vAlpha;

float hash11(float n) {
    return fract(sin(n * 78.233) * 43758.5453123);
}

void main() {
    vec3 pos = aTarget;

    float s1 = hash11(aSeed);
    float s2 = hash11(aSeed + 1.7);

    // A slow rise with a sideways sway: the sparks float up through the line
    // rather than sliding across it.
    pos.y += sin(uTime * (0.18 + s1 * 0.22) + aSeed * 6.283) * 0.10;
    pos.x += cos(uTime * (0.13 + s2 * 0.18) + aSeed * 4.712) * 0.14;

    // Loudness opens the slab a little; the beat pushes it outward and lights
    // it, which is the spark's whole job.
    pos.xy *= 1.0 + uLevel * 0.05 + uBeat * 0.06 * uIntensity;

    float depth = max(pos.z + 3.4, 0.35);
    gl_Position = vec4(
        2.6 * pos.x / depth / uHalfViewportX,
        2.6 * pos.y / depth / uHalfViewportX,
        0.0,
        1.0
    );

    float persp = 2.6 / depth / uHalfViewportX;
    float twinkle = 0.5 + 0.5 * sin(uTime * (1.2 + s2 * 2.0) + aSeed * 21.0);
    gl_PointSize = clamp((6.0 + s1 * 16.0) * persp * uHalfViewportX * 0.0018, 2.0, 34.0);

    // Mostly the cover's accent, some white: a highlight, not a colour wash.
    vColor = mix(uTint, vec3(1.0), 0.35 + s2 * 0.25);
    vAlpha = (0.10 + uLevel * 0.34 + uBeat * 0.30 * uIntensity)
        * (0.45 + 0.55 * twinkle)
        * clamp(persp * 2.4, 0.2, 1.0);
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

const LyricStarRiver = function ({
    analyser = null,
    isPlaying = false,
    intensity = 0.85,
    palette = null,
}) {
    const canvasRef = useRef(null);
    const wrapRef = useRef(null);
    const liveRef = useRef({ analyser, isPlaying, intensity, palette });
    liveRef.current.analyser = analyser;
    liveRef.current.isPlaying = isPlaying;
    liveRef.current.intensity = intensity;
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

        const compile = function (type, source) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                const log = gl.getShaderInfoLog(shader);
                gl.deleteShader(shader);
                throw new Error(log || 'shader failed');
            }
            return shader;
        };

        let program;
        try {
            const vertexShader = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
            const fragmentShader = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
            program = gl.createProgram();
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragmentShader);
            gl.linkProgram(program);
            gl.deleteShader(vertexShader);
            gl.deleteShader(fragmentShader);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                throw new Error(gl.getProgramInfoLog(program) || 'link failed');
            }
        } catch (error) {
            if (typeof console !== 'undefined') console.error('[lyric-river]', error);
            return undefined;
        }

        gl.useProgram(program);

        const targets = new Float32Array(COUNT * 3);
        const seeds = new Float32Array(COUNT);
        for (let index = 0; index < COUNT; index += 1) {
            // Bias towards the middle of the band: the sparks belong to the
            // line, and a uniform spread would put most of them out in the
            // margins where there is nothing to light.
            const centred = (Math.random() + Math.random() + Math.random()) / 3;
            targets[index * 3] = (centred * 2 - 1) * SPREAD_X;
            targets[index * 3 + 1] = (Math.random() * 2 - 1) * SPREAD_Y;
            targets[index * 3 + 2] = DEPTH_FROM + Math.random() * (DEPTH_TO - DEPTH_FROM);
            seeds[index] = Math.random() * 100;
        }
        const targetBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, targetBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, targets, gl.STATIC_DRAW);
        const seedBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, seedBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);

        const targetAttrib = gl.getAttribLocation(program, 'aTarget');
        const seedAttrib = gl.getAttribLocation(program, 'aSeed');
        const uTime = gl.getUniformLocation(program, 'uTime');
        const uLevel = gl.getUniformLocation(program, 'uLevel');
        const uBeat = gl.getUniformLocation(program, 'uBeat');
        const uIntensity = gl.getUniformLocation(program, 'uIntensity');
        const uHalf = gl.getUniformLocation(program, 'uHalfViewportX');
        const uTint = gl.getUniformLocation(program, 'uTint');

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

        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.clearColor(0, 0, 0, 0);

        const detector = createBeatDetector();
        let reader = null;
        let level = 0;
        let bass = 0;
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
            const wantLevel = playing ? sample.level : 0.06;
            level += (wantLevel - level) * (wantLevel > level ? 0.25 : 0.05);
            bass += ((playing ? sample.low : 0) - bass) * (sample.low > bass ? 0.35 : 0.06);

            const beat = detector.update(now, bass, playing);
            const rawGain = Number(live.intensity);
            const intensityK = Number.isFinite(rawGain) && rawGain > 0 ? rawGain : 0.85;
            const tint = live.palette && live.palette.accent
                ? live.palette.accent
                : [0.86, 0.36, 0.45];

            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.uniform1f(uTime, now / 1000);
            gl.uniform1f(uLevel, level);
            gl.uniform1f(uBeat, beat.amp);
            gl.uniform1f(uIntensity, intensityK);
            gl.uniform1f(uHalf, canvas.width * 0.5);
            gl.uniform3f(uTint, tint[0], tint[1], tint[2]);

            gl.bindBuffer(gl.ARRAY_BUFFER, targetBuffer);
            gl.enableVertexAttribArray(targetAttrib);
            gl.vertexAttribPointer(targetAttrib, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, seedBuffer);
            gl.enableVertexAttribArray(seedAttrib);
            gl.vertexAttribPointer(seedAttrib, 1, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.POINTS, 0, COUNT);
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
            gl.deleteBuffer(targetBuffer);
            gl.deleteBuffer(seedBuffer);
            gl.deleteProgram(program);
        };
    }, []);

    return (
        <div ref={wrapRef} className={styles.root} aria-hidden="true">
            <canvas ref={canvasRef} className={styles.canvas} />
        </div>
    );
};

export default LyricStarRiver;
