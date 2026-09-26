/* Temp: verify the preset pruning —
 * 1) the grid only offers emily / 唱片 / 星河 / 滚筒
 * 2) a stale save pointing at a retired slot falls back to preset 0
 * 3) clicking a remaining card actually drives uPreset */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = process.env.CHROME_PATH
    || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:8913/music/desktop/';
const CACHE_JSON = readFileSync('E:/code/music/shots/tracks.json', 'utf8');

const serveRoot = mkdtempSync(join(tmpdir(), 'presetserve-'));
symlinkSync(resolve('.next-preset7'), join(serveRoot, 'music'), 'junction');
const server = spawn(process.execPath, ['scripts/serve-static.js', serveRoot, '8913'], {
    stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((r) => setTimeout(r, 800));

const userDataDir = mkdtempSync(join(tmpdir(), 'presetcheck-'));
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
                                var out = orig(scene, camera);
                                // Sample the framebuffer right after the draw:
                                // share of non-black pixels tells us whether the
                                // preset actually puts particles on screen.
                                if (window.__sample) {
                                    var gl = r.getContext();
                                    var w = 300, h = 200;
                                    var px = new Uint8Array(w * h * 4);
                                    gl.readPixels(
                                        Math.floor(gl.drawingBufferWidth / 2 - w / 2),
                                        Math.floor(gl.drawingBufferHeight / 2 - h / 2),
                                        w, h, gl.RGBA, gl.UNSIGNED_BYTE, px
                                    );
                                    var lit = 0;
                                    for (var i = 0; i < px.length; i += 4) {
                                        if (px[i] + px[i + 1] + px[i + 2] > 12) lit += 1;
                                    }
                                    window.__sampleResult = +(lit / (w * h)).toFixed(4);
                                    window.__sample = false;
                                }
                                return out;
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
// A stale save sitting on a retired slot (9 = 月蚀圣环).
await evalJs(`localStorage.setItem('music:setting:immersiveFx', ${JSON.stringify(JSON.stringify({ preset: 9, particleLyrics: false }))}); 'ok'`);
await send('Page.navigate', { url: URL });
await sleep(4000);

const readPreset = `(() => {
    const s = window.__scene;
    if (!s) return 'no-scene';
    let u = null;
    s.traverse((o) => {
        if (u || !o.material) return;
        const m = o.material.uniforms;
        if (m && m.uPreset) u = m;
    });
    return u ? u.uPreset.value : 'no-uniforms';
})()`;

console.log('stale save (was preset 9) -> uPreset:', await evalJs(readPreset));

await evalJs(`(() => { const b = document.querySelector('[aria-label="设置"]'); if (b) b.click(); return 'clicked'; })()`);
await sleep(900);
console.log('grid cards:', await evalJs(`(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => /card/i.test(b.className));
    return JSON.stringify(btns.map((b) => b.textContent.trim().slice(0, 24)));
})()`));
await shot('preset-grid-pruned');

const clicked = await evalJs(`(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => /card/i.test(b.className));
    const hit = btns.find((b) => b.textContent.includes('唱片'));
    if (!hit) return 'no-card';
    hit.click();
    return 'clicked 唱片';
})()`);
console.log('click ->', clicked);
await sleep(1200);
console.log('after click 唱片 -> uPreset:', await evalJs(readPreset));
await shot('preset-record-selected');

const clickedVoid = await evalJs(`(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => /card/i.test(b.className));
    const hit = btns.find((b) => b.textContent.includes('虚空'));
    if (!hit) return 'no-card';
    hit.click();
    return 'clicked 虚空';
})()`);
console.log('click ->', clickedVoid);
await sleep(1200);
console.log('after click 虚空 -> uPreset:', await evalJs(readPreset));
await shot('preset-void-selected');

// --- pixel proof: emily lights pixels, 虚空 should not ---------------------
const sample = async (label) => {
    await evalJs('window.__sampleResult = null; window.__sample = true; "armed"');
    await sleep(500);
    console.log(`lit-pixel share (${label}):`, await evalJs('window.__sampleResult'));
};
const clickCard = async (name) => {
    await evalJs(`(() => {
        const btns = [...document.querySelectorAll('button')].filter((b) => /card/i.test(b.className));
        const hit = btns.find((b) => b.textContent.includes(${JSON.stringify(name)}));
        if (hit) hit.click();
        return !!hit;
    })()`);
    await sleep(1400);
};
await clickCard('虚空');
await sample('虚空');
await clickCard('emily');
await sample('emily');
await shot('preset-emily-selected');

console.log('--- console issues ---');
console.log(logs.filter((l) => /error|shader|GLSL|WebGLProgram/i.test(l)).slice(0, 8).join('\n') || '(none)');

chrome.kill();
server.kill();
rmSync(serveRoot, { recursive: true, force: true });
process.exit(0);
