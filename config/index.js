/**
 * music — site wide configuration.
 *
 * Extracted from the `space` blog, where the player lived at `/space/music/`.
 * This repo owns the music module only, so it is published as its own GitHub
 * Pages project site: https://ianyspace.github.io/music/
 */

const site = {
    // The site is published to GitHub Pages as a *project* page, ie.
    // https://ianyspace.github.io/music/, so every route and asset has to live
    // under `/music`. This value is the single source of truth for Next's
    // `basePath` (see `next.config.js`).
    pathPrefix: '/music',
    title: 'Music Space',
    author: 'Kou ShiXiang',
    description: '一个只做音乐播放的静态站点：公共曲库 + 自己的云盘，支持离线缓存',
    siteUrl: 'https://ianyspace.github.io/music/',
    lang: 'zh-hans',
};

/**
 * Music library data sources.
 *
 * The default library lives in a public Cloudflare R2 bucket and is listed by
 * the Worker in `cloudflare-worker/` (see its README), so the player works with
 * no Google authorization at all. Connecting Google Drive swaps the list for
 * the visitor's own Drive folder; disconnecting falls back to R2 again.
 *
 * Both values can be overridden at build time with
 * `NEXT_PUBLIC_MUSIC_WORKER_URL` / `NEXT_PUBLIC_MUSIC_R2_BASE` (the repo keeps
 * `.env` out of git, so configured values belong in the deploy environment).
 */
const music = {
    // Base URL of the music Worker exposing `GET /tracks`.
    workerUrl:
        process.env.NEXT_PUBLIC_MUSIC_WORKER_URL || 'https://space-music.ianyscript.workers.dev',
    // Public R2 domain. Only needed when the Worker answers with bare object
    // keys instead of absolute URLs; empty means "trust `track.url`".
    r2BaseUrl: process.env.NEXT_PUBLIC_MUSIC_R2_BASE || '',
};

module.exports = {
    site,
    music,
};
