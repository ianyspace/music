/* Temp: verify the two emily details just wired up —
 * 1) pointer push: uMouseActive/uMouseXY follow the pointer over the canvas
 * 2) entrance gather: uLoading rises on a track switch and settles back to 0
 *
 * The uniforms are read by patching WebGLRenderer.prototype.render to capture
 * the scene (no debug handle had to be added to the app code). */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = process.env.CHROME_PATH
    || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:8911/music/desktop/';
const CACHE_JSON = readFileSync('E:/code/music/shots/tracks.json', 'utf8');

const serveRoot = mkdtempSync(join(tmpdir(), 'emilyserve-'));
symlinkSync(resolve('.next-amb4'), join(serveRoot, 'music'), 'junction');
const server = spawn(process.execPath, ['scripts/serve-static.js', serveRoot, '8911'], {
    stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((r) => setTimeout(r, 800));

const userDataDir = mkdtempSync(join(tmpdir(), 'emilycheck-'));
const chrome = spawn(CHROME, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars',
    '--disable-web-security',
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
const logs = [];
ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.consoleAPICalled') {
        logs.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (msg.method === 'Log.entryAdded') logs.push(msg.params.entry.level + ': ' + msg.params.entry.text);
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

// three r128 defines `render` as an instance method inside the constructor, so
// patching the prototype never fires. Intercept the UMD export instead: wrap
// WebGLRenderer the moment three assigns it, and make the instance record its
// scene. Injected before any document script so the window is still clean.
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
                        window.__renderer = r;
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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });

await send('Page.navigate', { url: URL });
await sleep(2500);
await evalJs(`localStorage.setItem('music:trackListCache:v2:cloud', ${JSON.stringify(CACHE_JSON)}); 'ok'`);
await evalJs(`localStorage.setItem('music:setting:immersiveFx', ${JSON.stringify(JSON.stringify({ preset: 0, particleLyrics: false }))}); 'ok'`);
await send('Page.navigate', { url: URL });
await sleep(4000);

console.log('rows:', await evalJs(`document.querySelectorAll('ul li button:not([aria-label])').length`));
console.log('three:', await evalJs(`window.THREE ? (window.__renderer ? 'renderer captured' : 'three but no renderer') : 'no-three'`));
await sleep(600);

const readU = `(() => {
    const s = window.__scene;
    if (!s) return 'no-scene';
    let u = null;
    s.traverse((o) => {
        if (u || !o.material) return;
        const m = o.material.uniforms;
        if (m && m.uMouseActive) u = m;
    });
    if (!u) return 'no-uniforms';
    return JSON.stringify({
        active: u.uMouseActive.value,
        x: +u.uMouseXY.value.x.toFixed(3),
        y: +u.uMouseXY.value.y.toFixed(3),
        loading: +u.uLoading.value.toFixed(3),
        hasCover: u.uHasCover.value,
        preset: u.uPreset.value,
    });
})()`;

console.log('before move ->', await evalJs(readU));
await move(720, 400);
console.log('over canvas ->', await evalJs(readU));
await shot('emily-pointer-canvas');
await move(300, 200);
console.log('canvas left-up ->', await evalJs(readU));
// The play bar sits at the bottom; hovering it must disable the push.
await move(720, 770);
console.log('over play bar ->', await evalJs(readU));

// --- entrance gather: switch tracks and sample uLoading -------------------
const switched = await evalJs(`(() => {
    const btns = [...document.querySelectorAll('ul li button:not([aria-label])')];
    if (btns.length < 2) return 'no-rows';
    btns[1].click();
    return btns[1].getAttribute('title');
})()`);
console.log('switched to:', switched);
const samples = await evalJs(`(async () => {
    const out = [];
    const read = () => {
        const s = window.__scene;
        let u = null;
        s && s.traverse((o) => {
            if (u || !o.material) return;
            const m = o.material.uniforms;
            if (m && m.uMouseActive) u = m;
        });
        return u ? +u.uLoading.value.toFixed(3) : -1;
    };
    for (let i = 0; i < 90; i += 1) {
        out.push(read());
        await new Promise((r) => setTimeout(r, 30));
    }
    return JSON.stringify({ max: Math.max(...out), first: out.slice(0, 8), last: out.slice(-6) });
})()`, true);
console.log('uLoading samples ->', samples);
await shot('emily-after-switch');

console.log('--- console issues ---');
console.log(logs.filter((l) => /error|shader|GLSL|WebGLProgram/i.test(l)).slice(0, 8).join('\n') || '(none)');

chrome.kill();
server.kill();
rmSync(serveRoot, { recursive: true, force: true });
process.exit(0);
