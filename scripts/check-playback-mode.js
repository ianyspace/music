#!/usr/bin/env node
/**
 * Checks for the persisted playback mode (shuffle + repeat).
 *
 * The mode is changed by three controls — the phone player's combined cycling
 * button and the wide-screen layout's separate shuffle and repeat buttons — and
 * all three funnel into the same two pieces of state. Two things can therefore
 * break without anything looking wrong:
 *
 *  1. **A control that moves the state without persisting it.** The mode used to
 *     reset to 关闭 on every reload, because nothing wrote it back at all. A
 *     future fourth control that calls `setShuffle` directly would reintroduce
 *     exactly that, one button at a time.
 *  2. **A restore that races the writer.** Restoring on mount and persisting on
 *     change are two effects over the same state; written naively the writer
 *     runs on the mount commit, sees the pre-restore defaults, and stores them
 *     over the visitor's choice. Both effects look correct in isolation.
 *
 * The effect body and the cycling button are lifted out of `MusicApp.js` and
 * driven against a fake `localStorage`, so the assertions are about behaviour —
 * "reload and you get your mode back" — rather than about source text. The text
 * assertions that remain are the ones no behaviour test can reach: key
 * uniqueness, and the set of values each control is allowed to write.
 *
 * Run: node scripts/check-playback-mode.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const sharedJs = read('components/Music/shared.js');
const appJs = read('components/Music/MusicApp.js');

const results = [];
const check = function (name, condition, detail) {
    results.push({ name, pass: Boolean(condition), detail });
};

/* --- helpers ------------------------------------------------------------ */

// Brace-matched slice, so a body containing nested blocks is taken whole.
const blockOf = function (text, openIndex) {
    let depth = 0;
    for (let i = openIndex; i < text.length; i += 1) {
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}') {
            depth -= 1;
            if (depth === 0) return text.slice(openIndex, i + 1);
        }
    }
    return '';
};

/**
 * Lifts the body of the block that follows `marker`.
 *
 * Two shapes are in play: a marker that stops just before a call taking the
 * body as its argument (`useEffect(() => {`), and a marker that already ends
 * with the opening brace (`useCallback(function () {`). The second is why this
 * cannot simply scan for the next `(` — inside the body, `if (shuffle)` would
 * match first and the slice would come back as the `if` block.
 */
const bodyAfter = function (text, marker) {
    const at = text.indexOf(marker);
    if (at === -1) return '';
    if (marker.trimEnd().endsWith('{')) return blockOf(text, at + marker.length - 1);
    const open = text.indexOf('{', text.indexOf('(', at + marker.length));
    return open === -1 ? '' : blockOf(text, open);
};

// A fake localStorage whose two accessors mirror shared.js exactly.
const makeStore = function (seed) {
    const store = new Map(Object.entries(seed || {}));
    return {
        store,
        storageGet: (key) => {
            try { return store.get(key) || ''; } catch (err) { return ''; }
        },
        storageSet: (key, value) => {
            try { store.set(key, String(value)); } catch (err) { /* noop */ }
        },
    };
};

/* --- 1. the keys -------------------------------------------------------- */

const shuffleMatch = sharedJs.match(/export const SHUFFLE_KEY = '([^']+)'/);
const repeatMatch = sharedJs.match(/export const REPEAT_KEY = '([^']+)'/);
const SHUFFLE_KEY = shuffleMatch ? shuffleMatch[1] : '';
const REPEAT_KEY = repeatMatch ? repeatMatch[1] : '';

check('SHUFFLE_KEY is exported from shared.js', shuffleMatch, SHUFFLE_KEY || 'missing');
check('REPEAT_KEY is exported from shared.js', repeatMatch, REPEAT_KEY || 'missing');
check('both keys are namespaced under the app prefix',
    SHUFFLE_KEY.startsWith('music:') && REPEAT_KEY.startsWith('music:'),
    `${SHUFFLE_KEY} / ${REPEAT_KEY}`);
check('both keys mark themselves as settings, not restored playback state',
    /:setting:/.test(SHUFFLE_KEY) && /:setting:/.test(REPEAT_KEY),
    'both carry :setting:');
check('the two keys are distinct', SHUFFLE_KEY !== REPEAT_KEY, 'distinct');

// Every `music:*` key in the project has to be unique, or two features silently
// share one slot and the second writer wins.
const allKeys = (sharedJs.match(/export const [A-Z_]*KEY = '([^']+)'/g) || [])
    .map((line) => line.match(/'([^']+)'/)[1]);
const duplicates = allKeys.filter((key, index) => allKeys.indexOf(key) !== index);
check('no storage key is declared twice anywhere in shared.js',
    duplicates.length === 0, duplicates.join(', ') || 'all unique');
check('the playback keys are not shared with any other feature',
    allKeys.filter((key) => key === SHUFFLE_KEY).length === 1
    && allKeys.filter((key) => key === REPEAT_KEY).length === 1,
    'declared once each');

const modesMatch = sharedJs.match(/export const REPEAT_MODES = \[([^\]]*)\]/);
const REPEAT_MODES = modesMatch
    ? modesMatch[1].split(',').map((part) => part.trim().replace(/^'|'$/g, '')).filter(Boolean)
    : [];
check('REPEAT_MODES is exported as a list', Boolean(modesMatch), REPEAT_MODES.join(', ') || 'missing');
check('REPEAT_MODES holds exactly the three repeat states',
    REPEAT_MODES.length === 3
    && REPEAT_MODES.includes('off') && REPEAT_MODES.includes('all') && REPEAT_MODES.includes('one'),
    REPEAT_MODES.join(', '));

/* --- 2. the shell wires it up ------------------------------------------- */

check('MusicApp imports both keys',
    /SHUFFLE_KEY,/.test(appJs) && /REPEAT_KEY,/.test(appJs), 'imported');
check('MusicApp imports the mode list', /REPEAT_MODES,/.test(appJs), 'imported');
// The mode a visitor gets before they have ever touched the button, read out of
// the source so the behaviour tests below cannot drift from it.
const defaultShuffle = /const \[shuffle, setShuffle\] = useState\(true\)/.test(appJs);
const defaultRepeat = (/const \[repeat, setRepeat\] = useState\('(\w+)'\)/.exec(appJs) || [])[1] || '';
const DEFAULT_STATE = { shuffle: defaultShuffle, repeat: defaultRepeat };

check('shuffle defaults to 随机 (on)',
    defaultShuffle, `useState(${defaultShuffle})`);
check('repeat defaults to off',
    defaultRepeat === 'off', `useState('${defaultRepeat}')`);
check('the default is one of the four modes the button can show',
    REPEAT_MODES.includes(defaultRepeat), `${defaultShuffle ? 'shuffle' : defaultRepeat}`);

check('the mode is read in exactly one place',
    (appJs.match(/storageGet\(SHUFFLE_KEY\)/g) || []).length === 1
    && (appJs.match(/storageGet\(REPEAT_KEY\)/g) || []).length === 1,
    'one reader each');
check('the mode is written in exactly one place',
    (appJs.match(/storageSet\(SHUFFLE_KEY/g) || []).length === 1
    && (appJs.match(/storageSet\(REPEAT_KEY/g) || []).length === 1,
    'one writer each');

/* --- 3. the effect body, lifted and driven ------------------------------ */

const effectBody = bodyAfter(appJs, 'const modeSyncedRef = useRef(false);');
check('the playback effect was located in MusicApp.js', Boolean(effectBody), 'body extracted');
check('the effect re-runs on both pieces of state',
    /const modeSyncedRef = useRef\(false\);[\s\S]{0,1600}\}, \[shuffle, repeat\]\)/.test(appJs),
    '[shuffle, repeat] deps');
check('the effect is guarded by a ref so its first run is a read, not a write',
    /if \(!modeSyncedRef\.current\) \{/.test(effectBody), 'ref guard');
check('the read branch returns before the write branch',
    effectBody.indexOf('if (!modeSyncedRef.current)') < effectBody.indexOf('storageSet('),
    'read precedes write');

/**
 * Runs the real effect body with a given stored state and component state.
 *
 * The body is compiled as a closure over the values it would have had in the
 * component, so `shuffle`/`repeat`/`setShuffle`/`setRepeat` behave as they do
 * there. Returns what it called and what ended up in storage.
 */
const runEffect = function (seed, state, ref) {
    const env = makeStore(seed);
    const calls = [];
    const factory = new Function(
        'storageGet', 'storageSet', 'setShuffle', 'setRepeat',
        'SHUFFLE_KEY', 'REPEAT_KEY', 'REPEAT_MODES', 'modeSyncedRef',
        'shuffle', 'repeat',
        `return function () ${effectBody};`
    );
    factory(
        env.storageGet, env.storageSet,
        (value) => calls.push(['shuffle', value]),
        (value) => calls.push(['repeat', value]),
        SHUFFLE_KEY, REPEAT_KEY, REPEAT_MODES, ref,
        state.shuffle, state.repeat
    )();
    return { calls, store: env.store };
};

const freshRef = () => ({ current: false });
const usedRef = () => ({ current: true });

// (a) a reload must give the visitor their mode back
let run = runEffect({ [SHUFFLE_KEY]: 'on', [REPEAT_KEY]: 'one' }, DEFAULT_STATE, freshRef());
check('a reload restores a stored shuffle',
    run.calls.some(([what, value]) => what === 'shuffle' && value === true), JSON.stringify(run.calls));
check('a reload restores a stored repeat mode',
    run.calls.some(([what, value]) => what === 'repeat' && value === 'one'), JSON.stringify(run.calls));
check('restoring writes nothing back over what was just read',
    run.store.get(SHUFFLE_KEY) === 'on' && run.store.get(REPEAT_KEY) === 'one',
    `${run.store.get(SHUFFLE_KEY)} / ${run.store.get(REPEAT_KEY)}`);

run = runEffect({ [SHUFFLE_KEY]: 'off', [REPEAT_KEY]: 'all' }, DEFAULT_STATE, freshRef());
check('an explicit "off" is restored as off, not treated as absent',
    run.calls.some(([what, value]) => what === 'shuffle' && value === false), JSON.stringify(run.calls));

// (b) "no value saved yet" has to stay a state of its own: nothing written, so
// a visitor who has never touched the button always sees the *current* default
// rather than the one that happened to ship on their first visit.
run = runEffect({}, DEFAULT_STATE, freshRef());
check('a first visit keeps the defaults', run.calls.length === 0, JSON.stringify(run.calls));
check('a first visit writes nothing', run.store.size === 0, `${run.store.size} keys written`);

// (c) a corrupt value must not become a mode nobody chose
run = runEffect({ [SHUFFLE_KEY]: 'yes', [REPEAT_KEY]: 'banana' }, DEFAULT_STATE, freshRef());
check('an unrecognised shuffle value leaves the default in place',
    run.calls.length === 0, JSON.stringify(run.calls));
run = runEffect({ [SHUFFLE_KEY]: 'yes', [REPEAT_KEY]: 'one' }, DEFAULT_STATE, freshRef());
check('one corrupt key does not stop the other from restoring',
    run.calls.length === 1 && run.calls[0][0] === 'repeat' && run.calls[0][1] === 'one',
    JSON.stringify(run.calls));
run = runEffect({ [SHUFFLE_KEY]: 'on', [REPEAT_KEY]: '' }, DEFAULT_STATE, freshRef());
check('an empty repeat value leaves the default in place',
    !run.calls.some(([what]) => what === 'repeat'), JSON.stringify(run.calls));
run = runEffect({ [SHUFFLE_KEY]: 'on', [REPEAT_KEY]: 'shuffle' }, DEFAULT_STATE, freshRef());
check('the phone-only "随机" label is not mistaken for a repeat mode',
    !run.calls.some(([what]) => what === 'repeat'), JSON.stringify(run.calls));

// (d) every later run writes, and writes both keys
run = runEffect({}, { shuffle: true, repeat: 'off' }, usedRef());
check('changing the mode writes the shuffle key',
    run.store.get(SHUFFLE_KEY) === 'on', String(run.store.get(SHUFFLE_KEY)));
check('changing the mode writes the repeat key',
    run.store.get(REPEAT_KEY) === 'off', String(run.store.get(REPEAT_KEY)));
check('shuffle is stored as a semantic string, not a boolean',
    run.store.get(SHUFFLE_KEY) === 'on' || run.store.get(SHUFFLE_KEY) === 'off',
    JSON.stringify(run.store.get(SHUFFLE_KEY)));
run = runEffect({}, { shuffle: false, repeat: 'off' }, usedRef());
check('turning shuffle off stores the string "off"',
    run.store.get(SHUFFLE_KEY) === 'off', JSON.stringify(run.store.get(SHUFFLE_KEY)));
run = runEffect({}, { shuffle: false, repeat: 'one' }, usedRef());
check('repeat stores the mode name, not a flag',
    run.store.get(REPEAT_KEY) === 'one', JSON.stringify(run.store.get(REPEAT_KEY)));

// (e) the round trip: write, then read back with a fresh ref
const roundTrip = function (shuffle, repeat) {
    const written = runEffect({}, { shuffle, repeat }, usedRef()).store;
    const seed = {};
    written.forEach((value, key) => { seed[key] = value; });
    const back = runEffect(seed, DEFAULT_STATE, freshRef()).calls;
    return back.some(([what, value]) => what === 'shuffle' && value === shuffle)
        && back.some(([what, value]) => what === 'repeat' && value === repeat);
};

check('关闭 survives a reload', roundTrip(false, 'off'), 'off + off');
check('列表循环 survives a reload', roundTrip(false, 'all'), 'off + all');
check('单曲循环 survives a reload', roundTrip(false, 'one'), 'off + one');
check('随机 survives a reload', roundTrip(true, 'off'), 'on + off');
check('随机 and 关闭 stay distinguishable once stored',
    runEffect({}, { shuffle: true, repeat: 'off' }, usedRef()).store.get(REPEAT_KEY) === 'off'
    && runEffect({}, { shuffle: false, repeat: 'off' }, usedRef()).store.get(SHUFFLE_KEY) === 'off',
    'only the shuffle key differs');

/* --- 4. every control goes through the effect --------------------------- */

check('the phone player cycles the mode through a callback',
    /const cyclePlaybackMode = useCallback\(function \(\) \{/.test(appJs), 'cyclePlaybackMode');
check('the wide-screen repeat button cycles through a callback',
    /const cycleRepeat = useCallback\(function \(\) \{/.test(appJs), 'cycleRepeat');
check('the wide-screen shuffle button toggles through the setter',
    /onToggleShuffle=\{\(\) => setShuffle\(\(on\) => !on\)\}/.test(appJs), 'setShuffle updater');

// A control writing a repeat value the restore would reject means the setting
// silently fails to survive a reload — the exact class of bug being fixed here.
const repeatArgs = (appJs.match(/setRepeat\([^;]*?\)/g) || []).map((call) => call);
const repeatLiterals = repeatArgs
    .map((call) => (call.match(/'[a-z]+'/g) || []).map((lit) => lit.slice(1, -1)))
    .reduce((all, list) => all.concat(list), []);
const badRepeatValues = repeatLiterals.filter((value) => !REPEAT_MODES.includes(value));
check('every repeat value a control writes is one the restore accepts',
    badRepeatValues.length === 0, badRepeatValues.join(', ') || repeatLiterals.join(', '));
check('all three controls were found',
    repeatArgs.length >= 4, `${repeatArgs.length} setRepeat call sites`);

const shuffleArgs = (appJs.match(/setShuffle\([^;]*?\)/g) || []).join(' ');
check('shuffle is never given a string value',
    !/'/.test(shuffleArgs), shuffleArgs.slice(0, 80) || 'no string literals');

// The four phone modes are the four combinations of the pair, so the cycle has
// to actually visit all four — otherwise a stored pair could mean a mode the
// button cannot show.
const cycleBody = bodyAfter(appJs, 'const cyclePlaybackMode = useCallback(function () {');
check('the phone cycling button was located', Boolean(cycleBody), 'body extracted');

const simulateCycle = function (startShuffle, startRepeat) {
    let shuffle = startShuffle;
    let repeat = startRepeat;
    const seen = [];
    const factory = new Function(
        'setShuffle', 'setRepeat', 'shuffle', 'repeat',
        `return function () ${cycleBody};`
    );
    for (let i = 0; i < 5; i += 1) {
        seen.push(shuffle ? 'shuffle' : repeat);
        factory(
            (value) => { shuffle = typeof value === 'function' ? value(shuffle) : value; },
            (value) => { repeat = typeof value === 'function' ? value(repeat) : value; },
            shuffle, repeat
        )();
    }
    return seen;
};

// The canonical walk, in the order the button documents it.
const CANONICAL = ['off', 'all', 'one', 'shuffle'];
const rotate = function (order, by) { return order.slice(by).concat(order.slice(0, by)); };

// Simulated from the visitor's actual default, so the assertion covers the
// first thing a new visitor sees rather than an arbitrary entry point.
const visited = simulateCycle(DEFAULT_STATE.shuffle, DEFAULT_STATE.repeat);
check('the cycle was simulated from the shipped default',
    visited[0] === (DEFAULT_STATE.shuffle ? 'shuffle' : DEFAULT_STATE.repeat),
    visited[0]);
check('the phone button walks the four modes in the documented cycle',
    rotate(CANONICAL, CANONICAL.indexOf(visited[0])).join(' → ') === visited.slice(0, 4).join(' → '),
    `${visited.slice(0, 4).join(' → ')} (canonical order: ${CANONICAL.join(' → ')})`);
check('the cycle returns to where it started',
    visited[4] === visited[0], `${visited[4]} vs ${visited[0]}`);
check('every mode the cycle produces is one the restore recognises',
    visited.slice(0, 4).every((mode) => mode === 'shuffle' || REPEAT_MODES.includes(mode)),
    visited.slice(0, 4).join(', '));
check('the cycle visits all four modes, none twice',
    new Set(visited.slice(0, 4)).size === 4, visited.slice(0, 4).join(', '));

// ...and each of those four has to survive a reload as itself.
const cycleRoundTrip = visited.slice(0, 4).map((mode) => {
    const shuffle = mode === 'shuffle';
    const repeat = shuffle ? 'off' : mode;
    return roundTrip(shuffle, repeat);
});
check('every one of the four phone modes survives a reload',
    cycleRoundTrip.every(Boolean), cycleRoundTrip.join(', '));

/* --- report ------------------------------------------------------------- */

let failed = 0;
results.forEach((r) => {
    if (!r.pass) failed += 1;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
});
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
