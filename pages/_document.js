import React from 'react';
import Document, { Html, Head, Main, NextScript } from 'next/document';

import { site } from 'config';

/**
 * The path prefix the icons are published under.
 *
 * These are plain files under `public/`, which Next copies to the site root and
 * then leaves alone — unlike `next/link` and `_next/*`, it does *not* prefix
 * them itself. On a project page (`/music/`) a bare `/favicon.ico` therefore
 * points at the user's site root and 404s: the site had no working favicon
 * until this was spelled out.
 */
const BASE_PATH = site.pathPrefix || '';

/**
 * Custom document.
 *
 * The music app is a single full-viewport page that decides its own light/dark
 * palette in React, so there is no theme bootstrap script here.
 *
 * The `viewport` tag is deliberately NOT declared here: `_app.js` owns it via
 * `next/head`. Next already injects a default viewport for pages router, so a
 * second one in the document would be a duplicate that browsers ignore.
 *
 * Icons: the mark is a circular, transparent-background PNG (the strata
 * gradient), so it needs no padding or background of its own — it drops
 * straight onto browser chrome in either theme.
 */
export default class MyDocument extends Document {
    render() {
        return (
            <Html lang="zh-hans">
                <Head>
                    <meta charSet="utf-8" />
                    <meta httpEquiv="x-ua-compatible" content="ie=edge" />

                    {/*
                     * `favicon.ico` carries 16/32/48 in one file, which is what
                     * tabs, bookmarks and Windows shortcuts all reach for.
                     * Modern browsers prefer the explicit `icon` below it.
                     */}
                    <link rel="icon" href={`${BASE_PATH}/favicon.ico`} sizes="any" />
                    <link rel="icon" type="image/png" sizes="512x512" href={`${BASE_PATH}/icon-512.png`} />
                    {/*
                     * iOS ignores the `icon` links and reads this one; it must be
                     * opaque-ish and 180x180, and it gets its corners rounded by
                     * the system, which suits a circular mark. Without
                     * `apple-mobile-web-app-capable` this is used for the
                     * home-screen bookmark, not a standalone app shell.
                     */}
                    <link rel="apple-touch-icon" sizes="180x180" href={`${BASE_PATH}/apple-touch-icon.png`} />
                </Head>
                <body>
                    <Main />
                    <NextScript />
                </body>
            </Html>
        );
    }
}
