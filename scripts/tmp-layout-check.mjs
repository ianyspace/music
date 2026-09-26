/* Temp: verify the immersive page's new chrome — one gear in the top-right
 * corner owning 账号 + the visual console, a bare track column (no panel
 * shell, no mark, no count), and a play bar with no volume control. */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = process.env.CHROME_PATH
    || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:8925/music/desktop/';
const CACHE_JSON = readFileSync('E:/code/music/shots/tracks.json', 'utf8');
const DIST = process.argv[2] || '.next-layout';

const serveRoot = mkdtempSync(join(tmpdir(), 'layoutsrv-'));
symlinkSync(resolve(DIST), join(serveRoot, 'music'), 'junction');
const server = spawn(process.execPath, ['scripts/serve-static.js', serveRoot, '8925'], {
    stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((r) => setTimeout(r, 800));

const userDataDir = mkdtempSync(join(tmpdir(), 'layoutcheck-'));
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
const logs = [];
ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.consoleAPICalled') {
        logs.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
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
const shot = async (name) => {
    const png = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`E:/code/music/shots/${name}.png`, Buffer.from(png.result.data, 'base64'));
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

await send('Page.navigate', { url: URL });
await sleep(2500);
await evalJs(`localStorage.setItem('music:trackListCache:v2:cloud', ${JSON.stringify(CACHE_JSON)}); 'ok'`);
await evalJs(`localStorage.setItem('music:setting:immersiveFx', ${JSON.stringify(JSON.stringify({ preset: 0 }))}); 'ok'`);
await send('Page.navigate', { url: URL });
await sleep(4000);

// --- 1. the corner gear ------------------------------------------------------
const gears = await evalJs(`JSON.stringify(
    Array.from(document.querySelectorAll('button[aria-label="设置"]')).map((b) => {
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
    })
)`);
console.log('gear buttons        ->', gears, '(expect exactly 1, near x~1378 y~22)');

// --- 2. the track column: no panel shell ------------------------------------
const column = await evalJs(`(() => {
    const el = document.querySelector('[aria-label="歌曲列表"]');
    if (!el) return 'no-column';
    const s = getComputedStyle(el);
    return JSON.stringify({
        background: s.backgroundColor,
        border: s.borderTopWidth + ' ' + s.borderTopStyle,
        radius: s.borderTopLeftRadius,
        backdrop: s.backdropFilter || s.webkitBackdropFilter,
        shadow: s.boxShadow,
    });
})()`);
console.log('column shell        ->', column, '(expect transparent / 0px none / 0px / none / none)');

// --- 3. no mark, no count, no fold button ------------------------------------
console.log('mark elements       ->', await evalJs(`document.querySelectorAll('[class*="_mark__"]').length`), '(expect 0)');
console.log('"N 首" text         ->', await evalJs(`/\\d+\\s*首/.test(document.body.innerText) ? 'present' : 'absent'`), '(expect absent)');
console.log('fold button         ->', await evalJs(`document.querySelectorAll('button[aria-label="收起歌单"]').length`), '(expect 0)');

// --- 3b. the column's vertical framing --------------------------------------
console.log('column rect         ->', await evalJs(`(() => {
    const el = document.querySelector('[aria-label="歌曲列表"]');
    if (!el) return 'no-column';
    const r = el.getBoundingClientRect();
    return JSON.stringify({ top: Math.round(r.top), bottomGap: Math.round(window.innerHeight - r.bottom) });
})()`), '(expect top 40, bottomGap 110)');

// --- 3c. the row highlight: no closed radius, feathered both ends -----------
const rowStyle = await evalJs(`(() => {
    const row = document.querySelector('[aria-label="歌曲列表"] ul button');
    if (!row) return 'no-row';
    const s = getComputedStyle(row);
    const b = getComputedStyle(row, '::before');
    return JSON.stringify({
        radius: s.borderTopLeftRadius,
        washOpacityIdle: b.opacity,
        washGradient: (b.backgroundImage || '').slice(0, 120),
        washInset: b.left + ' / ' + b.right,
    });
})()`);
console.log('row idle            ->', rowStyle, '(expect radius 0px, opacity 0, gradient, -8px / -8px)');

const hoverOpacity = await evalJs(`(() => {
    const row = document.querySelector('[aria-label="歌曲列表"] ul button');
    if (!row) return 'no-row';
    const r = row.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
})()`);
const hoverAt = JSON.parse(hoverOpacity);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoverAt.x, y: hoverAt.y, button: 'none' });
await sleep(400);
console.log('row hovered ::before->', await evalJs(`(() => {
    const row = document.querySelector('[aria-label="歌曲列表"] ul button');
    return row ? getComputedStyle(row, '::before').opacity : 'no-row';
})()`), '(expect > 0 — the wash is on)');
await shot('layout-row-hover');

// --- 4. the play bar: no volume, no gear ------------------------------------
console.log('volume input        ->', await evalJs(`document.querySelectorAll('input[aria-label="音量"]').length`), '(expect 0)');
console.log('seek input (sanity) ->', await evalJs(`document.querySelectorAll('input[aria-label="播放进度"]').length`), '(expect 1)');
await shot('layout-idle');

// --- 5. open settings from the corner ---------------------------------------
await evalJs(`document.querySelector('button[aria-label="设置"]').click(); 'ok'`);
await sleep(700);
const popover = await evalJs(`(() => {
    const el = document.querySelector('[role="dialog"][aria-label="沉浸页设置"]');
    if (!el) return 'no-popover';
    const r = el.getBoundingClientRect();
    return JSON.stringify({ top: Math.round(r.top), right: Math.round(window.innerWidth - r.right), h: Math.round(r.height) });
})()`);
console.log('popover box         ->', popover, '(expect top~72, right~24 — top-right, not above the bar)');
await shot('layout-settings-open');

// --- 6. the account entry ----------------------------------------------------
console.log('account section     ->', await evalJs(`(() => {
    const el = document.querySelector('[role="dialog"]');
    if (!el) return 'no-popover';
    const label = Array.from(el.querySelectorAll('*')).find((n) => /^QQ 音乐/.test((n.textContent || '').trim()) && n.children.length === 0);
    const btn = Array.from(el.querySelectorAll('button')).find((b) => /绑定|管理/.test(b.textContent || ''));
    return JSON.stringify({ label: label ? label.textContent.trim() : null, button: btn ? btn.textContent.trim() : null });
})()`), '(expect QQ 音乐 · 未绑定 + 绑定)');

// --- 7. close on outside click ----------------------------------------------
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 500, y: 500, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 500, y: 500, button: 'left', clickCount: 1 });
await sleep(600);
console.log('popover after outside click ->', await evalJs(`document.querySelector('[role="dialog"]') ? 'still-open' : 'closed'`), '(expect closed)');

console.log('--- console issues ---');
console.log(logs.filter((l) => /error|shader|GLSL/i.test(l)).slice(0, 6).join('\n') || '(none)');

chrome.kill();
server.kill();
rmSync(serveRoot, { recursive: true, force: true });
process.exit(0);
