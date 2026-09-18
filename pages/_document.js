import React from 'react';
import Document, { Html, Head, Main, NextScript } from 'next/document';

/**
 * Custom document.
 *
 * The music app is a single full-viewport page that decides its own light/dark
 * palette in React, so there is no theme bootstrap script here — the inline
 * `theme-color` pair only tints the browser chrome to match the system theme
 * while the app boots, which avoids a light-to-dark flash on mobile Safari.
 */
export default class MyDocument extends Document {
    render() {
        return (
            <Html lang="zh-hans">
                <Head>
                    <meta charSet="utf-8" />
                    <meta httpEquiv="x-ua-compatible" content="ie=edge" />
                    <link rel="icon" href="/favicon.ico" />
                </Head>
                <body>
                    <Main />
                    <NextScript />
                </body>
            </Html>
        );
    }
}
