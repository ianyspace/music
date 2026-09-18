/**
 * Music library data sources.
 *
 * The player has two interchangeable libraries:
 *
 * - `cloud` (default): a public Cloudflare R2 bucket, listed by the Worker in
 *   `worker/`. Works with no Google authorization at all.
 * - `drive`: the visitor's own Google Drive folder, used only after they
 *   connect (implicit token flow, drive.readonly).
 *
 * Both produce the same track shape so the rest of the app never branches on
 * the source, and every track carries `source` so caches and downloads can be
 * routed correctly:
 *
 *   { id, name, size, source, url?, lyricsUrl?, lyricFile? }
 */

import { music } from 'config';

import { CACHE_TTL } from './audioCache';
import {
    DRIVE_FILES_URL,
    listAllFiles,
    normalizeLyricKey,
    storageGet,
    storageSet,
} from './shared';

export const CLOUD_SOURCE = 'cloud';
export const DRIVE_SOURCE = 'drive';

const AUDIO_FILE = /\.(mp3|flac|m4a|wav|ogg|oga|opus|aac|wma|ape)$/i;
const LIST_CACHE_PREFIX = 'music:trackListCache:v2';

export const sourceLabel = function (source) {
    return source === DRIVE_SOURCE ? '我的 Google 云盘' : '公共曲库';
};

/* --- cache keys ---------------------------------------------------------- */

// Lists and audio blobs are keyed per source: a Drive list cached while
// connected must never surface as the public library after disconnecting, and
// R2 keys / Drive file ids must not collide in IndexedDB.
export const listCacheKey = function (source, clientId) {
    return source === DRIVE_SOURCE
        ? `${LIST_CACHE_PREFIX}:drive:${clientId || 'default'}`
        : `${LIST_CACHE_PREFIX}:cloud`;
};

export const audioCacheKey = function (track) {
    return `${track.source || CLOUD_SOURCE}:${track.id}`;
};

export const readListCache = function (source, clientId) {
    let cached;
    try { cached = JSON.parse(storageGet(listCacheKey(source, clientId))); } catch (err) { cached = null; }
    if (!cached || !cached.expiresAt || cached.expiresAt <= Date.now()) return null;
    return {
        tracks: Array.isArray(cached.tracks) ? cached.tracks : [],
        folders: Array.isArray(cached.folders) ? cached.folders : [],
        folderId: cached.folderId || '',
        savedAt: Number(cached.savedAt) || 0,
    };
};

export const writeListCache = function (source, clientId, { tracks, folders = [], folderId = '' }) {
    storageSet(listCacheKey(source, clientId), JSON.stringify({
        savedAt: Date.now(),
        expiresAt: Date.now() + CACHE_TTL,
        clientId: clientId || '',
        folderId,
        folders,
        tracks,
    }));
};

export const clearListCache = function (source, clientId) {
    storageSet(listCacheKey(source, clientId), '');
};

/* --- cloud (R2 via Worker) ---------------------------------------------- */

const absoluteUrl = function (url) {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    const base = String(music.r2BaseUrl || '').replace(/\/+$/, '');
    return base ? `${base}/${String(url).replace(/^\/+/, '')}` : '';
};

export const fetchCloudTracks = async function ({ forceRefresh = false } = {}) {
    const base = String(music.workerUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('未配置公共曲库地址（config/index.js 的 music.workerUrl）');

    const response = await fetch(`${base}/tracks${forceRefresh ? '?refresh=1' : ''}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    return {
        tracks: (data.tracks || [])
            .filter((item) => item && item.id && item.url)
            .filter((item) => AUDIO_FILE.test(item.name || item.key || ''))
            .map((item) => ({
                id: item.id,
                name: item.name || item.key || item.id,
                size: item.size,
                url: absoluteUrl(item.url),
                lyricsUrl: absoluteUrl(item.lyricsUrl),
                source: CLOUD_SOURCE,
            })),
        folders: [],
    };
};

/* --- drive (visitor's own folder) --------------------------------------- */

export const fetchDriveTracks = async function ({ driveGet, token, folderId }) {
    if (!token) {
        const error = new Error('需要连接 Google 云盘');
        error.code = 'TOKEN_REQUIRED';
        throw error;
    }

    let q = "(mimeType contains 'audio' or name contains '.lrc' or name contains '.txt') and trashed=false";
    if (folderId) q += ` and '${folderId}' in parents`;

    const files = await listAllFiles(driveGet, {
        q,
        fields: 'files(id,name,mimeType,size)',
        pageSize: '200',
        orderBy: 'name',
    }, token);

    const lyricFiles = files.filter((file) => /\.(lrc|txt)$/i.test(file.name));
    const lyricByKey = new Map(lyricFiles.map((file) => [normalizeLyricKey(file.name), file]));

    return {
        tracks: files
            .filter((file) => file.mimeType && file.mimeType.startsWith('audio/'))
            .map((file) => ({
                ...file,
                source: DRIVE_SOURCE,
                lyricFile: lyricByKey.get(normalizeLyricKey(file.name)) || null,
            })),
        folders: [],
    };
};

/* --- per-track data ----------------------------------------------------- */

export const lyricsUrlOf = function (track) {
    if (track.lyricsUrl) return track.lyricsUrl;
    if (track.lyricFile && track.lyricFile.id) return `${DRIVE_FILES_URL}/${track.lyricFile.id}?alt=media`;
    return '';
};

export const hasLyrics = function (track) {
    return Boolean(track && lyricsUrlOf(track));
};

export const fetchLyricsText = async function (track, { token = '' } = {}) {
    const url = lyricsUrlOf(track);
    if (!url) return '';

    const isDrive = track.source === DRIVE_SOURCE || (!track.lyricsUrl && Boolean(track.lyricFile));
    if (isDrive && !token) return '';

    const response = await fetch(url, isDrive
        ? { headers: { Authorization: `Bearer ${token}` } }
        : undefined);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
};

// Downloads the audio bytes for a track. The caller is responsible for
// caching the blob and for turning it into an object URL.
export const downloadTrackBlob = async function (track, { token = '' } = {}) {
    if (track.source === DRIVE_SOURCE) {
        if (!token) {
            const error = new Error('本地没有缓存音频');
            error.code = 'TOKEN_REQUIRED';
            throw error;
        }
        const response = await fetch(`${DRIVE_FILES_URL}/${track.id}?alt=media`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (response.status === 401) {
            const error = new Error('授权已过期，请重新连接');
            error.code = 'UNAUTHORIZED';
            throw error;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
    }

    if (!track.url) throw new Error('曲目缺少音频地址');
    const response = await fetch(track.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.blob();
};
