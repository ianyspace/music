// 离线外壳（`public/sw.js`）的回归检查。
//
// 为什么需要它：Service Worker 的失败是**静默**的 —— build 绿、页面正常，只有断网时才
// 暴露。而这个 worker 存在的唯一理由是「断网也能打开页面」，所以对它来说
// 「build 通过」什么也证明不了。
//
// 它守四件事，每一条都对应一个真实的失败模式：
//
//   1. 装完之后真的接管了页面，缓存里有外壳 HTML 和 `_next` 资源。后者证明安装时
//      「顺着 HTML 抓一遍」那一步还在 —— 少了它，「访问过一次然后断网」是打不开的
//      （外壳在、脚本不在）。
//   2. **在线时不读缓存**：改一次产物里的 HTML，重载必须拿到改后的那一份。这是
//      「网络优先」的正面证据，也是整个设计成立的前提 —— 有人把它改成 cache-first
//      的话这里会红，而那正是当初删掉上一代 worker 的原因。
//   3. **断网时真的回缓存**：再改一次产物 **并关掉本地服务器**，重载必须拿到上一次
//      缓存的那一份（不是新的，也不是浏览器的错误页）。用「关服务器」而不是 CDP 的
//      网络仿真来模拟断网，是因为要断的是 **worker 自己的 `fetch()`**，而仿真不一定
//      盖得到它；关服务器是真的连不上。
//   4. 激活时的清理**按前缀**：只清自己家和上一代的，不动别人家的缓存 ——
//      `caches` 是整个 origin 共用的，而这个 origin 上还挂着博客（`/space/`）。
//
// 自带静态服务器（把 `out/` 挂在 `/music/` 下，因为产物里的资源路径带 basePath），
// 所以不用 Junction、也不用先起 `serve-static.js`：`npm run build` 之后直接跑。
//
// Usage: node scripts/probe-offline.js [--port=8913] [--chrome=PATH]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');
const PAGE = path.join(OUT, 'h5', 'index.html');

const argv = process.argv.slice(2);
const option = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};

const PORT = Number(option('port', '8913'));
const CHROME = option('chrome', process.env.CHROME_PATH
    || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const URL = `http://127.0.0.1:${PORT}/music/h5/`;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const checks = [];
const problems = [];
const check = (name, ok, detail = '') => {
    checks.push({ ok });
    if (!ok) problems.push(`${name}${detail ? ` — ${detail}` : ''}`);
    process.stdout.write(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}\n`);
};

// ------------------------------------------------------------- 前置检查 ----

if (!fs.existsSync(path.join(OUT, 'sw.js')) || !fs.existsSync(PAGE)) {
    process.stderr.write('out/ 里没有 sw.js 或 h5/index.html —— 先 `npm run build`\n');
    process.exit(1);
}

// ------------------------------------------------------- 自带的静态服务器 ----

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
};

/**
 * 把 `out/` 挂在 `/music/` 下 —— 产物里的 `_next/**` 和图标路径都带 basePath，
 * 直接以 `out/` 为根服务的话它们会 404。
 *
 * `no-store` 是必要的：这个脚本靠「改产物 → 重载」判断有没有走网络，
 * 浏览器自己那份 HTTP 缓存必须不能掺和进来。
 */
const serve = function (request, response) {
    const urlPath = decodeURIComponent((request.url || '/').split('?')[0]);
    const notFound = () => {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('not found');
    };

    if (!urlPath.startsWith('/music/')) return notFound();

    let file = path.join(OUT, urlPath.slice('/music/'.length));
    if (!file.startsWith(OUT)) return notFound(); // 路径穿越
    if (!fs.existsSync(file)) return notFound();
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return notFound();

    fs.readFile(file, (err, data) => {
        if (err) return notFound();
        response.writeHead(200, {
            'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
            'cache-control': 'no-store',
        });
        response.end(data);
    });
};

const server = http.createServer(serve);
const listen = () => new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
const unlisten = () => new Promise((resolve) => server.close(resolve));

await listen();

// ------------------------------------------------------------ 产物标记 ----

// 每次都从原始内容派生，不然连着写两次会在 body 里叠出两个标记，
// 而 `getElementById` 只认第一个 —— 读到的永远是旧的那个。
const originalPage = fs.readFileSync(PAGE, 'utf8');
if (!originalPage.includes('</body>')) {
    process.stderr.write('out/h5/index.html 里没有 </body>，产物形状变了？\n');
    await unlisten();
    process.exit(1);
}
const writeMarker = (marker) => fs.writeFileSync(
    PAGE,
    originalPage.replace('</body>', `<div id="probe-marker">${marker}</div></body>`),
    'utf8',
);

// ----------------------------------------------------------------- Chrome ----

const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT + 1}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'probe-offline-'))}`,
    '--window-size=1440,810',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    // URL 放命令行上，不要用 `Page.navigate`：驱动空白页有竞态，
    // 第一次探测会打在 about:blank 上（`drive-page.js` 里记过这条）。
    URL,
], { stdio: 'ignore' });

const findTarget = async () => {
    for (let i = 0; i < 80; i += 1) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${PORT + 1}/json/list`)).json();
            const page = list.find((t) => t.type === 'page' && t.url.startsWith('http'));
            if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        } catch {
            // Chrome 还没开始监听
        }
        await sleep(250);
    }
    throw new Error('没有等到 CDP target');
};

const socket = new WebSocket(await findTarget());
await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', reject);
});

let nextId = 0;
const pending = new Map();
let loadFired = 0;

socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Page.loadEventFired') loadFired += 1;
    if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
    }
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = (nextId += 1);
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
});

const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
};

const reload = async () => {
    const before = loadFired;
    await send('Page.reload', { ignoreCache: false });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && loadFired <= before) await sleep(100);
};

/** 等到 worker 真的接管了当前页面（activate 里的清理在这之前就做完了）。 */
const waitForControl = async (timeout = 30000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const controlled = await evaluate(`!!navigator.serviceWorker.controller`).catch(() => false);
        if (controlled) return true;
        await sleep(250);
    }
    return false;
};

const readMarker = () => evaluate(`(() => {
    const el = document.getElementById('probe-marker');
    return {
        marker: el ? el.textContent : null,
        isOurHtml: !!document.getElementById('__NEXT_DATA__'),
        textLength: document.body ? document.body.innerText.trim().length : 0,
        errorPage: document.body
            ? /ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED|无法访问此网站|This site can.t be reached/.test(document.body.innerText)
            : true,
    };
})()`);

// ---------------------------------------------------------------- 开始 ----

process.stdout.write(`\n离线外壳检查 — ${URL}\n\n`);

try {
    await send('Page.enable');
    await send('Runtime.enable');

    // ---- 1. 接管 + 缓存清单 -------------------------------------------------
    check('service worker 接管了页面', await waitForControl());

    const inventory = await evaluate(`(async () => {
        // 上面那条红了的时候页面可能已经是错的（比如没有 worker、服务器也关了，
        // 落到浏览器的错误页上），那里连 \`caches\` 都没有 —— 探针该报失败，
        // 不该崩在栈里。
        if (typeof caches === 'undefined') return [];
        const out = [];
        for (const name of await caches.keys()) {
            const cache = await caches.open(name);
            const keys = await cache.keys();
            out.push({ name, count: keys.length, paths: keys.map((r) => new URL(r.url).pathname) });
        }
        return out;
    })()`);

    const shell = inventory.find((c) => c.name.includes('shell')) || { count: 0, paths: [] };
    const asset = inventory.find((c) => c.name.includes('asset')) || { count: 0, paths: [] };

    check(
        '外壳缓存里有三条路由的 HTML',
        ['/music/', '/music/h5/', '/music/desktop/'].every((p) => shell.paths.includes(p)),
        `${shell.count} 项：${shell.paths.join(' ')}`,
    );
    check(
        '资源缓存里有 _next 的 JS 和 CSS（安装时顺 HTML 抓的那一步还在）',
        asset.paths.some((p) => p.endsWith('.js')) && asset.paths.some((p) => p.endsWith('.css')),
        `${asset.count} 项`,
    );

    // ---- 2. 在线时不读缓存 --------------------------------------------------
    // 第一次访问时页面还不受 worker 控制，所以它自己的 JS / CSS 不会进缓存 ——
    // 上面那份 asset 清单是安装时补抓的结果。先重载一次让页面进入受控状态，
    // 后面两步量的才是 worker 的行为。
    await reload();
    check('重载后仍然受 worker 控制', await waitForControl());

    writeMarker('MARK-A');
    await reload();
    const online = await readMarker();
    check(
        '在线重载拿到的是刚写进产物的 MARK-A（走网络，不是缓存）',
        online.marker === 'MARK-A',
        `读到 ${JSON.stringify(online.marker)}`,
    );

    // ---- 3. 断网时真的回缓存 ------------------------------------------------
    writeMarker('MARK-B');
    await unlisten();

    await reload();
    const offline = await readMarker();
    check('关掉服务器后重载仍然是我们自己的 HTML', offline.isOurHtml);
    check('不是浏览器的错误页', !offline.errorPage);
    check(
        '拿到的是缓存里的 MARK-A，不是新写入的 MARK-B（真的回缓存了）',
        offline.marker === 'MARK-A',
        `读到 ${JSON.stringify(offline.marker)}`,
    );
    check('断网后页面有内容', offline.textLength > 0, `${offline.textLength} 字`);

    await listen();

    // ---- 4. 清理按前缀 ------------------------------------------------------
    // 种两个缓存再重新装一遍：一个上一代的名字（该被清），一个别人的名字（不该被动）。
    await evaluate(`(async () => {
        await caches.open('music-shell-seed');
        await caches.open('space-keep-me');
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((r) => r.unregister()));
        return true;
    })()`);

    await reload();
    const reinstalled = await waitForControl();
    const names = reinstalled ? await evaluate(`caches.keys()`) : [];

    check('注销后重载会重新装上并接管', reinstalled);
    check(
        '上一代的 music-shell-* 被清掉',
        !names.includes('music-shell-seed'),
        names.join(' ') || '（读不到缓存名）',
    );
    check('别人家的缓存没被动（同一个 origin 上还有博客）', names.includes('space-keep-me'));
} finally {
    fs.writeFileSync(PAGE, originalPage, 'utf8');
    socket.close();
    chrome.kill();
    await unlisten().catch(() => {});
}

process.stdout.write(`\n${checks.filter((c) => c.ok).length}/${checks.length} 通过`);
process.stdout.write(problems.length ? `\n${problems.length} 个问题\n` : '，全部通过\n');
process.exit(problems.length ? 1 : 0);
