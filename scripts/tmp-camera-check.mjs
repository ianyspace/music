/* Temp: verify the camera now follows the pointer without a drag, drifts back
 * to the baseline once the pointer goes idle, and sits further out (smaller
 * subject) than before. Reads the camera through the patched WebGLRenderer. */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = process.env.CHROME_PATH
    || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:8923/music/desktop/';
const CACHE_JSON = readFileSync('E:/code/music/shots/tracks.json', 'utf8');

const serveRoot = mkdtempSync(join(tmpdir(), 'camsrv-'));
symlinkSync(resolve('.next-camera'), join(serveRoot, 'music'), 'junction');
const server = spawn(process.execPath, ['scripts/serve-static.js', serveRoot, '8923'], {
    stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((r) => setTimeout(r, 800));

const userDataDir = mkdtempSync(join(tmpdir(), 'camcheck-'));
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
const move = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await sleep(120);
};
const shot = async (name) => {
    const png = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`E:/code/music/shots/${name}.png`, Buffer.from(png.result.data, 'base64'));
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
(function () {
    var _three;
    Object.defineProperty(window, 'THREE', {
        configurable: true,
        get: function () { return _three; },
        set: function (v) {
            _three = v;
            if (!v || typeof v !== 'object') return;
            var _renderer;
            Object.defineProperty(v, 'WebGLRenderer', {
                configurable: true,
                get: function () { return _renderer; },
                set: function (Real) {
                    var Wrapped = function () {
                        var r = new (Function.prototype.bind.apply(Real, [null].concat([].slice.call(arguments))))();
                        var orig = r.render.bind(r);
                        r.render = function (scene, camera) {
                            window.__scene = scene;
                            window.__camera = camera;
                            return orig(scene, camera);
                        };
                        return r;
                    };
                    Wrapped.prototype = Real.prototype;
                    _renderer = Wrapped;
                }
            });
        }
    });
})();
`,
});
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

await send('Page.navigate', { url: URL });
await sleep(2500);
await evalJs(`localStorage.setItem('music:trackListCache:v2:cloud', ${JSON.stringify(CACHE_JSON)}); 'ok'`);
await evalJs(`localStorage.setItem('music:setting:immersiveFx', ${JSON.stringify(JSON.stringify({ preset: 0, particleLyrics: false }))}); 'ok'`);
await send('Page.navigate', { url: URL });
await sleep(4000);

const readCam = `(() => {
    const c = window.__camera;
    if (!c) return 'no-camera';
    const p = c.position;
    const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    return JSON.stringify({
        radius: +r.toFixed(3),
        theta: +Math.atan2(p.x, p.z).toFixed(4),
        phi: +Math.asin(Math.max(-1, Math.min(1, p.y / r))).toFixed(4),
    });
})()`;
const parse = (v) => (typeof v === 'string' && v.startsWith('{') ? JSON.parse(v) : v);

// Baseline: pointer parked away from the canvas, nothing pressed.
await move(720, 450);
await sleep(1500);
const base = parse(await evalJs(readCam));
console.log('baseline          ->', JSON.stringify(base));

// Hover right-of-centre (no button held): the view should swing.
await move(1150, 300);
await sleep(700);
const right = parse(await evalJs(readCam));
console.log('hover right       ->', JSON.stringify(right));
await shot('camera-follow-right');

// Hover the other side.
await move(360, 620);
await sleep(700);
const left = parse(await evalJs(readCam));
console.log('hover left-low    ->', JSON.stringify(left));
await shot('camera-follow-left');

// Now hold perfectly still: it should drift back to the baseline.
await sleep(3200);
const settled = parse(await evalJs(readCam));
console.log('idle 3.2s after   ->', JSON.stringify(settled));
await shot('camera-recentred');

const d = (a, b, k) => (typeof a === 'object' && typeof b === 'object' ? +Math.abs(a[k] - b[k]).toFixed(4) : 'n/a');
console.log('--- verdict ---');
console.log('theta moved on hover (right vs baseline):', d(base, right, 'theta'));
console.log('theta moved on hover (left  vs baseline):', d(base, left, 'theta'));
console.log('theta residual after idle  :', d(base, settled, 'theta'));
console.log('radius (baseline 6.6 x1.14 = 7.52):', base && base.radius);

console.log('--- console issues ---');
console.log(logs.filter((l) => /error|shader|GLSL/i.test(l)).slice(0, 6).join('\n') || '(none)');

chrome.kill();
server.kill();
rmSync(serveRoot, { recursive: true, force: true });
process.exit(0);
