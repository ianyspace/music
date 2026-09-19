#!/usr/bin/env node
/**
 * Parity checks between the phone and wide-screen layouts.
 *
 * The two layouts share all playback state through `MusicApp`, but each renders
 * its own list and its own controls — and that seam is where features quietly go
 * missing, because nothing errors when one side is simply not wired up. Three
 * failures this file exists for, all of which have happened:
 *
 *  1. **A gate keyed on the wrong flag.** The desktop list showed
 *     「曲库里还没有歌曲 / 去连接」 on top of a fully loaded public library,
 *     because its empty state tested the Google token (`connected`) instead of
 *     whether a library exists at all (`hasLibrary`). The public library needs
 *     no authorization, so the songs only appeared once a drive was linked —
 *     the opposite of what the flag was being read as. The phone layout had it
 *     right, so the two disagreed about the same data.
 *  2. **A feature wired to only one layout.** 置顶 / 移入不喜欢 were reachable
 *     from the phone's row drawer and nowhere on the desktop, even though the
 *     desktop was already being handed the callbacks.
 *  3. **A shell sheet nothing could open.** The cache manager and the
 *     disliked-songs screen are rendered beside the layout switch, so both
 *     variants have them — but the desktop's 更多 menu pointed 缓存管理 at the
 *     settings drawer, which only ever reported a count.
 *  4. **A control only one layout owned.** 「回到正在播放」 was mounted by the
 *     phone's mini bar, and the bar does not exist on the desktop — so on a long
 *     list the desktop had no way back to the playing row short of scrolling.
 *
 * Run: node scripts/check-desktop-parity.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const appJs = read('components/Music/MusicApp.js');
const deskJs = read('components/Music/DesktopMusic.js');
const deskScss = read('components/Music/DesktopMusic.module.scss');
const listJs = read('components/Music/TrackList.js');

const results = [];
const check = function (name, condition, detail) {
    results.push({ name, pass: Boolean(condition), detail });
};

const count = (text, pattern) => (text.match(pattern) || []).length;

/**
 * Pulls a rule's whole body out of a stylesheet, stopping at the rule's own
 * closing brace rather than at the first `}` — which is what a plain
 * `\{([^}]*)\}` does, and would cut the block off at the first nested
 * `@media`/`svg` rule. Brace counting is enough here: no string or comment in
 * these files contains an unbalanced brace.
 *
 * Preferred over `^\.foo \{[\s\S]{0,N}declaration` windows, which fail in a way
 * that is easy to miss: a window that matches nothing at all makes a negative
 * assertion (`!…test(…)`) pass for free, and a missing `/m` flag makes a
 * positive one fail for a reason that has nothing to do with the stylesheet.
 */
const blockOf = function (scss, selector) {
    const start = scss.indexOf(`\n${selector} {`);
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

/* --- 1. the library gate ------------------------------------------------ */

// The same value has to reach the same-named prop on both layouts, or the two
// disagree about whether there is anything to show.
check('MusicApp passes `hasLibrary` to the phone list',
    /<TrackList\s*\n\s*connected=\{hasLibrary\}/.test(appJs), 'connected={hasLibrary}');
check('MusicApp passes `hasLibrary` to the desktop list',
    /<DesktopMusic[\s\S]{0,4000}?hasLibrary=\{hasLibrary\}/.test(appJs), 'hasLibrary={hasLibrary}');
check('`hasLibrary` is derived from the list, not from the token alone',
    /const hasLibrary = tracks\.length > 0 \|\| listCacheAvailable \|\| Boolean\(token\)/.test(appJs),
    'tracks || cache || token');

const gate = deskJs.match(/\{!(\w+) && !(\w+) \? \(\s*\n\s*<section className=\{styles\.connect\}/);
check('the desktop connect prompt is gated on a flag plus a loading check',
    Boolean(gate), gate ? `${gate[1]} && !${gate[2]}` : 'not found');
check('...and that flag is `hasLibrary`, not the Google token',
    Boolean(gate) && gate[1] === 'hasLibrary',
    gate ? gate[1] : 'not found');
check('...and the loading check is `listLoading`',
    Boolean(gate) && gate[2] === 'listLoading', gate ? gate[2] : 'not found');
check('the desktop list gate no longer tests `connected`',
    !/\{!connected \? \(\s*\n\s*<section className=\{styles\.connect\}/.test(deskJs),
    'no !connected gate');

// `connected` must still mean "a drive is linked" everywhere else, or the fix
// turned into a blanket rename.
check('the drive-specific rows still key off `connected`',
    /\{connected \? '我的 Google 云盘' : sourceName\}/.test(deskJs)
    && /\{connected \? \(\s*\n\s*<section className=\{styles\.group\}>/.test(deskJs),
    'drive rows unchanged');

// The phone layout had the same flash-while-loading hole; both now guard it.
check('the phone connect prompt guards the loading state too',
    /\{!connected && !listLoading \? \(/.test(listJs), '!connected && !listLoading');

/* --- 2. row actions on both layouts ------------------------------------- */

const desktopRow = (() => {
    // Anchored on the attributes the row is *about* (its key and its class),
    // not on the exact attribute string: the row gained `data-track-id` for the
    // jump button, and a check that spelled the whole tag out would have gone
    // red for a reason that has nothing to do with what it tests.
    const start = deskJs.search(/<li key=\{track\.id\}[^>]*className=\{styles\['track-row'\]\}[^>]*>/);
    if (start === -1) return '';
    const end = deskJs.indexOf('</li>', start);
    return end === -1 ? '' : deskJs.slice(start, end);
})();
check('the desktop row markup was located', Boolean(desktopRow),
    desktopRow ? 'li extracted' : 'no <li> with data-track-id + track-row');
check('the desktop row is two sibling controls, not a nested button',
    count(desktopRow, /<button/g) === 2 && count(desktopRow, /<\/button>/g) === 2,
    `${count(desktopRow, /<button/g)} buttons`);
check('the play target still comes first and keeps the row\'s width',
    /className=\{active \? styles\['item-active'\] : styles\.item\}/.test(desktopRow),
    'item / item-active');
check('the desktop row has a three-dots button',
    /className=\{rowMenuOpen[\s\S]{0,180}styles\['item-more'\]/.test(desktopRow), 'item-more');
check('...that reports its expanded state',
    /aria-expanded=\{rowMenuOpen\}/.test(desktopRow), 'aria-expanded');
check('...and is announced as a menu trigger',
    /aria-haspopup="menu"/.test(desktopRow), 'aria-haspopup');
check('...and opens the shared row drawer',
    /onClick=\{\(\) => onOpenRowMenu\(track\)\}/.test(desktopRow), 'onOpenRowMenu(track)');
check('...and carries a per-row accessible name',
    /aria-label=\{`\$\{item\.title\} 的更多操作`\}/.test(desktopRow), 'aria-label');

check('MusicApp gives the desktop list the open row\'s id',
    /rowMenuId=\{rowMenu \? rowMenu\.id : ''\}/.test(appJs)
    && count(appJs, /rowMenuId=\{rowMenu \? rowMenu\.id : ''\}/g) === 2,
    'both layouts');
check('MusicApp gives the desktop list the row-menu opener',
    /onOpenRowMenu=\{openRowMenu\}/.test(appJs)
    && count(appJs, /onOpenRowMenu=\{openRowMenu\}/g) === 2,
    'both layouts');
check('the desktop layout actually uses the dislike/pin callbacks it is handed',
    /onDislikeTrack,/.test(deskJs) && /onPinTrack,/.test(deskJs),
    'destructured — the callbacks themselves are raised by the shared drawer');

/* --- 3. the shell sheets are reachable from both ------------------------ */

// The sheets live beside the layout switch, so both variants render them; the
// only thing that can be missing is a control that opens them.
//
// Newline-agnostic on purpose: this repo's working copy is CRLF on Windows and
// LF in CI, and a `'\n'`-anchored pattern silently matches nothing on one of
// them — which is how an assertion like this passes locally and fails in CI, or
// the other way round.
const ternaryOpen = appJs.search(/\{variant === 'desktop' \? \(/);
const firstShell = appJs.search(/\r?\n {12}\{rowMenu && \(/);
const shellClosers = [...appJs.matchAll(/\r?\n {12}\)\}\r?\n/g)].map((m) => m.index);
const ternaryClose = shellClosers.filter((at) => at < firstShell).pop();
check('the shared sheets sit outside the layout switch',
    ternaryOpen !== -1 && firstShell !== -1 && ternaryClose !== undefined
    && ternaryOpen < ternaryClose && ternaryClose < firstShell,
    'siblings of the switch, so both layouts render them');
['rowMenu', 'cacheOpen', 'dislikedOpen', 'driveOpen'].forEach((name) => {
    check(`the ${name} sheet is rendered at the shell level`,
        new RegExp(`\\r?\\n {12}\\{${name} && \\(`).test(appJs), 'shell level');
});

check('MusicApp gives the desktop list a way to open the cache manager',
    /onOpenCache=\{goCacheManager\}/.test(appJs), 'onOpenCache');
check('MusicApp gives the desktop list a way to open the disliked songs',
    /onOpenDisliked=\{openDislikedManager\}/.test(appJs), 'onOpenDisliked');
check('the desktop 缓存管理 entry opens the cache manager, not the settings drawer',
    /setMenu\(''\); onOpenCache\(\);/.test(deskJs)
    && !/缓存管理[\s\S]{0,400}setSettingsOpen\(true\)/.test(deskJs),
    'onOpenCache()');
check('the desktop menu has a 不喜欢歌曲 entry',
    /onOpenDisliked\(\);/.test(deskJs) && /不喜欢歌曲/.test(deskJs), 'entry present');
check('the desktop menu shows how many songs are hidden',
    /dislikedCount > 0 \? `\$\{dislikedCount\} 首`/.test(deskJs), 'count badge');
check('MusicApp passes that count',
    /dislikedCount=\{disliked\.length\}/.test(appJs), 'disliked.length');
check('the desktop settings drawer still opens the cache manager too',
    /onClick=\{onOpenCache\}/.test(deskJs), 'settings row');

/* --- 4. no stale copy --------------------------------------------------- */

// The 30-day expiry landed after these strings were written, and 「永久」 is
// now the opposite of what the app does. Comments are stripped first: a note
// explaining what the copy *used* to say is not stale copy.
const deskCopy = deskJs
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
check('the desktop no longer claims the cache is permanent',
    !/永久/.test(deskCopy), '永久 removed from the rendered copy');
check('the desktop states the real cache policy',
    /30 天过期/.test(deskJs) && /30 天没播放过才会清除/.test(deskJs), '30 days');

// Same trap, different claim. The footer chip used to read 「离线可用」 when the
// library list came from localStorage — but with no service worker the site
// cannot open without a network at all, so that promised something the app does
// not do. It reports where the *list* came from instead.
check('the desktop footer does not claim the app works offline',
    !/离线可用/.test(deskCopy), 'no 离线可用');
check('the desktop footer says what it actually knows',
    /列表已缓存/.test(deskJs), '列表已缓存 / 在线');

/* --- 5. the new markup has styles --------------------------------------- */

const classNames = ['track-row', 'item-more', 'item-more-on'];
classNames.forEach((name) => {
    check(`.${name} is defined in DesktopMusic.module.scss`,
        new RegExp(`^\\.${name.replace(/-/g, '-')}[\\s,{]`, 'm').test(deskScss), 'defined');
    check(`.${name} is actually used by the markup`,
        new RegExp(`styles\\['${name}'\\]`).test(deskJs), 'used');
});

// `.row` is the settings drawer's row. A second `.row` in the same file would
// be silently overridden by the later one — the list would then take the
// drawer's styling and nothing would look obviously broken in the source.
const rowDeclarations = count(deskScss, /^\.row\s*\{/gm);
check('`.row` is declared exactly once in the desktop stylesheet',
    rowDeclarations === 1, `${rowDeclarations} declarations`);
check('the list row uses a distinct class name',
    /^\.track-row \{/m.test(deskScss) && !/^\.row \{[\s\S]{0,200}\.item-more/m.test(deskScss),
    'track-row');
check('the hover rule cannot outrank the open state',
    /\.track-row:hover \.item-more:not\(\.item-more-on\)/.test(deskScss), ':not guard');

/* --- 6. the jump button exists on both layouts -------------------------- */

// The phone bar owns the button because the bar is the only thing pinned to the
// phone's viewport. The desktop has no such bar over the list, so the button had
// to be given a home of its own — the panel's bottom corner. Both layouts must
// reach the same row lookup, or one of them silently loses the feature.
const miniJs = read('components/Music/MiniPlayer.js');
const miniScss = read('components/Music/MiniPlayer.module.scss');

check('the phone layout still mounts the jump button',
    miniJs.includes("styles['locate-btn']"), 'MiniPlayer renders it');
check('the desktop layout mounts one too',
    deskJs.includes("styles['locate-btn']"), 'DesktopMusic renders it');
check('both are labelled the same, so the two layouts teach one target',
    /title="回到正在播放"/.test(miniJs) && /title="回到正在播放"/.test(deskJs),
    '回到正在播放');
check('both hide it while the list is loading, off-screen, or mid-jump',
    /\{!listLoading && rowOffScreen && !jumping && \(/.test(miniJs)
    && /\{!listLoading && rowOffScreen && !jumping && \(/.test(deskJs),
    'same gate on both');

// The row lookup has to work on both sides. The phone reaches across components
// by id; the desktop owns both the scroller and the rows, so it holds a ref and
// needs no id — but it still has to mark the rows the same way.
check('the phone finds rows through the list id',
    miniJs.includes('document.getElementById(LIST_ID)'), 'getElementById');
check('the desktop finds rows through its own ref',
    /const listRef = useRef\(null\)/.test(deskJs) && /listRef\.current/.test(deskJs),
    'listRef');
check('the desktop puts the ref on the scroller, not on the panel',
    /<ul className=\{styles\.list\} ref=\{listRef\}>/.test(deskJs), 'ref on <ul>');
check('the desktop rows carry the same data attribute the phone uses',
    /<li key=\{track\.id\} data-track-id=\{track\.id\}/.test(deskJs), 'data-track-id');
check('both escape the id before putting it in a selector',
    miniJs.includes('CSS.escape(currentId)') && deskJs.includes('CSS.escape(currentId)'),
    'CSS.escape');

// The pulse is applied from the component that owns the row, so each layout
// needs the rule in *its own* stylesheet — a shared name across two CSS modules
// is two classes, not one.
check('the desktop stylesheet defines the pulse the desktop applies',
    /^\.track-pulse \{/m.test(deskScss) && /@keyframes track-pulse/.test(deskScss),
    'track-pulse + keyframes');
check('the pulse rides on the <li>, which paints nothing at rest',
    /row\.classList\.add\(styles\['track-pulse'\]\)/.test(deskJs), 'classList.add on the row');
const pulseBlock = blockOf(deskScss, '.track-pulse');
check('...and carries a radius so the flash is not a rectangle',
    /border-radius:/.test(pulseBlock), pulseBlock ? 'border-radius on .track-pulse' : 'no rule');

// Where the button is anchored differs by design, and that difference is the
// whole point: the phone pins it to the bar's box, the desktop to the
// scroller's. Both have to be `absolute` against a box that does not scroll.
check('the phone anchors it above the bar',
    /bottom:\s*calc\(100% \+ \d+px\)/.test(miniScss), 'calc(100% + Npx)');
const wrapBlock = blockOf(deskScss, '.list-wrap');
check('the desktop anchors it inside the list wrapper',
    /position: relative/.test(wrapBlock), wrapBlock ? 'position: relative' : 'no .list-wrap rule');
check('the wrapper does not scroll with the rows',
    wrapBlock !== '' && !/overflow/.test(wrapBlock), 'no overflow on the wrapper');
check('the wrapper keeps the scroller scrollable (min-height: 0)',
    /min-height:\s*0/.test(wrapBlock), 'min-height: 0');
check('the wrapper is a column so the scroller inside still fills it',
    /display: flex/.test(wrapBlock) && /flex-direction: column/.test(wrapBlock),
    'flex column');
check('the desktop button is absolutely positioned against that wrapper',
    /position: absolute/.test(blockOf(deskScss, '.locate-btn')), 'position: absolute');
check('the button sits inside that wrapper, after the list',
    deskJs.indexOf("styles['locate-btn']") > deskJs.indexOf('ref={listRef}'),
    'rendered after the scroller');

/* --- report ------------------------------------------------------------- */

let failed = 0;
results.forEach((r) => {
    if (!r.pass) failed += 1;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
});
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
