/**
 * Loading a cover by whatever route works — shared by every layer that
 * samples cover pixels (the nebula, the tunnel, the palette picker).
 *
 * The covers live on an r2.dev bucket whose reachability is *intermittent*
 * (measured: 200 in 2.3 s one minute, dead the next — classic from-here
 * Cloudflare flakiness). The first loader fired exactly one `Image` request;
 * any transient failure stranded the nebula on the tint fallback for the
 * whole session, which read as "the nebula is a coloured ball, not the
 * cover". So now:
 *   1. a successfully sampled cover is downscaled into a dataURL and kept
 *      in localStorage, keyed by URL — after one good load the portrait
 *      survives even a fully dead network;
 *   2. a network load retries with backoff and every attempt is fenced by
 *      a timeout, because an `Image` that neither fires load nor error
 *      would otherwise hang the fallback forever.
 */

const COVER_CACHE_PREFIX = 'music.nebula-cover.';
const COVER_CACHE_MAX_SIDE = 128;

const coverCacheGet = function (url) {
    try {
        return localStorage.getItem(COVER_CACHE_PREFIX + url);
    } catch (error) {
        return null;
    }
};

const coverCachePut = function (url, image) {
    let dataUrl = '';
    try {
        const side = Math.min(
            COVER_CACHE_MAX_SIDE,
            Math.max(image.naturalWidth, image.naturalHeight) || COVER_CACHE_MAX_SIDE,
        );
        const canvas = document.createElement('canvas');
        canvas.width = side;
        canvas.height = side;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(image, 0, 0, side, side);
        dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    } catch (error) {
        return; // tainted or undecodable — nothing worth keeping
    }
    try {
        localStorage.setItem(COVER_CACHE_PREFIX + url, dataUrl);
    } catch (error) {
        // Quota: drop one older entry and try once more, else give up —
        // the cache is an accelerator, never a requirement.
        try {
            const keys = [];
            for (let i = 0; i < localStorage.length; i += 1) {
                const key = localStorage.key(i);
                if (key && key.startsWith(COVER_CACHE_PREFIX)) keys.push(key);
            }
            if (keys.length) localStorage.removeItem(keys[0]);
            localStorage.setItem(COVER_CACHE_PREFIX + url, dataUrl);
        } catch (ignored) {
            /* skip */
        }
    }
};

/** One `Image` load, fenced by a timeout. Resolves the image or null. */
export const loadImageFenced = function (url, timeoutMs) {
    return new Promise((resolve) => {
        const image = new Image();
        // Before `src`, or the request goes out without CORS and the canvas
        // comes back tainted.
        image.crossOrigin = 'anonymous';
        let settled = false;
        const done = (result) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            resolve(result);
        };
        const timer = window.setTimeout(() => {
            image.src = ''; // abort an in-flight request
            done(null);
        }, timeoutMs);
        image.onload = () => done(image);
        image.onerror = () => done(null);
        image.src = url;
    });
};

const sleep = (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); });

/**
 * The cover, by whatever route works. Cache first (instant, works offline),
 * then up to three network attempts at 0 / 1.5 s / 4 s, each fenced at 12 s.
 * Resolves an `HTMLImageElement` or null — null means the caller renders its
 * tint fallback.
 */
export const loadCoverResilient = async function (url) {
    const cached = coverCacheGet(url);
    if (cached) {
        const cachedImage = await loadImageFenced(cached, 4000);
        if (cachedImage) return cachedImage;
    }
    // The cover is ALSO requested by the list thumbnails as a plain `<img>` —
    // no CORS — and that response (no `Access-Control-Allow-Origin`, because
    // r2.dev only answers an `Origin`) lands in the HTTP cache. A CORS-mode
    // request for the same URL then hits that entry and fails the check
    // instantly — measured: `net::ERR_FAILED` in 1 ms, which read as "the
    // nebula lost its cover" plus a CORS error in the console. A stable query
    // param gives the pixel layers their own cache entry, written by a
    // CORS-mode request and therefore always safe for them to reuse.
    const corsUrl = url + (url.includes('?') ? '&' : '?') + 'nebula=1';
    const backoffs = [0, 1500, 4000];
    for (let attempt = 0; attempt < backoffs.length; attempt += 1) {
        if (backoffs[attempt]) await sleep(backoffs[attempt]);
        const image = await loadImageFenced(corsUrl, 12_000);
        if (image) {
            coverCachePut(url, image);
            return image;
        }
    }
    return null;
};
