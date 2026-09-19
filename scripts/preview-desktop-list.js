#!/usr/bin/env node
/**
 * Renders a stand-in for the wide-screen list panel (real CSS module output,
 * hard-coded markup) into a single HTML file, so the panel's layout and the
 * jump button's placement can be eyeballed and measured in a browser without
 * the app's audio/Auth plumbing.
 *
 * The markup mirrors `DesktopMusic.js`: header, tools, then a `.list-wrap`
 * holding the scroller and the button as siblings — the whole point of the
 * wrapper being that the button must not scroll with the rows.
 *
 * Run: node scripts/preview-desktop-list.js [outFile]
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const cssDir = path.join(root, 'out/_next/static/css');
const cssFile = fs.readdirSync(cssDir)
    .map((f) => path.join(cssDir, f))
    .find((f) => fs.readFileSync(f, 'utf8').includes('DesktopMusic_locate-btn'));
if (!cssFile) {
    console.error('no built CSS contains DesktopMusic_locate-btn — run `npm run build` first');
    process.exit(1);
}
const css = fs.readFileSync(cssFile, 'utf8');

const idOf = function (prefix) {
    const m = css.match(new RegExp(`\\.${prefix}__([A-Za-z0-9_-]+)`));
    if (!m) throw new Error(`no class starting with ${prefix} in ${path.basename(cssFile)}`);
    return `${prefix}__${m[1]}`;
};

const cls = {
    root: idOf('DesktopMusic_root'),
    backdrop: idOf('DesktopMusic_backdrop'),
    panel: idOf('DesktopMusic_panel'),
    panelOpen: idOf('DesktopMusic_panel-open'),
    head: idOf('DesktopMusic_panel-head'),
    brand: idOf('DesktopMusic_brand'),
    brandMark: idOf('DesktopMusic_brand-mark'),
    brandText: idOf('DesktopMusic_brand-text'),
    brandName: idOf('DesktopMusic_brand-name'),
    brandSub: idOf('DesktopMusic_brand-sub'),
    railBtn: idOf('DesktopMusic_rail-btn'),
    tools: idOf('DesktopMusic_panel-tools'),
    toolBtn: idOf('DesktopMusic_tool-btn'),
    wrap: idOf('DesktopMusic_list-wrap'),
    list: idOf('DesktopMusic_list'),
    row: idOf('DesktopMusic_track-row'),
    item: idOf('DesktopMusic_item'),
    itemActive: idOf('DesktopMusic_item-active'),
    thumb: idOf('DesktopMusic_item-thumb'),
    text: idOf('DesktopMusic_item-text'),
    title: idOf('DesktopMusic_item-title'),
    artist: idOf('DesktopMusic_item-artist'),
    more: idOf('DesktopMusic_item-more'),
    foot: idOf('DesktopMusic_panel-foot'),
    footSep: idOf('DesktopMusic_foot-sep'),
    footLink: idOf('DesktopMusic_foot-link'),
    locate: idOf('DesktopMusic_locate-btn'),
    pulse: idOf('DesktopMusic_track-pulse'),
};

const NOTE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>';
const DOTS = '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>';
const LOCATE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 9.5 12 14l4.5-4.5"/><path d="M5.5 18.5h13" stroke-width="1.7"/></svg>';
const REFRESH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4.5V9h-4.5"/></svg>';
const SEARCH = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="6.4"/><path d="m16 16 4 4"/></svg>';

const ACTIVE_INDEX = 3; // near the top, so the list must be scrolled to hide it
const rows = Array.from({ length: 26 }, (_, i) => {
    const active = i === ACTIVE_INDEX;
    return `      <li class="${cls.row}" data-track-id="t${i}">
        <button type="button" class="${active ? cls.itemActive : cls.item}" title="第 ${i + 1} 首 - 歌手">
          <span class="${cls.thumb}" style="background:linear-gradient(135deg,#fa233b,#5e5ce6)">${NOTE}</span>
          <span class="${cls.text}">
            <span class="${cls.title}">第 ${i + 1} 首歌的名字</span>
            <span class="${cls.artist}">某位歌手</span>
          </span>
          ${active ? `<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>` : ''}
        </button>
        <button type="button" class="${cls.more}" aria-label="更多操作">${DOTS}</button>
      </li>`;
}).join('\n');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>desktop list — jump button placement</title>
<style>${css}</style>
<style>
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; }
  /* Minimal stand-ins for the icons and the equalizer, which come from
     icons.js / the module's own rules in the real component. */
  .eq { display: inline-flex; align-items: flex-end; gap: 2.5px; height: 14px; color: var(--accent); flex-shrink: 0; }
  .eq i { display: block; width: 3px; height: 9px; border-radius: 2px; background: currentColor; }
  .eq i:nth-child(2) { height: 14px; }
  .eq i:nth-child(3) { height: 6px; }
  /* Headless virtual time freezes CSS animations on their first keyframe, so the
     entry animation would be measured and photographed at scale(0.9) and 8px
     low — the button is shown at rest instead. The pulse is deliberately left
     alone: frozen at 0% is its strongest frame, which is the one worth seeing. */
  .${cls.locate} { animation: none; }
  #out { position: fixed; right: 10px; bottom: 10px; z-index: 1000; background: rgba(0,0,0,.82);
    color: #7ee787; font: 11px/1.55 ui-monospace, monospace; padding: 8px 10px;
    border-radius: 6px; white-space: pre; }
</style>
</head>
<body>
<div class="${cls.root}">
  <div class="${cls.backdrop}" aria-hidden="true"></div>
  <aside class="${cls.panel} ${cls.panelOpen}">
    <header class="${cls.head}">
      <div class="${cls.brand}">
        <span class="${cls.brandMark}">${NOTE}</span>
        <span class="${cls.brandText}">
          <span class="${cls.brandName}">Music Space</span>
          <span class="${cls.brandSub}">26 首</span>
        </span>
      </div>
      <button type="button" class="${cls.railBtn}" aria-label="刷新列表">${REFRESH}</button>
    </header>
    <div class="${cls.tools}">
      <button type="button" class="${cls.toolBtn}" aria-label="搜索">${SEARCH}<span>搜索歌曲</span></button>
    </div>
    <div class="${cls.wrap}">
      <ul class="${cls.list}">
${rows}
      </ul>
      <button type="button" class="${cls.locate}" title="回到正在播放" aria-label="回到正在播放">${LOCATE}</button>
    </div>
    <footer class="${cls.foot}">
      <span>在线</span>
      <span class="${cls.footSep}" aria-hidden="true">·</span>
      <button type="button" class="${cls.footLink}">浅色</button>
    </footer>
  </aside>
</div>

<div id="out">measuring…</div>
<script>
  const list = document.querySelector('.${cls.list}');
  const wrap = document.querySelector('.${cls.wrap}');
  const btn = document.querySelector('.${cls.locate}');
  const foot = document.querySelector('.${cls.foot}');
  const active = document.querySelector('.${cls.itemActive}');
  const row = (l, v) => l.padEnd(32) + v;

  // Scroll the list away from the active row — that is the state the button
  // exists for, and the one the screenshot has to show. Adding ?pulse to the
  // URL instead jumps to the row and applies the one-shot tint, to check the
  // flash itself.
  const pulse = location.search.includes('pulse');
  if (pulse) {
    active.scrollIntoView({ block: 'center' });
    active.classList.add('${cls.pulse}');
  } else {
    list.scrollTop = list.scrollHeight;
  }

  const r = (el) => el.getBoundingClientRect();

  // Measured after the locate-in animation has finished. That animation is
  // "both", so a reading taken while it plays reports the from state —
  // scale(0.9) and an 8px offset — which looks exactly like a layout bug and
  // is not one.
  setTimeout(() => {
    const w = r(wrap); const t = r(btn); const f = r(foot); const l = r(list); const a = r(active);

    document.getElementById('out').textContent = [
      row('viewport', innerWidth + ' × ' + innerHeight),
      row('list scrollable?', list.scrollHeight > list.clientHeight ? 'yes (' + (list.scrollHeight - list.clientHeight) + 'px)' : 'NO'),
      row('list rect', [l.left, l.top, l.right, l.bottom].map(n => n.toFixed(1)).join('  ')),
      row('btn  rect', [t.left, t.top, t.right, t.bottom].map(n => n.toFixed(1)).join('  ')),
      row('btn diameter', t.width.toFixed(1) + ' × ' + t.height.toFixed(1) + ' (want 32 × 32)'),
      row('btn right → list right', (l.right - t.right).toFixed(1) + ' px (want 14: 10 + the -4px bleed)'),
      row('btn bottom → list bottom', (l.bottom - t.bottom).toFixed(1) + ' px (want 12)'),
      row('btn clear of footer?', t.bottom <= f.top ? 'yes (' + (f.top - t.bottom).toFixed(1) + 'px)' : 'NO — overlaps'),
      row('wrapper bottom − list bottom', (w.bottom - l.bottom).toFixed(1) + ' px (want 0)'),
      row('wrapper height − list height', (w.height - l.height).toFixed(1) + ' px (want 0)'),
      row('btn inside the panel?', t.left >= w.left && t.right <= w.right + 4 ? 'yes' : 'NO'),
      row('btn pinned to wrapper?', Math.abs(t.bottom - w.bottom) < 30 ? 'yes' : 'NO'),
      row('active row on screen?', a.bottom > l.top && a.top < l.bottom ? 'yes (should be no)' : 'no'),
      row('active row offset from list top', (a.top - l.top).toFixed(1) + ' px'),
      row('wrapper scrolls on its own?', wrap.scrollHeight > wrap.clientHeight + 1 ? 'YES — bad' : 'no'),
      row('btn computed transform', getComputedStyle(btn).transform),
      row('devicePixelRatio', String(devicePixelRatio)),
    ].join('\\n');
  }, 500);
</script>
</body>
</html>`;

const outFile = process.argv[2] || path.join(root, 'out/_preview-desktop-list.html');
fs.writeFileSync(outFile, html);
console.log(`wrote ${outFile}`);
