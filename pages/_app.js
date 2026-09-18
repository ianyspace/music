import React from 'react';

import { registerServiceWorker } from 'lib/serviceWorker';
import { BASE_PATH } from 'utils/basePath';

import 'styles/index.scss';

/**
 * The music module has no MDX, no i18n and no shared layout: both routes render
 * the same `MusicApp` and only the `variant` differs, so `_app.js` exists to
 * load the global stylesheet (Next's pages router only allows global CSS
 * imports from here) and to register the offline shell.
 */
export default function App({ Component, pageProps }) {
    React.useEffect(() => {
        // Progressive enhancement: registers after load and swallows every
        // failure, so the app is fully usable online even if this does nothing.
        // Registration is idempotent, so StrictMode's double effect is harmless.
        registerServiceWorker(`${BASE_PATH}/sw.js`);
    }, []);

    return <Component {...pageProps} />;
}
