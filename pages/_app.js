import React from 'react';
import Head from 'next/head';

import { registerServiceWorker } from 'utils/registerServiceWorker';

import 'styles/index.scss';

/**
 * The music module has no MDX, no i18n and no shared layout: `/h5` and
 * `/desktop` are two independent component trees, so `_app.js` exists to load
 * the global stylesheet (Next's pages router only allows global CSS imports
 * from here) and pin the viewport.
 *
 * It also registers the offline service worker (`public/sw.js`). That worker is
 * a **pure offline fallback, never a freshness layer**: every request goes
 * network-first and the cache is only read when `fetch()` rejects, so being
 * online always means getting the live copy, and a reload always answers "am I
 * looking at the current build?". That is what makes having one safe again — an
 * earlier worker *precached* the shell, and a stale shell could keep serving old
 * JS after a deploy.
 *
 * The worker only caches this site's own HTML / CSS / JS / icons. Audio, the
 * track list and settings still live in IndexedDB / localStorage (see
 * `components/Music/audioCache.js`), and the cross-origin library Worker, R2
 * audio and covers are never touched.
 */
export default function App({ Component, pageProps }) {
    React.useEffect(() => {
        registerServiceWorker();
    }, []);

    return (
        <>
            {/*
             * Declared here rather than in `_document.js` on purpose. Next
             * already injects its own default viewport tag, and with pages
             * router that one is emitted *first* — so a second declaration in
             * the document is a duplicate, and browsers honour only the first.
             * Using `next/head` merges into that single tag instead.
             *
             * `width=device-width` makes the app lay out at device width rather
             * than zooming a ~980px desktop fallback to fit. Pinch-zoom is
             * deliberately left enabled (no `user-scalable=no` / `maximum-scale`)
             * — disabling it is an accessibility regression. The focused-input
             * zoom on iOS is handled by keeping every text control at >=16px.
             */}
            <Head>
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1"
                />
            </Head>
            <Component {...pageProps} />
        </>
    );
}
