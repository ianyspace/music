import React from 'react';
import Head from 'next/head';
import Script from 'next/script';

import { site } from 'config';

import { GSI_SRC } from '../shared';

/**
 * The document head, plus the Google Identity Services script.
 *
 * Both layouts render this, for the same reason: the title and description are
 * what the tab and any share card show, and GSI is what the Google Drive
 * connection needs — and either layout can raise that connection. It lives in
 * the shared core rather than being written out twice so the two cannot drift
 * into different titles or different error copy for the same failure.
 *
 * The script's load state is not kept here: `onReady` and `onError` are the
 * player's own setters, because "is GSI usable yet" is what decides whether the
 * connect button is enabled, and that answer belongs with the connection code.
 */
const PageHead = function ({ onReady, onError }) {
    return (
        <>
            <Head>
                <title>{`音乐 | ${site.title}`}</title>
                <meta name="description" content={site.description} />
            </Head>

            <Script
                src={GSI_SRC}
                strategy="afterInteractive"
                onLoad={onReady}
                onError={onError}
            />
        </>
    );
};

export default PageHead;
