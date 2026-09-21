#!/usr/bin/env node
/**
 * Renders the app's mark — the rainbow rounded square at the leading end of the
 * list's bar — at three scale levels side by side, so the canvas-drawn backdrop
 * and the note's breathing scale can be eyeballed without the audio plumbing.
 *
 * The canvas drawing logic is copied from `MarkNote.js` on purpose: this file
 * has no bundler, so the rainbow has to be drawn here too. Change one and
 * change the other. The numbers printed at the top left are the three scale
 * factors being shown, so a screenshot that is later measured does not need
 * to guess which one is which.
 *
 * Run: node scripts/preview-mark-breath.js [outFile]   (run `npm run build` first)
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const cssDir = path.join(root, 'out/_next/static/css');
const cssFile = fs.readdirSync(cssDir)
    .map((f) => path.join(cssDir, f))
    .find((f) => fs.readFileSync(f, 'utf8').includes('MarkNote_mark'));
if (!cssFile) {
    console.error('no built CSS contains MarkNote_mark — run `npm run build` first');
    process.exit(1);
}
const css = fs.readFileSync(cssFile, 'utf8');

const idOf = function (prefix) {
    const m = css.match(new RegExp(`\\.${prefix}__([A-Za-z0-9_-]+)`));
    if (!m) throw new Error(`no class starting with ${prefix} in ${path.basename(cssFile)}`);
    return `${prefix}__${m[1]}`;
};
const cls = {
    mark: idOf('MarkNote_mark'),
    bg: idOf('MarkNote_bg'),
    art: idOf('MarkNote_art'),
    ink: idOf('MarkNote_ink'),
    dot: idOf('MarkNote_dot'),
    dotOn: idOf('MarkNote_dot-on'),
};

const BAND_COLORS = [
    '#f5a3b8', '#ff8c5a', '#ffdc7a',
    '#8fd688', '#5ea8d8', '#8a7fcf', '#d8a3c8',
];
const STEPS = 48;
const WAVE_AMP = 0.06;
const WAVE_FREQ = 2.4;
const DRAW_SIZE = 160;

const drawBackdrop = function (canvas, size, time, level) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    const w = size;
    const h = size;
    const numBands = BAND_COLORS.length;
    const bandH = 1 / numBands;
    const twoPiFreq = Math.PI * 2 * WAVE_FREQ;
    const amp = WAVE_AMP * (0.55 + 0.45 * level);
    const boundaries = [];
    for (let b = 0; b <= numBands; b += 1) {
        const baseY = b * bandH;
        const isEdge = b === 0 || b === numBands;
        const phase = b * 0.85;
        const drift = time * (0.9 + b * 0.17);
        const points = new Array(STEPS + 1);
        for (let s = 0; s <= STEPS; s += 1) {
            const t = s / STEPS;
            const wave = isEdge ? 0 : Math.sin(phase + drift + t * twoPiFreq) * amp;
            points[s] = { x: t * w, y: (baseY + wave) * h };
        }
        boundaries.push(points);
    }
    for (let i = 0; i < numBands; i += 1) {
        const top = boundaries[i];
        const bot = boundaries[i + 1];
        ctx.beginPath();
        ctx.moveTo(top[0].x, top[0].y);
        for (let s = 1; s <= STEPS; s += 1) ctx.lineTo(top[s].x, top[s].y);
        for (let s = STEPS; s >= 0; s -= 1) ctx.lineTo(bot[s].x, bot[s].y);
        ctx.closePath();
        ctx.fillStyle = BAND_COLORS[i];
        ctx.fill();
    }
};

const NOTE_PATH = `M288 109 L303 110 L382 153 L389 160 L394 169 L395 189 L393 195
L387 205 L378 212 L370 215 L358 215 L341 208 L339 206 L337 206 L312 193 L300 192
L295 194 L290 199 L287 211 L287 221 L286 222 L287 227 L286 228 L286 238 L285 239
L284 265 L283 266 L283 277 L282 278 L282 289 L281 290 L278 332 L274 348 L268 360
L263 367 L252 378 L247 382 L232 390 L213 395 L192 395 L180 392 L165 384 L159 379
L153 371 L147 355 L147 338 L149 330 L155 317 L161 309 L171 299 L179 293 L190 288
L192 286 L208 281 L220 280 L221 279 L241 280 L247 282 L252 282 L254 280 L271 126
L275 118 L281 112 L287 110 Z`;

const renderMark = function (level, label) {
    const bgScale = 1 + 0.10 * level;
    const noteScale = 1 + 0.24 * level;
    return `
        <figure class="cell">
            <button type="button" class="${cls.mark}" aria-label="账号，未确认 QQ" title="账号 · 未确认 QQ">
                <canvas class="${cls.bg}" data-draw="1" style="transform: scale(${bgScale.toFixed(3)})"></canvas>
                <svg class="${cls.art}" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
                    <path class="${cls.ink}" d="${NOTE_PATH}" style="transform: scale(${noteScale.toFixed(3)})"></path>
                </svg>
                <span class="${cls.dot}" aria-hidden="true"></span>
            </button>
            <figcaption>${label}</figcaption>
        </figure>
    `;
};

const header = function (level) {
    const bgScale = 1 + 0.10 * level;
    const noteScale = 1 + 0.24 * level;
    return `
        <div class="header-bar">
            <button type="button" class="${cls.mark}" aria-label="账号，未确认 QQ" title="账号 · 未确认 QQ">
                <canvas class="${cls.bg}" data-draw="1" style="transform: scale(${bgScale.toFixed(3)})"></canvas>
                <svg class="${cls.art}" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
                    <path class="${cls.ink}" d="${NOTE_PATH}" style="transform: scale(${noteScale.toFixed(3)})"></path>
                </svg>
                <span class="${cls.dot}" aria-hidden="true"></span>
            </button>
            <span class="h1">Music Space</span>
        </div>
    `;
};

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>mark — canvas backdrop + breathing</title>
<style>${css}</style>
<style>
    html, body { margin: 0; padding: 0; background: #f2f2f7; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; padding: 24px; }
    #out { position: fixed; left: 8px; top: 8px; z-index: 1000; background: rgba(0,0,0,.82);
        color: #7ee787; font: 11px/1.5 ui-monospace, monospace; padding: 8px 10px;
        border-radius: 6px; white-space: pre; }
    .strip { display: flex; gap: 28px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 28px; }
    .cell { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .cell figcaption { font: 11px/1.4 ui-monospace, monospace; color: #333; }
    .header-bar { display: flex; align-items: center; gap: 14px; padding: 14px 18px;
        background: rgba(255,255,255,.72); backdrop-filter: blur(24px) saturate(1.8);
        border-radius: 12px; margin-bottom: 18px; }
    .h1 { font-size: 17px; font-weight: 600; color: #1f264f; }
    .label { font: 12px/1.5 ui-monospace, monospace; color: #666; margin: 8px 0 4px; }
    .big { width: 120px; height: 120px; transform: scale(3); transform-origin: top left; margin-bottom: 84px; }
</style>
</head>
<body>
<div id="out"></div>
<div class="label">at rest / mid beat / full beat</div>
<div class="strip">
    ${renderMark(0, 'level=0.00\nbg=1.000 note=1.000')}
    ${renderMark(0.5, 'level=0.50\nbg=1.050 note=1.120')}
    ${renderMark(1.0, 'level=1.00\nbg=1.100 note=1.240')}
</div>

<div class="label">in a header bar (mid beat)</div>
${header(0.5)}

<div class="label">3× scale (to inspect the canvas waves)</div>
<div style="display: flex; gap: 24px; flex-wrap: wrap;">
    ${renderMark(0, '').replace('class="cell"', 'class="cell big"')}
    ${renderMark(0.5, '').replace('class="cell"', 'class="cell big"')}
</div>

<script>
    // Draw the rainbow into every <canvas data-draw="1">. The drawing logic is
    // copied from MarkNote.js — keep both in sync.
    const BAND_COLORS = ${JSON.stringify(BAND_COLORS)};
    const STEPS = ${STEPS};
    const WAVE_AMP = ${WAVE_AMP};
    const WAVE_FREQ = ${WAVE_FREQ};
    const DRAW_SIZE = ${DRAW_SIZE};
    const drawBackdrop = function (canvas, size, time, level) {
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        ctx.scale(dpr, dpr);
        const ampBase = WAVE_AMP * (0.55 + 0.45 * (level || 0));
        const w = size;
        const h = size;
        const numBands = BAND_COLORS.length;
        const bandH = 1 / numBands;
        const twoPiFreq = Math.PI * 2 * WAVE_FREQ;
        const boundaries = [];
        for (let b = 0; b <= numBands; b += 1) {
            const baseY = b * bandH;
            const isEdge = b === 0 || b === numBands;
            const phase = b * 0.85;
            const drift = (time || 0) * (0.9 + b * 0.17);
            const points = new Array(STEPS + 1);
            for (let s = 0; s <= STEPS; s += 1) {
                const t = s / STEPS;
                const wave = isEdge ? 0 : Math.sin(phase + drift + t * twoPiFreq) * ampBase;
                points[s] = { x: t * w, y: (baseY + wave) * h };
            }
            boundaries.push(points);
        }
        for (let i = 0; i < numBands; i += 1) {
            const top = boundaries[i];
            const bot = boundaries[i + 1];
            ctx.beginPath();
            ctx.moveTo(top[0].x, top[0].y);
            for (let s = 1; s <= STEPS; s += 1) ctx.lineTo(top[s].x, top[s].y);
            for (let s = STEPS; s >= 0; s -= 1) ctx.lineTo(bot[s].x, bot[s].y);
            ctx.closePath();
            ctx.fillStyle = BAND_COLORS[i];
            ctx.fill();
        }
    };
    document.querySelectorAll('canvas[data-draw="1"]').forEach(function (c) { drawBackdrop(c, DRAW_SIZE); });
    document.getElementById('out').textContent = [
        'mark canvas + breathing',
        'bg scale:  1.000 / 1.050 / 1.100',
        'note scale: 1.000 / 1.120 / 1.240',
        '',
        'level=0 (rest) → no scale',
        'level=1 (full beat) → max scale',
    ].join('\\n');
</script>
</body>
</html>`;

const outFile = process.argv[2] || path.join(root, 'preview-mark-breath.html');
fs.writeFileSync(outFile, html);
console.log(`wrote ${outFile}`);