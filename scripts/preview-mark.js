#!/usr/bin/env node
/**
 * Renders the mark's states side by side, using the *built* CSS and the same
 * drawing constants as the component:
 *
 *   - the entry bar (wide, running up to the actions group, no note),
 *   - the settled square, stopped,
 *   - the settled square playing, frozen at three points of the flow.
 *
 * It also checks the one thing a screenshot cannot: that the drawing really is
 * periodic at exactly one wavelength, which is what makes the CSS loop seam-free.
 *
 * Run: node scripts/preview-mark.js [outFile]   (run `npm run build` first)
 *      defaults to `out/_preview-mark.html`, served as /music/_preview-mark.html
 *      defaults to `out/_preview-mark.html`, served as /music/_preview-mark.html
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
    intro: idOf('MarkNote_mark-intro'),
    playing: idOf('MarkNote_mark-playing'),
    bg: idOf('MarkNote_bg'),
    art: idOf('MarkNote_art'),
    ink: idOf('MarkNote_ink'),
};

/* --- mirror of MarkNote.js ------------------------------------------------
 *
 * These are copies, not imports: the component is ESM+JSX and this script is
 * plain node. That means they can drift, so the page below *measures* the one
 * relationship that matters (the wavelength) rather than trusting the copy.
 */
const BAND_COLORS = ['#f4707a', '#f79a5b', '#f7d45c', '#7ccb86', '#5aa6e0', '#7379d4', '#b478cf'];
const DRAW_W = 320;
const DRAW_H = 160;
const COLUMNS = DRAW_W;
const BLEND = 0.12;
const WAVE_LAMBDA = DRAW_W / 5;
const WAVE_AMP = 0.55;
const VISIBLE_FRACTION = 1 / 1.2;
const WAVE_PHASES = [0, 0.55, 1.1, 1.65, 2.2, 2.75, 3.3, 3.85];

const mix = function (a, b, t) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const channels = [16, 8, 0].map((shift) => {
        const va = (pa >> shift) & 255;
        const vb = (pb >> shift) & 255;
        return Math.round(va + (vb - va) * t);
    });
    return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
};

const drawBackdrop = function (ctx) {
    const count = BAND_COLORS.length;
    const span = DRAW_H * VISIBLE_FRACTION;
    const top = (DRAW_H - span) / 2;
    const bandH = span / count;
    const amp = bandH * WAVE_AMP;
    const k = (Math.PI * 2) / WAVE_LAMBDA;
    const soft = bandH * BLEND;
    const columnW = DRAW_W / COLUMNS;
    const at = (y) => Math.min(1, Math.max(0, y / DRAW_H));
    const waveAt = (b, x) => (
        b === 0 || b === count ? 0 : Math.sin(WAVE_PHASES[b] + x * k) * amp
    );

    for (let c = 0; c < COLUMNS; c += 1) {
        const x = c * columnW;
        const ramp = ctx.createLinearGradient(0, 0, 0, DRAW_H);
        ramp.addColorStop(0, BAND_COLORS[0]);
        for (let b = 0; b < count; b += 1) {
            const colour = BAND_COLORS[b];
            const upper = top + b * bandH + waveAt(b, x);
            const lower = top + (b + 1) * bandH + waveAt(b + 1, x);
            if (b > 0) ramp.addColorStop(at(upper), mix(BAND_COLORS[b - 1], colour, 0.5));
            ramp.addColorStop(at(upper + soft), colour);
            ramp.addColorStop(at(lower - soft), colour);
            if (b < count - 1) ramp.addColorStop(at(lower), mix(colour, BAND_COLORS[b + 1], 0.5));
        }
        ramp.addColorStop(1, BAND_COLORS[count - 1]);
        ctx.fillStyle = ramp;
        ctx.fillRect(x, 0, columnW, DRAW_H);
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

const art = `<svg class="${cls.art}" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
    <path class="${cls.ink}" d="${NOTE_PATH}"></path>
</svg>`;

const markButton = function (classes, canvasStyle) {
    return `<button type="button" class="${classes}" aria-label="账号，未确认 QQ">
        <canvas class="${cls.bg}" data-draw="1"${canvasStyle ? ` style="${canvasStyle}"` : ''}></canvas>
        ${art}
    </button>`;
};

const mark = function (classes, label, canvasStyle) {
    return `
        <figure class="cell">
            ${markButton(classes, canvasStyle)}
            <figcaption>${label}</figcaption>
        </figure>
    `;
};

/* The entry bar is the one state the page has to stage: `.mark-intro` grows to
   fill whatever row it is in, so it needs a row with an actions group to fill
   up to — and it must be the row's *direct* child, not wrapped in a figure,
   or there is no free space for it to grow into. */
const entryRow = `
    <div class="row">
        ${markButton(`${cls.mark} ${cls.intro}`)}
        <div class="actions">
            <button class="nav" type="button" aria-label="搜索">⌕</button>
            <button class="nav" type="button" aria-label="我喜欢">♡</button>
            <button class="nav" type="button" aria-label="更多">⋮</button>
        </div>
    </div>
`;

const flow = (delay) => mark(
    `${cls.mark} ${cls.playing}`,
    `播放 / 冻结在 ${delay}s`,
    `animation-delay: ${delay}s`,
);

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>mark — rainbow score</title>
<style>${css}</style>
<style>
    html, body { margin: 0; padding: 0; background: #f2f2f7; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; padding: 24px; }
    #out { position: fixed; right: 8px; top: 8px; z-index: 1000; background: rgba(0,0,0,.82);
        color: #7ee787; font: 11px/1.5 ui-monospace, monospace; padding: 8px 10px;
        border-radius: 6px; white-space: pre; }
    #out.bad { color: #ff7b72; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 10px;
        width: 340px; margin: 0 0 34px; padding: 10px 18px; background: #fff;
        border-radius: 14px; box-shadow: 0 6px 16px -14px rgba(31,38,79,.18); }
    .actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; margin-left: auto; }
    .nav { width: 34px; height: 34px; border: 0; border-radius: 50%; background: transparent;
        color: #262c4a; font-size: 17px; cursor: pointer; }
    .strip { display: flex; gap: 26px; align-items: flex-end; }
    .cell { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .cell figcaption { font: 11px/1.4 ui-monospace, monospace; color: #333; }
    /* The frozen cells still run the real animation — the delay only picks the
       frame. Pausing it keeps the screenshot reproducible. */
    .cell .${cls.playing} .${cls.bg} { animation-play-state: paused; }
    .note { margin: 0 0 20px; font-size: 13px; color: #555; max-width: 560px; line-height: 1.6; }
    /* The #zoom hash blows one playing mark up 5× so the wave shape can
       actually be judged — at 40px a ripple and a straight line look alike in a
       screenshot. A uniform scale, so the proportions are the real ones. */
    body.zoom .row, body.zoom .note, body.zoom #out, body.zoom .cell { display: none; }
    body.zoom .cell.zoom-target { display: flex; transform: scale(5); transform-origin: top left; }
</style>
</head>
<body>
<div id="out"></div>
<p class="note">进场是一条伸到操作组的宽条、上面没有音符；随后收成 40px 圆角方块、音符淡入。
播放时彩虹按固定 2 秒周期一直向右流 —— 一个周期正好一个波长，所以首尾帧相同、循环无缝。</p>
${entryRow}
<div class="strip">
    ${mark(cls.mark, '落定 / 停止')}
    ${flow(-0.0)}
    ${flow(-0.5)}
    ${flow(-1.0)}
</div>
<script>
    const BAND_COLORS = ${JSON.stringify(BAND_COLORS)};
    const DRAW_W = ${DRAW_W};
    const DRAW_H = ${DRAW_H};
    const COLUMNS = ${COLUMNS};
    const BLEND = ${BLEND};
    const WAVE_LAMBDA = ${WAVE_LAMBDA};
    const WAVE_AMP = ${WAVE_AMP};
    const VISIBLE_FRACTION = ${VISIBLE_FRACTION};
    const WAVE_PHASES = ${JSON.stringify(WAVE_PHASES)};
    const mix = ${mix.toString()};

    const canvases = [...document.querySelectorAll('canvas[data-draw="1"]')];
    canvases.forEach(function (canvas) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = DRAW_W * dpr;
        canvas.height = DRAW_H * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        (${drawBackdrop.toString()})(ctx);
    });

    /* The seam check. The CSS loop translates the canvas by exactly one
       wavelength and starts over, which only reads as a continuous flow if the
       drawing itself repeats at that distance. Sample the top strip of the
       bitmap — the bands, not the flat edges — and compare every column with
       the column one wavelength to its right. */
    const out = document.getElementById('out');
    const probe = canvases[0];
    const dpr = window.devicePixelRatio || 1;
    const lambda = Math.round(WAVE_LAMBDA * dpr);
    const data = probe.getContext('2d').getImageData(0, 0, probe.width, probe.height).data;
    let worst = 0;
    for (let y = 0; y < probe.height; y += 3) {
        for (let x = 0; x + lambda < probe.width; x += 7) {
            const a = (y * probe.width + x) * 4;
            const b = (y * probe.width + x + lambda) * 4;
            worst = Math.max(worst, Math.abs(data[a] - data[b]), Math.abs(data[a + 1] - data[b + 1]), Math.abs(data[a + 2] - data[b + 2]));
        }
    }
    const ok = worst === 0;

    /* How wide the colour change between two bands actually is, in band
       heights, measured down one column. This is the number that decides
       whether the ripple reads as a band edge or as a blur, and it is not
       something a screenshot can be asked: a 40px mark hides it either way.
       Rows that sit on one of the band colours are "flat"; the run between two
       flat runs is the blend. */
    const pure = BAND_COLORS.map(function (hex) {
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    });
    const column = probe.getContext('2d')
        .getImageData(Math.round(probe.width / 2), 0, 1, probe.height).data;
    const bandRows = (DRAW_H * VISIBLE_FRACTION / BAND_COLORS.length) * dpr;
    let run = 0;
    let widest = 0;
    for (let y = 0; y < probe.height; y += 1) {
        const r = column[y * 4];
        const g = column[y * 4 + 1];
        const b = column[y * 4 + 2];
        const flat = pure.some(function (p) {
            return Math.abs(p[0] - r) + Math.abs(p[1] - g) + Math.abs(p[2] - b) < 12;
        });
        if (flat) {
            widest = Math.max(widest, run);
            run = 0;
        } else {
            run += 1;
        }
    }
    const blend = widest / bandRows;

    out.className = ok ? '' : 'bad';
    out.textContent = [
        ok ? 'periodic at one wavelength: yes' : 'periodic at one wavelength: NO',
        'worst channel delta: ' + worst,
        'blend widest / band: ' + blend.toFixed(2) + '  (BLEND=' + BLEND + ' -> ' + (2 * BLEND).toFixed(2) + ' expected)',
        'buffer: ' + DRAW_W + '\\u00d7' + DRAW_H + ', wavelength ' + WAVE_LAMBDA + ' (' + (DRAW_W / WAVE_LAMBDA) + ' cycles)',
        'flow: translateX(20%) over 2s linear, infinite',
        'note: static path, opacity only',
    ].join('\\n');

    if (location.hash === '#zoom') {
        document.body.classList.add('zoom');
        document.querySelectorAll('.cell')[1].classList.add('zoom-target');
    }
</script>
</body>
</html>`;

const outFile = process.argv[2] || path.join(root, 'out/_preview-mark.html');
fs.writeFileSync(outFile, html);
console.log(`wrote ${outFile}`);
