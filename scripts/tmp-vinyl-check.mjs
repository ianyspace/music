/* Temp: verify the vinyl preset and the play bar disc share one rotation —
 * same rate (14 s per turn), same angle, and both frozen while paused. */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = process.env.CHROME_PATH
    || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:8921/music/desktop/';
const CACHE_JSON = readFileSync('E:/code/music/shots/tracks.json', 'utf8');

const serveRoot = mkdtempSync(join(tmpdir(), 'vinylserve-'));
symlinkSync(resolve('.next-vinyl'), join(serveRoot, 'music'), 'junction');
const server = spawn(process.execPath, ['scripts/serve-static.js', serveRoot, '8921'], {
    stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((r) => setTimeout(r, 800));

const userDataDir = mkdtempSync(join(tmpdir(), 'vinylcheck-'));
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
// preset 4 = 唱片
await evalJs(`localStorage.setItem('music:setting:immersiveFx', ${JSON.stringify(JSON.stringify({ preset: 4, particleLyrics: false }))}); 'ok'`);
await send('Page.navigate', { url: URL });
await sleep(4000);

const readU = `(() => {
    const s = window.__scene;
    if (!s) return 'no-scene';
    let u = null;
    s.traverse((o) => {
        if (u || !o.material) return;
        const m = o.material.uniforms;
        if (m && m.uVinylSpin) u = m;
    });
    return u ? u.uVinylSpin.value : 'no-uniforms';
})()`;
// the DOM disc: unwrap the 2x2 matrix CSS reports back into an angle
const readDisc = `(() => {
    const el = [...document.querySelectorAll('span')].find((e) => /disc/i.test(e.className) && e.getBoundingClientRect().width > 20 && e.getBoundingClientRect().width < 60);
    if (!el) return 'no-disc';
    const t = getComputedStyle(el).transform;
    if (!t || t === 'none') return 0;
    const n = t.match(/matrix\\(([^)]+)\\)/);
    if (!n) return t;
    const [a, b] = n[1].split(',').map(Number);
    return Math.atan2(b, a);
})()`;

const unwrap = (prev, next) => {
    let d = next - prev;
    while (d < -Math.PI) d += Math.PI * 2;
    while (d > Math.PI) d -= Math.PI * 2;
    return d;
};

// --- start playback --------------------------------------------------------
const started = await evalJs(`(() => {
    const btns = [...document.querySelectorAll('ul li button:not([aria-label])')];
    if (!btns.length) return 'no-rows';
    btns[0].click();
    return 'started';
})()`);
console.log('playback:', started);
await sleep(2500);

const a0 = await evalJs(readU);
const d0 = await evalJs(readDisc);
await sleep(2000);
const a1 = await evalJs(readU);
const d1 = await evalJs(readDisc);
const rate = typeof a0 === 'number' && typeof a1 === 'number' ? unwrap(a0, a1) / 2 : null;
console.log('playing: uVinylSpin', a0, '->', a1, '| rate rad/s:', rate, '| period s:', rate ? +(Math.PI * 2 / rate).toFixed(2) : null);
console.log('playing: disc angle', d0, '->', d1);
console.log('angle delta 3D vs disc (rad):', typeof a1 === 'number' && typeof d1 === 'number' ? +Math.abs(unwrap(a1, d1)).toFixed(4) : 'n/a');
await shot('vinyl-playing');

// --- pause -----------------------------------------------------------------
const paused = await evalJs(`(() => {
    const b = document.querySelector('[aria-label="暂停"]');
    if (!b) return 'no-pause-button';
    b.click();
    return 'paused';
})()`);
console.log('pause:', paused);
await sleep(1200);
const p0 = await evalJs(readU);
const pd0 = await evalJs(readDisc);
await sleep(1500);
const p1 = await evalJs(readU);
const pd1 = await evalJs(readDisc);
console.log('paused: uVinylSpin', p0, '->', p1, '| drift:', typeof p0 === 'number' ? +Math.abs(unwrap(p0, p1)).toFixed(5) : 'n/a');
console.log('paused: disc angle', pd0, '->', pd1, '| drift:', typeof pd0 === 'number' ? +Math.abs(unwrap(pd0, pd1)).toFixed(5) : 'n/a');
await shot('vinyl-paused');

console.log('--- console issues ---');
console.log(logs.filter((l) => /error|shader|GLSL/i.test(l)).slice(0, 6).join('\n') || '(none)');

chrome.kill();
server.kill();
rmSync(serveRoot, { recursive: true, force: true });
process.exit(0);
