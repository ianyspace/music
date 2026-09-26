/* Minimal CDP probe: dump console messages, page errors and DOM facts. */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH
    || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:3001/music/desktop/';

const userDataDir = mkdtempSync(join(tmpdir(), 'probe-'));
const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    ...(process.env.DRIVE_PROXY ? [`--proxy-server=${process.env.DRIVE_PROXY}`] : []),
    ...(process.env.PROBE_INSECURE
        ? ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process']
        : []),
    `--user-data-dir=${userDataDir}`, '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let stderr = '';
chrome.stderr.on('data', (d) => { stderr += String(d); });

const wsUrl = await new Promise((resolve, reject) => {
    let seen = '';
    const timer = setTimeout(() => reject(new Error(`no target: ${seen}`)), 15000);
    const poll = setInterval(() => {
        const m = /ws:\/\/[^\s"]+/.exec(stderr);
        if (m) { clearInterval(poll); clearTimeout(timer); resolve(m[0]); }
    }, 100);
});
// The stderr ws URL points at the browser target; we need the page target.
const httpOrigin = wsUrl.replace(/^ws:/, 'http:').split('/devtools')[0];
const listResp = await fetch(`${httpOrigin}/json`);
const targets = await listResp.json();
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
        logs.push(`[console.${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
        logs.push(`[exception] ${msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text}`);
    }
};
const send = (method, params = {}) => new Promise((resolve) => {
    id += 1;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
});

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await new Promise((r) => setTimeout(r, 8000));

const result = await send('Runtime.evaluate', { expression: `(() => ({
    title: document.title,
    bodyLen: document.body ? document.body.innerHTML.length : -1,
    bodyText: document.body ? document.body.innerText.slice(0, 300) : '',
    audioCount: document.querySelectorAll('audio').length,
    canvasCount: document.querySelectorAll('canvas').length,
    rows: document.querySelectorAll('ul li button:not([aria-label])').length,
    rootChildren: document.querySelector('#__next') ? document.querySelector('#__next').children.length : -1,
}))()`, returnByValue: true });
console.log(JSON.stringify(result.result.result.value, null, 2));

const fetchTest = await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `Promise.all([
        fetch('https://space-music.ianyscript.workers.dev/tracks', { mode: 'no-cors' })
            .then((r) => 'worker no-cors: ok ' + r.type)
            .catch((e) => 'worker no-cors error: ' + (e && e.message)),
        fetch('https://www.cloudflare.com/cdn-cgi/trace', { mode: 'no-cors' })
            .then((r) => 'cloudflare no-cors: ok ' + r.type)
            .catch((e) => 'cloudflare no-cors error: ' + (e && e.message)),
        fetch('https://space-music.ianyscript.workers.dev/tracks')
            .then((r) => 'worker cors: status ' + r.status)
            .catch((e) => 'worker cors error: ' + (e && e.message)),
    ]).then((a) => a.join('\\n'))`,
});
console.log('--- connectivity from page ---');
console.log(fetchTest.result.result.value);
console.log('--- console/exceptions ---');
logs.slice(0, 30).forEach((l) => console.log(l));
chrome.kill();
process.exit(0);
