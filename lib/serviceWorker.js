/**
 * Service worker registration.
 *
 * Lives in `lib/` rather than `components/` because it is not UI: it is a
 * one-shot side effect wired up by `pages/_app.js`.
 *
 * The offline shell is a progressive enhancement, so every step here is
 * optional and failure is silent: an unsupported browser, a blocked SW, a
 * registration error or a missing `sw.js` all leave a fully working online app.
 * Nothing in this file can throw into the render path.
 */

const SW_PATH = '/sw.js';

/** Browsers need a secure context; `http://localhost` counts, a LAN IP does not. */
const isSupported = function () {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    if (!('serviceWorker' in navigator)) return false;
    if (!window.isSecureContext) return false;
    return true;
};

/**
 * Registers the offline shell.
 *
 * `scope` is left to the browser: `sw.js` sits at the site root, so its scope
 * covers the whole app including the basePath. The script URL is passed through
 * `withBasePath` because a service worker must be served from within its own
 * scope, and a static export is only reachable under `/music/`.
 *
 * @param {string} basePathPrefix Prefixed path to the SW script (eg. `/music/sw.js`).
 */
const registerServiceWorker = function (basePathPrefix) {
    if (!isSupported()) return;

    const scriptUrl = basePathPrefix || SW_PATH;

    // Registering after load keeps the SW install away from the critical path.
    const start = () => {
        navigator.serviceWorker.register(scriptUrl).catch(() => {
            /* offline shell unavailable — the app works normally without it */
        });
    };

    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
};

/** Asks the active worker to drop its cached shell (audio cache is separate). */
const clearShellCache = function () {
    if (!isSupported() || !navigator.serviceWorker.controller) return;
    try {
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_SHELL' });
    } catch (err) { /* nothing to clear */ }
};

export { registerServiceWorker, clearShellCache };
export default registerServiceWorker;
