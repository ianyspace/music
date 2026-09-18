/**
 * space-music — Cloudflare Worker that exposes an R2 bucket as a JSON track
 * index for the static blog's `/music/` page.
 *
 * The blog is exported statically to GitHub Pages, so it cannot list a bucket
 * on its own (R2 has no directory listing over HTTP). This Worker does it:
 *
 *   GET /tracks            → { tracks: [...], generatedAt }
 *   GET /tracks?refresh=1  → same, bypassing the edge cache
 *
 * Each track is:
 *   { id, name, key, size, url, lyricsUrl, source: 'cloud' }
 *
 * `id` is the R2 object key (stable and unique), `url` points at the public
 * R2 domain so the browser can download the audio directly, and `lyricsUrl`
 * is the matching `.lrc` / `.txt` object with the same base name (optional).
 *
 * The index is cached in `caches.default` for CACHE_TTL_SECONDS to keep R2
 * Class A (list) operations low; `?refresh=1` is the escape hatch.
 */

const AUDIO_EXTENSIONS = ['mp3', 'flac', 'm4a', 'wav', 'ogg', 'oga', 'opus', 'aac', 'wma', 'ape'];
const LYRIC_EXTENSIONS = ['lrc', 'txt'];
const CACHE_TTL_SECONDS = 300;
const LIST_PAGE_SIZE = 1000;
const LIST_HARD_CAP = 5000;
const CACHE_PATH = '/__space-music-index-v1';

const extensionOf = function (name) {
    const match = /\.([a-z0-9]+)$/i.exec(name);
    return match ? match[1].toLowerCase() : '';
};

const basenameOf = function (key) {
    return key.split('/').pop() || key;
};

// Mirrors `normalizeLyricKey` in components/Music/shared.js so that
// "01. 牵丝戏 - 银临.mp3" matches "牵丝戏-银临.lrc".
const normalizeLyricKey = function (name) {
    return name
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/^\s*\d{1,3}[\s._-]+/, '')
        .toLowerCase()
        .replace(/[\s._()[\]{}-]+/g, '');
};

const encodeKey = function (key) {
    return key.split('/').map(encodeURIComponent).join('/');
};

const corsHeaders = function (request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    const allowOrigin = allowed.includes(origin) ? origin : (allowed[0] || '');
    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
    };
};

const withHeaders = function (body, status, headers) {
    return new Response(body, { status, headers });
};

const jsonResponse = function (data, status, headers) {
    return withHeaders(JSON.stringify(data), status, {
        'Content-Type': 'application/json; charset=utf-8',
        ...headers,
    });
};

// Adds CORS to an already built response without disturbing its body.
const withCors = function (response, cors) {
    const headers = new Headers(response.headers);
    Object.keys(cors).forEach((name) => headers.set(name, cors[name]));
    return new Response(response.body, { status: response.status, headers });
};

const listAllObjects = async function (bucket, prefix) {
    const objects = [];
    let cursor;
    do {
        const page = await bucket.list({ prefix, cursor, limit: LIST_PAGE_SIZE });
        objects.push(...page.objects);
        cursor = page.truncated ? page.cursor : undefined;
    } while (cursor && objects.length < LIST_HARD_CAP);
    return objects;
};

const buildIndex = async function (env) {
    const objects = await listAllObjects(env.MUSIC_BUCKET, env.MUSIC_PREFIX || '');
    const base = String(env.R2_PUBLIC_BASE || '').replace(/\/+$/, '');

    const lyricsByKey = new Map();
    const audioObjects = [];
    objects.forEach((object) => {
        const ext = extensionOf(object.key);
        if (LYRIC_EXTENSIONS.includes(ext)) lyricsByKey.set(normalizeLyricKey(object.key), object);
        else if (AUDIO_EXTENSIONS.includes(ext)) audioObjects.push(object);
    });

    const tracks = audioObjects
        .map((object) => {
            const lyric = lyricsByKey.get(normalizeLyricKey(object.key));
            return {
                id: object.key,
                key: object.key,
                name: basenameOf(object.key),
                size: object.size,
                url: `${base}/${encodeKey(object.key)}`,
                lyricsUrl: lyric ? `${base}/${encodeKey(lyric.key)}` : null,
                source: 'cloud',
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

    return { tracks, generatedAt: Date.now() };
};

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const cors = corsHeaders(request, env);

        if (request.method === 'OPTIONS') return withHeaders(null, 204, cors);
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return jsonResponse({ error: 'Method not allowed' }, 405, cors);
        }
        if (url.pathname !== '/tracks') {
            return jsonResponse({ error: 'Not found. Try /tracks' }, 404, cors);
        }
        if (!env.MUSIC_BUCKET) {
            return jsonResponse({ error: 'MUSIC_BUCKET binding is missing' }, 500, cors);
        }
        if (!env.R2_PUBLIC_BASE) {
            return jsonResponse({ error: 'R2_PUBLIC_BASE variable is missing' }, 500, cors);
        }

        const forceRefresh = url.searchParams.get('refresh') === '1';
        const cache = typeof caches !== 'undefined' ? caches.default : undefined;
        const cacheKey = new Request(`${url.origin}${CACHE_PATH}`, { method: 'GET' });

        if (cache && !forceRefresh) {
            const hit = await cache.match(cacheKey);
            if (hit) {
                const headers = new Headers(hit.headers);
                headers.set('X-Music-Cache', 'HIT');
                Object.keys(cors).forEach((name) => headers.set(name, cors[name]));
                return new Response(hit.body, { status: 200, headers });
            }
        }

        let index;
        try {
            index = await buildIndex(env);
        } catch (error) {
            return jsonResponse({ error: `Cannot list bucket: ${error.message}` }, 502, cors);
        }

        const payload = JSON.stringify(index);
        const body = request.method === 'HEAD' ? null : payload;
        const headers = {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
            'X-Music-Cache': 'MISS',
            ...cors,
        };

        if (cache && ctx && typeof ctx.waitUntil === 'function') {
            const cached = new Response(payload, {
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
                },
            });
            ctx.waitUntil(cache.put(cacheKey, cached));
        }

        return withHeaders(body, 200, headers);
    },
};
