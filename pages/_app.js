import React from 'react';
import Head from 'next/head';

import { retireServiceWorker } from 'utils/retireServiceWorker';

import 'styles/index.scss';

/**
 * The music module has no MDX, no i18n and no shared layout: both routes render
 * the same `MusicApp` and only the `variant` differs, so `_app.js` exists to
 * load the global stylesheet (Next's pages router only allows global CSS
 * imports from here) and pin the viewport.
 *
 * There is deliberately no service worker. One used to precache the app shell,
 * and it caused more problems than it solved: a stale shell could keep serving
 * old JS after a deploy, and it made "is this the live build?" impossible to
 * answer by simply reloading. The app does not need it either — audio, the
 * track list and settings live in IndexedDB / localStorage (see
 * `components/Music/audioCache.js`), and Pages serves the shell itself, so a
 * normal request is enough to stay fast.
 *
 * All that is left is `retireServiceWorker`, which tears the old shell down on
 * browsers that still have it installed. It only unregisters; it never
 * registers anything.
 */
export default function App({ Component, pageProps }) {
    React.useEffect(() => {
        retireServiceWorker();
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
