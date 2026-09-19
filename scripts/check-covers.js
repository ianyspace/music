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

// One resolver, so no call site can skip the fallback: the component owns the
// "which field is it" knowledge and every tile goes through it. The module that
// *defines* it does not count as a consumer.
const consumers = fs.readdirSync(path.join(root, 'components/Music'))
    .filter((name) => name.endsWith('.js') && name !== 'librarySource.js')
    .filter((name) => /coverUrlOf/.test(read(`components/Music/${name}`)));
check('coverUrlOf is used from exactly one place',
    consumers.length === 1 && consumers[0] === 'Cover.js',
    consumers.join(', ') || 'nowhere');

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
