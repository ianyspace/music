/**
 * A readout for the one bug in this app that cannot be seen from the outside.
 *
 * The subject is the beat's `AudioContext`, and the symptom is silence: a media
 * element source replaces the element's own output, so a context that is not
 * running — or that is running and delivering nothing — is a player with no
 * sound, with the progress bar still moving, the element still reporting itself
 * as playing, and not one word in the console. Everything that would tell the
 * two apart is inside the page.
 *
 * It is off unless the URL asks for it, because it is not for visitors:
 *
 *     https://ianyspace.github.io/music/h5/?beatdebug=1
 *
 * What it shows, in one line: the context's state, whether the analyser is
 * reading anything, how long it has read nothing while the element says it is
 * playing, how many nudges have been spent, the level being drawn, and which
 * resource the element is on. Under that, the last few things that happened —
 * a resume the platform accepted, one it refused, a nudge — because the
 * interesting sequence happens while the page is away and has to survive
 * being read after the fact.
 *
 * The box is `pointer-events: none` on purpose: a tap anywhere is the gesture
 * this app needs to get its audio back, and a debug overlay must not be able to
 * eat one.
 */

const LOG_MAX = 7;

const ON = typeof window !== 'undefined'
    && /(^|[?&])beatdebug(=1)?(&|$)/.test(window.location.search);

const started = Date.now();
const log = [];
let fields = null;
let box = null;
let painted = 0;

const render = function () {
    if (!ON) return;
    if (!box) {
        if (!document.body) return;
        box = document.createElement('pre');
        box.id = 'beat-debug';
        box.setAttribute('style', [
            'position:fixed', 'left:6px', 'bottom:6px', 'z-index:2147483647',
            'margin:0', 'padding:6px 8px', 'max-width:calc(100vw - 28px)',
            'background:rgba(0,0,0,.78)', 'color:#7f7',
            'font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace',
            'white-space:pre-wrap', 'border-radius:6px', 'pointer-events:none',
        ].join(';'));
        document.body.appendChild(box);
    }
    const head = fields
        ? Object.keys(fields).map((k) => `${k}=${fields[k]}`).join('  ')
        : 'waiting for the beat…';
    box.textContent = head + (log.length ? '\n' + log.join('\n') : '');
};

const stamp = function () {
    return `+${((Date.now() - started) / 1000).toFixed(1)}s`;
};

/**
 * One frame's worth of state. Called from the beat's frame loop, so it is on
 * the hot path: it only stores the numbers, and repaints at most four times a
 * second — and only while the loop is running, which is exactly when the
 * numbers mean something.
 */
const sample = function (next) {
    if (!ON) return;
    fields = next;
    const now = Date.now();
    if (now - painted < 250) return;
    painted = now;
    render();
};

/** A moment worth keeping: a resume the platform answered, a nudge, a trip to
 *  the background. Kept short — the interesting one is always the last. */
const event = function (message) {
    if (!ON) return;
    log.push(`${stamp()}  ${message}`);
    if (log.length > LOG_MAX) log.shift();
    render();
};

const beatDebug = { on: ON, sample, event };

export default beatDebug;
