import React, { useEffect, useRef } from 'react';

import { createBandReader, readBands } from '../../core/audioAnalyser';

import styles from './ForegroundParticles.module.scss';

/**
 * The foreground veil: a sparse handful of large, faint particles drifting
 * *in front of* the lyrics (PRD v1.2 §6). Together with the background
 * nebula it forms the two canvas layers the lyric DOM sits between — the
 * words are inside the picture, with motes passing over them.
 *
 * Deliberately cheap: ~1,800 points, one draw call, additive blending, no
 * textures. It shares the analyser but not the beat detector — this layer
 * only breathes with loudness and leans with the pointer; the drama belongs
 * to the portrait behind.
 */

const COUNT = 1_800;

const VERTEX_SHADER = `
precision mediump float;

attribute vec3 aTarget;
attribute float aSeed;

uniform float uTime;
uniform float uLevel;
uniform vec2 uParallax;
uniform float uHalfViewportX;

varying float vAlpha;

void main() {
    vec3 pos = aTarget;

    // A slow three-axis drift, each particle on its own phase.
    float s1 = fract(sin(aSeed) * 43758.5453);
    float s2 = fract(sin(aSeed + 1.7) * 43758.5453);
    float s3 = fract(sin(aSeed + 3.3) * 43758.5453);
    pos += vec3(
        sin(uTime * (0.08 + s1 * 0.1) + aSeed * 6.283) * 0.5,
        cos(uTime * (0.06 + s2 * 0.1) + aSeed * 4.712) * 0.4,
        sin(uTime * (0.05 + s3 * 0.1) + aSeed * 3.141) * 0.3
    );

    // Loudness: the veil swells a hair with the music, then rests.
    pos.xy *= 1.0 + uLevel * 0.04;

    // The same virtual-camera turn as the background layer, so both sides of
    // the lyric sheet swing together and the parallax reads as one space.
    float yaw = uParallax.x * 0.16;
    float pitch = uParallax.y * 0.11;
    float cy = cos(yaw);
    float sy = sin(yaw);
    pos = vec3(pos.x * cy + pos.z * sy, pos.y, -pos.x * sy + pos.z * cy);
    float cp = cos(pitch);
    float sp = sin(pitch);
    pos = vec3(pos.x, pos.y * cp - pos.z * sp, pos.y * sp + pos.z * cp);

    float depth = max(pos.z + 3.4, 0.35);
    gl_Position = vec4(
        2.6 * pos.x / depth / uHalfViewportX,
        2.6 * pos.y / depth / uHalfViewportX,
        0.0,
        1.0
    );

    float persp = 2.6 / depth / uHalfViewportX;
    gl_PointSize = clamp((14.0 + s1 * 42.0) * persp * uHalfViewportX * 0.0016, 2.0, 90.0);
    // Near particles are the visible ones; the deep ones fade out entirely.
    vAlpha = 0.05 + 0.09 * clamp(persp * 3.2, 0.0, 1.0) * (0.55 + 0.45 * s2);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;

varying float vAlpha;

void main() {
    float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
    if (d > 1.0) discard;
    float falloff = 1.0 - d * d;
    gl_FragColor = vec4(vec3(0.92, 0.94, 1.0), vAlpha * falloff);
}
`;

/**
 * No props that change per song: this layer is scenery, not data. The loop
 * reads the analyser through a ref so a new track never re-arms it.
 */
const ForegroundParticles = function ({ analyser = null, isPlaying = false }) {
    const canvasRef = useRef(null);
    const wrapRef = useRef(null);
    const liveRef = useRef({ analyser, isPlaying });
    liveRef.current.analyser = analyser;
    liveRef.current.isPlaying = isPlaying;

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
            if (typeof console !== 'undefined') console.error('[veil]', error);
            return undefined;
        }

        gl.useProgram(program);

        // One buffer set: a shallow slab in front of the lyric plane.
        const targets = new Float32Array(COUNT * 3);
        const seeds = new Float32Array(COUNT);
        for (let index = 0; index < COUNT; index += 1) {
            targets[index * 3] = (Math.random() * 2 - 1) * 2.4;
            targets[index * 3 + 1] = (Math.random() * 2 - 1) * 1.5;
            targets[index * 3 + 2] = 0.1 + Math.random() * 1.1;
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
        const uParallax = gl.getUniformLocation(program, 'uParallax');
        const uHalf = gl.getUniformLocation(program, 'uHalfViewportX');

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

        // --- the pointer (same camera target as the nebula) ----------------

        const pointer = { x: 0, y: 0 };
        const eased = { x: 0, y: 0 };
        let lastMove = 0;
        const onPointerMove = function (event) {
            pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
            pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
            lastMove = performance.now();
        };
        window.addEventListener('pointermove', onPointerMove, { passive: true });

        // --- the loop -------------------------------------------------------

        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.clearColor(0, 0, 0, 0);

        let reader = null;
        let level = 0;
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
            const wantLevel = reader && live.analyser && live.isPlaying
                ? readBands(reader).level
                : 0.08;
            level += (wantLevel - level) * (wantLevel > level ? 0.25 : 0.05);

            const idleMs = now - lastMove;
            const cameraGain = idleMs > 2600
                ? Math.max(0, 1 - (idleMs - 2600) / 2200)
                : 1;
            eased.x += (pointer.x * cameraGain - eased.x) * 0.055;
            eased.y += (pointer.y * cameraGain - eased.y) * 0.055;

            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.uniform1f(uTime, now / 1000);
            gl.uniform1f(uLevel, level);
            gl.uniform2f(uParallax, eased.x, eased.y);
            gl.uniform1f(uHalf, canvas.width * 0.5);

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
            window.removeEventListener('pointermove', onPointerMove);
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

export default ForegroundParticles;
