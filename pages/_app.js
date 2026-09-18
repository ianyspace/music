import React from 'react';

import 'styles/index.scss';

/**
 * The music module has no MDX, no i18n and no shared layout: both routes render
 * the same `MusicApp` and only the `variant` differs, so `_app.js` exists purely
 * to load the global stylesheet (Next's pages router only allows global CSS
 * imports from here).
 */
export default function App({ Component, pageProps }) {
    return <Component {...pageProps} />;
}
