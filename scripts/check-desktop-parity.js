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
    const start = deskJs.indexOf("<li key={track.id} className={styles['track-row']}>");
    if (start === -1) return '';
    const end = deskJs.indexOf('</li>', start);
    return end === -1 ? '' : deskJs.slice(start, end);
})();
check('the desktop row markup was located', Boolean(desktopRow), 'li extracted');
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

/* --- report ------------------------------------------------------------- */

let failed = 0;
results.forEach((r) => {
    if (!r.pass) failed += 1;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
});
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
