#!/usr/bin/env node
/**
 * Renders a stand-in for every place a cover lands (real CSS module output,
 * hard-coded markup) into a single HTML file, so the overlay can be eyeballed
 * and measured in a browser.
 *
 * Why this is worth a script: the cover is an absolutely positioned overlay,
 * which is the one layout the eye cannot check. It either lands exactly on its
 * tile or somewhere else entirely, it either carries the tile's hairline or
 * silently drops it, and it either sits under the play/pause scrim or hides it.
 * All four are invisible in a diff and none of them throw. The three shapes a
 * cover has to fit are here — the list's rounded square, the drawer's larger
 * tile, and the record's circle — each with a cover next to the same tile
 * without one, which is the comparison that shows the hairline was preserved.
 *
 * The images are data URIs so the file works offline; the last row loads a real
 * remote PNG and reports its `naturalWidth`, which is the only way to see that
 * a decoded image really paints (the deployed R2 covers are 0-byte objects
 * right now, so the live app can only ever show the gradient).
 *
 * Run: node scripts/preview-covers.js [outFile]   (run `npm run build` first)
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const cssDir = path.join(root, 'out/_next/static/css');
const cssFile = fs.readdirSync(cssDir)
    .map((f) => path.join(cssDir, f))
    .find((f) => fs.readFileSync(f, 'utf8').includes('Cover_cover__'));
if (!cssFile) {
    console.error('no built CSS contains Cover_cover__ — run `npm run build` first');
    process.exit(1);
}
const css = fs.readFileSync(cssFile, 'utf8');

const idOf = function (prefix) {
    const m = css.match(new RegExp(`\\.${prefix}__([A-Za-z0-9_-]+)`));
    if (!m) throw new Error(`no class starting with ${prefix} in ${path.basename(cssFile)}`);
    return `${prefix}__${m[1]}`;
};

const cls = {
    cover: idOf('Cover_cover'),
    page: idOf('TrackList_page'),
    tracks: idOf('TrackList_tracks'),
    row: idOf('TrackList_row'),
    track: idOf('TrackList_track'),
    thumb: idOf('TrackList_track-thumb'),
    overlay: idOf('TrackList_thumb-overlay'),
    text: idOf('TrackList_track-text'),
    title: idOf('TrackList_track-title'),
    artist: idOf('TrackList_track-artist'),
    menu: idOf('MusicApp_menu'),
    rowHead: idOf('MusicApp_row-head'),
    rowCover: idOf('MusicApp_row-cover'),
    rowMeta: idOf('MusicApp_row-meta'),
    rowTitle: idOf('MusicApp_row-title'),
    rowArtist: idOf('MusicApp_row-artist'),
    discLabel: idOf('NowPlaying_disc-label'),
    rotor: idOf('NowPlaying_rotor'),
    grooves: idOf('NowPlaying_disc-grooves'),
    cacheItem: idOf('CacheManager_item'),
    cacheThumb: idOf('CacheManager_item-thumb'),
};

const NOTE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>';
const PLAY = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';

// 4:1 stripes — deliberately not square, so `object-fit: cover` has something to
// crop and a stretched image would be obvious.
const WIDE = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="120">'
    + '<rect width="480" height="120" fill="#1d2b64"/>'
    + '<g fill="#f8cdda"><rect x="0" y="0" width="40" height="120"/><rect x="80" y="0" width="40" height="120"/>'
    + '<rect x="160" y="0" width="40" height="120"/><rect x="240" y="0" width="40" height="120"/>'
    + '<rect x="320" y="0" width="40" height="120"/><rect x="400" y="0" width="40" height="120"/></g></svg>',
);
// 1:1, so the circle and the square tiles get a clean fill.
const SQUARE = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">'
    + '<rect width="200" height="200" fill="#0f2027"/>'
    + '<circle cx="100" cy="100" r="74" fill="#2c5364"/>'
    + '<path d="M40 160 L100 40 L160 160 Z" fill="#7ee7c7" opacity="0.85"/></svg>',
);
const REMOTE = 'https://ianyspace.github.io/music/icon-512.png';

const GRAD = 'linear-gradient(135deg,#fb5c74,#fa233b)';
const GRAD2 = 'linear-gradient(135deg,#64d2ff,#0a84ff)';

/** One phone list row. `cover` is the image src, or '' for the gradient case. */
const listRow = function (title, artist, gradient, cover, active) {
    return `      <li class="${cls.row}">
        <div class="${active ? cls.track + ' ' + cls.track : cls.track}" style="opacity:1">
          <span class="${cls.thumb}" style="background:${gradient}">
            ${cover ? `<img class="${cls.cover}" src="${cover}" alt="" />` : ''}
            ${active ? `<span class="${cls.overlay}">${PLAY}</span>` : NOTE}
          </span>
          <span class="${cls.text}">
            <span class="${cls.title}">${title}</span>
            <span class="${cls.artist}">${artist}</span>
          </span>
        </div>
      </li>`;
};

const drawer = function (withCover) {
    return `  <div class="${cls.menu}" style="position:relative;transform:none">
    <div class="${cls.rowHead}">
      <span class="${cls.rowCover}" style="background:${GRAD2}">
        ${withCover ? `<img class="${cls.cover}" src="${SQUARE}" alt="" />` : ''}
        ${NOTE}
      </span>
      <span class="${cls.rowMeta}">
        <span class="${cls.rowTitle}">${withCover ? '有封面' : '没有封面'}</span>
        <span class="${cls.rowArtist}">抽屉里的 62px 方块</span>
      </span>
    </div>
  </div>`;
};

const record = function (withCover) {
    return `  <div class="${cls.rotor}" style="position:relative;width:200px;height:200px;animation:none">
    <span class="${cls.grooves}"></span>
    <span class="${cls.discLabel}" style="background:${GRAD}">
      ${withCover ? `<img class="${cls.cover}" src="${SQUARE}" alt="" />` : ''}
      ${NOTE}
    </span>
  </div>`;
};

const cacheRow = function (withCover) {
    return `  <div class="${cls.cacheItem}">
    <span class="${cls.cacheThumb}" style="background:${GRAD2}">
      ${withCover ? `<img class="${cls.cover}" src="${WIDE}" alt="" />` : ''}
      ${NOTE}
    </span>
    <span>${withCover ? '缓存管理里也有封面' : '缓存管理里的回落'}</span>
  </div>`;
};

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>covers — the overlay, on every shape</title>
<style>${css}</style>
<style>
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
         background: var(--bg, #f5f6fa); display: flex; gap: 28px; align-items: flex-start; padding: 18px; }
  .col { width: 340px; }
  .col > h2 { font: 600 12px/1.4 ui-monospace, monospace; color: #667; margin: 0 0 8px; }
  /* The list normally scrolls inside the page; here it is a plain block. */
  .${cls.tracks} { padding: 0; margin: 0; list-style: none; }
  .${cls.menu} { margin-bottom: 18px; }
  #out { position: fixed; right: 10px; bottom: 10px; z-index: 1000; background: rgba(0,0,0,.84);
    color: #7ee787; font: 11px/1.55 ui-monospace, monospace; padding: 8px 10px;
    border-radius: 6px; white-space: pre; max-width: 46vw; }
</style>
</head>
<body>
<div class="col">
  <h2>list rows — cover / no cover / cover + scrim</h2>
  <ul class="${cls.tracks}">
${listRow('有封面', '应该看到条纹图', GRAD, WIDE, false)}
${listRow('没有封面', '应该看到渐变 + 音符', GRAD, '', false)}
${listRow('播放中的行', '遮罩必须在图上面', GRAD, WIDE, true)}
${listRow('远程真图', 'icon-512.png', GRAD2, REMOTE, false)}
  </ul>
</div>
<div class="col">
  <h2>drawer 62px tile</h2>
${drawer(true)}
${drawer(false)}
  <h2>cache manager 42px tile</h2>
${cacheRow(true)}
${cacheRow(false)}
</div>
<div class="col">
  <h2>record label — circle</h2>
${record(true)}
${record(false)}
</div>

<div id="out">measuring…</div>
<script>
  const cls = ${JSON.stringify(cls)};
  const row = (l, v) => l.padEnd(30) + v;
  const r = (el) => el.getBoundingClientRect();
  const round = (n) => Math.round(n * 100) / 100;

  // The image must cover its tile exactly: same box, same radius, and the
  // tile's own 1px hairline repainted on top of the photo.
  const tiles = [
    ['list thumb', '.' + cls.thumb],
    ['drawer tile', '.' + cls.rowCover],
    ['cache tile', '.' + cls.cacheThumb],
    ['record label', '.' + cls.discLabel],
  ];
  const lines = [];
  tiles.forEach(([name, selector]) => {
    const tile = document.querySelector(selector);
    const img = tile && tile.querySelector('.' + cls.cover);
    if (!tile || !img) { lines.push(row(name, 'NO IMAGE')); return; }
    const t = r(tile); const i = r(img);
    const ts = getComputedStyle(tile); const is = getComputedStyle(img);
    lines.push(row(name + ' box', round(t.width) + '×' + round(t.height)
      + ' vs img ' + round(i.width) + '×' + round(i.height)
      + (Math.abs(t.width - i.width) < 0.5 && Math.abs(t.height - i.height) < 0.5 ? '  same' : '  DIFFERENT')));
    lines.push(row(name + ' radius', ts.borderRadius + ' vs ' + is.borderRadius
      + (ts.borderRadius === is.borderRadius ? '  same' : '  DIFFERENT')));
    lines.push(row(name + ' shadow', (is.boxShadow || 'none') === (ts.boxShadow || 'none') ? 'inherited' : 'DIFFERENT — ' + is.boxShadow));
    lines.push(row(name + ' pointer-events', is.pointerEvents));
    lines.push(row(name + ' object-fit', is.objectFit));
  });

  // Paint order, the one thing CSS geometry cannot tell us: what a finger at
  // the centre of the tile actually hits. pointer-events:none makes the photo
  // invisible to hit-testing, so a tap still lands on the row — while an
  // *active* row must land on the scrim, not under it.
  const active = document.querySelector('.' + cls.overlay);
  const activeTile = active && active.closest('.' + cls.thumb);
  if (activeTile) {
    const box = r(activeTile);
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    lines.push(row('scrim hit-test', hit === active || active.contains(hit) ? 'scrim on top' : 'NOT the scrim — ' + hit.className));
  }
  const plainTile = document.querySelector('.' + cls.thumb);
  if (plainTile) {
    const box = r(plainTile);
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    lines.push(row('covered row hit-test', hit && hit.tagName === 'IMG' ? 'IMG — the photo eats taps' : 'the row (photo is inert)'));
  }

  // A decoded photo really paints. The four data-URI rows prove the geometry;
  // this one proves an <img> that actually loaded is visible at all — read on
  // the window's load event, because a naturalWidth taken while the request is
  // still in flight is 0 and looks exactly like a broken image.
  const report = function () {
    const remote = document.querySelector('img[src^="https://"]');
    lines.push(row('remote image decoded', remote ? (remote.naturalWidth + '×' + remote.naturalHeight + ' (want 512×512)') : 'not found'));
    lines.push(row('images that failed', [...document.images].filter((i) => !i.naturalWidth).length + ' of ' + document.images.length));
    document.getElementById('out').textContent = lines.join('\\n');
  };
  if (document.readyState === 'complete') report();
  else window.addEventListener('load', report);
</script>
</body>
</html>`;

const outFile = process.argv[2] || path.join(root, 'out/_preview-covers.html');
fs.writeFileSync(outFile, html);
console.log(`wrote ${outFile}`);
