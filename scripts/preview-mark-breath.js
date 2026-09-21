#!/usr/bin/env node
/**
 * Renders the app's mark in both of its states — the 40px square at rest and
 * the wide playing bar (canvas rainbow + floating notes, QQ dot removed) — so
 * the canvas drawing, the breathing scales and the wide layout can be eyeballed
 * without the audio plumbing.
 *
 * The drawing and layout constants are copied from `MarkNote.js` on purpose:
 * this file has no bundler, so the rainbow has to be drawn here too. Change one
 * and change the other. The numbers printed at the top left are the scale
 * factors being shown, so a screenshot that is later measured does not need to
 * guess which one is which.
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
    markWide: idOf('MarkNote_mark-wide'),
    bg: idOf('MarkNote_bg'),
    art: idOf('MarkNote_art'),
    ink: idOf('MarkNote_ink'),
    notes: idOf('MarkNote_notes'),
    notesOn: idOf('MarkNote_notes-on'),
    noteFloat: idOf('MarkNote_note-float'),
    noteFloatInk: idOf('MarkNote_note-float-ink'),
};

// --- constants mirrored from MarkNote.js — keep in sync ----------------------
const BAND_COLORS = [
    '#f5a3b8', '#ff8c5a', '#ffdc7a',
    '#8fd688', '#5ea8d8', '#8a7fcf', '#d8a3c8',
];
const STEPS = 48;
const WAVE_AMP = 0.06;
const WAVE_FREQ = 2.4;
const SCORE_BOUNCE = 0.12;
const BREATH_BG = 0.10;
const BREATH_NOTE = 0.24;
const FLOATING_NOTES = [
    { size: 20, left: 0.56, bottom: 7, breath: 0.26 },
    { size: 13, left: 0.72, bottom: 15, breath: 0.34 },
    { size: 16, left: 0.86, bottom: 5, breath: 0.30 },
];
const DRAW_SIZE = 160;
// -----------------------------------------------------------------------------

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
        const bounce = isEdge ? 0 : level * SCORE_BOUNCE * Math.sin(b * 1.7);
        const points = new Array(STEPS + 1);
        for (let s = 0; s <= STEPS; s += 1) {
            const t = s / STEPS;
            const wave = isEdge ? 0 : Math.sin(phase + drift + t * twoPiFreq) * amp;
            points[s] = { x: t * w, y: (baseY + wave + bounce) * h };
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

const floatNotesMarkup = function (level, withTransforms) {
    return `
        <span class="${cls.notes} ${cls.notesOn}" aria-hidden="true">
            ${FLOATING_NOTES.map((spec, i) => `
                <span class="${cls.noteFloat}"
                    style="width:${spec.size}px;height:${spec.size}px;left:${Math.round(spec.left * 100)}%;bottom:${spec.bottom}px;${withTransforms ? `transform:scale(${(1 + spec.breath * level).toFixed(3)});` : ''}">
                    <svg viewBox="0 0 512 512" focusable="false">
                        <path class="${cls.noteFloatInk}" d="${NOTE_PATH}"></path>
                    </svg>
                </span>
            `).join('')}
        </span>
    `;
};

const renderMark = function (level, label) {
    const bgScale = 1 + BREATH_BG * level;
    const noteScale = 1 + BREATH_NOTE * level;
    return `
        <figure class="cell">
            <button type="button" class="${cls.mark}" aria-label="账号，未确认 QQ" title="账号 · 未确认 QQ">
                <canvas class="${cls.bg}" data-draw="1" data-level="${level}" style="transform: scale(${bgScale.toFixed(3)})"></canvas>
                <svg class="${cls.art}" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
                    <path class="${cls.ink}" d="${NOTE_PATH}" style="transform: scale(${noteScale.toFixed(3)})"></path>
                </svg>
            </button>
            <figcaption>${label}</figcaption>
        </figure>
    `;
};

// The wide playing bar, in a mock header row: mark grows (flex-grow 1), the
// actions sit at the trailing end — the layout the real app builds.
const wideBar = function (level) {
    const bgScale = 1 + BREATH_BG * level;
    const noteScale = 1 + BREATH_NOTE * level;
    return `
        <div class="header-bar">
            <button type="button" class="${cls.mark} ${cls.markWide}" aria-label="账号，未确认 QQ" title="账号 · 未确认 QQ">
                <canvas class="${cls.bg}" data-draw="1" data-level="${level}" style="transform: scale(${bgScale.toFixed(3)})"></canvas>
                <svg class="${cls.art}" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
                    <path class="${cls.ink}" d="${NOTE_PATH}" style="transform: scale(${noteScale.toFixed(3)})"></path>
                </svg>
                ${floatNotesMarkup(level, true)}
            </button>
            <span class="action">🔍</span>
            <span class="action">♥</span>
            <span class="action">⋮</span>
        </div>
    `;
};

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>mark — rest square & wide playing bar</title>
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
    .header-bar { display: flex; align-items: center; gap: 10px; padding: 10px 18px;
        background: rgba(255,255,255,.72); backdrop-filter: blur(24px) saturate(1.8);
        border-radius: 12px; margin-bottom: 18px; max-width: 420px; }
    .action { font-size: 15px; color: #3c3c43; }
    .label { font: 12px/1.5 ui-monospace, monospace; color: #666; margin: 8px 0 4px; }
</style>
</head>
<body>
<div id="out"></div>
<div class="label">静止的 40px 方块（无 QQ 点）</div>
<div class="strip">
    ${renderMark(0, 'level=0.00')}
</div>

<div class="label">播放中的宽条：彩虹乐谱跳动 + 大大小小的音符呼吸</div>
${wideBar(1.0)}
${wideBar(0.5)}

<script>
    // Drawing logic copied from MarkNote.js — keep both in sync.
    const BAND_COLORS = ${JSON.stringify(BAND_COLORS)};
    const STEPS = ${STEPS};
    const WAVE_AMP = ${WAVE_AMP};
    const WAVE_FREQ = ${WAVE_FREQ};
    const SCORE_BOUNCE = ${SCORE_BOUNCE};
    const DRAW_SIZE = ${DRAW_SIZE};
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
            const bounce = isEdge ? 0 : level * SCORE_BOUNCE * Math.sin(b * 1.7);
            const points = new Array(STEPS + 1);
            for (let s = 0; s <= STEPS; s += 1) {
                const t = s / STEPS;
                const wave = isEdge ? 0 : Math.sin(phase + drift + t * twoPiFreq) * amp;
                points[s] = { x: t * w, y: (baseY + wave + bounce) * h };
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
    document.querySelectorAll('canvas[data-draw="1"]').forEach(function (c) {
        drawBackdrop(c, DRAW_SIZE, 0, Number(c.getAttribute('data-level')) || 0);
    });
    document.getElementById('out').textContent = [
        'mark: rest square + wide playing bar',
        'wide: flex-grow 1, rainbow heave SCORE_BOUNCE=' + SCORE_BOUNCE,
        'notes: ' + document.querySelectorAll('.note-float, [class*="note-float"]').length + ' floaters, dot removed',
    ].join('\\n');
</script>
</body>
</html>`;

const outFile = process.argv[2] || path.join(root, 'preview-mark-breath.html');
fs.writeFileSync(outFile, html);
console.log(`wrote ${outFile}`);