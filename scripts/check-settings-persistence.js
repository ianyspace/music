#!/usr/bin/env node
/**
 * Inventory guard for the visitor's settings.
 *
 * Every preference the app exposes lives under `music:setting:*`, and each one
 * has the same two obligations: it is read once when the app opens, and it is
 * written whenever it changes. Getting either half wrong fails *silently* — the
 * control still flips, the UI still looks right, and the setting simply reverts
 * on the next reload. That is exactly how the playback mode shipped broken: it
 * was plain component state with no storage behind it at all.
 *
 * So this script does not test one feature; it walks the whole inventory:
 *
 *  1. Every `music:setting:*` key declared in shared.js has at least one read
 *     and at least one write somewhere in `components/`. A key added for a new
 *     control and forgotten on one side is caught here.
 *  2. No component writes a `music:setting:*` literal directly. Keys go through
 *     the exported constant, so a typo cannot create a second, parallel key
 *     that nothing ever reads.
 *  3. The keys are namespaced and unique — two features sharing one slot means
 *     the second writer wins and the first control looks broken.
 *  4. The desktop playlist toggle (the newest of them) is exercised for real:
 *     its effect body is lifted out of `DesktopMusic.js` and driven against a
 *     fake localStorage, so "hide the panel, reload, it is still hidden" is an
 *     assertion rather than a hope.
 *
 * Run: node scripts/check-settings-persistence.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const sharedJs = read('components/Music/shared.js');
const deskJs = read('components/Music/DesktopMusic.js');

const componentDir = path.join(root, 'components/Music');
const componentFiles = fs.readdirSync(componentDir)
    .filter((name) => name.endsWith('.js'))
    // `shared.js` is where the keys are declared and where the two accessors
    // live, so it is the one file that is *supposed* to hold the literals and
    // touch localStorage. Everything else has to go through it.
    .filter((name) => name !== 'shared.js')
    .map((name) => ({ name, text: read(`components/Music/${name}`) }));
const components = componentFiles.map((file) => file.text).join('\n');

const results = [];
const check = function (name, condition, detail) {
    results.push({ name, pass: Boolean(condition), detail });
};

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

const bodyAfter = function (text, marker) {
    const at = text.indexOf(marker);
    if (at === -1) return '';
    if (marker.trimEnd().endsWith('{')) return blockOf(text, at + marker.length - 1);
    const open = text.indexOf('{', text.indexOf('(', at + marker.length));
    return open === -1 ? '' : blockOf(text, open);
};

/* --- 1. the inventory --------------------------------------------------- */

// Every exported constant whose value is a `music:setting:*` key.
const declared = [];
const keyPattern = /export const ([A-Z_]+) = '(music:setting:[^']+)'/g;
let match;
while ((match = keyPattern.exec(sharedJs)) !== null) {
    declared.push({ name: match[1], key: match[2] });
}

check('the settings inventory is not empty', declared.length > 0, `${declared.length} keys`);

const seenKeys = new Set();
declared.forEach(({ name, key }) => {
    const short = key.replace('music:setting:', '');
    check(`\`${key}\` is namespaced under music:setting:`,
        key.startsWith('music:setting:') && short.length > 0, key);
    check(`\`${key}\` is declared only once`,
        !seenKeys.has(key), seenKeys.has(key) ? 'duplicate' : 'unique');
    seenKeys.add(key);
});

declared.forEach(({ name, key }) => {
    // Reads go through `storageGet` for scalar preferences and `readKeyList` for
    // list preferences; both funnel into the same localStorage slot.
    const readPattern = new RegExp(`(storageGet|readKeyList)\\(${name}\\)`, 'g');
    const writePattern = new RegExp(`(storageSet|writeKeyList)\\(${name}[,)]`, 'g');
    const reads = (components.match(readPattern) || []).length;
    const writes = (components.match(writePattern) || []).length;

    check(`\`${name}\` is read from storage somewhere`,
        reads >= 1, `${reads} read site${reads === 1 ? '' : 's'}`);
    check(`\`${name}\` is written to storage somewhere`,
        writes >= 1, `${writes} write site${writes === 1 ? '' : 's'}`);
    check(`\`${name}\` is imported by a component`,
        new RegExp(`\\b${name},`).test(components), 'imported');
});

/* --- 2. no component invents its own key -------------------------------- */

const strayLiterals = [];
componentFiles.forEach(({ name, text }) => {
    const literals = text.match(/'music:setting:[^']*'/g) || [];
    if (literals.length) strayLiterals.push(`${name}: ${literals.join(', ')}`);
});
check('components never write a settings key as a bare literal',
    strayLiterals.length === 0, strayLiterals.join(' | ') || 'all via the constants');

// The two accessors are the only sanctioned way in and out of localStorage.
const directAccess = [];
componentFiles.forEach(({ name, text }) => {
    const calls = (text.match(/window\.localStorage\.\w+/g) || []);
    if (calls.length) directAccess.push(`${name}: ${calls.join(', ')}`);
});
check('components never touch localStorage directly',
    directAccess.length === 0, directAccess.join(' | ') || 'all via storageGet/storageSet');

/* --- 3. the desktop playlist toggle, driven for real -------------------- */

const DESKTOP_LIST_KEY = (declared.find((entry) => entry.name === 'DESKTOP_LIST_KEY') || {}).key || '';
check('the desktop playlist key exists', Boolean(DESKTOP_LIST_KEY), DESKTOP_LIST_KEY || 'missing');
check('the desktop playlist key does not collide with the playback keys',
    DESKTOP_LIST_KEY !== 'music:setting:shuffle' && DESKTOP_LIST_KEY !== 'music:setting:repeat',
    DESKTOP_LIST_KEY);

check('the desktop panel defaults to open',
    /const \[listOpen, setListOpen\] = useState\(true\)/.test(deskJs), 'useState(true)');
check('the desktop layout imports the key',
    /DESKTOP_LIST_KEY,/.test(deskJs), 'imported');
check('the desktop layout imports the storage helpers',
    /storageGet,/.test(deskJs) && /storageSet,/.test(deskJs), 'imported');

const effectBody = bodyAfter(deskJs, 'const listPrefSyncedRef = useRef(false);');
check('the desktop panel effect was located', Boolean(effectBody), 'body extracted');
check('the effect re-runs when the panel is toggled',
    /const listPrefSyncedRef = useRef\(false\);[\s\S]{0,1600}\}, \[listOpen\]\)/.test(deskJs),
    '[listOpen] deps');
check('the effect is guarded by a ref so its first run is a read, not a write',
    /if \(!listPrefSyncedRef\.current\) \{/.test(effectBody), 'ref guard');
check('the read branch returns before the write branch',
    effectBody.indexOf('if (!listPrefSyncedRef.current)') < effectBody.indexOf('storageSet('),
    'read precedes write');

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

const runEffect = function (seed, state, ref) {
    const env = makeStore(seed);
    const calls = [];
    const factory = new Function(
        'storageGet', 'storageSet', 'setListOpen', 'DESKTOP_LIST_KEY', 'listPrefSyncedRef', 'listOpen',
        `return function () ${effectBody};`
    );
    factory(
        env.storageGet, env.storageSet,
        (value) => calls.push(value),
        DESKTOP_LIST_KEY, ref, state.listOpen
    )();
    return { calls, store: env.store };
};

const freshRef = () => ({ current: false });
const usedRef = () => ({ current: true });

let run = runEffect({ [DESKTOP_LIST_KEY]: 'off' }, { listOpen: true }, freshRef());
check('a reload restores a hidden panel',
    run.calls.length === 1 && run.calls[0] === false, JSON.stringify(run.calls));
check('restoring writes nothing back over what was just read',
    run.store.get(DESKTOP_LIST_KEY) === 'off', String(run.store.get(DESKTOP_LIST_KEY)));

run = runEffect({ [DESKTOP_LIST_KEY]: 'on' }, { listOpen: false }, freshRef());
check('a reload restores a shown panel',
    run.calls.length === 1 && run.calls[0] === true, JSON.stringify(run.calls));

run = runEffect({}, { listOpen: true }, freshRef());
check('a first visit keeps the default and writes nothing',
    run.calls.length === 0 && run.store.size === 0, `${run.calls.length} calls, ${run.store.size} keys`);

run = runEffect({ [DESKTOP_LIST_KEY]: 'yes' }, { listOpen: true }, freshRef());
check('an unrecognised value leaves the default in place',
    run.calls.length === 0, JSON.stringify(run.calls));

run = runEffect({}, { listOpen: false }, usedRef());
check('hiding the panel stores the string "off"',
    run.store.get(DESKTOP_LIST_KEY) === 'off', JSON.stringify(run.store.get(DESKTOP_LIST_KEY)));
run = runEffect({}, { listOpen: true }, usedRef());
check('showing the panel stores the string "on"',
    run.store.get(DESKTOP_LIST_KEY) === 'on', JSON.stringify(run.store.get(DESKTOP_LIST_KEY)));

const roundTrip = function (listOpen) {
    const written = runEffect({}, { listOpen }, usedRef()).store;
    const seed = {};
    written.forEach((value, key) => { seed[key] = value; });
    const back = runEffect(seed, { listOpen: !listOpen }, freshRef()).calls;
    return back.length === 1 && back[0] === listOpen;
};
check('显示中 survives a reload', roundTrip(true), 'on');
check('已隐藏 survives a reload', roundTrip(false), 'off');

check('the toggle is reachable from the settings drawer',
    /aria-label=\{listOpen \? '隐藏列表' : '显示列表'\}/.test(deskJs), 'rail button labelled');
check('the toggle reports its state in the drawer',
    /listOpen \? '显示中' : '已隐藏'/.test(deskJs), 'row value');

/* --- report ------------------------------------------------------------- */

let failed = 0;
results.forEach((r) => {
    if (!r.pass) failed += 1;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
});
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
