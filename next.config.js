/**
 * Styling is plain **Sass**: global styles live in `styles/*.scss` (imported
 * only by `pages/_app.js`) and every component keeps its own styles next to it
 * as `Foo.module.scss`. Next.js supports both natively — it ships
 * `next/dist/compiled/sass-loader`, so installing the `sass` package is all that
 * is needed and no custom webpack rules are required.
 */

const { site } = require('./config');

const basePath = site.pathPrefix || '';

/** @type {import('next').NextConfig} */
const nextConfig = {
    // GitHub Pages only serves static files, so `next build` has to emit a fully
    // static site into `out/` instead of a server rendered app.
    output: 'export',
    // Deployed as a project page (`https://ianyspace.github.io/music/`), which
    // requires every route and `_next/*` asset to be prefixed with the repo name.
    ...(basePath ? { basePath } : {}),
    reactStrictMode: false,
    trailingSlash: true,
    outputFileTracingRoot: __dirname,
    images: {
        unoptimized: true,
    },
};

module.exports = nextConfig;
