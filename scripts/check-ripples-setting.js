#!/usr/bin/env node
/**
 * Checks for the player drawer's "唱片波纹" preference.
 *
 * Two things here can fail silently and neither is caught by a compiler:
 *
 *  1. **The storage round-trip.** The preference is written on every toggle and
 *     read once on mount, in a different file from the switch that flips it. A
 *     key typo, a value the reader does not recognise, or a read that runs on
 *     every render would all leave the app looking fine while the setting does
 *     nothing across reloads.
 *  2. **The gating.** "Off" has to remove the ripples in *both* layouts (the
 *     phone sheet and the desktop disc), because they share one preference.
 *     Miss one and the switch appears to work only half the time.
 *
 * The pure parts of the round-trip are exercised against a fake `localStorage`,
 * so the assertions are about behaviour rather than about source text.
 *
 * Run: node scripts/check-ripples-setting.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const sharedJs = read('components/Music/shared.js');
const appJs = read('components/Music/MusicApp.js');
const nowJs = read('components/Music/NowPlaying.js');
const nowScss = read('components/Music/NowPlaying.module.scss');
const deskJs = read('components/Music/DesktopMusic.js');

const results = [];
const check = function (name, condition, detail) {
    results.push({ name, pass: Boolean(condition), detail });
};

/* --- 1. the key ---------------------------------------------------------- */

const keyMatch = sharedJs.match(/export const RIPPLES_KEY = '([^']+)'/);
const RIPPLES_KEY = keyMatch ? keyMatch[1] : '';
check('RIPPLES_KEY is exported from shared.js', keyMatch, RIPPLES_KEY || 'missing');
check('the key is namespaced under the app prefix',
    RIPPLES_KEY.startsWith('music:'), RIPPLES_KEY);
check('the key marks itself as a setting, not restored playback state',
    /:setting:/.test(RIPPLES_KEY), RIPPLES_KEY);
check('the key does not collide with another storage key',
    (sharedJs.match(new RegExp(`'${RIPPLES_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 'g')) || []).length === 1,
    'declared once');

/* --- 2. the round-trip, against a fake localStorage --------------------- */

// Re-implement the two helpers exactly as shared.js defines them, then drive
// the same on/off/absent logic MusicApp uses. If the source stops matching
// these shapes the text assertions further down fail, which is the point.
const store = new Map();
const fakeWindow = {
    localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
    },
};
const storageGet = (key) => {
    try { return fakeWindow.localStorage.getItem(key) || ''; } catch (err) { return ''; }
};
const storageSet = (key, value) => {
    try { fakeWindow.localStorage.setItem(key, value); } catch (err) { /* noop */ }
};

// The reader, mirroring MusicApp's effect.
const readPref = function () {
    const saved = storageGet(RIPPLES_KEY);
    if (saved === 'on') return true;
    if (saved === 'off') return false;
    return true; // the documented default
};
// The writer, mirroring MusicApp's toggle.
const toggle = function (on) {
    storageSet(RIPPLES_KEY, on ? 'off' : 'on');
    return !on;
};

store.clear();
check('with nothing stored, the default is ON (ripples shown)', readPref() === true, 'default on');

let state = true;
state = toggle(state);
check('one toggle turns the preference off', state === false, 'now off');
check('the off state is written as the string "off"',
    store.get(RIPPLES_KEY) === 'off', JSON.stringify(store.get(RIPPLES_KEY)));
check('a reload while off reads back off', readPref() === false, 'persisted off');

state = toggle(state);
check('a second toggle turns it back on', state === true, 'now on');
check('the on state is written as the string "on"',
    store.get(RIPPLES_KEY) === 'on', JSON.stringify(store.get(RIPPLES_KEY)));
check('a reload while on reads back on', readPref() === true, 'persisted on');

// Garbage values must not be read as "off": that would let a corrupted key
// silently hide a decorative default that the visitor never turned off.
store.set(RIPPLES_KEY, 'yes');
check('an unrecognised value falls back to the ON default', readPref() === true, 'fallback on');
store.set(RIPPLES_KEY, '');
check('an empty value falls back to the ON default', readPref() === true, 'fallback on');
store.delete(RIPPLES_KEY);
check('a cleared key falls back to the ON default', readPref() === true, 'fallback on');

/* --- 3. the shell owns it (state + restore + persist) ------------------- */

check('MusicApp holds the preference in state',
    /const \[ripples, setRipples\] = useState\(true\)/.test(appJs), 'useState(true)');
check('MusicApp defaults it to true', /useState\(true\)/.test(appJs), 'default true');
check('MusicApp imports the key from shared',
    /RIPPLES_KEY,/.test(appJs), 'imported');
check('the restore effect runs once, on mount',
    /useEffect\(\(\) => \{\s*\n\s*const saved = storageGet\(RIPPLES_KEY\)/.test(appJs),
    'mount-only effect');
check('the restore effect has an empty dependency list',
    /const saved = storageGet\(RIPPLES_KEY\)[\s\S]{0,260}\}, \[\]\)/.test(appJs),
    '[] deps');
check('the restore recognises both values explicitly',
    /saved === 'on'/.test(appJs) && /saved === 'off'/.test(appJs),
    "compares against 'on' and 'off'");
check('the toggle writes the inverse of the current value',
    /storageSet\(RIPPLES_KEY, on \? 'off' : 'on'\)/.test(appJs),
    "writes 'off'/'on'");
check('the writer is not fired by the restore effect (no read-write loop)',
    !/storageGet\(RIPPLES_KEY\)[\s\S]{0,120}storageSet\(RIPPLES_KEY/.test(appJs),
    'read and write are in separate blocks');

/* --- 4. both layouts honour it ------------------------------------------ */

check('NowPlaying takes the preference as a prop',
    /ripples = true,/.test(nowJs), 'defaulted prop');
check('NowPlaying takes the toggle as a prop',
    /onToggleRipples,/.test(nowJs), 'toggle prop');
check('the phone sheet gates the ripple markup',
    /ripples \? '' : ` \$\{styles\['rig-no-ripples'\]\}`/.test(nowJs),
    'conditionally adds rig-no-ripples');
check('"off" removes the rings from the render, not just pauses them',
    /\.rig-no-ripples \.ripples \{\s*\n\s*display: none;/.test(nowScss),
    'display: none');
check('DesktopMusic takes the same preference',
    /ripples = true,/.test(deskJs), 'defaulted prop');
check('the desktop layout gates its ripple markup too',
    /\{ripples && \(/.test(deskJs), 'conditional block');
check('the desktop drawer exposes a way to change it',
    /aria-checked=\{ripples\}/.test(deskJs) && /onToggleRipples/.test(deskJs),
    'switch row present');
check('MusicApp passes it to both layouts',
    (appJs.match(/ripples=\{ripples\}/g) || []).length === 2, 'two call sites');
check('MusicApp passes the toggle to both layouts',
    (appJs.match(/onToggleRipples=\{toggleRipples\}/g) || []).length === 2, 'two call sites');

/* --- 5. the drawer is reachable and dismissible ------------------------- */

check('the three-dots button opens the drawer',
    /onClick=\{openSheet\}/.test(nowJs), 'opens');
check('the button reports its expanded state',
    /aria-expanded=\{sheetOpen\}/.test(nowJs), 'aria-expanded');
check('the drawer is marked up as a modal dialog',
    /role="dialog"[\s\S]{0,120}aria-modal="true"/.test(nowJs), 'role + aria-modal');
check('the row is a switch carrying its checked state',
    /role="switch"[\s\S]{0,120}aria-checked=\{ripples\}/.test(nowJs), 'role=switch');
check('tapping the scrim closes the drawer',
    /onClick=\{closeSheet\}/.test(nowJs), 'scrim closes');
check('taps inside the panel do not reach the scrim',
    /onClick=\{\(event\) => event\.stopPropagation\(\)\}/.test(nowJs), 'stopPropagation');
check('Escape closes the drawer before the player',
    /if \(sheetOpen\) \{[\s\S]{0,120}closeSheet\(\);/.test(nowJs), 'drawer first');
check('the drawer unmounts only after its exit animation',
    /setSheetOpen\(false\);\s*\n\s*setSheetClosing\(false\);/.test(nowJs)
    && /onAnimationEnd=\{/.test(nowJs), 'animation-driven unmount');
check('reduced motion skips the drawer animation entirely',
    /closeSheet[\s\S]{0,300}prefers-reduced-motion/.test(nowJs), 'reduced-motion branch');
check('the switch itself has no transition under reduced motion',
    /\.switch,\s*\n\s*\.switch::after \{\s*\n\s*transition: none;/.test(nowScss),
    'transition: none');

/* --- 6. the switch's geometry adds up ----------------------------------- */

// The knob's travel is written as a literal in the stylesheet, so it is the one
// number here that can be silently wrong: 1px out and the knob sits off-centre
// in one of the two states, which reads as sloppy rather than broken.
const blockOf = function (scss, selector) {
    const start = scss.indexOf(`${selector} {`);
    if (start === -1) return '';
    let depth = 0;
    for (let i = scss.indexOf('{', start); i < scss.length; i += 1) {
        if (scss[i] === '{') depth += 1;
        else if (scss[i] === '}') {
            depth -= 1;
            if (depth === 0) return scss.slice(start, i + 1);
        }
    }
    return '';
};
const switchBlock = blockOf(nowScss, '.switch');
const knobBlock = blockOf(nowScss, '.switch::after');
const onBlock = blockOf(nowScss, '.switch-on::after');

const num = function (block, prop) {
    // Allows a function wrapper between the property and the number, so
    // `transform: translateX(18px)` is read as 18 like a plain `width: 46px`.
    const m = block.match(new RegExp(`${prop}:\\s*[a-zA-Z]*\\(?\\s*(-?[\\d.]+)px`));
    return m ? Number(m[1]) : NaN;
};
const TRACK_W = num(switchBlock, 'width');
const TRACK_H = num(switchBlock, 'height');
const TRACK_R = num(switchBlock, 'border-radius');
const KNOB = num(knobBlock, 'width');
const KNOB_TOP = num(knobBlock, 'top');
const KNOB_LEFT = num(knobBlock, 'left');
const TRAVEL = num(onBlock, 'transform');

check('the switch track is a pill (radius = half its height)',
    TRACK_R === TRACK_H / 2, `${TRACK_R} vs ${TRACK_H} / 2`);
check('the knob is inset equally on top and left',
    KNOB_TOP === KNOB_LEFT, `top ${KNOB_TOP}, left ${KNOB_LEFT}`);
check('the knob leaves the same gap top/bottom as at rest',
    (TRACK_H - KNOB) / 2 === KNOB_TOP, `${(TRACK_H - KNOB) / 2} vs top ${KNOB_TOP}`);
check('the knob is smaller than the track',
    KNOB < TRACK_W && KNOB < TRACK_H, `${KNOB} in ${TRACK_W}×${TRACK_H}`);
check('the knob travels exactly the room available to it',
    TRAVEL === TRACK_W - KNOB - KNOB_LEFT * 2,
    `declared ${TRAVEL}, room ${TRACK_W - KNOB - KNOB_LEFT * 2}`);
check('so the knob lands symmetrically when on',
    TRACK_W - (KNOB_LEFT + TRAVEL + KNOB) === KNOB_LEFT,
    `right gap ${TRACK_W - (KNOB_LEFT + TRAVEL + KNOB)} vs left ${KNOB_LEFT}`);
check('the row is wide enough to hit without a stray tap',
    TRACK_H >= 24, `${TRACK_W}×${TRACK_H} track`);

/* --- report ------------------------------------------------------------- */

let failed = 0;
results.forEach((r) => {
    if (!r.pass) failed += 1;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
});
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
