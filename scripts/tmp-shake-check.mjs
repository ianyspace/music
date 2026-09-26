/* Temp: measure the period of the camera's standing drift (the "镜头晃动"
 * slider's always-on sine component) and confirm it is ~2.5x slower than the
 * old 1.31 / 1.75 / 2.62 s. Also reports the render fps so a clamped dt
 * (dt is capped at 0.05) can be ruled out as the cause of any discrepancy. */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = process.env.CHROME_PATH
    || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:8924/music/desktop/';
const CACHE_JSON = readFileSync('E:/code/music/shots/tracks.json', 'utf8');
const DIST = process.argv[2] || '.next-shake';

const serveRoot = mkdtempSync(join(tmpdir(), 'shakesrv-'));
symlinkSync(resolve(DIST), join(serveRoot, 'music'), 'junction');
const server = spawn(process.execPath, ['scripts/serve-static.js', serveRoot, '8924'], {
    stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((r) => setTimeout(r, 800));

const userDataDir = mkdtempSync(join(tmpdir(), 'shakecheck-'));
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
                            window.__camera = camera;
                            window.__renders = (window.__renders || 0) + 1;
                            if (!window.__renderT0) window.__renderT0 = performance.now();
                            window.__renderT1 = performance.now();
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
// cinemaShake at its default 0.5, cinema on, no lyrics to keep the frame cheap.
await evalJs(`localStorage.setItem('music:setting:immersiveFx', ${JSON.stringify(JSON.stringify({ preset: 0, particleLyrics: false, cinema: true, cinemaShake: 0.5 }))}); 'ok'`);
await send('Page.navigate', { url: URL });
await sleep(4000);

// Park the pointer dead centre so the follow term is a constant and only the
// standing drift remains in theta.
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720, y: 450, button: 'none' });
await sleep(2500);

console.log('camera present ->', await evalJs(`!!window.__camera`));

const SAMPLE_MS = 26000;
const series = await evalJs(`(async () => {
    const c = window.__camera;
    if (!c) return 'no-camera';
    const out = [];
    const t0 = performance.now();
    await new Promise((done) => {
        const step = () => {
            const p = c.position;
            const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
            out.push([
                +(performance.now() - t0).toFixed(1),
                Math.atan2(p.x, p.z),
                Math.asin(Math.max(-1, Math.min(1, p.y / r))),
                r,
            ]);
            if (performance.now() - t0 > ${SAMPLE_MS}) return done();
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    });
    return JSON.stringify(out);
})()`, true);

const fps = await evalJs(`(() => {
    const n = window.__renders || 0;
    const dt = (window.__renderT1 || 0) - (window.__renderT0 || 0);
    return dt > 0 ? +(n / (dt / 1000)).toFixed(1) : 'n/a';
})()`);

const analyse = (rows, idx) => {
    const v = rows.map((r) => r[idx]);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const dev = v.map((x) => x - mean);
    const amp = Math.max(...dev.map(Math.abs));
    const crossings = [];
    for (let i = 1; i < dev.length; i += 1) {
        if (dev[i - 1] < 0 && dev[i] >= 0) {
            const t = rows[i - 1][0] + (rows[i][0] - rows[i - 1][0]) * (-dev[i - 1] / (dev[i] - dev[i - 1]));
            crossings.push(t);
        }
    }
    let period = null;
    if (crossings.length >= 2) {
        period = +(((crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1)) / 1000).toFixed(2);
    }
    return { amp: +amp.toFixed(5), cycles: crossings.length, periodSec: period };
};

if (typeof series !== 'string' || series.startsWith('no-camera') || series.startsWith('ERR')) {
    console.log('sample failed ->', series);
} else {
    const rows = JSON.parse(series);
    const th = analyse(rows, 1);
    const ph = analyse(rows, 2);
    const ra = analyse(rows, 3);
    console.log('samples:', rows.length, '| render fps:', fps);
    console.log('theta  ->', JSON.stringify(th), ' (expect ~3.27s)');
    console.log('phi    ->', JSON.stringify(ph), ' (expect ~4.36s)');
    console.log('radius ->', JSON.stringify(ra), ' (expect ~6.54s)');
    console.log('theta amplitude deg:', +(th.amp * 57.2958).toFixed(3), '(expect ~0.34 at shake 0.5)');
}

console.log('--- console issues ---');
console.log(logs.filter((l) => /error|shader|GLSL/i.test(l)).slice(0, 6).join('\n') || '(none)');

chrome.kill();
server.kill();
rmSync(serveRoot, { recursive: true, force: true });
process.exit(0);
