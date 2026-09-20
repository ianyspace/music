#!/usr/bin/env node
/**
 * Renders the four empty-list messages the way the two layouts actually build
 * them — real CSS-module output, hard-coded markup — into one HTML file, so
 * the messages can be eyeballed and measured without the app's audio/Auth
 * plumbing.
 *
 * The messages come from `shared.js` at runtime; this page renders the same
 * strings by hand, so what it settles is not the wording but the shape. What a
 * browser can settle that a string comparison cannot:
 *
 *   - that the phone's message is the list's *sibling*, so the `<ul>` has no
 *     element children — a `<p>` inside a `<ul>` is invalid HTML, and it makes
 *     the list announce the message as an item of its own;
 *   - that the message is actually visible in both layouts: non-zero box, an
 *     opaque colour, inside the column's padding box;
 *   - that the two layouts still read as their own layouts — 13.5px on the
 *     phone, 13px on the panel — while sharing one class name per module.
 *
 * The two layouts are shaped differently on purpose, and the markup here
 * follows each: the phone keeps its `<ul>` mounted (the jump button in the
 * player bar looks it up by id) and puts the message beside it, while the panel
 * swaps the list for the message outright. The old shape — a `<p>` inside the
 * `<ul>` — is rendered alongside the new one, because "the message moved out of
 * the list" is the whole change and a screenshot of the new shape alone cannot
 * show that it moved.
 *
 * Run: node scripts/preview-empty-list.js [outFile]
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const cssDir = path.join(root, 'out/_next/static/css');
const cssFiles = fs.readdirSync(cssDir).filter((f) => f.endsWith('.css'));
const css = cssFiles.map((f) => fs.readFileSync(path.join(cssDir, f), 'utf8')).join('\n');

if (!/TrackList_list-empty/.test(css) || !/DesktopMusic_list-empty/.test(css)) {
    console.error('the built CSS has no list-empty rule — run `npm run build` first');
    process.exit(1);
}

const idOf = function (prefix) {
    const m = css.match(new RegExp(`\\.${prefix}__([A-Za-z0-9_-]+)`));
    if (!m) throw new Error(`no class starting with ${prefix} in the built CSS`);
    return `${prefix}__${m[1]}`;
};

// Only what the markup below actually uses. Every entry here is a hard lookup
// that *throws* when the class is gone, which is the point — but it also means
// a name left behind after the element it belonged to was deleted takes the
// whole script down with it. Two had been sitting here for a while
// (`TrackList_title` and the panel's `panel-tools` / `tool-btn`), so the page
// had stopped rendering at all and nobody could see it had.
const cls = {
    page: idOf('TrackList_page'),
    tracks: idOf('TrackList_tracks'),
    phoneMsg: idOf('TrackList_list-empty'),
    wrap: idOf('DesktopMusic_list-wrap'),
    deskMsg: idOf('DesktopMusic_list-empty'),
};

// Four representative states of `emptyListMessage`, in the order the helper
// tests them. The helper also has a 只看喜欢 + keyword variant, which is the
// same branch with a different wording — the four below are the shapes that
// differ in *markup* terms, which is what this page is for.
const STATES = [
    ['曲库还在加载', '加载中…'],
    ['搜了但没搜到', '没有匹配「周杰伦」的歌曲'],
    ['只看喜欢，但还没喜欢过', '还没有喜欢的歌曲，在歌曲右侧的「更多」里可以喜欢'],
    ['曲库真的是空的', '没有找到音频文件，去「我的」换个文件夹试试？'],
];

const phoneState = function (label, text, invalid) {
    const message = `        <p class="${cls.phoneMsg}">${text}</p>`;
    return `  <section class="case">
    <h2 class="caption">${label}${invalid ? ' — 旧写法' : ''}</h2>
    <div class="${cls.page}">
      <ul class="${cls.tracks}" data-role="${invalid ? 'old' : 'new'}">${invalid ? `\n${message}\n      ` : ''}</ul>
${invalid ? '' : `${message}\n`}    </div>
  </section>`;
};

const phoneCases = STATES
    .map(([label, text]) => phoneState(label, text, false))
    .concat([phoneState(STATES[2][0], STATES[2][1], true)])
    .join('\n');

const deskCases = STATES
    .map(([label, text]) => `  <section class="case">
    <h2 class="caption">${label}</h2>
    <div class="${cls.wrap}">
      <p class="${cls.deskMsg}">${text}</p>
    </div>
  </section>`)
    .join('\n');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>empty list — one decision, two layouts</title>
<style>${css}</style>
<style>
  html, body { margin: 0; padding: 0; background: #0b0b0f; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; }
  /* 390px, so TrackList's own max-width:520px rules are the ones in force —
     a phone preview measured at desktop width would report the wrong recipe. */
  #phone { width: 390px; }
  .case { border-bottom: 1px dashed rgba(255,255,255,.14); }
  .caption { margin: 0; padding: 8px 12px 0; font-size: 11px; font-weight: 600;
    letter-spacing: .02em; color: #8b949e; }
  /* The panel is a grid column in the app; here it just needs the width it has
     there, so the message wraps the way it does on screen. */
  #desktop { width: 296px; padding: 0 0 20px; }
  #desktop .case { padding-bottom: 4px; }
  #out { position: fixed; left: 50%; transform: translateX(-50%); bottom: 8px; z-index: 1000;
    background: rgba(0,0,0,.85); color: #7ee787; font: 11px/1.55 ui-monospace, monospace;
    padding: 8px 10px; border-radius: 6px; white-space: pre; max-height: 46vh; overflow: auto; }
  /* The overlay is wider than the phone column, so it covers the panel's
     messages. Drop it with ?noout when the point is to look, not to measure. */
  html.noout #out { display: none; }
</style>
</head>
<body>
<div style="display:flex;align-items:flex-start;gap:24px;padding:12px">
  <div id="phone">
    <h1 class="caption" style="padding-bottom:6px">手机列表 · TrackList</h1>
${phoneCases}
  </div>
  <div id="desktop">
    <h1 class="caption" style="padding-bottom:6px">宽屏面板 · DesktopMusic</h1>
${deskCases}
  </div>
</div>

<div id="out">measuring…</div>
<script>
  const lines = [];
  const row = (l, v) => l.padEnd(34) + v;
  const box = (el) => el.getBoundingClientRect();
  const colour = (el) => getComputedStyle(el).color;

  lines.push('--- structure: a <ul> may only hold <li> ---');
  document.querySelectorAll('ul').forEach((ul, i) => {
    const kids = [...ul.children].map((c) => c.tagName);
    const bad = kids.filter((t) => t !== 'LI');
    lines.push(row('list ' + i + ' (' + ul.dataset.role + ')',
      kids.length + ' element children'
      + (bad.length ? '  INVALID: ' + bad.join(',') : '  all <li> (or empty)')));
  });
  lines.push(row('phone', document.querySelectorAll('#phone p').length + ' messages, '
    + document.querySelectorAll('#phone ul').length + ' lists (kept mounted)'));
  lines.push(row('panel', document.querySelectorAll('#desktop p').length + ' messages, '
    + document.querySelectorAll('#desktop ul').length + ' lists (swapped out)'));
  document.querySelectorAll('p').forEach((p) => {
    lines.push(row('message parent', p.parentElement.tagName
      + (p.parentElement.tagName === 'UL' ? '  INVALID — inside the list' : '')));
  });

  lines.push('');
  lines.push('--- the message on screen ---');
  const visible = (p) => {
    const b = box(p);
    return b.width > 0 && b.height > 0 && colour(p) !== 'rgba(0, 0, 0, 0)';
  };
  const sample = (p) => {
    const b = box(p);
    const s = getComputedStyle(p);
    return [b.width.toFixed(1) + 'x' + b.height.toFixed(1),
      s.fontSize,
      s.textAlign,
      visible(p) ? 'visible' : 'INVISIBLE'].join('  ');
  };
  const firstPhone = document.querySelector('#phone .${cls.phoneMsg}');
  const firstDesk = document.querySelector('#desktop .${cls.deskMsg}');
  lines.push(row('phone message', firstPhone ? sample(firstPhone) : 'not found'));
  lines.push(row('panel message', firstDesk ? sample(firstDesk) : 'not found'));

  // The two layouts keep their own typography; one class *name* per module is
  // about the markup, not about making the phone and the panel look alike.
  if (firstPhone && firstDesk) {
    const a = getComputedStyle(firstPhone).fontSize;
    const b = getComputedStyle(firstDesk).fontSize;
    lines.push(row('phone vs panel font-size', a + ' vs ' + b + (a === b ? '  SAME — the layouts collapsed' : '  each its own')));
  }

  // Nothing may stick out of its column: the phone page's padding box and the
  // panel's wrapper are the two edges that would clip a long message.
  const overflow = (host, p) => {
    const h = box(host); const b = box(p);
    return b.left >= h.left - 0.5 && b.right <= h.right + 0.5
      ? 'inside'
      : 'OVERFLOWS by ' + Math.max(0, h.left - b.left, b.right - h.right).toFixed(1) + 'px';
  };
  if (firstPhone) lines.push(row('phone message inside its column', overflow(firstPhone.parentElement, firstPhone)));
  if (firstDesk) lines.push(row('panel message inside its column', overflow(firstDesk.parentElement, firstDesk)));

  // Every message, not just the first: the longest one is the one that wraps.
  // The phone leaves line-height at its inherited value, so a line count is
  // only available where the rule states one (the panel sets 1.8).
  lines.push('');
  lines.push('--- all messages ---');
  document.querySelectorAll('p').forEach((p) => {
    const b = box(p);
    const lh = getComputedStyle(p).lineHeight;
    const n = parseFloat(lh);
    lines.push(row(p.textContent.slice(0, 14), b.width.toFixed(0) + 'x' + b.height.toFixed(0)
      + '  lines~' + (Number.isFinite(n) ? (b.height / n).toFixed(1) : 'n/a (' + lh + ')')
      + '  ' + (visible(p) ? 'visible' : 'INVISIBLE')));
  });

  document.getElementById('out').textContent = lines.join('\\n');
  if (location.search.includes('noout')) document.documentElement.className = 'noout';
</script>
</body>
</html>`;

const outFile = process.argv[2] || path.join(root, 'out/_preview-empty-list.html');
fs.writeFileSync(outFile, html);
console.log(`wrote ${outFile}`);
