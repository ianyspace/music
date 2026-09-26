/* Temp: verify the immersive backdrop is pure black by default and that the
 * new "氛围底色" toggle brings the gradient layers back. */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = process.env.CHROME_PATH
    || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:8907/music/desktop/';

const outDir = resolve('.next-amb3');
const serveRoot = mkdtempSync(join(tmpdir(), 'bgserve-'));
symlinkSync(outDir, join(serveRoot, 'music'), 'junction');

const server = spawn(process.execPath, ['scripts/serve-static.js', serveRoot, '8907'], {
    stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((r) => setTimeout(r, 800));

const userDataDir = mkdtempSync(join(tmpdir(), 'bgcheck-'));
const chrome = spawn(CHROME, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars',
    `--user-data-dir=${userDataDir}`, '--remote-debugging-port=0',
    '--window-size=1440,810', 'about:blank',
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
const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.result?.exceptionDetails) return 'ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300);
    return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
    const png = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(png.result.data, 'base64');
    writeFileSync(`E:/code/music/shots/${name}.png`, buf);
    return buf.length;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });

await send('Page.navigate', { url: URL });
await sleep(3500);

const probe = `(() => {
    const root = document.querySelector('[class*="root"]');
    const has = (n) => Boolean(document.querySelector('[class*="' + n + '"]'));
    return JSON.stringify({
        rootBg: root ? getComputedStyle(root).backgroundColor : 'no-root',
        bodyBg: getComputedStyle(document.body).backgroundColor,
        bodyInline: document.body.getAttribute('style') || '(none)',
        backdrop: has('backdrop'),
        glow: has('glow'),
        coverBg: has('cover-bg'),
        canvas: Boolean(document.querySelector('canvas')),
        stored: localStorage.getItem('music:setting:immersiveAmbient'),
    });
})()`;

console.log('default ->', await evalJs(probe));
console.log('shot ->', await shot('bg-default-black'));

// Open the settings popover.
await evalJs(`(() => { const b = document.querySelector('[aria-label="设置"]'); if (b) b.click(); return 'clicked'; })()`);
await sleep(900);
console.log('toggle present ->', await evalJs(`(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const hit = labels.find((l) => /氛围底色/.test(l.textContent || ''));
    return hit ? 'yes: ' + hit.textContent.trim() : 'missing';
})()`));
console.log('shot ->', await shot('bg-settings-open'));

// Turn the ambient backdrop on.
await evalJs(`(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const hit = labels.find((l) => /氛围底色/.test(l.textContent || ''));
    if (!hit) return 'missing';
    const box = hit.querySelector('input[type=checkbox]');
    box.click();
    return 'toggled ' + box.checked;
})()`);
await sleep(1600);
console.log('ambient on ->', await evalJs(probe));
console.log('shot ->', await shot('bg-ambient-on'));

chrome.kill();
server.kill();
rmSync(serveRoot, { recursive: true, force: true });
process.exit(0);
