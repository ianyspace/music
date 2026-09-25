/**
 * The one Web Audio graph behind the visual effects.
 *
 * Two things here are singletons *by nature*, and the rest of the module is
 * shaped around that:
 *
 * - `createMediaElementSource(el)` may be called **once per media element**.
 *   A second call on the same element throws, and — worse — routing a second
 *   graph to `destination` is how audio ends up playing twice or not at all.
 *   The player mounts exactly one `<audio>` for the life of the page, so this
 *   module keeps the node it built and hands the same one back.
 * - An `AudioContext` starts `suspended` under every browser's autoplay
 *   policy, and only a gesture can start it. So `attach` builds the graph but
 *   `resume` is what actually lets sound through — and it is called from the
 *   same click that starts playback.
 *
 * Nothing here reads the DOM or knows about React: it takes an element, and it
 * answers questions about the numbers the graph produces.
 */

// 2048 samples → 1024 frequency bins, ~21 Hz each at 44.1 kHz. Wide enough
// that the bass bins are their own thing, cheap enough to read every frame.
const FFT_SIZE = 2048;

// How much of the previous frame bleeds into this one, as the analyser's own
// smoothing. Higher is calmer; 0.75 is "the beat is still a beat".
const SMOOTHING = 0.75;

/**
 * Bin ranges, in Hz, for the three bands the visuals ask for. Music lives
 * below ~8 kHz for our purposes: the top bins are nearly always silent, and
 * averaging them in would drag every band towards zero.
 */
const BANDS = {
    low: [20, 250],
    mid: [250, 2000],
    high: [2000, 8000],
};

let context = null;
let sourceNode = null;
let analyserNode = null;
let boundElement = null;
let failed = false;

/**
 * Build the graph for `element`, or return the one already built.
 *
 * `null` means "no visualisation", and callers must treat that as the normal
 * case rather than an error: an old browser, or an element that arrived before
 * the page had one, are both just a page without a spectrum.
 */
export const attachAnalyser = function (element) {
    if (failed || !element || typeof window === 'undefined') return null;
    if (analyserNode) return analyserNode;

    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
        failed = true;
        return null;
    }

    try {
        context = new Ctor();
        sourceNode = context.createMediaElementSource(element);
        analyserNode = context.createAnalyser();
        analyserNode.fftSize = FFT_SIZE;
        analyserNode.smoothingTimeConstant = SMOOTHING;
        sourceNode.connect(analyserNode);
        // The graph has to end at the speakers: `MediaElementSource` takes the
        // element's audio *out of* the normal output path, so without this
        // connecting the analyser would mute the player.
        analyserNode.connect(context.destination);
        boundElement = element;
    } catch (error) {
        // A cross-origin element with no CORS headers is the interesting
        // failure: the graph builds and then feeds the analyser pure silence.
        // Nothing downstream can tell that apart from a quiet track, so the
        // only honest answer is "no analyser at all".
        failed = true;
        context = null;
        sourceNode = null;
        analyserNode = null;
        boundElement = null;
        return null;
    }

    return analyserNode;
};

/** The element this graph is wired to, or `null` before the first `attach`. */
export const analyserElement = function () {
    return boundElement;
};

/**
 * Start the clock. Safe to call on every play: resuming a running context is
 * a no-op, and the promise is swallowed because there is nothing useful to do
 * with a failure here — the next play will try again.
 */
export const resumeAnalyser = function () {
    if (!context || context.state !== 'suspended') return;
    const resumed = context.resume();
    if (resumed && typeof resumed.catch === 'function') resumed.catch(() => {});
};

/**
 * A reusable buffer for {@link readBands}, so the per-frame read allocates
 * nothing. One per consumer: two readers sharing a buffer would each see the
 * other's frame.
 */
export const createBandReader = function (analyser) {
    return {
        analyser,
        bins: new Uint8Array(analyser ? analyser.frequencyBinCount : 0),
        sample: { low: 0, mid: 0, high: 0, level: 0 },
    };
};

const binIndex = function (hz, sampleRate, binCount) {
    return Math.min(binCount - 1, Math.max(0, Math.round((hz / (sampleRate / 2)) * binCount)));
};

const averageRange = function (bins, from, to) {
    if (to <= from) return 0;
    let total = 0;
    for (let index = from; index < to; index += 1) total += bins[index];
    return total / (to - from) / 255;
};

/**
 * Fill `reader.sample` with this frame's three bands, each 0–1.
 *
 * `level` is the whole spectrum's average, i.e. loudness rather than the bass
 * — the thing that should move *everything* on a chorus and barely twitch on
 * a quiet intro.
 */
export const readBands = function (reader) {
    const sample = reader.sample;
    if (!reader.analyser) {
        sample.low = 0;
        sample.mid = 0;
        sample.high = 0;
        sample.level = 0;
        return sample;
    }

    reader.analyser.getByteFrequencyData(reader.bins);

    const binCount = reader.bins.length;
    const sampleRate = context ? context.sampleRate : 44100;
    const lowFrom = binIndex(BANDS.low[0], sampleRate, binCount);
    const lowTo = binIndex(BANDS.low[1], sampleRate, binCount);
    const midTo = binIndex(BANDS.mid[1], sampleRate, binCount);
    const highTo = binIndex(BANDS.high[1], sampleRate, binCount);

    sample.low = averageRange(reader.bins, lowFrom, lowTo);
    sample.mid = averageRange(reader.bins, lowTo, midTo);
    sample.high = averageRange(reader.bins, midTo, highTo);
    sample.level = averageRange(reader.bins, 0, highTo);

    return sample;
};
