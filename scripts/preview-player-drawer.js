#!/usr/bin/env node
/**
 * Renders the player's preferences drawer as a standalone page, using the real
 * built CSS. Both switch states are shown side by side (plus the record with
 * and without ripples), so the drawer and the switch can be eyeballed without
 * opening the app and starting playback.
 *
 * Run: node scripts/preview-player-drawer.js [outFile]
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const cssDir = path.join(root, 'out/_next/static/css');
const cssFile = fs.readdirSync(cssDir)
    .map((f) => path.join(cssDir, f))
    .find((f) => fs.readFileSync(f, 'utf8').includes('NowPlaying_sheet-row'));
if (!cssFile) {
    console.error('no built CSS contains NowPlaying_sheet-row — run `npm run build` first');
    process.exit(1);
}
const css = fs.readFileSync(cssFile, 'utf8');

const idOf = function (prefix) {
    const m = css.match(new RegExp(`\\.${prefix}__([A-Za-z0-9_-]+)`));
    if (!m) throw new Error(`no class starting with ${prefix}`);
    return `${prefix}__${m[1]}`;
};

const cls = {
    page: idOf('NowPlaying_page'),
    topbar: idOf('NowPlaying_topbar'),
    topBtn: idOf('NowPlaying_top-btn'),
    topBtnOn: idOf('NowPlaying_top-btn-on'),
    rig: idOf('NowPlaying_rig'),
    noRipples: idOf('NowPlaying_rig-no-ripples'),
    ripples: idOf('NowPlaying_ripples'),
    ripple: idOf('NowPlaying_ripple'),
    rotor: idOf('NowPlaying_rotor'),
    grooves: idOf('NowPlaying_disc-grooves'),
    label: idOf('NowPlaying_disc-label'),
    sheen: idOf('NowPlaying_disc-sheen'),
    sheetScrim: idOf('NowPlaying_sheet-scrim'),
    sheet: idOf('NowPlaying_sheet'),
    grip: idOf('NowPlaying_sheet-grip'),
    sheetTitle: idOf('NowPlaying_sheet-title'),
    sheetRow: idOf('NowPlaying_sheet-row'),
    rowIcon: idOf('NowPlaying_sheet-row-icon'),
    rowText: idOf('NowPlaying_sheet-row-text'),
    rowTitle: idOf('NowPlaying_sheet-row-title'),
    rowSub: idOf('NowPlaying_sheet-row-sub'),
    sw: idOf('NowPlaying_switch'),
    swOn: idOf('NowPlaying_switch-on'),
};

const GRAD = 'linear-gradient(135deg,#fb5c74,#fa233b)';

const rippleIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M19.4 5a10.4 10.4 0 0 1 0 14"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4"/><path d="M4.6 5a10.4 10.4 0 0 0 0 14"/></svg>`;
const moreIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>`;

const record = function (withRipples) {
    return `<div class="${cls.rig}${withRipples ? '' : ` ${cls.noRipples}`}" style="position:relative;width:190px;height:190px">
      <span class="${cls.ripples}" aria-hidden="true">
        <span class="${cls.ripple}"></span><span class="${cls.ripple}"></span><span class="${cls.ripple}"></span>
      </span>
      <span class="${cls.rotor}" style="position:absolute;inset:0;display:block;border-radius:50%;background:radial-gradient(circle at 50% 50%,#2a2b33,#101117 72%)">
        <span class="${cls.grooves}"></span>
        <span class="${cls.label}" style="background:${GRAD};position:absolute;left:50%;top:50%;width:38%;height:38%;transform:translate(-50%,-50%);border-radius:50%"></span>
        <span class="${cls.sheen}"></span>
      </span>
    </div>`;
};

const drawerRow = function (on) {
    return `<button type="button" class="${cls.sheetRow}" role="switch" aria-checked="${on}">
      <span class="${cls.rowIcon}" aria-hidden="true">${rippleIcon}</span>
      <span class="${cls.rowText}">
        <span class="${cls.rowTitle}">唱片波纹</span>
        <span class="${cls.rowSub}">${on ? '唱片周围有一圈扩散的声波' : '唱片周围保持干净'}</span>
      </span>
      <span class="${on ? `${cls.sw} ${cls.swOn}` : cls.sw}" aria-hidden="true"></span>
    </button>`;
};

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>播放设置抽屉 — 唱片波纹</title>
<style>${css}</style>
<style>
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
    background: #14151c; color: #eee; display: flex; flex-wrap: wrap; gap: 18px;
    padding: 18px; align-items: flex-start; }
  .frame { position: relative; width: 380px; border-radius: 22px; overflow: hidden;
    box-shadow: 0 30px 70px -30px #000; }
  /* The scrim and sheet are fixed-position in the app; inlined here as static
     blocks so two states can sit side by side. */
  .frame .scrim { position: static; animation: none; border-radius: 0; }
  .frame .sheet { position: static; animation: none; }
  .cap { font: 12px/1.6 ui-monospace, monospace; color: #8b90a0; margin: 0 0 8px; }
  .stack { display: flex; flex-direction: column; }
</style>
</head>
<body>
  <div class="stack">
    <p class="cap">ripples ON (default) — drawer open</p>
    <div class="frame">
      <div class="${cls.page}" style="height:430px">
        <div class="${cls.topbar}">
          <button type="button" class="${cls.topBtn}">▼</button>
          <button type="button" class="${cls.topBtn} ${cls.topBtnOn}">${moreIcon}</button>
        </div>
        <div style="display:flex;justify-content:center;padding-top:24px">${record(true)}</div>
        <div class="${cls.sheetScrim}">
          <div class="${cls.sheet}">
            <span class="${cls.grip}" aria-hidden="true"></span>
            <h2 class="${cls.sheetTitle}">播放设置</h2>
            ${drawerRow(true)}
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="stack">
    <p class="cap">ripples OFF — same drawer, switch flipped</p>
    <div class="frame">
      <div class="${cls.page}" style="height:430px">
        <div class="${cls.topbar}">
          <button type="button" class="${cls.topBtn}">▼</button>
          <button type="button" class="${cls.topBtn} ${cls.topBtnOn}">${moreIcon}</button>
        </div>
        <div style="display:flex;justify-content:center;padding-top:24px">${record(false)}</div>
        <div class="${cls.sheetScrim}">
          <div class="${cls.sheet}">
            <span class="${cls.grip}" aria-hidden="true"></span>
            <h2 class="${cls.sheetTitle}">播放设置</h2>
            ${drawerRow(false)}
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="stack">
    <p class="cap">switch, ×4 — travel &amp; centring</p>
    <div style="display:flex;gap:22px;align-items:center;padding:16px;background:rgba(255,255,255,.05);border-radius:14px">
      <span class="${cls.sw}"></span>
      <span class="${cls.sw} ${cls.swOn}"></span>
      <span class="${cls.sw}"></span>
      <span class="${cls.sw} ${cls.swOn}"></span>
    </div>
    <p class="cap" id="m"></p>
  </div>

<script>
  const sw = document.querySelector('.${cls.sw}');
  const swOn = document.querySelector('.${cls.swOn}');
  const knob = getComputedStyle(sw, '::after');
  const knobOn = getComputedStyle(swOn, '::after');
  const on = swOn.getBoundingClientRect();
  document.getElementById('m').textContent = [
    'track  ' + sw.getBoundingClientRect().width.toFixed(0) + ' × ' + sw.getBoundingClientRect().height.toFixed(0),
    'knob   ' + knob.width + ' @ ' + knob.top + '/' + knob.left,
    'on     ' + knobOn.transform,
    'accent ' + getComputedStyle(swOn).backgroundColor,
  ].join('\\n');
</script>
</body>
</html>`;

const outFile = process.argv[2] || path.join(root, 'out/_preview-player-drawer.html');
fs.writeFileSync(outFile, html);
console.log(`wrote ${outFile}`);
