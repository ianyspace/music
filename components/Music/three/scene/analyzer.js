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
 * still routed through it, and a closed context is silence — which is what
 * `ensureRunning` below exists to prevent.
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
        /** When this context may be asked to resume again. See below. */
        retryAt: 0,
    };
};

/** How long before the same context may be asked to resume again. */
const RETRY_MS = 1500;

/**
 * The one thing here that is not about drawing: asking the context to run, and
 * saying whether it is.
 *
 * It is not a nicety. A media element source *replaces* the element's own
 * output, so from the moment the element is tapped the song comes out of this
 * context — and a context that is not running is silence, while the element
 * reports itself as playing. Nothing else in the app knows the context exists,
 * so nothing else can notice.
 *
 * `'suspended'` is the state a browser starts a context in, and the only one a
 * `resume()` was originally written for. iOS has a second one: when the page
 * leaves the screen, Safari does not suspend the context, it *interrupts* it,
 * and `state` reads `'interrupted'`. No other browser has that state, so a
 * check for `'suspended'` misses the case that matters: play a song, switch
 * away, come back, and the next song is silent. The question asked here is the
 * negative one — anything that is not `'running'` is asked to run — and
 * `'closed'` is the one state that cannot come back.
 *
 * The retry is rate-limited per graph because `update` below calls this once a
 * frame, and an interruption can last minutes (a call), during which a
 * `resume()` per frame would be a rejected promise per frame.
 */
const ensureRunning = function (graph, now) {
    if (!graph) return false;
    const state = graph.context.state;
    if (state === 'running') return true;
    if (state === 'closed') return false;
    if (now < graph.retryAt) return false;
    graph.retryAt = now + RETRY_MS;
    graph.context.resume().catch(() => { });
    return false;
};

/**
 * The stand-in, for when there is no analyser to read — an unsupported browser,
 * a graph that could not be built (a second mount that raced the first), or a
 * context that is not running *right now*. It is not an analysis of anything:
 * it is two slow sines at plausible tempos, which is enough to keep the rim and
 * the dust alive. A scene that freezes on every frame because the audio graph
 * failed looks broken; a scene that pulses to a fake 1.3 Hz looks like a
 * visualiser.
 */
const SYNTH = function (t) {
    return 0.24
        + 0.13 * Math.sin(Math.PI * 2 * 1.3 * t)
        + 0.08 * Math.sin(Math.PI * 2 * 2.1 * t + 1.1);
};

export const createAnalyzer = function () {
    let graph = null;
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
                return true;
            } catch (err) {
                // Already sourced elsewhere, or the browser said no. The
                // element keeps playing through its own path; only the
                // analysis is lost.
                graph = null;
                return false;
            }
        },

        /**
         * Asked from a tap, or from the page coming back — the two moments iOS
         * honours a `resume()` — so it is worth an attempt even if the frame
         * loop asked a moment ago.
         */
        resume() {
            if (!graph) return;
            graph.retryAt = 0;
            ensureRunning(graph, performance.now());
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

            // A context that is not running reads nothing — and reading
            // nothing is also the moment to ask for it back, which is the
            // repair for an interruption the system has not lifted.
            const live = graph ? ensureRunning(graph, performance.now()) : false;
            let target;
            if (!live) {
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
            level = 0;
        },
    };
};
