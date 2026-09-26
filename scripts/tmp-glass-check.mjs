/* Temp: measure how much of the particle field survives behind the two glass
 * panels. Screenshot -> decode inside the page -> compare mean luminance of
 * the panel rect against an equal stretch of bare canvas right next to it.
 *
 * usage: node scripts/tmp-glass-check.mjs <distDir>
 *   ratio = panel / bare. 1.0 = perfectly transparent, lower = more veiled. */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const DIST = process.argv[2] || '.next-preset7';
const PORT = process.argv[3] || '8915';
const CHROME = process.env.CHROME_PATH
    || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = `http://localhost:${PORT}/music/desktop/`;
const CACHE_JSON = readFileSync('E:/code/music/shots/tracks.json', 'utf8');

const serveRoot = mkdtempSync(join(tmpdir(), 'glassserve-'));
symlinkSync(resolve(DIST), join(serveRoot, 'music'), 'junction');
const server = spawn(process.execPath, ['scripts/serve-static.js', serveRoot, PORT], {
    stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((r) => setTimeout(r, 800));

const userDataDir = mkdtempSync(join(tmpdir(), 'glasscheck-'));
const chrome = spawn(CHROME, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars',
    '--disable-web-security',
    `--user-data-dir=${userDataDir}`, '--remote-debugging-port=0',
    '--window-size=1440,900', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let stderr = '';
chrome.stderr.on('data', (d) => { stderr += String(d); });
const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no target')), 20000);
    const poll = setInterval(() => {
        const m = /ws:\/\/[^\s"]+/.exec(stderr);
        if (m) { clearInterval(poll); clearTimeout(timer); resolve(m[0]); }
    }, 100);
});
const httpOrigin = wsUrl.replace(/^ws:/, 'http:').split('/devtools')[0];
const targets = await (await fetch(`${httpOrigin}/json`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });

let id = 0;
const pending = new Map();
ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
    id += 1;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.result?.exceptionDetails) return 'ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300);
    return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

await send('Page.navigate', { url: URL });
await sleep(2500);
await evalJs(`localStorage.setItem('music:trackListCache:v2:cloud', ${JSON.stringify(CACHE_JSON)}); 'ok'`);
// keep the playlist panel unfolded so it can be measured
await evalJs(`localStorage.setItem('music:setting:immersivePanel', 'off'); 'ok'`);
await evalJs(`localStorage.setItem('music:setting:immersiveFx', ${JSON.stringify(JSON.stringify({ preset: 0, particleLyrics: false }))}); 'ok'`);
await send('Page.navigate', { url: URL });
await sleep(4500);

const rects = JSON.parse(await evalJs(`JSON.stringify({
    bar: (function () {
        const el = [...document.querySelectorAll('div,section,footer')]
            .find((e) => /bar/i.test(e.className) && e.getBoundingClientRect().width > 500);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })(),
    panel: (function () {
        const el = [...document.querySelectorAll('div,aside,section')]
            .find((e) => /panel|list/i.test(e.className) && e.getBoundingClientRect().height > 300);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })()
})`));
console.log('rects:', JSON.stringify(rects));

const shotB64 = async () => (await send('Page.captureScreenshot', { format: 'png' })).result.data;

const withPanels = await shotB64();
writeFileSync(`E:/code/music/shots/glass-${DIST.replace(/^\.next-/, '')}.png`, Buffer.from(withPanels, 'base64'));
// Hide both glass panels and shoot again: the same pixels with nothing in the
// way. How far the "with panel" frame sits from this one is how much the glass
// is actually hiding — text and icons excluded by ignoring the strongest hits.
await evalJs(`(() => {
    const s = document.createElement('style');
    s.id = '__hide_glass';
    s.textContent = '[class*="PlayerBar_bar"], [class*="PlaylistPanel_stage"] { visibility: hidden !important; }';
    document.head.appendChild(s);
    return 'hidden';
})()`);
await sleep(600);
const bare = await shotB64();
await evalJs(`(() => { const s = document.getElementById('__hide_glass'); if (s) s.remove(); return 'shown'; })()`);

const measure = await evalJs(`(async (a64, b64, rects) => {
    const load = async (b) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        return c.getContext('2d');
    };
    const ga = await load(a64), gb = await load(b64);
    const out = {};
    for (const key of ['bar', 'panel']) {
        const r = rects[key];
        if (!r) { out[key] = 'no-rect'; continue; }
        const x = r.x + 4, y = r.y + 4, w = r.w - 8, h = r.h - 8;
        const da = ga.getImageData(x, y, w, h).data;
        const db = gb.getImageData(x, y, w, h).data;
        const px = w * h;
        let sumA = 0, sumB = 0;
        const diffs = new Float64Array(px);
        for (let i = 0, p = 0; i < da.length; i += 4, p += 1) {
            const la = 0.2126 * da[i] + 0.7152 * da[i + 1] + 0.0722 * da[i + 2];
            const lb = 0.2126 * db[i] + 0.7152 * db[i + 1] + 0.0722 * db[i + 2];
            sumA += la; sumB += lb;
            diffs[p] = Math.abs(la - lb);
        }
        // Sort a copy and read the median: the text and icons are a minority of
        // the area, so the median describes what the glass does to the field.
        const sorted = Float64Array.from(diffs).sort();
        const med = sorted[Math.floor(px / 2)];
        const meanDelta = diffs.reduce((s, v) => s + v, 0) / px;
        out[key] = {
            withPanel: +(sumA / px).toFixed(2),
            bare: +(sumB / px).toFixed(2),
            medianDelta: +med.toFixed(2),
            meanDelta: +meanDelta.toFixed(2),
            // 1 = the glass changes nothing at all, 0 = it hides everything
            passThrough: +(1 - Math.min(1, med / Math.max(1, sumB / px))).toFixed(3),
        };
    }
    return JSON.stringify(out);
})(${JSON.stringify(withPanels)}, ${JSON.stringify(bare)}, ${JSON.stringify(rects)})`, true);
console.log('glass ->', measure);

chrome.kill();
server.kill();
rmSync(serveRoot, { recursive: true, force: true });
process.exit(0);
