import { site } from 'config';

/**
 * The path prefix the site is served under. GitHub Pages project sites live at
 * `https://<user>.github.io/<repo>/`, so the app is built with
 * `basePath: '/music'` (see `next.config.js`).
 */
const BASE_PATH = site.pathPrefix || '';

/**
 * Prefixes a site absolute path (`/foo.png`) with the deployment base path.
 *
 * Next.js only rewrites the paths it controls itself (`next/link`, `next/image`,
 * `_next/*` assets). Plain `<img src>`, `background-image: url()` and `fetch()`
 * targets are left untouched, so they have to be prefixed manually or they
 * would resolve from the domain root and 404.
 *
 * Remote URLs (`https://…`, `//cdn…`) and `data:` / `blob:` URIs are returned
 * unchanged, which makes this safe to call on values that may be local or
 * remote.
 *
 * @param {string} path
 * @returns {string}
 */
const withBasePath = function (path) {
    if (!path || typeof path !== 'string') return path;
    if (!BASE_PATH) return path;
    if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(path)) return path;
    if (path.startsWith('data:') || path.startsWith('blob:')) return path;
    if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) return path;

    return `${BASE_PATH}${path.startsWith('/') ? '' : '/'}${path}`;
};

export default withBasePath;
export { BASE_PATH, withBasePath };
