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
        /** When this graph may be nudged again, how often it has been, and
         *  which resource it was on when the budget was handed out. See `nudge`
         *  and `watch` below — the bookkeeping lives on the graph rather than in
         *  a loop because a nudge restarts the loop, and because there are two
         *  loops: the stage's frame loop on screen and the element's own
         *  `timeupdate` off it. */
        nudgeAt: 0,
        nudges: 0,
        nudgeSrc: '',
        /** Wall-clock ms at which the graph last started reading nothing, or 0
         *  while it is reading something. */
        quietAt: 0,
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

/** How long the graph may read nothing — or not run at all — while the element
 *  says it is playing, before the element is nudged. See below. */
const QUIET_MS = 3000;
/** How long before the same graph may be nudged again, and how many times it
 *  may be nudged per track. A nudge is a real pause and a real play, and a
 *  repair that fires forever is its own bug. */
const NUDGE_COOLDOWN_MS = 15000;
const NUDGE_LIMIT = 3;

/**
 * What a visitor does by hand when the song goes quiet: pause, then play.
 *
 * Reported from the phone, verbatim: 「切后台自动播放下一首就又没声音了……
 * 但是没声音后我回页面再次暂停，再次播放，然后切后台就再也不出现这个问题了」.
 * So this is not a guess — it was demonstrated on the device, and all that was
 * missing was doing it without asking the visitor to. The 3D stage is on the
 * same wire and goes quiet the same way; there it reads as a frozen glow rather
 * than as a missing beat, which is why it took longer to notice.
 *
 * It is safe to fire without asking because it only ever fires while the graph
 * is reading nothing, and there are exactly two ways to get there: the context
 * is not running (the system took it away and has not given it back), or it is
 * running and delivering silence (a source node that came back from an
 * interruption without its audio). In both of those there is no sound to cut
 * off — the gap this makes is inaudible — and while the graph is reading music
 * it cannot fire at all.
 *
 * `pause()` before `play()` is the whole point: a `play()` on an element that
 * already believes it is playing is a no-op, and it is the re-play that
 * re-asks the platform for the audio route.
 */
const nudge = function (audio) {
    try {
        audio.pause();
        const request = audio.play();
        if (request && typeof request.catch === 'function') request.catch(() => { });
    } catch (err) { /* nothing else left to try */ }
};

/** The 86–430 Hz band's raw sum. Zero is the only symptom the second kind of
 *  silence has — no state to check, no promise to catch, nothing in the
 *  console. */
const readSum = function (graph) {
    graph.analyser.getByteFrequencyData(graph.data);
    let sum = 0;
    for (let i = BIN_FROM; i < BIN_TO; i += 1) sum += graph.data[i];
    return sum;
};

/**
 * The repair, in one place, because it has two callers — and it needs both.
 *
 * `update` below is the caller while the stage is on screen, and it is a good
 * one: a frame is a fine clock. But the frame loop *is* `requestAnimationFrame`,
 * and that does not run at all while the page is off screen — which is exactly
 * where the report came from: a phone in a pocket auto-advances to the next
 * song and the next song comes out silent. So the second caller is the
 * element's own `timeupdate`, which keeps firing about four times a second for
 * as long as there is audio, hidden or not. It is a slower clock, which is why
 * `QUIET_MS` is measured against wall time rather than counted in ticks. Both
 * callers read and write the same fields on the graph, so the budget is one
 * budget and the two of them can never double-nudge.
 *
 * @param quiet whether the graph read nothing on this tick
 * @returns how long the graph has been reading nothing, in ms
 */
const watch = function (graph, audio, quiet, now) {
    if (!graph || !audio) return 0;
    // `ended` as well as `paused`, and not for tidiness: an element that has
    // reached the end of its media reports `paused === false`, so `paused`
    // alone calls a finished song a playing one — and `play()` on an ended
    // element starts it again from the top, which would make this "repair"
    // restart a song that had finished.
    const alive = !audio.paused && !audio.ended && audio.currentTime > 0;
    if (!alive) {
        graph.quietAt = 0;
        return 0;
    }
    // A new track is a new situation, and gets its own budget.
    if (audio.currentSrc !== graph.nudgeSrc) {
        graph.nudgeSrc = audio.currentSrc;
        graph.nudges = 0;
    }
    if (!quiet) {
        graph.quietAt = 0;
        return 0;
    }
    if (!graph.quietAt) {
        graph.quietAt = now;
        return 0;
    }
    const quietMs = now - graph.quietAt;
    if (quietMs < QUIET_MS || graph.nudges >= NUDGE_LIMIT || now < graph.nudgeAt) return quietMs;
    graph.quietAt = 0;
    graph.nudges += 1;
    graph.nudgeAt = now + NUDGE_COOLDOWN_MS;
    nudge(audio);
    return 0;
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
    /** The element being tapped, kept for the heartbeat below — which fires
     *  from an event rather than from a frame, and so outlives the frame loop. */
    let element = null;
    let clock = 0;
    let level = 0;

    /**
     * The loop for when there is no frame loop. `update` below is called from
     * `requestAnimationFrame`, which is frozen for a hidden page — so the repair
     * inside it simply does not run in the background, which is where the
     * report came from: a phone in a pocket auto-advances to the next song and
     * the next song comes out silent. A media element's own events do keep
     * firing there, and `timeupdate` is the steady one: about four a second,
     * for as long as there is audio.
     *
     * It is not a second implementation. It asks the same two questions in the
     * same order — is the context running, is the graph reading anything — and
     * hands both answers to the same `watch`, which owns the budget. The only
     * thing it does not do is draw: the stage is not on screen.
     */
    const onBeat = function () {
        if (!document.hidden || !graph || !element) return;
        const now = performance.now();
        const live = ensureRunning(graph, now);
        watch(graph, element, live ? readSum(graph) === 0 : true, now);
    };
    const listen = function (audio) {
        if (element === audio) return;
        unlisten();
        element = audio;
        element.addEventListener('timeupdate', onBeat);
        element.addEventListener('playing', onBeat);
    };
    const unlisten = function () {
        if (!element) return;
        element.removeEventListener('timeupdate', onBeat);
        element.removeEventListener('playing', onBeat);
        element = null;
    };

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
                listen(audio);
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
            // repair for an interruption the system has not lifted. So does a
            // context that *is* running and delivering silence: there is no
            // state to read there and no promise to catch, and the only symptom
            // is this sum. See `watch`.
            const now = performance.now();
            const live = graph ? ensureRunning(graph, now) : false;
            let target;
            let quiet = true;
            if (!live) {
                clock += delta;
                target = SYNTH(clock);
            } else {
                const sum = readSum(graph);
                quiet = sum === 0;
                // The bins are linear in amplitude and the eye is not; the
                // curve lifts the quiet half of the range into view without
                // letting a loud master clip the top.
                target = Math.pow(
                    THREE.MathUtils.clamp((sum / ((BIN_TO - BIN_FROM) * 255)) * 1.45, 0, 1),
                    0.78,
                );
            }
            watch(graph, element, quiet, now);

            level = THREE.MathUtils.damp(level, target, target > level ? 26 : 5.5, delta);
            return level;
        },

        get level() {
            return level;
        },

        /** The graph itself is left connected — see `graphs` above. The
         *  heartbeat is not: it belongs to this stage, which is going away. */
        dispose() {
            unlisten();
            graph = null;
            level = 0;
        },
    };
};
