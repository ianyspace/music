#!/usr/bin/env node
/**
 * Renders a stand-in for the phone layout's mini bar (real CSS module output,
 * hard-coded markup) into a single HTML file, so the button's placement can be
 * eyeballed and measured in a browser without the app's audio/Auth plumbing.
 *
 * Run: node scripts/preview-locate-btn.js [outFile]
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const cssDir = path.join(root, 'out/_next/static/css');
const cssFile = fs.readdirSync(cssDir)
    .map((f) => path.join(cssDir, f))
    .find((f) => fs.readFileSync(f, 'utf8').includes('MiniPlayer_locate-btn'));
if (!cssFile) {
    console.error('no built CSS contains MiniPlayer_locate-btn — run `npm run build` first');
    process.exit(1);
}
const css = fs.readFileSync(cssFile, 'utf8');

// Class names come from the build output, so this stays honest if they change.
const idOf = function (prefix) {
    const m = css.match(new RegExp(`\\.${prefix}__([A-Za-z0-9_-]+)`));
    if (!m) throw new Error(`no class starting with ${prefix} in ${path.basename(cssFile)}`);
    return `${prefix}__${m[1]}`;
};

const cls = {
    wrap: idOf('MiniPlayer_wrap'),
    mini: idOf('MiniPlayer_mini'),
    disc: idOf('MiniPlayer_disc'),
    discCover: idOf('MiniPlayer_disc-cover'),
    label: idOf('MiniPlayer_mini-label'),
    playWrap: idOf('MiniPlayer_play-wrap'),
    playBtn: idOf('MiniPlayer_play-btn'),
    btn: idOf('MiniPlayer_btn'),
    locate: idOf('MiniPlayer_locate-btn'),
};
const page = idOf('MusicApp_page');
const app = idOf('MusicApp_app');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>mini bar — locate button placement</title>
<style>${css}</style>
<style>
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; }
  /* A ruler grid over the whole viewport: 20px vertical guides off centre, so
     the button's alignment with the bar's right edge is readable by eye. */
  .grid { position: fixed; inset: 0; pointer-events: none; z-index: 999;
    background-image:
      repeating-linear-gradient(to right, rgba(0,150,255,.28) 0 1px, transparent 1px 20px),
      repeating-linear-gradient(to bottom, rgba(255,0,80,.22) 0 1px, transparent 1px 20px); }
  .centre { position: fixed; left: 50%; top: 0; bottom: 0; width: 1px; background: #0096ff; z-index: 999; }
  .probe { position: fixed; z-index: 999; background: rgba(0,150,255,.9); color: #fff;
    font: 11px/1.6 ui-monospace, monospace; padding: 2px 6px; border-radius: 4px; }
  #out { position: fixed; left: 8px; top: 8px; z-index: 1000; background: rgba(0,0,0,.82);
    color: #7ee787; font: 11px/1.5 ui-monospace, monospace; padding: 8px 10px;
    border-radius: 6px; white-space: pre; }
</style>
</head>
<body>
<div class="${page}">
  <div class="${app}">
    <p style="padding:16px;color:#666">${'曲库里的歌'.repeat(40)}</p>
  </div>
</div>

<div class="${cls.wrap}">
  <div class="${cls.mini}" role="button" aria-label="打开播放页">
    <span class="${cls.disc}">
      <span class="${cls.discCover}" style="background:linear-gradient(135deg,#fa233b,#5e5ce6)"></span>
    </span>
    <span class="${cls.label}" style="flex:1">正在播放的歌 - 某个歌手</span>
    <span class="${cls.playWrap}">
      <button type="button" class="${cls.playBtn}" aria-label="暂停">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4.2" height="15" rx="1.6"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.6"/></svg>
      </button>
    </span>
    <button type="button" class="${cls.btn}" aria-label="下一首">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="17.6" y="5.4" width="2.4" height="13.2" rx="1.2"/><path d="M4 7v10a1.1 1.1 0 0 0 1.7.92l7.6-5a1.1 1.1 0 0 0 0-1.84l-7.6-5A1.1 1.1 0 0 0 4 7z"/></svg>
    </button>
  </div>
  <button type="button" class="${cls.locate}" aria-label="回到正在播放">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 9.5 12 14l4.5-4.5"/><path d="M5.5 18.5h13" stroke-width="1.7"/></svg>
  </button>
</div>

<div class="grid"></div>
<div class="centre"></div>
<div id="out">measuring…</div>
<script>
  const bar = document.querySelector('.${cls.mini}');
  const btn = document.querySelector('.${cls.locate}');
  const wrap = document.querySelector('.${cls.wrap}');
  const b = bar.getBoundingClientRect();
  const t = btn.getBoundingClientRect();
  const w = wrap.getBoundingClientRect();
  const row = (label, value) => label.padEnd(34) + value;
  document.getElementById('out').textContent = [
    row('viewport', innerWidth + ' × ' + innerHeight),
    row('bar  rect', [b.left, b.top, b.right, b.bottom].map(n => n.toFixed(1)).join('  ')),
    row('wrap rect', [w.left, w.top, w.right, w.bottom].map(n => n.toFixed(1)).join('  ')),
    row('btn  rect', [t.left, t.top, t.right, t.bottom].map(n => n.toFixed(1)).join('  ')),
    row('btn → bar right edge', (b.right - t.right).toFixed(1) + ' px'),
    row('btn bottom → bar top', (b.top - t.bottom).toFixed(1) + ' px (want 6)'),
    row('btn centre x → viewport centre', (t.left + t.width / 2 - innerWidth / 2).toFixed(1) + ' px'),
    row('btn inside bar horizontally?', (t.left >= b.left && t.right <= b.right) ? 'yes' : 'NO'),
    row('btn overlaps bar box?', (t.bottom > b.top && t.top < b.bottom) ? 'NO (good)' : 'no'),
    row('bar centred on column?', Math.abs((b.left + b.right) / 2 - innerWidth / 2) < 0.6 ? 'yes' : 'NO'),
    row('bar width / height', b.width.toFixed(1) + ' × ' + b.height.toFixed(1)),
    row('btn diameter', t.width.toFixed(1) + ' × ' + t.height.toFixed(1)),
  ].join('\\n');

  // Draw a probe line where the bar's top edge and right edge are.
  const mk = (x, y, text) => {
    const d = document.createElement('div');
    d.className = 'probe';
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    d.textContent = text;
    document.body.appendChild(d);
  };
  mk(b.right + 4, b.top - 24, 'bar top-right');
  mk(t.left - 90, t.top + 8, 'btn');
</script>
</body>
</html>`;

const outFile = process.argv[2] || path.join(root, 'out/_preview-locate.html');
fs.writeFileSync(outFile, html);
console.log(`wrote ${outFile}`);
console.log(`classes: ${JSON.stringify(cls, null, 2)}`);
