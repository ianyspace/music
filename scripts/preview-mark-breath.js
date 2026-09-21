#!/usr/bin/env node
/**
 * Renders the mark's two states — stopped and playing — after the simplification:
 * a fixed 40px logo, a canvas-drawn rainbow score, a static note, and one fixed
 * CSS drift cadence while playing. There is deliberately no analyser data in
 * this preview because the real component no longer reads audio frequencies.
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
    playing: idOf('MarkNote_mark-playing'),
    bg: idOf('MarkNote_bg'),
    art: idOf('MarkNote_art'),
    ink: idOf('MarkNote_ink'),
};

const BAND_COLORS = [
    '#f5a3b8', '#ff8c5a', '#ffdc7a', '#8fd688',
    '#5ea8d8', '#8a7fcf', '#d8a3c8',
];
const STEPS = 48;
const WAVE_AMP = 0.06;
const WAVE_FREQ = 2.4;
const WAVE_PHASES = [0.0, 0.85, 1.7, 2.55, 3.4, 4.25, 5.1, 5.95];
const DRAW_SIZE = 160;

const NOTE_PATH = `M288 109 L303 110 L382 153 L389 160 L394 169 L395 189 L393 195
L387 205 L378 212 L370 215 L358 215 L341 208 L339 206 L337 206 L312 193 L300 192
L295 194 L290 199 L287 211 L287 221 L286 222 L287 227 L286 228 L286 238 L285 239
L284 265 L283 266 L283 277 L282 278 L282 289 L281 290 L278 332 L274 348 L268 360
L263 367 L252 378 L247 382 L232 390 L213 395 L192 395 L180 392 L165 384 L159 379
L153 371 L147 355 L147 338 L149 330 L155 317 L161 309 L171 299 L179 293 L190 288
L192 286 L208 281 L220 280 L221 279 L241 280 L247 282 L252 282 L254 280 L271 126
L275 118 L281 112 L287 110 Z`;

const drawBackdrop = function (canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = DRAW_SIZE * dpr;
    canvas.height = DRAW_SIZE * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bandH = DRAW_SIZE / BAND_COLORS.length;
    const twoPiFreq = Math.PI * 2 * WAVE_FREQ;
    const boundaries = [];
    for (let b = 0; b <= BAND_COLORS.length; b += 1) {
        const edge = b === 0 || b === BAND_COLORS.length;
        const points = new Array(STEPS + 1);
        for (let s = 0; s <= STEPS; s += 1) {
            const t = s / STEPS;
            const wave = edge ? 0 : Math.sin(WAVE_PHASES[b] + t * twoPiFreq) * WAVE_AMP * DRAW_SIZE;
            points[s] = { x: t * DRAW_SIZE, y: b * bandH + wave };
        }
        boundaries.push(points);
    }
    BAND_COLORS.forEach((color, i) => {
        const top = boundaries[i];
        const bottom = boundaries[i + 1];
        ctx.beginPath();
        ctx.moveTo(top[0].x, top[0].y);
        for (let s = 1; s <= STEPS; s += 1) ctx.lineTo(top[s].x, top[s].y);
        for (let s = STEPS; s >= 0; s -= 1) ctx.lineTo(bottom[s].x, bottom[s].y);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
    });
};

const mark = function (playing, label) {
    return `
        <figure class="cell">
            <button type="button" class="${cls.mark}${playing ? ` ${cls.playing}` : ''}" aria-label="账号，未确认 QQ" title="账号 · 未确认 QQ">
                <canvas class="${cls.bg}" data-draw="1"></canvas>
                <svg class="${cls.art}" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
                    <path class="${cls.ink}" d="${NOTE_PATH}"></path>
                </svg>
            </button>
            <figcaption>${label}</figcaption>
        </figure>
    `;
};

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>mark — fixed score cadence</title>
<style>${css}</style>
<style>
    html, body { margin: 0; padding: 0; background: #f2f2f7; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; padding: 24px; }
    #out { position: fixed; left: 8px; top: 8px; z-index: 1000; background: rgba(0,0,0,.82);
        color: #7ee787; font: 11px/1.5 ui-monospace, monospace; padding: 8px 10px;
        border-radius: 6px; white-space: pre; }
    .strip { display: flex; gap: 28px; align-items: flex-end; margin-bottom: 30px; }
    .cell { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .cell figcaption { font: 11px/1.4 ui-monospace, monospace; color: #333; }
    .note { margin: 0; font-size: 13px; color: #555; max-width: 440px; line-height: 1.6; }
</style>
</head>
<body>
<div id="out"></div>
<p class="note">停止：固定彩虹印谱，音符静止。播放：同一个 40px logo，仅彩虹按固定 2.6 秒节奏漂移；没有音频分析、放大或呼吸。</p>
<div class="strip">
    ${mark(false, '停止 / 固定')}
    ${mark(true, '播放 / 固定节奏')}
</div>
<script>
    document.querySelectorAll('canvas[data-draw="1"]').forEach(function (canvas) {
        (${drawBackdrop.toString()})(canvas);
    });
    document.getElementById('out').textContent = [
        'fixed score cadence',
        'logo size: 40px (both states)',
        'playing motion: CSS rainbow-score-drift 2.6s',
        'audio analyser: removed',
        'note motion: removed',
    ].join('\\n');
</script>
</body>
</html>`;

const outFile = process.argv[2] || path.join(root, 'preview-mark-breath.html');
fs.writeFileSync(outFile, html);
console.log(`wrote ${outFile}`);