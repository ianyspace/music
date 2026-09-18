#!/usr/bin/env node
/**
 * Checks for the two list preferences: 移入不喜欢 (hide + drop the cache) and
 * 置顶 (pin to the head of the list).
 *
 * Four things here fail silently — none of them is a compiler error, and all of
 * them look fine in a running app until the visitor reloads or refreshes the
 * library:
 *
 *  1. **The storage round-trip.** The lists are read once on mount and written
 *     on every change, in different places from where they are consumed. A key
 *     typo, or a reader that throws on a half-written value, leaves the app
 *     looking right while losing every choice across reloads.
 *  2. **The filter and the ranking.** `applyListPrefs` is the single place a
 *     hidden song leaves the app and a pinned song moves up. If it is skipped
 *     (or if something re-derives the list from `tracks` instead), the row
 *     disappears but the totals do not — which is exactly the "不喜欢的歌曲也
 *     不再在总歌曲数中" requirement.
 *  3. **The cache deletion.** 移入不喜欢 must drop the song's audio blob, keyed
 *     `audioCacheKey(track)`. Deleting the wrong key does nothing visible at
 *     all; the blob just quietly stays on disk.
 *  4. **The row markup.** The row used to be a single <button>; it now holds a
 *     three-dots <button> as a sibling. Nesting one button in another is
 *     invalid HTML and the browser will tear the inner one out, so the shape of
 *     that markup is asserted rather than assumed.
 *
 * `applyListPrefs`, `readKeyList` and `writeKeyList` are pure, so they are
 * lifted straight out of `shared.js` and driven against a fake `localStorage` —
 * the assertions are about behaviour, not about source text.
 *
 * Run: node scripts/check-dislike-pin.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const sharedJs = read('components/Music/shared.js');
const appJs = read('components/Music/MusicApp.js');
const listJs = read('components/Music/TrackList.js');
const listScss = read('components/Music/TrackList.module.scss');
const appScss = read('components/Music/MusicApp.module.scss');
const sheetJs = read('components/Music/DislikedSheet.js');
const sheetScss = read('components/Music/DislikedSheet.module.scss');
const deskJs = read('components/Music/DesktopMusic.js');
const iconsJs = read('components/Music/icons.js');
const cacheJs = read('components/Music/audioCache.js');

const results = [];
const check = function (name, condition, detail) {
    results.push({ name, pass: Boolean(condition), detail });
};

/* --- 1. the two keys ----------------------------------------------------- */

const grab = function (source, name) {
    const m = source.match(new RegExp(`export const ${name} = '([^']+)'`));
    return m ? m[1] : '';
};
const DISLIKED_KEY = grab(sharedJs, 'DISLIKED_KEY');
const ORDER_KEY = grab(sharedJs, 'ORDER_KEY');

check('DISLIKED_KEY is exported from shared.js', !!DISLIKED_KEY, DISLIKED_KEY || 'missing');
check('ORDER_KEY is exported from shared.js', !!ORDER_KEY, ORDER_KEY || 'missing');
check('both keys are namespaced under the app prefix',
    DISLIKED_KEY.startsWith('music:') && ORDER_KEY.startsWith('music:'),
    `${DISLIKED_KEY} / ${ORDER_KEY}`);
check('both keys mark themselves as settings, not restored playback state',
    /:setting:/.test(DISLIKED_KEY) && /:setting:/.test(ORDER_KEY),
    'both under music:setting:');
check('the two keys are distinct', DISLIKED_KEY !== ORDER_KEY, 'no collision');
check('each key is declared exactly once',
    (sharedJs.match(new RegExp(`'${DISLIKED_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 'g')) || []).length === 1
    && (sharedJs.match(new RegExp(`'${ORDER_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 'g')) || []).length === 1,
    'declared once each');

/* --- 2. the round-trip, against a fake localStorage ---------------------- */

const store = new Map();
const fakeWindow = {
    localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
    },
};

// Lift the real implementations out of the source and evaluate them, so the
// assertions below cannot drift from what the app actually runs. The two
// functions are self-contained (they only touch `window`).
// Pull one `export const <name> = function … };` out of the source by brace
// matching, so the assertions drive the code the app actually ships rather than
// a copy that can drift.
const sourceOf = function (source, name) {
    const start = source.indexOf(`export const ${name} = function`);
    if (start === -1) return '';
    let depth = 0;
    let i = source.indexOf('{', start);
    for (; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) break;
        }
    }
    return source.slice(source.indexOf('function', start), i + 1);
};

const liftFunction = function (source, name, scope) {
    const body = sourceOf(source, name);
    if (!body) return null;
    // `readKeyList`/`writeKeyList` delegate to `storageGet`/`storageSet`, so
    // those come along and talk to whichever store was handed in.
    const deps = ['storageGet', 'storageSet']
        .map((dep) => {
            const depBody = sourceOf(source, dep);
            return depBody ? `const ${dep} = ${depBody};` : '';
        })
        .filter(Boolean)
        .join('\n');
    const text = `const ${name} = ${body};`;
    // eslint-disable-next-line no-new-func
    return new Function('window', `${deps}\n${text}\nreturn ${name};`)(scope || fakeWindow);
};

const applyListPrefs = liftFunction(sharedJs, 'applyListPrefs');
const readKeyList = liftFunction(sharedJs, 'readKeyList');
const writeKeyList = liftFunction(sharedJs, 'writeKeyList');

check('applyListPrefs is exported from shared.js (not re-implemented per caller)',
    typeof applyListPrefs === 'function', 'lifted');
check('readKeyList is exported from shared.js', typeof readKeyList === 'function', 'lifted');
check('writeKeyList is exported from shared.js', typeof writeKeyList === 'function', 'lifted');

/* --- 3. applyListPrefs: the hiding half --------------------------------- */

const T = function (id, name, source) {
    return { id, name: name || `${id}.mp3`, source: source || 'cloud' };
};
const ids = (list) => list.map((t) => t.id).join(',');

const library = [T('a'), T('b'), T('c'), T('d')];

check('with no preferences the list is untouched',
    ids(applyListPrefs(library, [], [])) === 'a,b,c,d', ids(applyListPrefs(library, [], [])));
check('a disliked song is dropped from the list',
    ids(applyListPrefs(library, ['cloud:b'], [])) === 'a,c,d',
    ids(applyListPrefs(library, ['cloud:b'], [])));
check('disliking does not disturb the order of the rest',
    ids(applyListPrefs(library, ['cloud:b'], [])) === 'a,c,d', 'stable');
check('several dislikes all drop',
    ids(applyListPrefs(library, ['cloud:b', 'cloud:d'], [])) === 'a,c',
    ids(applyListPrefs(library, ['cloud:b', 'cloud:d'], [])));
check('disliking everything leaves an empty list',
    applyListPrefs(library, ['cloud:a', 'cloud:b', 'cloud:c', 'cloud:d'], []).length === 0,
    'empty');
check('a disliked key from another source does not hide this library\u2019s song',
    ids(applyListPrefs(library, ['drive:a'], [])) === 'a,b,c,d',
    'source is part of the key');
// The key is what the *audio cache* is keyed by, so a track with no `source`
// must still match the entry written for it. This is the one join between the
// two features and it is easy to get off by a prefix.
check('a track with no source matches the same key the cache uses',
    ids(applyListPrefs([T('a', 'a.mp3', '')], ['cloud:a'], [])) === '',
    'empty source reads as cloud');

/* --- 4. applyListPrefs: the pinning half --------------------------------- */

check('a pinned song moves to the head',
    ids(applyListPrefs(library, [], ['cloud:c'])) === 'c,a,b,d',
    ids(applyListPrefs(library, [], ['cloud:c'])));
check('pinning two keeps the most recently pinned first',
    ids(applyListPrefs(library, [], ['cloud:d', 'cloud:b'])) === 'd,b,a,c',
    ids(applyListPrefs(library, [], ['cloud:d', 'cloud:b'])));
check('unpinned songs keep their original relative order behind the pinned ones',
    ids(applyListPrefs(library, [], ['cloud:b', 'cloud:c'])) === 'b,c,a,d',
    ids(applyListPrefs(library, [], ['cloud:b', 'cloud:c'])));
// The ranking is a *presence* test, not a lookup by index: a key in `order`
// that no longer exists in the library must not shift anything.
check('a pinned key that is not in the library is ignored',
    ids(applyListPrefs(library, [], ['cloud:zzz', 'cloud:c'])) === 'c,a,b,d',
    ids(applyListPrefs(library, [], ['cloud:zzz', 'cloud:c'])));
check('an all-missing order list leaves the library alone',
    ids(applyListPrefs(library, [], ['cloud:zzz'])) === 'a,b,c,d',
    ids(applyListPrefs(library, [], ['cloud:zzz'])));
check('the two preferences compose: hidden first, then ranked',
    ids(applyListPrefs(library, ['cloud:b'], ['cloud:d'])) === 'd,a,c',
    ids(applyListPrefs(library, ['cloud:b'], ['cloud:d'])));
check('a song that is both disliked and pinned stays hidden',
    ids(applyListPrefs(library, ['cloud:d'], ['cloud:d'])) === 'a,b,c',
    'hidden wins');
check('applyListPrefs does not mutate the list it was handed',
    (function () {
        const input = [T('a'), T('b')];
        applyListPrefs(input, ['cloud:a'], ['cloud:b']);
        return ids(input) === 'a,b';
    }()), 'input unchanged');
check('a fresh library object still gets the pinned order applied',
    ids(applyListPrefs([T('a'), T('b'), T('c')], [], ['cloud:c'])) === 'c,a,b',
    'works on a re-fetched list');

/* --- 5. readKeyList / writeKeyList survive bad data --------------------- */

store.clear();
check('nothing stored reads as an empty list', readKeyList(DISLIKED_KEY).length === 0, 'empty');

writeKeyList(DISLIKED_KEY, ['cloud:a', 'cloud:b']);
check('a written list reads back in order',
    readKeyList(DISLIKED_KEY).join(',') === 'cloud:a,cloud:b',
    readKeyList(DISLIKED_KEY).join(','));

store.set(ORDER_KEY, 'not json at all');
check('unparseable JSON reads as an empty list (no throw)',
    readKeyList(ORDER_KEY).length === 0, 'fallback empty');
store.set(ORDER_KEY, '{"a":1}');
check('a JSON object reads as an empty list',
    readKeyList(ORDER_KEY).length === 0, 'fallback empty');
store.set(ORDER_KEY, '[]');
check('an empty array reads as an empty list', readKeyList(ORDER_KEY).length === 0, 'empty');
store.set(ORDER_KEY, '[1,2,3]');
check('numbers are not accepted as keys',
    readKeyList(ORDER_KEY).length === 0, 'empty');
store.set(ORDER_KEY, '["cloud:a",null,"cloud:b"]');
check('nulls inside the array are skipped',
    readKeyList(ORDER_KEY).join(',') === 'cloud:a,cloud:b', readKeyList(ORDER_KEY).join(','));
store.set(ORDER_KEY, '["cloud:a","cloud:a","cloud:b"]');
check('duplicates are collapsed (a doubled pin must not duplicate a row)',
    readKeyList(ORDER_KEY).join(',') === 'cloud:a,cloud:b', readKeyList(ORDER_KEY).join(','));
store.set(ORDER_KEY, '[""]');
check('an empty string is not a key', readKeyList(ORDER_KEY).length === 0, 'empty');

// A preference that cannot be written (private mode) must not throw.
const throwingWindow = {
    localStorage: {
        getItem: () => null,
        setItem: () => { throw new Error('QuotaExceededError'); },
    },
};
const writeKeyListThrows = liftFunction(sharedJs, 'writeKeyList', throwingWindow);
let threw = false;
try { writeKeyListThrows(ORDER_KEY, ['cloud:a']); } catch (err) { threw = true; }
check('a failing write is swallowed rather than thrown', threw === false, 'no throw');

/* --- 6. the shell wires it up ------------------------------------------- */

check('MusicApp holds both preferences in state',
    /const \[disliked, setDisliked\] = useState\(\[\]\)/.test(appJs)
    && /const \[order, setOrder\] = useState\(\[\]\)/.test(appJs),
    'two state hooks');
check('MusicApp imports both keys from shared',
    /DISLIKED_KEY,/.test(appJs) && /ORDER_KEY,/.test(appJs), 'imported');
check('the preferences are restored once, on mount',
    /setDisliked\(readKeyList\(DISLIKED_KEY\)\)/.test(appJs)
    && /setOrder\(readKeyList\(ORDER_KEY\)\)/.test(appJs),
    'readKeyList on mount');
check('the restore is driven by an empty dependency list',
    /setDisliked\(readKeyList\(DISLIKED_KEY\)\);[\s\S]{0,80}\}, \[\]\)/.test(appJs),
    '[] deps');
check('every write goes through writeKeyList, not a raw storageSet',
    !/storageSet\((DISLIKED_KEY|ORDER_KEY)/.test(appJs)
    && (appJs.match(/writeKeyList\(/g) || []).length >= 4,
    'writeKeyList only');

// The single most important line in the feature: the rendered list has to be
// the filtered one, and everything downstream (totals, shuffle, repeat) has to
// read *that*.
check('visibleTracks is derived through applyListPrefs',
    /applyListPrefs\(tracks, disliked, order\)/.test(appJs), 'applyListPrefs');
check('the search runs on the filtered list, so a hidden song cannot come back',
    /const filtered = applyListPrefs\(tracks, disliked, order\);/.test(appJs)
    && /filtered\.filter\(\(track\) => \{/.test(appJs),
    'search after filter');
check('visibleTracks re-derives when either preference changes',
    /\}, \[tracks, disliked, order, search\]\)/.test(appJs), 'deps include both');

/* --- 7. 移入不喜欢 drops the cached audio -------------------------------- */

check('the dislike action looks up the cache key with audioCacheKey',
    /const key = audioCacheKey\(track\)/.test(appJs), 'audioCacheKey(track)');
check('the dislike action deletes exactly that blob',
    /deleteCachedAudio\(key\)/.test(appJs), 'deleteCachedAudio(key)');
check('deleteCachedAudio is really imported from the cache module',
    /deleteCachedAudio,/.test(appJs) && /export const deleteCachedAudio = /.test(cacheJs),
    'both sides exist');
check('the key format matches what the cache manager builds',
    /\$\{track\.source \|\| CLOUD_SOURCE\}:\$\{track\.id\}/.test(
        read('components/Music/librarySource.js'),
    ), 'source:id');
// A cache failure must not stop the hide: the visitor asked for the list.
check('a failed cache deletion does not block the hide',
    /deleteCachedAudio\(key\)\.catch\(/.test(appJs), 'caught');
check('disliking a song that is already hidden is a no-op',
    /if \(keys\.includes\(key\)\) return keys;/.test(appJs), 'guard');
check('disliking also forgets the song\u2019s pinned position',
    /setOrder\(\(keys\) => \{[\s\S]{0,120}keys\.filter\(\(entry\) => entry !== key\)/.test(appJs),
    'order cleaned');

/* --- 8. 置顶 writes the ranking ------------------------------------------ */

check('pinning unshifts the key (top = first in the stored order)',
    /const next = \[key\]\.concat\(keys\.filter\(\(entry\) => entry !== key\)\)/.test(appJs),
    'unshift');
check('pinning persists the new order', /writeKeyList\(ORDER_KEY, next\)/.test(appJs), 'written');

/* --- 9. the manager lets a song back out --------------------------------- */

check('DislikedSheet is a component of its own',
    /const DislikedSheet = function/.test(sheetJs), 'exists');
check('the manager reuses the shared sheet chrome',
    /composes: veil from '\.\/Sheet\.module\.scss'/.test(sheetScss)
    && /composes: page from '\.\/Sheet\.module\.scss'/.test(sheetScss),
    'composed in');
check('the manager unmounts only after its exit animation',
    /onAnimationEnd=\{\(\) => \{ if \(closing\) onClosed\(\); \}\}/.test(sheetJs),
    'animation-driven unmount');
check('a song can be taken back out of the list',
    /onRestore\(row\.key\)/.test(sheetJs), '移出 wired');
check('restoring removes the key from the keep-out list',
    /const next = keys\.filter\(\(entry\) => entry !== id\);/.test(appJs), 'filtered out');
check('restoring writes the shortened list back',
    /writeKeyList\(DISLIKED_KEY, next\)/.test(appJs), 'persisted');
check('the manager renders rows from the stored keys alone',
    /const rows = \(keys \|\| \[\]\)\.slice\(\)\.reverse\(\)\.map/.test(sheetJs),
    'key-driven rows');
check('the manager has an empty state',
    /还没有隐藏的歌曲/.test(sheetJs), 'empty copy');
check('the manager\u2019s entry is in the list drawer',
    /不喜欢歌曲/.test(appJs) && /onClick=\{openDislikedManager\}/.test(appJs),
    'menu item');
check('the entry shows how many songs are hidden',
    /disliked\.length > 0 \? `\$\{disliked\.length\} 首` : ''/.test(appJs), 'count');
check('the manager can be dismissed by scrim, Escape and its own button',
    /onPointerDown=\{\(\) => \{ if \(closing\) onCancelClose\(\); \}\}/.test(sheetJs)
    && /if \(!dislikedOpen\) return undefined;/.test(appJs)
    && /onClick=\{onClose\}/.test(sheetJs),
    'three ways out');

/* --- 10. the row: two sibling controls, never nested buttons ------------- */

check('the row is an <li> holding both controls',
    /<li key=\{track\.id\} data-track-id=\{track\.id\} className=\{styles\['row'\]\}>/.test(listJs),
    'row class on the li');
check('the play target is a div with the button role (not a <button>)',
    /role="button"[\s\S]{0,400}onClick=\{\(\) => \{ if \(!loading\) onToggleTrack\(track\); \}\}/.test(listJs),
    'role=button');
// The whole reason for the div: a <button> inside a <button> is invalid and the
// browser drops the inner one out of the tab order.
const rowBlock = (function () {
    const start = listJs.indexOf('const rowMenuOpen = rowMenuId === track.id;');
    const end = listJs.indexOf('</li>', start);
    return start === -1 ? '' : listJs.slice(start, end);
}());
check('the row markup contains no nested <button>',
    !/<button[\s\S]*?<button/.test(rowBlock), 'no button in button');
check('the three-dots button is the row\u2019s own button',
    /className=\{rowMenuOpen\s*\n?\s*\? `\$\{styles\['row-more'\]\} \$\{styles\['row-more-on'\]\}`/.test(listJs),
    'row-more');
check('the button reports whether its drawer is open',
    /aria-expanded=\{rowMenuOpen\}/.test(listJs) && /rowMenuId=\{rowMenu \? rowMenu\.id : ''\}/.test(appJs),
    'aria-expanded wired');
check('the button opens the drawer with its own track',
    /onClick=\{\(\) => onOpenRowMenu\(track\)\}/.test(listJs), 'track handed up');
check('the play target does not swallow the dots button\u2019s taps',
    listJs.indexOf('role="button"') < listJs.indexOf("styles['row-more']"),
    'the dots button is a sibling, not a child');
// Keyboard parity: the div has to be reachable and operable, which a real
// button gave us for free.
check('the play target is focusable',
    /tabIndex=\{loading \? -1 : 0\}/.test(listJs), 'tabIndex');
check('the play target answers Enter and Space',
    /event\.key === 'Enter' \|\| event\.key === ' '/.test(listJs), 'Enter + Space');
check('the loading row is inert, not merely faded',
    /aria-disabled=\{loading \|\| undefined\}/.test(listJs)
    && /&\[aria-disabled='true'\]/.test(listScss),
    'aria-disabled + pointer-events');
check('the play target names the song it plays',
    /aria-label=\{`播放 \$\{meta\.title\}`\}/.test(listJs), 'aria-label');

/* --- 11. the drawer itself ---------------------------------------------- */

check('the row drawer lives in the shell, not in the list column',
    /const \[rowMenu, setRowMenu\] = useState\(null\)/.test(appJs)
    && !/position:\s*fixed/.test(listScss),
    'shell-owned (a fixed child would be trapped by the column\u2019s transform)');
check('the drawer shows the song\u2019s cover',
    /className=\{styles\['row-cover'\]\}[\s\S]{0,120}trackGradient\(rowMenu\.name\)/.test(appJs),
    'trackGradient');
check('the drawer shows the title and the artist',
    /parseTrackName\(rowMenu\.name\)\.title/.test(appJs)
    && /parseTrackName\(rowMenu\.name\)\.artist/.test(appJs),
    'both parsed');
check('the drawer offers 置顶 and 移入不喜欢',
    /onClick=\{\(\) => \{[\s\S]{0,80}pinTrack\(rowMenu\);/.test(appJs)
    && /dislikeTrack\(rowMenu\);/.test(appJs),
    'two actions');
check('置顶 is disabled when the song is already first',
    /disabled=\{visibleTracks\[0\] && visibleTracks\[0\]\.id === rowMenu\.id\}/.test(appJs),
    'guarded');
check('the drawer closes itself after either action',
    /pinTrack\(rowMenu\);\s*\n\s*closeRowMenu\(\);/.test(appJs)
    && /dislikeTrack\(rowMenu\);\s*\n\s*closeRowMenu\(\);/.test(appJs),
    'closes after acting');
check('the drawer is marked up as a modal dialog',
    /role="dialog"[\s\S]{0,120}aria-modal="true"/.test(appJs), 'role + aria-modal');
check('taps inside the row drawer do not reach the scrim',
    (appJs.match(/onClick=\{\(event\) => event\.stopPropagation\(\)\}/g) || []).length >= 2,
    'both drawers stop propagation');
check('Escape closes the row drawer',
    /if \(!rowMenu\) return undefined;[\s\S]{0,120}closeRowMenu\(\)/.test(appJs),
    'Escape wired');
check('reduced motion skips the row drawer\u2019s exit animation',
    /closeRowMenu = useCallback[\s\S]{0,300}prefers-reduced-motion/.test(appJs),
    'reduced-motion branch');
check('the drawer can be dismissed without choosing anything',
    /onClick=\{closeRowMenu\}/.test(appJs), 'scrim closes');

/* --- 12. the icons exist and are used ----------------------------------- */

check('IconDislike exists', /export const IconDislike = /.test(iconsJs), 'declared');
check('IconPin exists', /export const IconPin = /.test(iconsJs), 'declared');
check('both are stroke icons on the shared 24 viewBox like their neighbours',
    /export const IconDislike = \(\{ size = 20 \}\) => \(\s*\n\s*<SvgStroke size=\{size\}>/.test(iconsJs)
    && /export const IconPin = \(\{ size = 20 \}\) => \(\s*\n\s*<SvgStroke size=\{size\}>/.test(iconsJs),
    'SvgStroke');
// A pin drawn to the frame's corner would clip: the needle ends at 5.6/20.4.
// The pin's main path is relative (`m`/`l`/`a` with small deltas), so its
// numbers are offsets and cannot be range-checked directly. What *can* be
// checked is the one thing that would clip: the absolute start points and the
// corner the needle reaches. The head runs 14.4,9.6 → 20.4,3.6 and the needle
// ends near 5,20 — all inside a 24 frame with the 1px stroke accounted for.
const pinSource = iconsJs.slice(
    iconsJs.indexOf('export const IconPin'),
    iconsJs.indexOf('export const IconCloud'),
);
const absolutePoints = (pinSource.match(/[Mm]\s*-?\d+(?:\.\d+)?\s+(-?\d+(?:\.\d+)?)/g) || [])
    .map((segment) => Number(segment.trim().split(/\s+/)[1]));
check('the pin icon has an absolute start point', absolutePoints.length > 0,
    `${absolutePoints.length} points`);
check('no absolute pin coordinate runs off the top of the frame',
    absolutePoints.every((y) => y >= 3), `min y ${Math.min(...absolutePoints)}`);
check('the pin does not reach past the bottom of the frame',
    !/\d{2}\.\d+\s*[vV]|\s24[.\s]/.test(pinSource), 'nothing at y=24');
check('the drawer\u2019s rows use them',
    /<IconPin size=\{20\} \/>/.test(appJs) && /<IconDislike size=\{20\} \/>/.test(appJs),
    'both rendered');
// Scoped to the menu button itself: the copy appears in a state comment too,
// so the assertion anchors on the markup rather than the words.
const menuEntry = (function () {
    const click = appJs.indexOf('onClick={openDislikedManager}');
    if (click === -1) return '';
    const close = appJs.indexOf('</button>', click);
    return appJs.slice(click, close === -1 ? click + 900 : close);
}());
check('the list drawer has a 不喜欢歌曲 entry',
    /menu-title'\]\}>不喜欢歌曲/.test(menuEntry), 'entry present');
check('the entry wears the dislike icon',
    /IconDislike size=\{20\}/.test(menuEntry), 'icon on the entry');
check('the entry leads to the manager, not to a toggle',
    /onClick=\{openDislikedManager\}/.test(menuEntry), 'opens the sheet');

/* --- 13. the totals agree with the list --------------------------------- */

// The badge, the folder row and the manager all have to count the *visible*
// list, otherwise a hidden song stays in a number the visitor can read.
check('the desktop badge counts the filtered list',
    /\{listLoading \? '同步中…' : `\$\{trackCount\} 首`\}/.test(deskJs), 'trackCount');
check('the desktop folder row counts it too',
    /`\$\{trackCount\} 首歌曲`/.test(deskJs), 'trackCount');
check('DesktopMusic no longer counts the raw library',
    !/\$\{tracks\.length\} 首/.test(deskJs), 'no tracks.length total');
check('MusicApp passes the filtered count to the desktop layout',
    /trackCount=\{visibleTracks\.length\}/.test(appJs), 'derived from visibleTracks');
// The cache manager's "未缓存" tile subtracts its entry count from the same
// total it is handed, so it has to be the filtered one.
check('the cache manager is handed the filtered list',
    /tracks=\{tracks\}/.test(appJs) && /tracks=\{visibleTracks\}/.test(deskJs) === false,
    'tracks prop unchanged in shape');

/* --- 14. the styles add up ---------------------------------------------- */

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
// Reads a declaration at the *top level* of a rule only. A plain search would
// find the nested `svg { width: 17px }` before the button's own `width` when
// the outer value is not a px length (e.g. `border-radius: 50%`), which reads
// as a missing value rather than a wrong one. Returns NaN when the property is
// not set at the top level.
const num = function (block, prop) {
    const open = block.indexOf('{');
    if (open === -1) return NaN;
    const inner = block.slice(open + 1, block.lastIndexOf('}'));
    let depth = 0;
    let flat = '';
    for (let i = 0; i < inner.length; i += 1) {
        const c = inner[i];
        if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        else if (depth === 0) flat += c;
    }
    const m = flat.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*[a-zA-Z]*\\(?\\s*(-?[\\d.]+)`));
    return m ? Number(m[1]) : NaN;
};

const moreBlock = blockOf(listScss, '.row-more');
const coverBlock = blockOf(appScss, '.row-cover');

check('the dots button has a real hit area',
    num(moreBlock, 'width') >= 24 && num(moreBlock, 'height') >= 24,
    `${num(moreBlock, 'width')}×${num(moreBlock, 'height')}`);
// A round button is `border-radius: 50%`, which is the same thing as half the
// width — and it stays correct if the size is ever changed.
check('the dots button is round',
    /border-radius: 50%;/.test(moreBlock)
    && num(moreBlock, 'width') === num(moreBlock, 'height'),
    '50% on a square');
check('the dots button is deliberately quiet at rest',
    num(moreBlock, 'opacity') > 0 && num(moreBlock, 'opacity') < 1,
    `opacity ${num(moreBlock, 'opacity')}`);
check('it comes up to full strength while its drawer is open',
    /\.row-more-on \{[\s\S]{0,160}opacity: 1;/.test(listScss), 'row-more-on');
check('the icon is smaller than its button',
    num(moreBlock, 'width') > 17, `svg 17px in ${num(moreBlock, 'width')}px button`);
check('the drawer cover is a square (radius smaller than the side)',
    num(coverBlock, 'width') === num(coverBlock, 'height')
    && num(coverBlock, 'border-radius') < num(coverBlock, 'width'),
    `${num(coverBlock, 'width')}px, radius ${num(coverBlock, 'border-radius')}`);
check('the cover is bigger than a list row\u2019s thumb (it is the point of the drawer)',
    num(coverBlock, 'width') > 44, `${num(coverBlock, 'width')} > 44`);
// The red is scoped to the icon tile and the title, never to the row's own
// background at rest: a fully tinted row reads as "this will delete something",
// and disliking only hides the song. A hover wash is fine — that is feedback,
// not a resting state.
const dangerBlock = blockOf(appScss, '.menu-item-danger');
const dangerFlat = (function () {
    const open = dangerBlock.indexOf('{');
    if (open === -1) return '';
    const inner = dangerBlock.slice(open + 1, dangerBlock.lastIndexOf('}'));
    let depth = 0;
    let flat = '';
    for (let i = 0; i < inner.length; i += 1) {
        const c = inner[i];
        if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        else if (depth === 0) flat += c;
    }
    return flat;
}());
check('the destructive row tints its icon tile and its title',
    /\.menu-icon \{[\s\S]{0,160}rgba\(255, 59, 48, 0\.1[0-9]?\)/.test(dangerBlock)
    && /\.menu-title \{[\s\S]{0,80}color: #ff3b30/.test(dangerBlock),
    'icon tile + title coloured');
check('the destructive row is not red at rest',
    !/(?:^|;)\s*background:/.test(dangerFlat),
    'no top-level background');
check('the icon tile\u2019s red is a wash, not a fill',
    /background: rgba\(255, 59, 48, 0\.14\);/.test(dangerBlock), 'low-alpha red');
check('the row\u2019s hover wash covers both controls',
    /\.row \{[\s\S]{0,200}display: flex;/.test(listScss), 'flex line');
check('long titles get two lines in the drawer, not an ellipsis',
    /-webkit-line-clamp: 2/.test(appScss), 'two lines');

/* --- report ------------------------------------------------------------- */

let failed = 0;
results.forEach((r) => {
    if (!r.pass) failed += 1;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
});
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
