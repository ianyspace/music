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

    return {
        context,
        analyser,
        data: new Uint8Array(analyser.frequencyBinCount),
        /** When this context may be asked to resume again. See below. */
        retryAt: 0,
        /** When this graph may be nudged again, and how often it has been. See
         *  `nudge` below — the bookkeeping lives on the graph rather than in the
         *  loop because a nudge restarts the loop. */
        nudgeAt: 0,
        nudges: 0,
        nudgeSrc: '',
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
 * @param apply    called with the level, 0..1, once a frame while it matters
 */
const useBeat = function (audioRef, playing, apply) {
    // Held in refs so a new closure every render cannot restart the loop.
    const applyRef = useRef(apply);
    useEffect(() => { applyRef.current = apply; });

    const levelRef = useRef(0);
    /** The graph the loop below reads, for the listeners that outlive it. */
    const graphRef = useRef(null);

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
            paint(0);
            return undefined;
        }

        let graph = null;
        // Hoisted out of the branch below: the loop needs the element itself,
        // to tell a player that is playing from one that has only been asked to.
        const audio = audioRef && audioRef.current;

        if (playing) {
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
                } catch (err) {
                    // Already sourced elsewhere, or the browser said no. The
                    // element keeps playing through its own path; only the
                    // analysis is lost.
                    graph = null;
                }
            }
        }
        // Sticky on purpose: an element that has been tapped is tapped for
        // good, and the listeners above have to keep working while the player
        // is paused — the tap that resumes it comes before this effect runs
        // again.
        if (graph) graphRef.current = graph;

        // Browsers start a context suspended until a gesture, and iOS hands one
        // back from an interruption in the same state. The tap that started
        // this track is the gesture both of them want, and this is the first
        // moment there is a context to ask.
        if (graph) ensureRunning(graph, performance.now());

        let raf = 0;
        let last = 0;
        let clock = 0;
        let level = levelRef.current;
        /** Milliseconds of *playback* in which the graph read nothing. Reset by
         *  any sound, and by a pause — a stopped player is not a broken one. */
        let quietMs = 0;

        const tick = function (now) {
            const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
            last = now;

            let target = 0;
            let quiet = true;
            if (playing) {
                // A context that is not running reads nothing — and reading
                // nothing is also the moment to ask for it back. This is the
                // repair that happens while the page is on screen: an
                // interruption is noticed within a frame, and a `resume()` the
                // system refuses is retried until it stops refusing.
                const live = graph ? ensureRunning(graph, now) : false;
                if (!live) {
                    clock += dt;
                    target = SYNTH(clock);
                } else {
                    graph.analyser.getByteFrequencyData(graph.data);
                    let sum = 0;
                    for (let i = BIN_FROM; i < BIN_TO; i += 1) sum += graph.data[i];
                    quiet = sum === 0;
                    target = sum / ((BIN_TO - BIN_FROM) * 255);
                    // The bins are linear in amplitude and the eye is not, so
                    // the quiet half of the range is lifted into view. Gently:
                    // the window above has already done the compressing, and a
                    // steep exponent on top of it would leave ordinary music
                    // with nothing to say.
                    target = Math.pow(Math.min(1, Math.max(0, target)), 1.25);
                }

                // Asking for the context back is not always enough: the report
                // that produced this hook ends with the visitor doing the
                // repair by hand. So while the element insists it is playing and
                // the graph reads nothing, do what they did.
                const alive = audio && !audio.paused && audio.currentTime > 0;
                if (alive && graph) {
                    // A new track is a new situation, and gets its own budget.
                    if (audio.currentSrc !== graph.nudgeSrc) {
                        graph.nudgeSrc = audio.currentSrc;
                        graph.nudges = 0;
                    }
                    quietMs = quiet ? quietMs + dt * 1000 : 0;
                    if (quietMs >= QUIET_MS
                        && graph.nudges < NUDGE_LIMIT
                        && now >= graph.nudgeAt) {
                        const why = `state=${graph.context.state} quiet=${Math.round(quietMs)}`;
                        quietMs = 0;
                        graph.nudges += 1;
                        graph.nudgeAt = now + NUDGE_COOLDOWN_MS;
                        beatDebug.event(`nudge ${graph.nudges}/${NUDGE_LIMIT} ${why}`);
                        nudge(audio);
                    }
                } else {
                    quietMs = 0;
                }
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
