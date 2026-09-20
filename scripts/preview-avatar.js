#!/usr/bin/env node
/**
 * Renders the phone header's avatar at 4x, in both themes, from the built CSS.
 *
 * The avatar is a music note behind a low-blur glass cover, and "low" is a
 * narrow window — past ~4px the note stops being a note. That is a judgement
 * about pixels, so it wants a picture rather than an assertion, and it wants one
 * fast enough to iterate on: this renders straight from `out/_next/static/css`
 * with hard-coded markup, so it needs no server, no data and no click-through.
 *
 * Run: node scripts/preview-avatar.js [outFile]   (run `npm run build` first)
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const cssDir = path.join(root, 'out/_next/static/css');
const cssFiles = fs.readdirSync(cssDir).filter((f) => f.endsWith('.css'));
const css = cssFiles.map((f) => fs.readFileSync(path.join(cssDir, f), 'utf8')).join('\n');

const idOf = function (prefix) {
    const m = css.match(new RegExp(`\\.${prefix}__([A-Za-z0-9_-]+)`));
    if (!m) throw new Error(`no class starting with ${prefix} in the built CSS`);
    return `${prefix}__${m[1]}`;
};

const page = idOf('MusicApp_page');
const dark = idOf('MusicApp_theme-dark');
const head = idOf('TrackList_head');
const row = idOf('TrackList_head-row');
const avatar = idOf('TrackList_avatar');
const glass = idOf('TrackList_avatar-glass');

// The same glyph the component renders (`IconNote filled`), inline so this page
// needs no bundle — stems and beam as filled shapes, heads as slanted ovals.
const note = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7.8" y="4" width="2.4" height="14" rx="1.2"/><rect x="18.8" y="2" width="2.4" height="14" rx="1.2"/><path d="M7.8 3.8 21.2 1.4v2.4L7.8 6.2z"/><ellipse cx="6" cy="18" rx="3.2" ry="2.8" transform="rotate(-18 6 18)"/><ellipse cx="17" cy="16" rx="3.2" ry="2.8" transform="rotate(-18 17 16)"/></svg>`;

// Stand-ins for the three icon buttons the header also holds, so the avatar is
// judged at its real weight next to them. Deliberately *not* the note: two of
// the same glyph on one row would make it look like the buttons changed too.
const dot = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2.2"/></svg>';

// One header per blur radius, so the window can be judged side by side rather
// than by rebuilding four times.
const radii = [0, 2, 3, 5];

const band = function (themeClass, label) {
    const heads = radii.map((r) => `  <div class="cell">
    <span class="cap">blur ${r}px</span>
    <div class="${head}" style="margin:0;padding:10px 18px;--r:${r}px">
      <div class="${row}">
        <span class="${avatar}" role="img" aria-label="用户头像">${note}<span class="${glass}" style="backdrop-filter:blur(var(--r));-webkit-backdrop-filter:blur(var(--r))"></span></span>
        <div style="display:flex;align-items:center;gap:8px">
          <button type="button" style="width:34px;height:34px;border:0;border-radius:50%;background:transparent;color:var(--text);cursor:pointer">${dot}</button>
          <button type="button" style="width:34px;height:34px;border:0;border-radius:50%;background:transparent;color:var(--text);cursor:pointer">${dot}</button>
          <button type="button" style="width:34px;height:34px;border:0;border-radius:50%;background:transparent;color:var(--text);cursor:pointer">${dot}</button>
        </div>
      </div>
    </div>
  </div>`).join('\n');

    return `  <section class="${page} ${themeClass}">
    <h2>${label}</h2>
${heads}
  </section>`;
};

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>avatar</title>
<style>
${css}
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
h2 { font-size: 13px; font-weight: 600; letter-spacing: .3px; margin: 22px 18px 6px; opacity: .6; }
.cell { margin: 10px 0 18px; }
.cap { display: block; font-size: 11px; letter-spacing: .4px; opacity: .5; margin: 0 18px 2px; }
/* The real page fills the viewport; here the two themes have to fit in one
   picture, so the token root is not allowed to claim the whole screen. */
.${page} { min-height: auto; }
/* The avatar is deliberately **not** scaled up. The blur radius is in CSS
   pixels and the glyph is 21px, so a magnified avatar changes the ratio that is
   the whole question — shoot this page with force-device-scale-factor=4
   instead, which magnifies the result without touching the relationship.
   (No backticks in here: this whole block is inside a template literal, and a
   stray one closes it early with a syntax error pointing somewhere else.) */
</style>
</head>
<body>
${band('', '浅色')}
${band(dark, '深色')}
</body>
</html>
`;

const outFile = process.argv[2] || '.workbuddy-ai/serve/avatar.html';
fs.writeFileSync(outFile, html);
console.log(`wrote ${outFile}`);
