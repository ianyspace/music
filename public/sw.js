/**
 * 离线外壳。
 *
 * 只做一件事：**断网时页面还打得开**。它是纯离线兜底，不是加速层 ——
 * 所有请求都走「网络优先」，只有网络真的失败才回缓存。这一条是整个设计的支点。
 *
 * 这个仓库曾经有过一个「预缓存外壳」的 worker，它被删掉是因为部署之后旧外壳会继续
 * 吐旧 JS，而且「我现在看到的是不是最新版」没法靠刷新回答 —— 排查线上问题时这个
 * 不确定性反复误导过判断。网络优先把这两条都消掉了：只要在线，拿到的永远是线上的
 * 那一份，刷新一次就能确定版本；缓存只在 `fetch()` 抛错时被读到。所以「有 worker」
 * 这件事本身不再意味着「可能在看旧东西」。
 *
 * 缓存范围只有本站自己的 HTML / CSS / JS / 图标。曲库 Worker、R2 音频和封面都是
 * 跨域的，这里一律不碰 —— 那些由应用自己的缓存层管
 * （`components/Music/audioCache.js` + `lib/cache/indexedDb.js`）。
 */

const VERSION = 'v1';

/** 这个 worker 自己的缓存。前缀用来在 activate 里精确地只清自己的。 */
const CACHE_PREFIX = 'music-offline-';
const SHELL_CACHE = `${CACHE_PREFIX}shell-${VERSION}`;
const ASSET_CACHE = `${CACHE_PREFIX}asset-${VERSION}`;

/**
 * 上一代 worker 留下的缓存名。它的注销代码（原来的 `utils/retireServiceWorker.js`）
 * 随这次改动删掉了 —— 旧注册会被同一个地址上的新脚本顶掉，缓存就顺手在这里清。
 */
const LEGACY_CACHE_PREFIXES = ['music-shell-', 'music-runtime-'];

/** worker 的 scope，也就是 `https://<host>/music/`。所有路径都从它推，不写死 basePath。 */
const SCOPE = self.registration.scope;
const SCOPE_PATH = new URL(SCOPE).pathname;
const scoped = (path) => new URL(path, SCOPE).href;

/** 三条路由 + 图标：装的时候一起拿下来，断网时至少能打开一个完整的壳。 */
const SHELL = [
    scoped('./'),
    scoped('h5/'),
    scoped('desktop/'),
    scoped('favicon.ico'),
    scoped('apple-touch-icon.png'),
    scoped('icon-192.png'),
    scoped('icon-512.png'),
];

/**
 * HTML 里引用的 `_next/static/**`。
 *
 * 安装发生在**第一次访问时**，而那次访问的请求不经过这个 worker（它还没接管），
 * 所以页面自己的 JS / CSS 不会进缓存。不把这一遍补上，「访问过一次然后断网」
 * 就是打不开的：外壳在、脚本不在。
 */
const NEXT_ASSET = /["'(]([^"'()\s]*\/_next\/static\/[^"'()\s]+)["')]/g;

/**
 * 顺着刚缓存下来的 HTML 把里面的 `_next/static/**` 也抓一遍。
 *
 * 逐个 `add` 并吞掉失败：任何一个 404（比如某个图标以后被删掉）都不该让整个
 * worker 装不上 —— 装不上就是彻底没有离线能力。
 */
async function precacheShellAssets(shellCache) {
    const assetCache = await caches.open(ASSET_CACHE);
    const found = new Set();

    await Promise.all(SHELL.map(async (url) => {
        const response = await shellCache.match(url);
        if (!response) return;

        const html = await response.text();
        for (const match of html.matchAll(NEXT_ASSET)) found.add(scoped(match[1]));
    }));

    await Promise.all([...found].map((url) => assetCache.add(url).catch(() => {})));
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
        await precacheShellAssets(cache);

        // 立刻接管，而不是等所有标签页关掉：新版本要马上生效。
        // 网络优先的策略下这不危险 —— 接管之后在线拿到的仍然是线上的那一份。
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
        const names = await caches.keys();

        await Promise.all(names
            .filter((name) => {
                if (keep.has(name)) return false;
                // 只清自己家的和上一代留下的。**这个 origin 上还挂着别的项目**
                // （博客在 `/space/`），它们的缓存不归这里管。
                return name.startsWith(CACHE_PREFIX)
                    || LEGACY_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix));
            })
            .map((name) => caches.delete(name)));

        await self.clients.claim();
    })());
});

/**
 * 网络优先，失败才回缓存。
 *
 * 成功响应顺手存一份 —— 这就是离线时能被读到的东西的全部来源。只存
 * `ok && type === 'basic'`：4xx / 5xx 也存下来的话，一个临时的 500 会变成
 * 断网时的「正式内容」，而跨域的不透明响应既读不到状态也没法判断对错。
 */
async function networkFirst(request) {
    const isNavigation = request.mode === 'navigate';
    const cache = await caches.open(isNavigation ? SHELL_CACHE : ASSET_CACHE);

    try {
        const response = await fetch(request);

        if (response.ok && response.type === 'basic') {
            await cache.put(request, response.clone()).catch(() => {});
        }

        return response;
    } catch (err) {
        const cached = await cache.match(request);
        if (cached) return cached;

        // 断网，而且这个地址没缓存过：给一个打得开的外壳，而不是浏览器那张恐龙页。
        // `./` 就是入口路由，它自己会按屏宽送去 /h5 或 /desktop。
        if (isNavigation) {
            const shell = await cache.match(scoped('./'));
            if (shell) return shell;
        }

        throw err;
    }
}

self.addEventListener('fetch', (event) => {
    const { request } = event;

    if (request.method !== 'GET') return;

    // 带 Range 的请求（音频拖动）不能按整份响应缓存：存下来的是一段 206，
    // 下次当完整响应发出去就错了。这类直接放行。
    if (request.headers.has('range')) return;

    const url = new URL(request.url);

    // 只碰本站自己的东西。曲库清单、音频、封面都在别的域上。
    if (url.origin !== self.location.origin) return;
    if (!url.pathname.startsWith(SCOPE_PATH)) return;

    event.respondWith(networkFirst(request));
});
