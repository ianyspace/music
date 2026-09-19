#!/usr/bin/env node
/**
 * Checks that a song's cover is used everywhere its gradient is, and that the
 * two are wired the same way.
 *
 * A cover is a *sidecar* file: the same base name as the audio with an image
 * extension, exactly like the lyrics. That makes it cheap to render and easy to
 * get subtly wrong, because every failure mode is silent:
 *
 * - A place that paints `trackGradient(name)` without a `Cover` next to it just
 *   keeps showing the gradient. Nothing errors; the song simply never gets its
 *   photo, and only on the layout or the sheet nobody looked at.
 * - A `Cover` fed the wrong object — the row's `name` instead of the track, a
 *   stale `rowMenu` — shows *another song's* artwork, which is worse than none.
 * - The image is an absolutely positioned overlay, so it needs a positioned
 *   tile to land in. Three of the nine tiles were not positioned before this
 *   feature: without `position: relative` the photo escapes to the nearest
 *   ancestor and lands on top of the row.
 * - It also has to paint *under* the row's play/pause scrim but *over* the note
 *   glyph, which is a matter of where it sits in the markup.
 * - And it must not fetch a whole library's worth of images on open, nor eat
 *   the taps that belong to the row underneath.
 *
 * The cloud/drive split is checked here too: the pairing rule lives in the
 * Worker for R2 and in the file listing for Drive, and both have to produce the
 * same thing. `coverUrlOf` is the only place allowed to know which is which, so
 * that a call site can never forget the fallback.
 *
 * The lock screen is the third surface, and the one where the fallback is not
 * free: the OS fetches that artwork by itself, so a cover that will not load is
 * reported to an `onerror` rather than to a `Cover` that can just return null.
 * Both halves — the choice and the second write — are checked here.
 *
 * Run: node scripts/check-covers.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/**
 * Pulls a rule's whole body out, stopping at the rule's own closing brace rather
 * than at the first `}` — which is what a plain `\{([^}]*)\}` does, and would cut
 * the block off at the first nested `@media`/`&:hover`.
 *
 * Leading whitespace is allowed before the selector so the same helper works on
 * rules nested inside a media query.
 */
const blockOf = function (text, selector) {
    const found = new RegExp(`\\n[ \\t]*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{`).exec(text);
    if (!found) return '';
    const start = found.index;
    let depth = 0;
    for (let i = text.indexOf('{', start); i < text.length; i += 1) {
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}') {
            depth -= 1;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return '';
};

/**
 * The `<span>` that carries a tile's class name, opened to its own `</span>`.
 *
 * These tiles are span-only subtrees, so counting `<span` against `</span>` is
 * enough to find the end without pulling in a parser. It matters that this is
 * the *whole* element: several assertions below are negative ones ("the glyph
 * is under the cover"), and a fixed-size window that stopped short would make
 * those pass for the wrong reason.
 */
const tileOf = function (source, className) {
    const found = new RegExp(`<span[^>]*styles\\['${className}'\\][^>]*>`).exec(source);
    if (!found) return '';
    let depth = 0;
    for (let i = found.index; i < source.length; i += 1) {
        if (source.startsWith('<span', i)) depth += 1;
        else if (source.startsWith('</span>', i)) {
            depth -= 1;
            if (depth === 0) return source.slice(found.index, i + 7);
        }
    }
    return '';
};

const results = [];
const check = function (name, condition, detail) {
    results.push({ name, pass: Boolean(condition), detail });
};

/* --- every tile that paints a gradient also tries a cover ---------------- */

// file, the tile's class, the track the cover must be given, and the gradient
// the same element paints. The track column is the one that catches "shows
// another song's artwork": it is the object whose `name` feeds the gradient in
// that very element, so a mismatch means the photo and the fallback colour
// belong to two different songs. Three of the tiles paint a `gradient` computed
// above the markup rather than calling `trackGradient` inline; those two
// variables are pinned to their track just below.
const SITES = [
    { file: 'components/Music/TrackList.js', tile: 'track-thumb', track: 'track', gradient: 'trackGradient(track.name)' },
    { file: 'components/Music/DesktopMusic.js', tile: 'item-thumb', track: 'track', gradient: 'trackGradient(track.name)' },
    { file: 'components/Music/DesktopMusic.js', tile: 'disc-label', track: 'current ? current.track : null', gradient: 'gradient' },
    { file: 'components/Music/DesktopMusic.js', tile: 'bar-disc-cover', track: 'current ? current.track : null', gradient: 'gradient' },
    { file: 'components/Music/NowPlaying.js', tile: 'disc-label', track: 'track', gradient: 'gradient' },
    { file: 'components/Music/MiniPlayer.js', tile: 'disc-cover', track: 'current.track', gradient: 'trackGradient(current.track.name)' },
    { file: 'components/Music/MusicApp.js', tile: 'row-cover', track: 'rowMenu', gradient: 'trackGradient(rowMenu.name)' },
    { file: 'components/Music/CacheManager.js', tile: 'item-thumb', track: 'track', gradient: 'trackGradient(name)' },
    { file: 'components/Music/DislikedSheet.js', tile: 'item-thumb', track: 'row.track', gradient: 'trackGradient(row.name)' },
];

const sources = {};
SITES.forEach(({ file }) => { sources[file] = sources[file] || read(file); });

SITES.forEach(({ file, tile, track, gradient }) => {
    const element = tileOf(sources[file], tile);
    const where = `${path.basename(file)} .${tile}`;
    check(`${where} exists`, element !== '', element ? 'found' : 'not found');
    check(`${where} still paints the fallback gradient`,
        element.includes(`background: ${gradient}`), gradient);
    check(`${where} renders a cover`,
        /<Cover\s+track=\{/.test(element), element.includes('<Cover') ? 'Cover rendered' : 'no Cover');
    check(`${where} hands the cover the same song as the gradient`,
        element.includes(`<Cover track={${track}} />`),
        `<Cover track={${track}} />`);
});

// The two shared `gradient` variables the table above leans on.
check('the desktop record label follows the playing track',
    /const gradient = current \? trackGradient\(current\.track\.name\)/.test(sources['components/Music/DesktopMusic.js']),
    'trackGradient(current.track.name)');
check('the phone record label follows its track',
    /const gradient = trackGradient\(track\.name\)/.test(sources['components/Music/NowPlaying.js']),
    'trackGradient(track.name)');

/* --- the overlay recipe -------------------------------------------------- */

const coverScss = read('components/Music/Cover.module.scss');
const cover = blockOf(coverScss, '.cover');
check('.cover is a single rule in its own sheet', cover !== '', 'Cover.module.scss');

check('the cover is an overlay, not a replacement',
    /position:\s*absolute/.test(cover) && /inset:\s*0/.test(cover),
    'absolute + inset: 0');
check('...sized to the tile it lands in',
    /width:\s*100%/.test(cover) && /height:\s*100%/.test(cover), '100% × 100%');
check('...and cropped to it rather than squashed',
    /object-fit:\s*cover/.test(cover), 'object-fit: cover');
check('the cover follows the tile\'s shape',
    /border-radius:\s*inherit/.test(cover), 'border-radius: inherit');
// Every tile wears a 1px inset hairline (the record label a dark rim, the
// drawer tile a drop shadow). Painted by the tile it sits *under* the photo, so
// the songs with a cover would lose the ring the songs without one keep.
check('the tile\'s own hairline is carried onto the photo',
    /box-shadow:\s*inherit/.test(cover), 'box-shadow: inherit');
check('the photo does not eat the row\'s taps',
    /pointer-events:\s*none/.test(cover), 'pointer-events: none');

/* --- the tiles are positioned ------------------------------------------- */

// `inset: 0` resolves against the nearest positioned ancestor, so a tile that
// is `static` sends the photo somewhere else on the page entirely.
const TILES = [
    ['components/Music/TrackList.module.scss', '.track-thumb'],
    ['components/Music/DesktopMusic.module.scss', '.item-thumb'],
    ['components/Music/DesktopMusic.module.scss', '.disc-label'],
    ['components/Music/DesktopMusic.module.scss', '.bar-disc-cover'],
    ['components/Music/NowPlaying.module.scss', '.disc-label'],
    ['components/Music/MiniPlayer.module.scss', '.disc-cover'],
    ['components/Music/MusicApp.module.scss', '.row-cover'],
    ['components/Music/CacheManager.module.scss', '.item-thumb'],
    ['components/Music/DislikedSheet.module.scss', '.item-thumb'],
];

TILES.forEach(([file, selector]) => {
    const rule = blockOf(read(file), selector);
    check(`${path.basename(file)} ${selector} is a containing block`,
        /position:\s*(relative|absolute)/.test(rule),
        (rule.match(/position:\s*[\w-]+/) || ['none'])[0]);
});

/* --- paint order inside a row ------------------------------------------- */

// The cover is absolute; the note glyph is in-flow and therefore paints below
// it, while the play/pause scrim is absolute too and only beats the cover by
// coming later in the markup. So the cover goes first, and both of the row
// tiles keep their scrim after it.
[
    ['components/Music/TrackList.js', 'track-thumb'],
    ['components/Music/DesktopMusic.js', 'item-thumb'],
].forEach(([file, tile]) => {
    const element = tileOf(sources[file] || read(file), tile);
    const coverAt = element.indexOf('<Cover');
    check(`${path.basename(file)} .${tile}: the cover comes first`,
        coverAt !== -1 && coverAt < element.indexOf('thumb-overlay'),
        'before the play/pause scrim');
    check(`${path.basename(file)} .${tile}: ...so the glyph is under it`,
        coverAt !== -1 && coverAt < element.indexOf('IconNote'),
        'before the note glyph');
});

/* --- how the image itself behaves --------------------------------------- */

const coverJs = read('components/Music/Cover.js');

check('a song with no cover renders no <img> at all',
    /if\s*\(!url\s*\|\|\s*url === brokenUrl\)\s*return null;/.test(coverJs),
    'null → the gradient is what shows');
check('a failed cover falls back to the gradient',
    /onError=\{\(\) => setBrokenUrl\(url\)\}/.test(coverJs), 'onError → drop the image');
// Keyed by URL, not by a boolean: the record label and the mini bar outlive the
// song they show, so a flag would keep the *next* song on the gradient.
check('the failure is remembered per URL, not per component',
    /useState\(''\)/.test(coverJs) && /url === brokenUrl/.test(coverJs),
    'brokenUrl');
check('the image is decorative',
    /alt=""/.test(coverJs), 'alt=""');
// A long library mounts every row at once.
check('covers below the fold are not fetched',
    /loading="lazy"/.test(coverJs), 'loading="lazy"');

// One resolver, so no call site can read the wrong field. Phrased as "no
// component knows the field names" rather than "exactly one component mentions
// the resolver": the resolver is meant to be *used* — `Cover` for the tiles,
// `MusicApp` for the lock screen — while `track.coverUrl` / `track.coverFile`
// are what has to stay in one file.
const app = read('components/Music/MusicApp.js');
const shared = read('components/Music/shared.js');
const componentFiles = fs.readdirSync(path.join(root, 'components/Music'))
    .filter((name) => name.endsWith('.js') && name !== 'librarySource.js');
const fieldReaders = componentFiles.filter((name) => {
    const text = read(`components/Music/${name}`);
    // `.coverUrl\b` does not match `.coverUrlOf(`: `\b` needs a non-word
    // character after `coverUrl`, and `O` is a word character.
    return /\.coverUrl\b/.test(text) || /\.coverFile\b/.test(text);
});
check('no component reads a cover field directly',
    fieldReaders.length === 0,
    fieldReaders.join(', ') || 'coverUrlOf is the only reader');

const callers = componentFiles.filter((name) => /coverUrlOf\(/.test(read(`components/Music/${name}`)));
check('...and the two places that show artwork ask it',
    callers.length === 2 && callers.includes('Cover.js') && callers.includes('MusicApp.js'),
    callers.join(', ') || 'nowhere — update this list when a third tile appears');

// Naming the resolver is not the same as importing it: the import list is a
// separate statement, and a free variable there is a ReferenceError at runtime
// rather than anything the bundler refuses. Sliced from the real statement, so
// the identifier also appearing in the body below cannot satisfy this.
const importedBy = function (text, name, from) {
    const end = text.indexOf(`} from '${from}';`);
    const start = end === -1 ? -1 : text.lastIndexOf('import {', end);
    if (start === -1) return false;
    return text.slice(start + 'import {'.length, end)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .includes(name);
};
check('...and both actually import it',
    importedBy(app, 'coverUrlOf', 'components/Music/librarySource')
    && importedBy(app, 'mediaArtwork', 'components/Music/shared')
    && importedBy(read('components/Music/Cover.js'), 'coverUrlOf', './librarySource'),
    'a missing import is a runtime ReferenceError, not a build failure');

/* --- the lock screen shows the same cover ------------------------------- */

// `blockOf` hands back the whole declaration — header line included — so the
// header is dropped here to leave a body that `new Function` can be given.
const artBlock = blockOf(shared, 'export const mediaArtwork = function (coverUrl, name)');
const artFn = artBlock ? artBlock.slice(artBlock.indexOf('{')) : '';
check('mediaArtwork is exported from shared.js', artFn !== '', artFn ? 'found' : 'missing');

// Driven, not pattern-matched: the choice between the photo and the drawn
// gradient is the whole content of the helper, and a regex can only ask
// whether both strings appear somewhere in it.
//
// The body is re-evaluated with `makeArtwork` injected, because drawing a
// gradient needs a canvas. `coverUrl` and `name` come in as parameters for the
// same reason — `functionBodyOf`-style slicing would have to skip the
// parameter list to find the body, and getting that wrong silently yields the
// destructuring braces instead.
const mediaArtwork = artFn
    ? new Function('makeArtwork', 'coverUrl', 'name', `return (function () ${artFn})();`)
    : null;
const art = (coverUrl, drawn) => (mediaArtwork
    ? JSON.stringify(mediaArtwork(() => drawn, coverUrl, '某首歌'))
    : '(missing)');

// The expected object is exact on purpose: the cover entry must carry `src`
// and nothing else. `sizes` is a promise the lock screen lays the image out
// against, and the only size known here is the gradient's own 320×320.
check('the lock screen prefers the cover it is handed',
    art('https://cdn.example/a.jpg', 'data:image/png;base64,GRADIENT')
    === '[{"src":"https://cdn.example/a.jpg"}]',
    art('https://cdn.example/a.jpg', 'data:image/png;base64,GRADIENT'));
check('...and draws the gradient when there is no cover',
    art('', 'data:image/png;base64,GRADIENT')
    === '[{"src":"data:image/png;base64,GRADIENT","sizes":"320x320","type":"image/png"}]',
    art('', 'data:image/png;base64,GRADIENT'));
check('...publishing nothing when even the canvas is unavailable',
    art('', '') === '[]', art('', ''));

check('the cover URL comes from the resolver, not from the track',
    /const coverUrl = coverUrlOf\(current\.track\)/.test(app), 'coverUrlOf(current.track)');
check('...and is what the metadata is built from',
    /publish\(mediaArtwork\(coverUrl, current\.track\.name\)\)/.test(app),
    'mediaArtwork(coverUrl, ...)');

// The OS fetches the artwork itself, so a cover that will not load (a 0-byte
// object in the bucket, an expired Drive thumbnail) has to be answered here:
// `onerror` on a probe image, republishing the gradient entry. Asserted on the
// handler's own body, not on a window around it.
const probeHandler = blockOf(app, 'probe.onerror = () =>');
check('a cover that will not load falls back to the gradient',
    probeHandler !== '' && /publish\(mediaArtwork\('', current\.track\.name\)\)/.test(probeHandler),
    probeHandler ? 'republished' : 'no onerror handler');
check('...and the probe is detached on teardown',
    /if \(probe\) probe\.onerror = null;/.test(app),
    'a stale failure must not repaint the next song');

/* --- the two libraries produce the same thing --------------------------- */

const lib = read('components/Music/librarySource.js');

check('the track shape documents both spellings',
    /coverUrl\?,\s*coverFile\?/.test(lib), 'coverUrl? / coverFile?');

// Asserted on the resolver's own body, not on the file: a `track.coverUrl` that
// only appears in the guard (or in a comment) is not a wired field.
const coverFn = blockOf(lib, 'export const coverUrlOf = function (track)');
check('coverUrlOf is a small resolver', coverFn !== '', 'found');
check('coverUrlOf reads the cloud field',
    /if \(track\.coverUrl\) return track\.coverUrl;/.test(coverFn), 'track.coverUrl');
check('coverUrlOf reads the drive field',
    /return driveThumbnail\(track\.coverFile\.thumbnailLink\);/.test(coverFn),
    'driveThumbnail(track.coverFile.thumbnailLink)');
check('coverUrlOf answers "none" for a missing track',
    /if \(!track\) return '';/.test(coverFn), 'null-safe');
// An `<img>` cannot send the Authorization header, so a cover cannot go through
// `?alt=media` the way the audio and the lyrics do. This is the one place where
// the cover deliberately differs from the other sidecar file.
check('the drive cover is a URL the browser can fetch on its own',
    !/alt=media/.test(coverFn), 'no token-only URL');

// The cloud index carries covers as public links, resolved like the lyrics are.
check('the cloud track keeps the index\'s coverUrl',
    /coverUrl: 'coverUrl' in item \? absoluteUrl\(item\.coverUrl\)/.test(lib),
    'absoluteUrl(item.coverUrl)');
// A client newer than the deployed Worker must still work: the site and the
// Worker are published separately. The guess is the *else* branch — a Worker
// that answers `null` must not be second-guessed into a 404.
check('an index that predates covers falls back to the naming rule',
    /in item \? absoluteUrl\(item\.coverUrl\) : guessCoverUrl\(url\),/.test(lib),
    'guessCoverUrl(url) as the else branch');
check('...which only rewrites an audio URL',
    /AUDIO_FILE\.test\(url\) \? url\.replace\(AUDIO_FILE, '\.jpg'\) : ''/.test(lib),
    'anchored on AUDIO_FILE');

// Drive: the listing has to ask for the images and for their thumbnails.
check('the drive listing asks for images',
    /let q = "\(mimeType contains 'audio' or mimeType contains 'image'"/.test(lib),
    "q: mimeType contains 'image'");
check('the drive listing asks for thumbnails',
    /fields: 'files\(id,name,mimeType,size,thumbnailLink\)'/.test(lib),
    'thumbnailLink in fields');
check('...asked for at a size worth showing',
    /=s\\d\+\(\[-a-z\]\*\)\$/.test(lib), '=s512, flags preserved');
check('drive covers are paired by the same-name rule as the lyrics',
    /coverByKey = new Map\(coverFiles\.map\(\(file\) => \[normalizeLyricKey\(file\.name\), file\]\)\)/.test(lib),
    'normalizeLyricKey');
check('...and hang off the track as coverFile',
    /coverFile: coverByKey\.get\(normalizeLyricKey\(file\.name\)\) \|\| null/.test(lib),
    'coverFile');

/* --- the Worker pairs them for R2 -------------------------------------- */

const worker = read('cloudflare-worker/src/index.js');
const workerReadme = read('cloudflare-worker/README.md');

check('the Worker knows the image extensions',
    /const IMAGE_EXTENSIONS = \['jpg', 'jpeg', 'png', 'webp'\]/.test(worker),
    'jpg/jpeg/png/webp');
check('...pairs them with the same normalisation as the lyrics',
    /else if \(IMAGE_EXTENSIONS\.includes\(ext\)\) coversByKey\.set\(normalizeLyricKey\(object\.key\), object\)/.test(worker),
    'normalizeLyricKey');
check('...and puts the public link on the track',
    /coverUrl: cover \? `\$\{base\}\/\$\{encodeKey\(cover\.key\)\}` : null/.test(worker),
    'encodeKey(cover.key)');
// `null`, not absent: the client reads a missing field as "this index is older
// than covers" and would guess a `.jpg` for every song, 404 included.
check('...saying null rather than omitting the field',
    /: null,/.test(worker) && !/coverUrl: cover \? .* : undefined/.test(worker),
    'null keeps the client from guessing');
check('the Worker README documents the field',
    /"coverUrl"/.test(workerReadme), 'coverUrl in the sample payload');

/* --- report ------------------------------------------------------------- */

let failed = 0;
results.forEach((r) => {
    if (!r.pass) failed += 1;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
});
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
