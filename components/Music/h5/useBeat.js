import { useEffect, useRef } from 'react';
import beatDebug from './beatDebug';

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
 *
 * The one thing here that is not a matter of taste is the context's *state*. A
 * media element source replaces the element's own output, so from the moment
 * the element is tapped the song comes out of this context — and a context that
 * is not running is not a missing animation, it is a silent player, for this
 * track and for every track after it, while the progress bar keeps moving. iOS
 * is the reason `ensureRunning` exists: when the page leaves the screen it does
 * not suspend the context, it *interrupts* it, and nothing in the platform ever
 * hands it back.
 *
 * A context that is not running is one way to lose the sound. The other one has
 * no state to read at all — `running`, and silent — and it is the reason
 * `nudge`, `watch` and the second loop below exist. Read `nudge` first.
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
 * The frequency bands, one per rainbow stripe. The analyser's bins are
 * `sampleRate / fftSize` wide (~86 Hz each at 44.1 kHz with `fftSize: 512`),
 * and the split below is roughly logarithmic — wide at the top where music
 * has most of its energy spread, narrow at the bottom where a kick lives.
 * Each band's level is the mean of its bins, through the same 1.25 exponent
 * as the main level. Band 0 is the bass the main `level` already tracks, so
 * the note breathing and the bottom rainbow stripe pulse together.
 */
const BAND_EDGES = [
    [1, 4],      // ~86–344 Hz   kick / bass
    [4, 8],      // ~344–690 Hz
    [8, 16],     // ~0.7–1.4 kHz
    [16, 32],    // ~1.4–2.8 kHz
    [32, 64],    // ~2.8–5.5 kHz
    [64, 128],   // ~5.5–11 kHz
    [128, 220],  // ~11–19 kHz   (headroom below the 256-bin ceiling)
];
const BAND_COUNT = BAND_EDGES.length;
/** The all-rest band vector, handed to `apply` wherever a plain `0` used to
 *  close the loop, so the rainbow and the note always settle together. */
const ZERO_BANDS = new Array(BAND_COUNT).fill(0);

/**
 * One media element can only ever be given a source node once — a second
 * `createMediaElementSource` on the same element throws `InvalidStateError`.
 * The list is unmounted and remounted as the visitor moves between routes, so
 * the graph is kept here, keyed by element, and handed back on remount. Closing
 * the context is also deliberately not done: the element is still routed
 * through it, and a closed context is silence — which is the whole subject of
 * `ensureRunning` below.
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

    // The fastest possible signal that sound just stopped. The loops below
    // can only *poll*: a frame (not while hidden) or a `timeupdate` (up to
    // 250ms later), and then only through `ensureRunning`'s retry cooldown —
    // so the first interruption after a backgrounding could sit silent for
    // up to RETRY_MS before anyone asked for the context back. That wait was
    // the audible gap on the first trip to the background.
    // `statechange` fires the instant the system takes the state away, so
    // `resume()` goes out within milliseconds — and it bypasses the cooldown
    // on purpose: this is the system's own one-shot announcement, not a poll,
    // so the rate limit that exists to protect the audio stack from per-frame
    // spam has nothing to protect it from here. No runaway either way: a
    // rejected `resume()` changes no state (so no repeat event), and a
    // successful one fires this again with `running`, which returns early.
    context.addEventListener('statechange', function () {
        const state = context.state;
        if (state === 'running' || state === 'closed') return;
        context.resume().then(
            () => beatDebug.event('statechange resume -> ' + context.state),
            () => beatDebug.event('statechange resume refused'),
        );
    });

    return {
        context,
        analyser,
        data: new Uint8Array(analyser.frequencyBinCount),
        /** When this context may be asked to resume again. See below. */
        retryAt: 0,
        /** When this graph may be nudged again, and how often it has been. See
         *  `nudge` below — the bookkeeping lives on the graph rather than in a
         *  loop because a nudge restarts the loop, and because there are two
         *  loops: the frame loop on screen and the element's `timeupdate` off
         *  it. Both read and write these, which is what keeps one budget. */
        nudgeAt: 0,
        nudges: 0,
        nudgeSrc: '',
        /** Wall-clock ms at which the graph last started reading nothing, or 0
         *  while it is reading something. The same reasoning as above. */
        quietAt: 0,
    };
};

/** How long before the same context may be asked to resume again. */
const RETRY_MS = 1500;

/**
 * The one thing this hook does that is not about drawing: asking the context to
 * run, and saying whether it is.
 *
 * It is not a nicety and not an optimisation. A media element source *replaces*
 * the element's own output, so from the moment the element is tapped the song
 * comes out of this context — and a context that is not running is silence,
 * while the element reports itself as playing and the progress bar keeps
 * moving. Nothing else in the app knows the context exists, so nothing else can
 * notice, and it does not heal on its own: the next track is routed through the
 * same dead context, which is what "切后台之后第二首没有声音" is.
 *
 * `'suspended'` is the state a browser starts a context in, and the only one a
 * `resume()` was originally written for here. iOS has a second one: when the
 * page leaves the screen — backgrounded, locked, or interrupted by a call —
 * Safari does not suspend the context, it *interrupts* it, and `state` reads
 * `'interrupted'`. No other browser has that state, so a check for
 * `'suspended'` misses exactly the case that matters: play a song, switch away,
 * come back, and the next song is silent. The question asked here is therefore
 * the negative one — anything that is not `'running'` is asked to run — and
 * `'closed'` is the one state that cannot come back.
 *
 * The retry is rate-limited per graph rather than per call site, because this
 * is called once a frame from the loop below and an interruption can last a
 * long time (a phone call), during which a `resume()` per frame would be a
 * rejected promise per frame. A second and a half is short enough that the
 * sound is back before a visitor has finished noticing it was gone, and long
 * enough to be polite to the audio stack.
 */
const ensureRunning = function (graph, now) {
    if (!graph) return false;
    const state = graph.context.state;
    if (state === 'running') return true;
    if (state === 'closed') return false;
    if (now < graph.retryAt) return false;
    graph.retryAt = now + RETRY_MS;
    graph.context.resume().then(
        () => beatDebug.event('resume -> ' + graph.context.state),
        () => beatDebug.event('resume refused'),
    );
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
 * The report that produced this, verbatim: 「切后台自动播放下一首就又没声音了……
 * 但是没声音后我回页面再次暂停，再次播放，然后切后台就再也不出现这个问题了」.
 * So the repair is not a guess — it was demonstrated on the device. All that was
 * missing was doing it without asking the visitor to.
 *
 * It is safe to fire without asking because it only ever fires while the graph
 * is reading nothing, and there are exactly two ways to get there: the context
 * is not running (iOS took it away and has not given it back), or it is running
 * and delivering silence (a source node that came back from an interruption
 * without its audio). In both of those there is no sound to cut off — the gap
 * this makes is inaudible — and while the graph is reading music, it cannot
 * fire at all.
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

/** The 86–430 Hz band's raw sum — and, in the same pass over the byte data,
 *  each rainbow band's mean. Zero is the whole subject of this file's second
 *  half: it is what a source node that has come back without its audio reads,
 *  and it is the only symptom that failure has — no state to check, no promise
 *  to catch, nothing in the console. One `getByteFrequencyData` per frame is
 *  all the analyser gets asked for; the main level and the bands are two
 *  readings of the same buffer, never two calls. */
const readSpectrum = function (graph) {
    graph.analyser.getByteFrequencyData(graph.data);
    const data = graph.data;
    let sum = 0;
    for (let i = BIN_FROM; i < BIN_TO; i += 1) sum += data[i];
    const bands = new Array(BAND_COUNT);
    for (let b = 0; b < BAND_COUNT; b += 1) {
        const [from, to] = BAND_EDGES[b];
        let bandSum = 0;
        for (let i = from; i < to; i += 1) bandSum += data[i];
        bands[b] = Math.pow(Math.min(1, Math.max(0, bandSum / ((to - from) * 255))), 1.25);
    }
    return { sum, bands };
};

/**
 * The repair, in one place, because it has two callers — and it needs both.
 *
 * The frame loop below is the caller while the page is on screen, and it is a
 * good one: a frame is a fine clock, and an interruption is noticed within one
 * of them. But `requestAnimationFrame` does not run at all while the page is
 * off screen, and *that is where the report came from*: a phone in a pocket
 * auto-advances to the next song and the next song comes out silent, with the
 * progress bar moving. Waiting for the visitor to come back and look at the
 * page would be waiting for the one thing that is not happening.
 *
 * So the second caller is the element's own `timeupdate`, which keeps firing
 * about four times a second for as long as there is audio, hidden or not. It
 * is a slower clock, which is why the same `QUIET_MS` is measured against wall
 * time rather than counted in ticks. Both callers read and write the same
 * fields on the graph, so the budget is one budget and the two of them can
 * never double-nudge.
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
    beatDebug.event(
        `nudge ${graph.nudges}/${NUDGE_LIMIT} state=${graph.context.state}`
        + ` quiet=${Math.round(quietMs)}${document.hidden ? ' hidden' : ''}`,
    );
    nudge(audio);
    return 0;
};

/**
 * The stand-in, for when there is no analyser to read — an unsupported browser,
 * an element this hook declined to tap (see the `blob:` guard below), or a
 * context that is not running *right now*. It is not an analysis of anything:
 * it is two slow sines at plausible tempos. A note that sits perfectly still
 * while the music plays looks broken; a note that breathes to a fake 1.3 Hz
 * looks like a visualiser.
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
 * @param apply    called with the main level (0..1) and the per-rainbow-band
 *                 levels (array of BAND_COUNT, 0..1), once a frame while it
 *                 matters. Both come from the same damped pass, so the note
 *                 and the stripes always agree about the moment.
 */
const useBeat = function (audioRef, playing, apply) {
    // Held in refs so a new closure every render cannot restart the loop.
    const applyRef = useRef(apply);
    useEffect(() => { applyRef.current = apply; });

    // `playing` through a ref too. The main effect below used to list `playing`
    // as a dependency, which meant every play/pause tore the loop down and
    // rebuilt it — cancelling the RAF, unbinding `timeupdate`, then re-binding
    // both. That rebuild is silent on screen, but it is the reason the auto-
    // nudge (pause + play to hand the context back its audio) could fail in the
    // background: the nudge's own `pause()` fires `setIsPlaying(false)` which
    // triggers the clean-up that removes the `timeupdate` listener, and by the
    // time the listener is re-bound the `play()` has already come and gone.
    // With `playing` in a ref the loop and its listeners are born once and live
    // for the life of the screen; `playing` is read live inside `tick` and
    // `onBeat` exactly where it was already a branch.
    const playingRef = useRef(playing);
    useEffect(() => { playingRef.current = playing; });

    const levelRef = useRef(0);
    /** The graph the loop below reads, for the listeners that outlive it. */
    const graphRef = useRef(null);
    /** The RAF id, kept on a ref so the wake effect below can restart the loop
     *  without tearing down the one in the main effect. */
    const rafRef = useRef(0);

    /**
     * When `playing` goes from `false` to `true` the loop may be stopped —
     * `tick` halts itself once the note has settled to rest, to keep the cost
     * at zero while nothing is reacting. Something has to ask for the next
     * frame again, and it cannot be the main effect, because that effect does
     * not re-run on `playing` (by design — see `playingRef` above). This is the
     * one thing this effect does: kick the loop. It does not bind listeners,
     * it does not build a graph, it just says "there might be something to
     * draw now."
     */
    const startRef = useRef(function () {});
    useEffect(() => {
        if (playing) startRef.current();
    }, [playing]);

    /**
     * The two moments a context the system took away can be asked back, and
     * neither of them is inside the frame loop.
     *
     * **A tap.** On iOS a `resume()` is only honoured from a user gesture, and
     * the tap that starts a track happens *before* the effect below has run —
     * so this cannot live in that effect. It is attached once, for the life of
     * the screen, and it is the listener that actually gives the sound back:
     * the tap on the next row is inside a gesture, and so is the tap that
     * dismisses a sheet or presses play.
     *
     * **Coming back into view.** `requestAnimationFrame` does not run while the
     * page is hidden, so the loop's own retry cannot be the thing that notices
     * the page is back.
     *
     * Neither listener needs to know whether music is playing: resuming a
     * context with nothing to play costs nothing, and the moment it matters is
     * always the moment a track starts.
     */
    useEffect(() => {
        const wake = function (fresh) {
            const graph = graphRef.current;
            if (!graph) return;
            // A fresh interruption has not waited out the last cooldown, and
            // waiting it out is silence the visitor can hear.
            if (fresh) graph.retryAt = 0;
            ensureRunning(graph, performance.now());
        };
        const onGesture = function () { wake(true); };
        const onVisibility = function () {
            beatDebug.event('visibility ' + document.visibilityState);
            if (document.visibilityState === 'visible') wake(true);
        };

        document.addEventListener('pointerdown', onGesture, { passive: true });
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            document.removeEventListener('pointerdown', onGesture);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, []);

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
            paint(0, ZERO_BANDS);
            return undefined;
        }

        const audio = audioRef && audioRef.current;

        // The graph is built lazily — not on mount, but the first time `tick`
        // sees that something is playing. `playing` is read from the ref so
        // the loop does not have to be torn down and rebuilt on every
        // play/pause (see the note on `playingRef` above).
        //
        // The element plays from an object URL (`usePlayer` downloads the
        // track and mounts the blob), and a blob URL is same-origin by
        // construction. That matters more than it looks: a media element
        // source node fed by a *cross-origin* resource outputs silence —
        // and it does so by replacing the element's own output, so tapping
        // one would not just lose the analysis, it would mute the song. The
        // guard costs one string test and removes that whole class of
        // accident.
        const ensureGraph = function () {
            if (!audio || !/^blob:/.test(audio.currentSrc || audio.src || '')) return null;
            try {
                let g = graphs.get(audio) || null;
                if (!g) {
                    g = buildGraph(audio);
                    if (g) graphs.set(audio, g);
                }
                // Sticky on purpose: an element that has been tapped is tapped
                // for good, and the listeners have to keep working while the
                // player is paused — the tap that resumes it comes before the
                // next `tick`.
                if (g) graphRef.current = g;
                return g;
            } catch (err) {
                // Already sourced elsewhere, or the browser said no. The
                // element keeps playing through its own path; only the
                // analysis is lost.
                return null;
            }
        };

        /**
         * The loop for when there is no frame loop. `requestAnimationFrame` is
         * frozen for a hidden page, so the tick below — and the repair inside
         * it — simply does not run in the background, which is where the report
         * came from: 「切后台自动播放下一首就又没声音了」. A media element's own
         * events do keep firing there, and `timeupdate` is the steady one: about
         * four a second, for as long as there is audio.
         *
         * It is not a second implementation. It asks the same two questions in
         * the same order — is the context running, is the graph reading
         * anything — and hands both answers to the same `watch`, which owns the
         * budget. The only thing it does not do is draw: the mark is not on
         * screen, and `levelRef` is left where the visitor will find it.
         *
         * `graphRef.current` rather than a local, because the listener outlives
         * every render and a paused player is exactly the case where there is
         * no graph in this closure — but there may be one on the ref, built by
         * a previous tick or by the tap that started the track before this
         * effect first ran.
         */
        const onBeat = function () {
            const g = graphRef.current;
            if (!document.hidden || !g) return;
            const now = performance.now();
            // Same shape as the loop's: anything not running reads nothing.
            const live = ensureRunning(g, now);
            // `nudge` (pause + play) is the repair for the one case
            // `ensureRunning` cannot reach: the context *is* running but
            // the source node delivers silence — no state to check, no
            // promise to catch. When the context is *not* running (iOS
            // interrupted it), only `resume()` can bring it back, and a
            // nudge there is just a audible hiccup that fixes nothing.
            // So: only ask `watch` to consider a nudge when the context
            // is live; otherwise pass `quiet=false` to keep the budget
            // untouched and let `ensureRunning` keep retrying.
            watch(g, audio, live ? readSum(g) === 0 : false, now);
        };
        if (audio) {
            audio.addEventListener('timeupdate', onBeat);
            audio.addEventListener('playing', onBeat);
        }

        let raf = 0;
        let last = 0;
        let clock = 0;
        let level = levelRef.current;
        /** Per-band smoothed levels, damped exactly like `level`. Lives in the
         *  closure so the loop owns it; handed to `paint` once a frame. */
        let bands = ZERO_BANDS.slice();
        /** Milliseconds of *playback* in which the graph read nothing, as
         *  `watch` last reported it. It is the readout's copy and nothing else
         *  reads it — the repair keeps its own clock on the graph, because the
         *  hidden half of the page runs `watch` too and this variable does not
         *  exist there. */
        let quietMs = 0;

        /** Let the wake effect restart this loop without owning the RAF id
         *  itself. `start` asks for the next frame if the loop is idle, and
         *  is a no-op if it is already running. */
        const start = function () {
            if (raf) return;
            last = 0;
            raf = window.requestAnimationFrame(tick);
            rafRef.current = raf;
        };
        startRef.current = start;

        const tick = function (now) {
            const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
            last = now;

            const isPlaying = playingRef.current;
            let target = 0;
            let targets = ZERO_BANDS;
            let quiet = true;

            // The graph is built here, not on mount, so it appears the moment
            // something starts playing and survives across play/pause without
            // the loop being rebuilt. `ensureGraph` is idempotent — the WeakMap
            // keeps one graph per element.
            const graph = isPlaying ? ensureGraph() : graphRef.current;

            if (isPlaying) {
                // A context that is not running reads nothing — and reading
                // nothing is also the moment to ask for it back. This is the
                // repair that happens while the page is on screen: an
                // interruption is noticed within a frame, and a `resume()` the
                // system refuses is retried until it stops refusing.
                const live = graph ? ensureRunning(graph, now) : false;
                if (!live) {
                    clock += dt;
                    target = SYNTH(clock);
                    // The synth stands in for the whole analyser, so every
                    // band rides the same fake wave — offset per band so the
                    // stripes still move against each other while it runs.
                    targets = BAND_EDGES.map((edge, b) => SYNTH(clock + b * 0.37));
                } else {
                    const spectrum = readSpectrum(graph);
                    quiet = spectrum.sum === 0;
                    // The bins are linear in amplitude and the eye is not, so
                    // the quiet half of the range is lifted into view. Gently:
                    // the window above has already done the compressing, and a
                    // steep exponent on top of it would leave ordinary music
                    // with nothing to say. (The 1.25 exponent is applied per
                    // band inside `readSpectrum` — same curve, same reason.)
                    target = Math.pow(Math.min(1, Math.max(0, spectrum.sum / ((BIN_TO - BIN_FROM) * 255))), 1.25);
                    targets = spectrum.bands;
                }

                // Asking for the context back is not always enough: the report
                // that produced this hook ends with the visitor doing the
                // repair by hand. So while the element insists it is playing and
                // the graph reads nothing, do what they did.
                quietMs = watch(graph, audio, quiet, now);
            } else {
                quietMs = 0;
            }

            beatDebug.sample({
                state: graph ? graph.context.state : 'none',
                live: Boolean(graph) && !quiet,
                quietMs: Math.round(quietMs),
                nudges: graph ? graph.nudges : 0,
                level: level.toFixed(2),
                paused: audio ? audio.paused : true,
                at: audio ? audio.currentTime.toFixed(1) : '-',
                src: audio ? String(audio.currentSrc).slice(-14) : '-',
            });

            level = damp(level, target, target > level ? RISE : FALL, dt);
            for (let b = 0; b < BAND_COUNT; b += 1) {
                bands[b] = damp(bands[b], targets[b], targets[b] > bands[b] ? RISE : FALL, dt);
            }
            levelRef.current = level;
            paint(level, bands);

            // Paused: settle to rest, then stop. The element stays mounted and
            // the loop costs nothing while there is nothing to react to.
            if (!isPlaying && level < REST) {
                levelRef.current = 0;
                paint(0, ZERO_BANDS);
                raf = 0;
                rafRef.current = 0;
                return;
            }
            raf = window.requestAnimationFrame(tick);
            rafRef.current = raf;
        };

        raf = window.requestAnimationFrame(tick);
        rafRef.current = raf;
        return () => {
            if (raf) window.cancelAnimationFrame(raf);
            rafRef.current = 0;
            if (audio) {
                audio.removeEventListener('timeupdate', onBeat);
                audio.removeEventListener('playing', onBeat);
            }
        };
    }, [audioRef]);
};

export default useBeat;
