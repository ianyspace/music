import React, { useState } from 'react';

import { coverUrlOf } from './librarySource';

import styles from './Cover.module.scss';

/**
 * A track's artwork: the same-name cover image when the library has one, and
 * — if the caller passed `fallbackUrl` — that picture when it does not. The
 * gradient the caller already painted is what remains when even that fails.
 *
 * The fallback is opt-in on purpose: this component is shared with the phone
 * layout, whose tiles are built around "no cover costs nothing" (gradient +
 * note glyph). Only the desktop immersive page's two tiles ask for it.
 *
 * It is an overlay rather than a replacement. Every place that shows a cover
 * already paints `trackGradient(name)` as its background and a note glyph on
 * top of it, so this component adds a photo *over* both — which is what makes
 * "no cover" cost nothing. There is no second layout to keep in step: a song
 * without a cover renders exactly the DOM it rendered before covers existed,
 * and a cover that fails to load (a song whose `.jpg` was never uploaded, a
 * Drive thumbnail that expired, the Worker still being the pre-cover one) just
 * removes itself and uncovers the same gradient. That is why the failure is
 * state here and not an error branch in nine call sites.
 *
 * Callers must render it as the **first** child of the tile: it is absolutely
 * positioned, so everything after it in the markup paints above it — the note
 * glyph is deliberately swallowed by the photo, while the row's play/pause
 * scrim (`.thumb-overlay`) has to stay on top of it.
 */
const Cover = function ({ track, fallbackUrl = '' }) {
    const ownUrl = coverUrlOf(track);
    // The URL that failed, not a boolean: a row re-rendered for another song
    // (or the record label, which outlives every song it shows) must try the
    // new cover instead of inheriting the previous song's failure. Comparing
    // the URL gets that for free, with no effect to reset the flag.
    const [brokenUrl, setBrokenUrl] = useState('');

    // 桌面沉浸页的列表缩略图和播放栏唱片传了 fallbackUrl (站点图标): 没有
    // 封面的歌、封面加载失败的歌都落到它 —— 一颗 logo 比空白方块更像「这
    // 首歌是有图的」。图标自己都挂了才彻底放弃, 退回调用方画的渐变 ——
    // 兜底不能反过来把方块变没。没传 fallbackUrl 的调用方(手机端的一切)
    // 走原来的老路: 没有封面就是没有图。
    let url = '';
    if (track) {
        url = ownUrl || fallbackUrl;
        if (brokenUrl === ownUrl) url = fallbackUrl;
        if (fallbackUrl && brokenUrl === fallbackUrl) url = '';
    }

    if (!url) return null;

    return (
        <img
            className={styles.cover}
            src={url}
            // Decoration: the parent is already `aria-hidden`, and the song is
            // named by the row's own label.
            alt=""
            // A long library mounts every row at once, so without this a
            // thousand covers would be requested on open. The gradient is a
            // good enough placeholder until the row is scrolled to.
            loading="lazy"
            decoding="async"
            onError={() => setBrokenUrl(url)}
        />
    );
};

export default Cover;
