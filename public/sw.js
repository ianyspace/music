/**
 * Music Space service worker.
 *
 * Goal: the site opens and plays like an installed app, including with no
 * network at all. Two rules make that safe:
 *
 * 1. **The app shell is never the reason something breaks.** Every handler
 *    falls back to the network, and a failed network call is passed through as
 *    a normal error response — the SW never invents a broken reply. A bad
 *    cached entry simply loses to a live fetch on the next load.
 * 2. **Only the shell is cached here.** Audio and the track list live in
 *    IndexedDB (see `components/Music/audioCache.js`), which is where
 *    "permanent until the user deletes it" is implemented and where the cache
 *    manager can count and clear things. Caching media in the SW Cache API
 *    too would double the storage and put tracks beyond the user's reach.
 *
 * Strategy per request kind (the user's requested pattern — serve cached, then
 * refresh the cache from the network):
 *
 * - `_next/static/**` → cache-first. These URLs are content-hashed by Next, so
 *   a hit is always the right bytes and a new deploy gets new names.
 * - Page navigations / other same-origin GETs → stale-while-revalidate: answer
 *   from cache instantly, revalidate in the background so the next load is
 *   fresh.
 * - Cross-origin (music Worker, R2 audio, Google APIs, fonts) → untouched. The
 *   app already owns these and OAuth/range requests must not be intercepted.
 */

/* eslint-disable no-restricted-globals */

const VERSION = 'v1';
const SHELL_CACHE = `music-shell-${VERSION}`;
const RUNTIME_CACHE = `music-runtime-${VERSION}`;
const KEEP = [SHELL_CACHE, RUNTIME_CACHE];

/**
 * Nothing is precached by URL list on purpose: the basePath is known only to
 * the build, and a hard-coded list would 404 the whole install step if it ever
 * drifted. The shell warms itself on the first visit instead, and the app still
 * works offline from the second load on.
 *
 * URLs are resolved against the SW's own location so they match what the page
 * actually requests (`./` becomes `https://host/music/`), which is what the
 * runtime lookups search for.
 */
const SHELL_URLS = ['./', './h5/', './desktop/'].map((path) => new URL(path, self.location.href).href);

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        // Individually, so one 404 cannot abort the whole install.
        await Promise.all(SHELL_URLS.map(async (url) => {
            try {
                const response = await fetch(url, { cache: 'reload' });
                if (response && response.ok) await cache.put(url, response);
            } catch (err) { /* offline during install — warm up later instead */ }
        }));
        // Take over as soon as possible: the shell is additive, so there is no
        // half-updated state to worry about.
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.map((name) => (
            KEEP.includes(name) ? undefined : caches.delete(name)
        )));
        // Serve the already-open page instead of waiting for a reload.
        await self.clients.claim();
    })());
});

/** Same-origin GETs only — everything else belongs to the app. */
const isCacheable = function (request) {
    if (request.method !== 'GET') return false;
    let url;
    try { url = new URL(request.url); } catch (err) { return false; }
    if (url.origin !== self.location.origin) return false;
    // The SW itself must always come from the network, or a broken build could
    // not be replaced.
    if (url.pathname.endsWith('/sw.js')) return false;
    return true;
};

const isImmutableAsset = function (request) {
    try {
        return new URL(request.url).pathname.includes('/_next/static/');
    } catch (err) { return false; }
};

const isNavigation = function (request) {
    return request.mode === 'navigate' || request.destination === 'document';
};

/**
 * Cache-first: content-hashed assets never change under a given URL, so a hit
 * is final and there is nothing to revalidate.
 */
const cacheFirst = async function (request) {
    const cache = await caches.open(RUNTIME_CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;

    const response = await fetch(request);
    if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone()).catch(() => { });
    }
    return response;
};

/**
 * Last resort when the network is unreachable and nothing matches the request.
 *
 * For a navigation any route works, because every page renders the same app
 * shell — so a cached `h5/` document can answer a link to `desktop/` instead of
 * letting the browser show its own error page. Cached documents are indexed by
 * exact URL, so the search walks the shell URLs.
 */
const offlineNavigationFallback = async function () {
    const shellCache = await caches.open(SHELL_CACHE);
    for (const url of SHELL_URLS) {
        const cached = await shellCache.match(url);
        if (cached) return cached;
    }
    // The runtime cache also holds whatever the visitor actually browsed.
    const runtime = await caches.open(RUNTIME_CACHE);
    for (const url of SHELL_URLS) {
        const cached = await runtime.match(url);
        if (cached) return cached;
    }
    return undefined;
};

/**
 * Stale-while-revalidate: answer from cache immediately (fast, works offline)
 * and refresh the entry in the background so the next load is current. The
 * live response is what a first-time visitor gets.
 */
const staleWhileRevalidate = async function (request) {
    const cache = await caches.open(RUNTIME_CACHE);
    const hit = await cache.match(request);

    const network = fetch(request).then((response) => {
        if (response && response.ok && response.type === 'basic') {
            cache.put(request, response.clone()).catch(() => { });
        }
        return response;
    });

    if (hit) {
        // Revalidation runs on its own; a failure must not surface as an
        // unhandled rejection.
        network.catch(() => { });
        return hit;
    }

    try {
        return await network;
    } catch (err) {
        // Offline with nothing cached for this exact URL.
        if (isNavigation(request)) {
            const shell = await offlineNavigationFallback();
            if (shell) return shell;
        }
        throw err;
    }
};

self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Range requests (audio seeking) must reach the network untouched; the app
    // handles its own audio caching, and a re-sliced cached body would corrupt
    // playback.
    if (request.headers.get('range')) return;
    if (!isCacheable(request)) return;

    const handler = isImmutableAsset(request)
        ? cacheFirst(request)
        : staleWhileRevalidate(request);

    // Last line of defence: if the strategy itself throws (a cache API error,
    // an unexpected shape), go straight to the network rather than failing the
    // request. Only if that also fails does the browser surface its own error,
    // which is the same behaviour as having no service worker at all.
    event.respondWith(handler.catch(async () => {
        try {
            return await fetch(request);
        } catch (err) {
            if (isNavigation(request)) {
                const shell = await offlineNavigationFallback();
                if (shell) return shell;
            }
            throw err;
        }
    }));
});

/**
 * Lets the page drop cached shell assets (used when the user clears caches, or
 * on a hard refresh after a deploy). Audio/track data is untouched — that lives
 * in IndexedDB and is cleared from the cache manager.
 */
self.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type !== 'CLEAR_SHELL') return;
    event.waitUntil((async () => {
        await Promise.all(KEEP.map((name) => caches.delete(name)));
        if (event.source && event.source.postMessage) {
            event.source.postMessage({ type: 'SHELL_CLEARED' });
        }
    })());
});
