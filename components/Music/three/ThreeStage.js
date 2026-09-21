import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { createStage } from './scene';
import { IconCube } from './icons';

import styles from './ThreeApp.module.scss';

/**
 * The canvas, the render loop and the pointer.
 *
 * Everything below this file is framework-free (`scene/`), and everything above
 * it is plain DOM (`ThreeHud`). This is the only place the two meet: it owns the
 * host element, drives `frame()` from `requestAnimationFrame`, and turns pointer
 * events into camera moves.
 *
 * Three things are worth knowing about the loop:
 *
 *  - **`delta` is capped.** A background tab, a long paint or a breakpoint in
 *    the debugger all hand back a huge `delta`, and a camera that damps by
 *    `delta` would teleport across the room on the frame after. Clamping to
 *    50ms turns a hitch into a single slow frame instead of a jump.
 *  - **The frame reads a ref, not props.** `frame()` needs the live playback
 *    state, but re-creating the loop on every `timeupdate` (four times a
 *    second) would tear down and rebuild the renderer each time. The state
 *    object goes into a ref that the loop reads.
 *  - **Nothing in here is allowed to throw out of the effect.** A throw in a
 *    mount effect unmounts the whole tree in React 19 — no error boundary, no
 *    message, just the white page behind the app. So both the stage's
 *    construction and every frame are caught, and the page answers with a card
 *    that says what happened instead of disappearing.
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
    const stageRef = useRef(null);
    const stateRef = useRef(state);
    const toggleRef = useRef(onToggleLyrics);
    // `''` = fine. Anything else is shown on the card, verbatim: the browser's
    // own wording ("Error creating WebGL context.") is the most useful thing
    // that can be put in front of someone whose GPU just refused.
    const [failure, setFailure] = useState('');
    // Bumped by the retry button. It is a dependency of the mount effect, so a
    // retry really does build a new renderer rather than re-run the same code
    // path that already failed.
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        stateRef.current = state;
        toggleRef.current = onToggleLyrics;
    });

    const retry = useCallback(() => {
        setFailure('');
        setAttempt((count) => count + 1);
    }, []);

    // --- the renderer, the loop and the pointer ------------------------------
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;

        let raf = 0;
        let dead = false;

        // Declared before the stage so that the context-lost callback can
        // close over it — the stage may outlive this effect only in the sense
        // that it is disposed by the cleanup below, never by `fail`.
        const fail = function (message) {
            if (dead) return;
            dead = true;
            if (raf) cancelAnimationFrame(raf);
            raf = 0;
            setFailure(message);
        };

        let stage;
        try {
            stage = createStage(host, {
                canvasClass: styles.canvas,
                reduced: prefersReducedMotion(),
                onContextLost: () => fail('显卡上下文丢失了，这一帧之后就再也没画出来'),
            });
        } catch (err) {
            setFailure((err && err.message) || '这个浏览器没有可用的 WebGL');
            return undefined;
        }

        stageRef.current = stage;

        const fit = () => stage.resize(host.clientWidth, host.clientHeight);
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(host);

        let last = performance.now();

        const tick = (now) => {
            raf = requestAnimationFrame(tick);
            const delta = Math.min((now - last) / 1000, MAX_DELTA);
            last = now;
            if (delta <= 0) return;
            try {
                stage.frame(delta, stateRef.current);
            } catch (err) {
                // A frame that throws will throw on every frame. Report once
                // and stop, rather than filling the console sixty times a
                // second until the tab is closed.
                fail((err && err.message) || '渲染时出错');
            }
        };
        raf = requestAnimationFrame(tick);

        // A hidden tab keeps its rAF alive in some browsers and throttles it in
        // others; either way there is nothing to look at, so the loop stops.
        // The audio context is deliberately *not* suspended with it: the app's
        // one `<audio>` element is routed through that context (see
        // `scene/analyzer.js`), so suspending it would not stop a visual, it
        // would mute the song — and listening in the background is a thing this
        // app supports (`usePlayer` prefetches the next track for exactly that).
        const onVisibility = () => {
            if (dead) return;
            if (document.hidden) {
                if (raf) cancelAnimationFrame(raf);
                raf = 0;
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

        /** Client coordinates to the normalised pair the scene wants. */
        const toScene = (event) => {
            const rect = host.getBoundingClientRect();
            return {
                x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
                y: -(((event.clientY - rect.top) / rect.height) * 2 - 1),
            };
        };

        const onPointerDown = (event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            // The other half of the reasoning in `onVisibility`: a tap is the
            // one gesture iOS takes a `resume()` from, and this is the surface
            // the visitor taps to start and stop the music.
            stage.analyzer.resume();
            pointerId = event.pointerId;
            lastX = event.clientX;
            lastY = event.clientY;
            travel = 0;
            host.setPointerCapture(event.pointerId);
            const at = toScene(event);
            stage.aim(at.x, at.y);
        };

        const onPointerMove = (event) => {
            // The aim is updated whether or not a button is down: the dust
            // parts around a cursor that is only hovering, which is most of
            // the time.
            const at = toScene(event);
            stage.aim(at.x, at.y);

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

            const at = toScene(event);
            if (stage.pick(at.x, at.y)) toggleRef.current();
        };

        const onPointerLeave = () => {
            stage.aimOff();
        };

        const onWheel = (event) => {
            event.preventDefault();
            stage.dolly(event.deltaY);
        };

        host.addEventListener('pointerdown', onPointerDown);
        host.addEventListener('pointermove', onPointerMove);
        host.addEventListener('pointerup', onPointerUp);
        host.addEventListener('pointercancel', onPointerUp);
        host.addEventListener('pointerleave', onPointerLeave);
        host.addEventListener('wheel', onWheel, { passive: false });

        return () => {
            dead = true;
            if (raf) cancelAnimationFrame(raf);
            document.removeEventListener('visibilitychange', onVisibility);
            host.removeEventListener('pointerdown', onPointerDown);
            host.removeEventListener('pointermove', onPointerMove);
            host.removeEventListener('pointerup', onPointerUp);
            host.removeEventListener('pointercancel', onPointerUp);
            host.removeEventListener('pointerleave', onPointerLeave);
            host.removeEventListener('wheel', onWheel);
            observer.disconnect();
            stage.dispose();
            stageRef.current = null;
        };
    }, [attempt]);

    // --- the cover ----------------------------------------------------------
    const coverUrl = state.coverUrl;
    const coverFallback = state.coverFallback;
    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;
        stage.setCover(coverUrl, coverFallback);
    }, [coverUrl, coverFallback, attempt]);

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
    }, [playing, audioRef, attempt]);

    return (
        <div className={styles.stage} ref={hostRef}>
            {failure && (
                <div className={styles.fallback} role="alert">
                    <span className={styles['fallback-mark']} aria-hidden="true">
                        <IconCube size={18} />
                    </span>
                    <p className={styles['fallback-title']}>3D 场景没能启动</p>
                    <p className={styles['fallback-text']}>
                        浏览器没能拿到 WebGL 上下文，所以这一页画不出东西 ——
                        其余部分都是好的，音乐照样能放。常见原因是「使用硬件加速」被关掉了，
                        或者显卡驱动被浏览器拉黑了。
                    </p>
                    <p className={styles['fallback-detail']}>{failure}</p>
                    <div className={styles['fallback-actions']}>
                        <button type="button" className={styles['fallback-primary']} onClick={retry}>
                            再试一次
                        </button>
                        <Link className={styles['fallback-link']} href="/desktop">
                            回简洁版
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ThreeStage;
