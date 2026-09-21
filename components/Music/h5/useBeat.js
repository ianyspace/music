import { useEffect, useRef } from 'react';

/**
 * The beat, for the one thing on this screen that moves: the note on the app's
 * mark. `playing` says whether there is music; `apply` is handed a level, 0..1,
 * once a frame, and is free to do anything with it — this hook never re-renders
 * anything, because a level that changes sixty times a second is exactly the
 * kind of state React should not be holding.
 *
 * This is the phone's half of what `three/scene/analyzer.js` does for the 3D
 * stage, and it is a copy rather than a shared import on purpose: the three
 * layouts do not import from each other, and the 3D one is written against
 * `THREE.MathUtils`. It reads the same band, and smooths the same way, so the
 * mark and the record's rim react to the same thing at the same moment.
 *
 * It is deliberately *not* a spectrum readout. `AnalyserNode` gives decibels per
 * frequency bin; a note that jumps wants one number, and the number that makes
 * a note jump is the bass. Bins 1–4 are roughly 86–430 Hz at the usual 44.1kHz
 * with `fftSize: 512`, which is where a kick drum and a bass line live. Bin 0 is
 * skipped because it carries the DC offset and reads loud on silence.
 *
 * The decibel window is the one number the 3D stage and this disagree about, and
 * it is not a disagreement about taste: `-84..-14` was picked for a glow that
 * should sit near full whenever anything is playing, and a note that sits near
 * full whenever anything is playing is a note that does not move. A mastered
 * track puts its 86–430 Hz band somewhere around -30 to -12 dBFS, so `-70..-10`
 * is what gives that band the middle of the range instead of the ceiling, and
 * the curve on top of it is gentle for the same reason — the compression is in
 * the window, not in the exponent.
 */

const FFT_SIZE = 512;
const SMOOTHING = 0.72;
const BIN_FROM = 1;
const BIN_TO = 5;
const MIN_DB = -70;
const MAX_DB = -10;
/** Rise fast, fall slowly. A kick that snaps back between frames reads as a
 *  flicker rather than as a hit; a note that floats down reads as broken. */
const RISE = 26;
const FALL = 5.5;
/** Below this the note is at rest, and the loop stops rather than idling. */
const REST = 0.004;

/**
 * One media element can only ever be given a source node once — a second
 * `createMediaElementSource` on the same element throws `InvalidStateError`.
 * The list is unmounted and remounted as the visitor moves between routes, so
 * the graph is kept here, keyed by element, and handed back on remount. Closing
 * the context is also deliberately not done: the element is still routed
 * through it, and a closed context is silence.
 */
const graphs = new WeakMap();

const buildGraph = function (audio) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;

    const context = new Context();
    const source = context.createMediaElementSource(audio);
    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = SMOOTHING;
    analyser.minDecibels = MIN_DB;
    analyser.maxDecibels = MAX_DB;

    // A media element source *replaces* the element's own output, so a source
    // that is not wired back to the destination is a player with no sound.
    source.connect(analyser);
    analyser.connect(context.destination);

    return { context, analyser, data: new Uint8Array(analyser.frequencyBinCount) };
};

/**
 * The stand-in, for when there is no analyser to read — an unsupported browser,
 * a context that refuses to start, or an element this hook declined to tap (see
 * the `blob:` guard in `attach`). It is not an analysis of anything: it is two
 * slow sines at plausible tempos. A note that sits perfectly still while the
 * music plays looks broken; a note that breathes to a fake 1.3 Hz looks like a
 * visualiser.
 */
const SYNTH = function (t) {
    return 0.24
        + 0.13 * Math.sin(Math.PI * 2 * 1.3 * t)
        + 0.08 * Math.sin(Math.PI * 2 * 2.1 * t + 1.1);
};

/** Frame-rate independent approach to a target, the same shape as
 *  `THREE.MathUtils.damp` (which is `lerp` with an exponential time constant). */
const damp = function (from, to, lambda, dt) {
    return from + (to - from) * (1 - Math.exp(-lambda * dt));
};

/**
 * @param audioRef ref to the app's one `<audio>` element
 * @param playing  whether it is playing right now
 * @param apply    called with the level, 0..1, once a frame while it matters
 */
const useBeat = function (audioRef, playing, apply) {
    // Held in refs so a new closure every render cannot restart the loop.
    const applyRef = useRef(apply);
    useEffect(() => { applyRef.current = apply; });

    const levelRef = useRef(0);

    useEffect(() => {
        const paint = function (level) {
            if (applyRef.current) applyRef.current(level);
        };

        // A visitor who has asked the system for less motion did not ask for
        // this. The mark is drawn at rest and nothing else happens.
        if (typeof window === 'undefined'
            || !window.requestAnimationFrame
            || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            levelRef.current = 0;
            paint(0);
            return undefined;
        }

        let graph = null;
        let synthetic = true;

        if (playing) {
            const audio = audioRef && audioRef.current;
            // The element plays from an object URL (`usePlayer` downloads the
            // track and mounts the blob), and a blob URL is same-origin by
            // construction. That matters more than it looks: a media element
            // source node fed by a *cross-origin* resource outputs silence —
            // and it does so by replacing the element's own output, so tapping
            // one would not just lose the analysis, it would mute the song. The
            // guard costs one string test and removes that whole class of
            // accident.
            if (audio && /^blob:/.test(audio.currentSrc || audio.src || '')) {
                try {
                    graph = graphs.get(audio) || null;
                    if (!graph) {
                        graph = buildGraph(audio);
                        if (graph) graphs.set(audio, graph);
                    }
                    synthetic = !graph;
                } catch (err) {
                    // Already sourced elsewhere, or the browser said no. The
                    // element keeps playing through its own path; only the
                    // analysis is lost.
                    graph = null;
                    synthetic = true;
                }
                // Browsers start a context suspended until a gesture; the tap
                // on the row is one, but it may have happened before this
                // effect ran.
                if (graph && graph.context.state === 'suspended') {
                    graph.context.resume().catch(() => { });
                }
            }
        }

        let raf = 0;
        let last = 0;
        let clock = 0;
        let level = levelRef.current;

        const tick = function (now) {
            const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
            last = now;

            let target = 0;
            if (playing) {
                if (synthetic || !graph) {
                    clock += dt;
                    target = SYNTH(clock);
                } else {
                    graph.analyser.getByteFrequencyData(graph.data);
                    let sum = 0;
                    for (let i = BIN_FROM; i < BIN_TO; i += 1) sum += graph.data[i];
                    target = sum / ((BIN_TO - BIN_FROM) * 255);
                    // The bins are linear in amplitude and the eye is not, so
                    // the quiet half of the range is lifted into view. Gently:
                    // the window above has already done the compressing, and a
                    // steep exponent on top of it would leave ordinary music
                    // with nothing to say.
                    target = Math.pow(Math.min(1, Math.max(0, target)), 1.25);
                }
            }

            level = damp(level, target, target > level ? RISE : FALL, dt);
            levelRef.current = level;
            paint(level);

            // Paused: settle to rest, then stop. The element stays mounted and
            // the loop costs nothing while there is nothing to react to.
            if (!playing && level < REST) {
                levelRef.current = 0;
                paint(0);
                raf = 0;
                return;
            }
            raf = window.requestAnimationFrame(tick);
        };

        raf = window.requestAnimationFrame(tick);
        return () => {
            if (raf) window.cancelAnimationFrame(raf);
        };
    }, [audioRef, playing]);
};

export default useBeat;
