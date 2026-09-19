import React, { useEffect, useRef } from 'react';

import { createStage } from './scene';

import styles from './ThreeApp.module.scss';

/**
 * The canvas, the render loop and the pointer.
 *
 * Everything below this file is framework-free (`scene/`), and everything above
 * it is plain DOM (`ThreeHud`). This is the only place the two meet: it owns the
 * `<canvas>`, drives `frame()` from `requestAnimationFrame`, and turns pointer
 * events into camera moves.
 *
 * Two things are worth knowing about the loop:
 *
 *  - **`delta` is capped.** A background tab, a long paint or a breakpoint in
 *    the debugger all hand back a huge `delta`, and a camera that damps by
 *    `delta` would teleport across the room on the frame after. Clamping to
 *    50ms turns a hitch into a single slow frame instead of a jump.
 *  - **The frame reads a ref, not props.** `frame()` needs the live playback
 *    state, but re-creating the loop on every `timeupdate` (four times a
 *    second) would tear down and rebuild the renderer each time. The state
 *    object goes into a ref that the loop reads.
 */

const MAX_DELTA = 1 / 20;

/** The drag has to travel this far before it stops being a click. */
const DRAG_SLOP = 6;

const prefersReducedMotion = function () {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

const ThreeStage = function ({ state, audioRef, onToggleLyrics }) {
    const hostRef = useRef(null);
    const canvasRef = useRef(null);
    const stageRef = useRef(null);
    const stateRef = useRef(state);
    const toggleRef = useRef(onToggleLyrics);

    useEffect(() => {
        stateRef.current = state;
        toggleRef.current = onToggleLyrics;
    });

    // --- the renderer, the loop and the pointer, once ------------------------
    useEffect(() => {
        const host = hostRef.current;
        const canvas = canvasRef.current;
        if (!host || !canvas) return undefined;

        const stage = createStage(canvas, { reduced: prefersReducedMotion() });
        stageRef.current = stage;

        const fit = () => stage.resize(host.clientWidth, host.clientHeight);
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(host);

        let raf = 0;
        let last = performance.now();

        const tick = (now) => {
            raf = requestAnimationFrame(tick);
            const delta = Math.min((now - last) / 1000, MAX_DELTA);
            last = now;
            if (delta > 0) stage.frame(delta, stateRef.current);
        };
        raf = requestAnimationFrame(tick);

        // A hidden tab keeps its rAF alive in some browsers and throttles it in
        // others; either way there is nothing to look at, so the loop stops and
        // the audio context goes with it.
        const onVisibility = () => {
            if (document.hidden) {
                if (raf) cancelAnimationFrame(raf);
                raf = 0;
                stage.analyzer.suspend();
                return;
            }
            if (!raf) {
                last = performance.now();
                raf = requestAnimationFrame(tick);
                stage.analyzer.resume();
            }
        };
        document.addEventListener('visibilitychange', onVisibility);

        let pointerId = null;
        let lastX = 0;
        let lastY = 0;
        let travel = 0;

        const onPointerDown = (event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            pointerId = event.pointerId;
            lastX = event.clientX;
            lastY = event.clientY;
            travel = 0;
            host.setPointerCapture(event.pointerId);
        };

        const onPointerMove = (event) => {
            if (pointerId === null || event.pointerId !== pointerId) return;
            const dx = event.clientX - lastX;
            const dy = event.clientY - lastY;
            lastX = event.clientX;
            lastY = event.clientY;
            travel += Math.abs(dx) + Math.abs(dy);
            // Below the slop this is still a click; orbiting by a pixel would
            // make every tap on the record nudge the camera.
            if (travel < DRAG_SLOP) return;
            stage.orbit(dx, dy);
        };

        const onPointerUp = (event) => {
            if (pointerId === null || event.pointerId !== pointerId) return;
            if (host.hasPointerCapture(event.pointerId)) {
                host.releasePointerCapture(event.pointerId);
            }
            pointerId = null;
            if (travel >= DRAG_SLOP) return;

            const rect = host.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
            if (stage.pick(x, y)) toggleRef.current();
        };

        const onWheel = (event) => {
            event.preventDefault();
            stage.dolly(event.deltaY);
        };

        host.addEventListener('pointerdown', onPointerDown);
        host.addEventListener('pointermove', onPointerMove);
        host.addEventListener('pointerup', onPointerUp);
        host.addEventListener('pointercancel', onPointerUp);
        host.addEventListener('wheel', onWheel, { passive: false });

        return () => {
            if (raf) cancelAnimationFrame(raf);
            document.removeEventListener('visibilitychange', onVisibility);
            host.removeEventListener('pointerdown', onPointerDown);
            host.removeEventListener('pointermove', onPointerMove);
            host.removeEventListener('pointerup', onPointerUp);
            host.removeEventListener('pointercancel', onPointerUp);
            host.removeEventListener('wheel', onWheel);
            observer.disconnect();
            stage.dispose();
            stageRef.current = null;
        };
    }, []);

    // --- the cover ----------------------------------------------------------
    const coverUrl = state.coverUrl;
    const coverFallback = state.coverFallback;
    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;
        stage.setCover(coverUrl, coverFallback);
    }, [coverUrl, coverFallback]);

    // --- the audio tap ------------------------------------------------------
    // Deferred to the first play on purpose: an `AudioContext` created on page
    // load starts suspended and browsers log a warning about it, and a visitor
    // who never presses play has no use for one.
    const playing = state.playing;
    useEffect(() => {
        const stage = stageRef.current;
        const audio = audioRef && audioRef.current;
        if (!stage || !audio || !playing) return;
        stage.analyzer.attach(audio);
        stage.analyzer.resume();
    }, [playing, audioRef]);

    return (
        <div className={styles.stage} ref={hostRef}>
            <canvas className={styles.canvas} ref={canvasRef} aria-hidden="true" />
        </div>
    );
};

export default ThreeStage;
