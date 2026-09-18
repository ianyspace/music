import React from 'react';
import Head from 'next/head';

import { registerServiceWorker } from 'lib/serviceWorker';
import { BASE_PATH } from 'utils/basePath';

import 'styles/index.scss';

/**
 * The music module has no MDX, no i18n and no shared layout: both routes render
 * the same `MusicApp` and only the `variant` differs, so `_app.js` exists to
 * load the global stylesheet (Next's pages router only allows global CSS
 * imports from here), pin the viewport, and register the offline shell.
 */
export default function App({ Component, pageProps }) {
    React.useEffect(() => {
        // Progressive enhancement: registers after load and swallows every
        // failure, so the app is fully usable online even if this does nothing.
        // Registration is idempotent, so StrictMode's double effect is harmless.
        registerServiceWorker(`${BASE_PATH}/sw.js`);
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
