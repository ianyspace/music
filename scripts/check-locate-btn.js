#!/usr/bin/env node
/**
 * Boundary checks for the mini bar's "jump to the playing track" button.
 *
 * The button is positioned purely by CSS against the bar's box, so there is
 * nothing here to unit-test in the usual sense. What *is* worth locking down
 * is the handful of numbers that have to agree across three files
 * (MiniPlayer.module.scss, TrackList.module.scss, MiniPlayer.js): the bar's
 * width and height, the wrap's centring, the button's insets, and the id used
 * to reach the list from a sibling component. A silent disagreement between
 * any of those puts the button somewhere surprising on a real screen, and no
 * compiler catches it.
 *
 * Run: node scripts/check-locate-btn.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const miniScss = read('components/Music/MiniPlayer.module.scss');
const listScss = read('components/Music/TrackList.module.scss');
const miniJs = read('components/Music/MiniPlayer.js');
const listJs = read('components/Music/TrackList.js');
const appJs = read('components/Music/MusicApp.js');

/**
 * Pulls a rule's declarations out of the stylesheet, stopping at the rule's own
 * closing brace rather than at the first `}` (which is what a plain
 * `\{([^}]*)\}` does — it would cut the block off at the first nested
 * `@media`/`svg` rule). Brace counting is enough here: no string or comment in
 * these files contains an unbalanced brace.
 */
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

const results = [];
const check = function (name, condition, detail) {
    results.push({ name, pass: Boolean(condition), detail });
};

/* --- the bar's own box (the button's containing block) --- */

const wrapWidthMatch = miniScss.match(/\.wrap\s*\{[^}]*width:\s*min\((\d+)px,\s*calc\(100vw - (\d+)px\)\)/);
check('bar width is expressed as min(<n>px, 100vw - <n>px)', wrapWidthMatch,
    wrapWidthMatch ? `${wrapWidthMatch[1]}px / 100vw - ${wrapWidthMatch[2]}px` : 'no match');

const barW = wrapWidthMatch ? Number(wrapWidthMatch[1]) : 0;
const viewportGutter = wrapWidthMatch ? Number(wrapWidthMatch[2]) : 0;
const COLUMN = 480; // `.app` in MusicApp.module.scss
const halfColumn = COLUMN / 2;
// `.wrap` is `left: 50%; transform: translateX(-50%)`, so it is centred on the
// 480px column. It is `min(464px, 100vw - 24px)` wide, i.e. on a viewport
// narrower than 488px the 12px "gutter" on each side shrinks away first and the
// bar stops getting narrower — so the widest the bar ever gets is 464px, and
// (464 / 2 = 232) + 12 <= 240 always holds.
check('bar never exceeds the column at its widest',
    barW <= COLUMN, `${barW} <= ${COLUMN} (the wrap is centred on the column, so
    the 12px "gutter" is inside the column rather than added to it)`);
check('the bar is a centred pill with a 29px corner radius',
    /border-radius:\s*29px/.test(blockOf(miniScss, '.mini')), 'border-radius: 29px');
check('the bar is exactly as tall as the button placement assumes',
    /height:\s*58px/.test(blockOf(miniScss, '.mini')), 'height: 58px');

/* --- the button's placement --- */

const locateBlock = blockOf(miniScss, '.locate-btn');
check('.locate-btn exists in MiniPlayer.module.scss', locateBlock,
    locateBlock ? 'found' : 'not found');

const rightMatch = locateBlock.match(/right:\s*(-?\d+)px/);
const RIGHT_INSET = rightMatch ? Number(rightMatch[1]) : NaN;
check('.locate-btn has a numeric right inset', rightMatch, `right: ${RIGHT_INSET}px`);

const bottomMatch = locateBlock.match(/bottom:\s*calc\(100%\s*\+\s*(\d+)px\)/);
const BOTTOM_LIFT = bottomMatch ? Number(bottomMatch[1]) : NaN;
check('.locate-btn sits above the bar (bottom: calc(100% + Npx))', bottomMatch,
    `lift ${BOTTOM_LIFT}px`);

const BTN = 32;
const BAR_RADIUS = 29;
const BAR_HEIGHT = 58;
// The bar is a pill: its corner arc spans the last `BAR_RADIUS` pixels of its
// right edge, and at any given x inside that span the arc eats into the bar's
// top/bottom edge by `R - sqrt(R² - (R - x)²)`. The rule is not "stay 29px
// clear" (that would forbid the corner entirely) but "whatever the arc eats
// there, the button must sit above it" — and it does, from both sides:
//   • the button's bottom edge is BOTTOM_LIFT above the bar's top edge, and
//   • at the button's nearest x the arc only drops a fraction of a pixel.
// So the two outlines never cross, and `right: 24px` also lines the button up
// with nothing in particular — it is simply clear of the arc's steep part.
const arcDropAtBtnRight = RIGHT_INSET < BAR_RADIUS
    ? BAR_RADIUS - Math.sqrt(BAR_RADIUS ** 2 - (BAR_RADIUS - RIGHT_INSET) ** 2)
    : 0;
check('button clears the bar corner arc vertically',
    BOTTOM_LIFT > arcDropAtBtnRight,
    `button bottom ${BOTTOM_LIFT}px above bar top vs arc drop ${arcDropAtBtnRight.toFixed(2)}px at x=${RIGHT_INSET}`);
check('button sits within the bar\'s horizontal span (never hangs off an edge)',
    RIGHT_INSET >= 0 && RIGHT_INSET + BTN <= barW,
    `right inset ${RIGHT_INSET} + width ${BTN} <= bar width ${barW}`);
// Vertical: the button's bottom edge is BOTTOM_LIFT above the bar's top edge,
// so the two surfaces read as a stack rather than as one overlapping the other.
check('vertical gap between button and bar is small but non-zero',
    BOTTOM_LIFT > 0 && BOTTOM_LIFT <= 12, `${BOTTOM_LIFT}px`);
// The button occupies the 32px directly above the bar's top-right; the bar is
// 58px tall and the pill's full height stays legible to its right.
check('the button never overlaps the bar\'s own box',
    BOTTOM_LIFT > 0, `button occupies ${BOTTOM_LIFT}..${BOTTOM_LIFT + BTN} above the bar top`);
check('a 32px button is reachable against a 58px bar',
    BTN >= 28 && BTN <= BAR_HEIGHT,
    `${BTN}px diameter vs ${BAR_HEIGHT}px bar height`);

/* --- quiet by construction --- */

check('no accent colour on the button', !/var\(--accent/.test(locateBlock),
    locateBlock.includes('--accent') ? 'uses --accent' : 'no accent');
check('button uses the bar\'s glass recipe',
    /background:\s*var\(--glass-strong\)/.test(locateBlock)
    && /var\(--glass-border\)/.test(locateBlock),
    'glass-strong + glass-border');
check('button icon sits at the mid text weight',
    /color:\s*var\(--text-2\)/.test(locateBlock), 'color: var(--text-2)');
const svgMatch = locateBlock.match(/svg\s*\{[^}]*width:\s*(\d+)px/);
check('icon is smaller than the 20px transport glyphs', svgMatch && Number(svgMatch[1]) <= 16,
    svgMatch ? `${svgMatch[1]}px` : 'no svg rule');
check('button is no larger than the transport buttons (36px)',
    /width:\s*(\d+)px;\s*\n\s*height:\s*(\d+)px/.test(locateBlock)
    && Number(locateBlock.match(/width:\s*(\d+)px/)[1]) <= 36,
    locateBlock.match(/width:\s*(\d+)px/) ? `${locateBlock.match(/width:\s*(\d+)px/)[1]}px` : '?');

/* --- the old rules are gone from TrackList --- */

check('TrackList no longer defines .locate-btn', !/\.locate-btn\s*\{/.test(listScss),
    'no .locate-btn rule');
check('TrackList no longer defines .track-pulse', !/\.track-pulse\s*\{/.test(listScss),
    'no .track-pulse rule');
check('TrackList still declares both classes as resolved-in-elsewhere comments',
    listScss.includes('MiniPlayer.module.scss'), 'cross-reference comment present');
check('the pulse keyframes moved too (no orphan animation name in TrackList)',
    !/@keyframes\s+track-pulse/.test(listScss), 'no orphan @keyframes track-pulse');
check('MiniPlayer declares the pulse keyframes',
    /@keyframes\s+track-pulse/.test(miniScss), '@keyframes track-pulse present');
check('MiniPlayer declares the locate-in keyframes (the rule references it)',
    /@keyframes\s+locate-in/.test(miniScss)
    && locateBlock.includes('animation: locate-in'), 'keyframes + reference together');

/* --- the id handshake --- */

const idInList = listJs.match(/const listId = '([^']+)'/);
const idInMini = miniJs.match(/const LIST_ID = '([^']+)'/);
check('TrackList declares the list id', idInList, idInList ? idInList[1] : 'missing');
check('MiniPlayer declares the same list id', idInMini, idInMini ? idInMini[1] : 'missing');
check('the two ids match', idInList && idInMini && idInList[1] === idInMini[1],
    `${idInList && idInList[1]} vs ${idInMini && idInMini[1]}`);
check('TrackList puts that id on the <ul>',
    new RegExp(`<ul className=\\{styles\\.tracks\\} id=\\{listId\\}>`).test(listJs),
    'id={listId} on <ul>');
// The row is a flex line holding the play target and the three-dots button, so
// the <li> now carries a class too — the check only cares that the id stays on
// the <li> the jump scrolls to, not what else is on it.
check('every row still carries data-track-id',
    /<li key=\{track\.id\} data-track-id=\{track\.id\}[^>]*>/.test(listJs), 'data-track-id present');
check('MiniPlayer looks the list up by that id',
    miniJs.includes('document.getElementById(LIST_ID)'), 'getElementById(LIST_ID)');
check('the row lookup escapes the id',
    miniJs.includes('CSS.escape(currentId)'), 'CSS.escape(currentId)');

/* --- the button is anchored to the bar, not to the document --- */

check('.locate-btn is absolutely positioned (not fixed)',
    /position:\s*absolute/.test(locateBlock), 'position: absolute');
check('.locate-btn is NOT fixed (fixed would drift from the bar)',
    !/position:\s*fixed/.test(locateBlock), 'no position: fixed');
// The button has to be a sibling of the pill, not a child: `.mini` is the
// tappable "open the player" surface and it is `overflow: hidden`, so a button
// inside it would be clipped at the rounded corner and would inherit that tap.
const pillClose = miniJs.indexOf('</div>\n\n            {/* Top-right shoulder');
check('the button renders as a sibling of the clipped `.mini` pill',
    pillClose !== -1 && miniJs.indexOf("styles['locate-btn']") > pillClose,
    pillClose === -1 ? 'anchor not found' : 'after the pill closes');
check('the button is a direct child of `.wrap` (absolute against the bar box)',
    /<\/button>\s*\)\}\s*<\/div>\s*\);\s*\};/.test(miniJs)
    || /<\/button>\s*\)\}\s*\n\s*<\/div>/.test(miniJs),
    'closes .wrap last');
check('the button does not bubble its tap into the bar',
    /onClick=\{jumpToCurrent\}/.test(miniJs) && !/actInPlace\(event, jumpToCurrent\)/.test(miniJs),
    'plain onClick, no stopPropagation needed outside the pill');

/* --- gating --- */

check('button is hidden while the list is loading',
    /\{!listLoading && rowOffScreen && !jumping && \(/.test(miniJs), 'listLoading guard');
check('button is hidden while the playing row is visible (rowOffScreen)',
    /rowOffScreen/.test(miniJs), 'rowOffScreen guard');
check('button is hidden during the jump (jumping)', /jumping/.test(miniJs), 'jumping guard');
check('rowOffScreen starts false so the button cannot flash on mount',
    /useState\(false\);\n\s*\/\/ True for the length of a jump/.test(miniJs)
    || /const \[rowOffScreen, setRowOffScreen\] = useState\(false\)/.test(miniJs),
    'useState(false)');
check('the visibility test uses an inset viewport, not the raw one',
    miniJs.includes("rootMargin: '-72px 0px -96px 0px'"),
    "rootMargin: '-72px 0px -96px 0px'");
// A removed node generates no further IntersectionObserver entries, so the
// effect has to re-run when the playing row can no longer be rendered — a
// search that filters it out. Otherwise the last reading sticks and the button
// offers a jump to a row that is not there.
check('the phone re-measures when the filtered list changes size',
    /\[rowOf, listLoading, trackCount\]/.test(miniJs), 'trackCount in the deps');
check('MiniPlayer takes that count as a prop',
    /^\s{4}trackCount,$/m.test(miniJs), 'prop declared');
check('MusicApp feeds it the visible count',
    /<MiniPlayer[\s\S]{0,400}trackCount=\{visibleTracks\.length\}/.test(appJs),
    'visibleTracks.length');
check('the jump respects prefers-reduced-motion',
    miniJs.includes("matchMedia('(prefers-reduced-motion: reduce)')"), 'reduced-motion branch');
check('the pulse class comes off again on a timer',
    /classList\.remove\(styles\['track-pulse'\]\)/.test(miniJs), 'remove on timer');
check('timers are cleared on unmount',
    /clearTimeout\(settleRef\.current\)/.test(miniJs)
    && /clearTimeout\(pulseRef\.current\)/.test(miniJs), 'both cleared');

/* --- wiring from the shell --- */

check('MusicApp passes listLoading into MiniPlayer',
    /<MiniPlayer[\s\S]{0,400}listLoading=\{listLoading\}/.test(appJs), 'prop wired');
check('the mini bar is still list-tab only',
    /\{tab === 'list' && current && !playerOpen && \(/.test(appJs), 'tab gate intact');

/* --- the same button on the wide-screen layout -------------------------- */

// The desktop has no mini bar, so the button had nowhere to live and simply did
// not exist there — on a long list there was no way back to the playing row.
// It is pinned to the list panel instead. The numbers differ (a corner inside a
// scroller rather than a shoulder above a bar), so the invariants are stated
// separately rather than shared with the block above.
const deskJs = read('components/Music/DesktopMusic.js');
const deskScss = read('components/Music/DesktopMusic.module.scss');

const deskBlock = blockOf(deskScss, '.locate-btn');
check('.locate-btn exists in DesktopMusic.module.scss', deskBlock,
    deskBlock ? 'found' : 'not found');
check('the desktop button is the same 32px circle as the phone\'s',
    new RegExp(`width:\\s*${BTN}px`).test(deskBlock)
    && new RegExp(`height:\\s*${BTN}px`).test(deskBlock),
    `${BTN}px — one target, two layouts`);
check('the desktop icon is the same weight as the phone\'s',
    new RegExp(`svg\\s*\\{[^}]*width:\\s*${svgMatch ? svgMatch[1] : 15}px`).test(deskBlock),
    'same glyph size');

// It floats over the rows, so it has to be quiet enough to sit on top of them.
check('the desktop button is not accent-coloured either',
    !/var\(--accent/.test(deskBlock), 'no accent');
check('the desktop button wears the panel\'s glass',
    /background:\s*var\(--glass-solid\)/.test(deskBlock)
    && /var\(--hairline\)/.test(deskBlock), 'glass-solid + hairline');
check('the desktop button icon sits at the mid text weight',
    /color:\s*var\(--text-2\)/.test(deskBlock), 'color: var(--text-2)');
check('the desktop button declares its own locate-in keyframes',
    /@keyframes\s+locate-in/.test(deskScss) && deskBlock.includes('animation: locate-in'),
    'keyframes + reference together');

// Anchoring: the phone pins to the bar (a box that never scrolls because it is
// a sibling of the list), the desktop pins to a wrapper around the scroller for
// the same reason. If the button were ever put *inside* the scroller it would
// scroll away with the rows, which is exactly what the phone's version was
// designed not to do.
const wrapBlock = blockOf(deskScss, '.list-wrap');
check('.list-wrap is the desktop button\'s containing block',
    /position: relative/.test(wrapBlock), wrapBlock ? 'position: relative' : 'missing');
check('the desktop button is absolutely positioned against it',
    /position:\s*absolute/.test(deskBlock) && !/position:\s*fixed/.test(deskBlock),
    'absolute, not fixed');
check('the wrapper does not itself scroll',
    wrapBlock !== '' && !/overflow/.test(wrapBlock), 'no overflow');
check('the scroller inside it still does (min-height: 0 keeps flex honest)',
    /min-height:\s*0/.test(wrapBlock), 'min-height: 0');
const ulIdx = deskJs.indexOf('ref={listRef}');
const btnIdx = deskJs.indexOf("styles['locate-btn']");
check('the button renders after the scroller, not inside it',
    ulIdx !== -1 && btnIdx > ulIdx && btnIdx > deskJs.indexOf('</ul>', ulIdx),
    'outside the <ul>');
check('the button stays clear of the panel footer',
    deskJs.indexOf("styles['panel-foot']") > btnIdx, 'footer is a later sibling');

// Behaviour has to match the phone's, or one layout would feel broken.
check('the desktop hides it while the list is loading, off-screen, or mid-jump',
    /\{!listLoading && rowOffScreen && !jumping && \(/.test(deskJs), 'same gate');
check('the desktop measures the row against the scroller, not the viewport',
    /root:\s*listRef\.current/.test(deskJs), 'root: listRef.current');
check('the desktop re-measures when the filtered list changes size too',
    /\[rowOf, listLoading, visibleCount\]/.test(deskJs), 'visibleCount in the deps');
check('the desktop row lookup escapes the id',
    deskJs.includes('CSS.escape(currentId)'), 'CSS.escape(currentId)');
// The lookup is only as good as the hook it reads: without the attribute on the
// rows the query returns null and the button never appears — silently, since
// "no row found" is also the honest answer when nothing is playing.
check('the desktop rows carry the attribute the lookup reads',
    /<li key=\{track\.id\} data-track-id=\{track\.id\}/.test(deskJs), 'data-track-id on the row');
check('the desktop ref is on the scroller the rows live in',
    /<ul className=\{styles\.list\} ref=\{listRef\}>/.test(deskJs), 'ref on the <ul>');
check('the desktop jump respects prefers-reduced-motion',
    deskJs.includes("matchMedia('(prefers-reduced-motion: reduce)')"), 'reduced-motion branch');
check('the desktop pulse comes off again on a timer',
    /classList\.remove\(styles\['track-pulse'\]\)/.test(deskJs), 'remove on timer');
check('the desktop clears its timers on unmount',
    /clearTimeout\(settleRef\.current\)/.test(deskJs)
    && /clearTimeout\(pulseRef\.current\)/.test(deskJs), 'both cleared');
check('the desktop pulse rule lives where the desktop applies it',
    /^\.track-pulse \{/m.test(deskScss) && !/\.track-pulse\s*\{/.test(listScss),
    'DesktopMusic.module.scss, not TrackList');
check('the desktop pulse carries a radius (the <li> is a bare flex line)',
    /border-radius:/.test(blockOf(deskScss, '.track-pulse')), 'border-radius');
check('the phone row got the same radius for the same reason',
    /\.row \{[\s\S]{0,400}border-radius:\s*12px/.test(listScss), 'radius 12px on .row');

/* --- report --- */

let failed = 0;
results.forEach((r) => {
    if (!r.pass) failed += 1;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
});
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
