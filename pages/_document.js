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
                    {/*
                     * `viewport` is what makes the app lay out at device width
                     * instead of a ~980px fallback that the browser then zooms
                     * to fit. `maximumScale` is deliberately left unset — capping
                     * it would block pinch-zoom, which is an accessibility
                     * regression. The focused-input zoom on iOS is instead
                     * prevented by keeping every text input at >=16px, since
                     * anything smaller makes Safari zoom in on focus.
                     */}
                    <meta
                        name="viewport"
                        content="width=device-width, initial-scale=1"
                    />
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
