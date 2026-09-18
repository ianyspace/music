/**
 * Service worker cleanup.
 *
 * The site used to register a service worker to precache its app shell. It was
 * removed because a stale shell could keep serving old JS after a deploy and it
 * made "am I looking at the live build?" impossible to answer with a reload.
 *
 * Deleting `public/sw.js` is not enough on its own: a browser that already
 * installed a worker keeps it, and it keeps answering requests from its own
 * caches forever — it only ever updates by fetching `sw.js`, and a 404 does not
 * unregister it. So anybody who visited before the removal would still be stuck
 * on the old shell with no way out but manual devtools surgery.
 *
 * This runs once on load and dismantles that: unregister every registration in
 * this scope, then drop the caches the worker owned. Audio and the track list
 * are untouched — those live in IndexedDB / localStorage, which is where the
 * cache manager looks for them.
 *
 * Once no registration is left, this is a no-op: `getRegistrations` comes back
 * empty and nothing else happens. It only ever removes, never registers, so it
 * cannot reintroduce a worker by accident. This file can be deleted once the
 * old shell has aged out.
 */

/** Cache prefixes the removed worker created (`music-shell-*` / `music-runtime-*`). */
const LEGACY_CACHE_PREFIX = 'music-';

const isSupported = function () {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    // Unregistering needs a secure context, same as registering did`.
    if (!window.isSecureContext) return false;
    return 'serviceWorker' in navigator;
};

/**
 * Unregisters any worker left over from the removed offline shell.
 *
 * Deliberately silent and best-effort: this is cleanup for old visitors, and
 * nothing about the app depends on it succeeding.
 */
const retireServiceWorker = function () {
    if (!isSupported()) return;

    const retire = async function () {
        try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            if (!registrations || registrations.length === 0) return;

            await Promise.all(registrations.map((registration) => registration.unregister()));

            // `caches` is a separate API from the registration, so unregistering
            // does not drop what the worker stored. Clear the shell caches it
            // owned; anything else on the origin is left alone.
            if (typeof caches !== 'undefined' && typeof caches.keys === 'function') {
                const names = await caches.keys();
                await Promise.all(names
                    .filter((name) => name.startsWith(LEGACY_CACHE_PREFIX))
                    .map((name) => caches.delete(name)));
            }
        } catch (err) {
            /* cleanup only — the app works normally either way */
        }
    };

    // Off the critical path, same as the old registration was.
    if (document.readyState === 'complete') retire();
    else window.addEventListener('load', retire, { once: true });
};

export default retireServiceWorker;
export { retireServiceWorker };
