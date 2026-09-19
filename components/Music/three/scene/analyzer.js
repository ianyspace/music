import * as THREE from 'three';

/**
 * The beat, for the three things that react to it: the rim of the record, the
 * dust in the air, and the camera's push-in.
 *
 * This is the plain Web Audio API rather than `THREE.Audio`. `THREE.Audio`
 * owns its own playback — it loads a buffer and plays it through an
 * `AudioBufferSourceNode` — and the 3D layout must *not* own playback: the one
 * `<audio>` element in the app belongs to `core/PlayerAudio`, driven by
 * `usePlayer`, and it is the only thing that can play the cached blob, report
 * `timeupdate` and survive a route change. What is wanted here is a tap on
 * that element, and the Web Audio node for a tap is
 * `MediaElementAudioSourceNode`. `THREE.AudioAnalyser` is a thin wrapper over
 * the very same `AnalyserNode`, so nothing is lost by using it directly.
 */

const FFT_SIZE = 512;
const SMOOTHING = 0.72;

/**
 * An `AnalyserNode` gives decibels per frequency bin; a "beat level" wants one
 * number. Bins 1–4 are roughly 86–430 Hz at the usual 44.1kHz with
 * `fftSize: 512`, which is where a kick drum and a bass line live. Bin 0 is
 * skipped on purpose: it carries the DC offset and reads loud on silence.
 */
const BIN_FROM = 1;
const BIN_TO = 5;

/**
 * One media element can only ever be given a source node once — a second
 * `createMediaElementSource` on the same element throws `InvalidStateError`.
 * The 3D stage is mounted and unmounted as the visitor moves between routes,
 * so the graph is kept here, keyed by element, and handed back on remount.
 * Closing the context on unmount is also deliberately not done: the element is
 * still routed through it, and a closed context is silence.
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
    analyser.minDecibels = -84;
    analyser.maxDecibels = -14;

    // A media element source *replaces* the element's own output, so a source
    // that is not wired back to the destination is a player with no sound.
    source.connect(analyser);
    analyser.connect(context.destination);

    return {
        context,
        source,
        analyser,
        data: new Uint8Array(analyser.frequencyBinCount),
    };
};

/**
 * The stand-in, for when the graph could not be built — an unsupported
 * browser, a context that refuses to start, or a second mount that raced the
 * first. It is not an analysis of anything: it is two slow sines at plausible
 * tempos, which is enough to keep the rim and the dust alive. A scene that
 * freezes on every frame because the audio graph failed looks broken; a scene
 * that pulses to a fake 1.3 Hz looks like a visualiser.
 */
const SYNTH = function (t) {
    return 0.24
        + 0.13 * Math.sin(Math.PI * 2 * 1.3 * t)
        + 0.08 * Math.sin(Math.PI * 2 * 2.1 * t + 1.1);
};

export const createAnalyzer = function () {
    let graph = null;
    let synthetic = true;
    let clock = 0;
    let level = 0;

    return {
        /**
         * Taps `audio`. Returns whether real analysis is available, which is
         * only useful for logging — `update` works either way.
         */
        attach(audio) {
            if (!audio) return false;
            try {
                graph = graphs.get(audio) || null;
                if (!graph) {
                    graph = buildGraph(audio);
                    if (!graph) return false;
                    graphs.set(audio, graph);
                }
                synthetic = false;
                return true;
            } catch (err) {
                // Already sourced elsewhere, or the browser said no. The
                // element keeps playing through its own path; only the
                // analysis is lost.
                graph = null;
                synthetic = true;
                return false;
            }
        },

        /** Browsers start a context suspended until a gesture. */
        resume() {
            if (!graph) return;
            if (graph.context.state === 'suspended') graph.context.resume().catch(() => {});
        },

        suspend() {
            if (!graph) return;
            if (graph.context.state === 'running') graph.context.suspend().catch(() => {});
        },

        /**
         * One frame. Returns the level, 0..1, already smoothed — fast to rise,
         * slow to fall, because a kick that snaps to zero between frames reads
         * as a flicker rather than as a hit.
         */
        update(delta, playing) {
            if (!playing) {
                // Decay instead of dropping: the light on the record's edge
                // should dim, not blink out.
                level = THREE.MathUtils.damp(level, 0, 3.4, delta);
                return level;
            }

            let target;
            if (synthetic || !graph) {
                clock += delta;
                target = SYNTH(clock);
            } else {
                graph.analyser.getByteFrequencyData(graph.data);
                let sum = 0;
                for (let i = BIN_FROM; i < BIN_TO; i += 1) sum += graph.data[i];
                target = sum / ((BIN_TO - BIN_FROM) * 255);
                // The bins are linear in amplitude and the eye is not; the
                // curve lifts the quiet half of the range into view without
                // letting a loud master clip the top.
                target = Math.pow(THREE.MathUtils.clamp(target * 1.45, 0, 1), 0.78);
            }

            level = THREE.MathUtils.damp(level, target, target > level ? 26 : 5.5, delta);
            return level;
        },

        get level() {
            return level;
        },

        /** The graph itself is left connected — see `graphs` above. */
        dispose() {
            graph = null;
            synthetic = true;
            level = 0;
        },
    };
};
