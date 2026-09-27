import React, { useState } from 'react';

import { coverUrlOf } from './librarySource';
import { FALLBACK_COVER } from './shared';

import styles from './Cover.module.scss';

/**
 * A track's artwork: the same-name cover image when the library has one, the
 * site icon when it does not, the gradient the caller already painted only
 * when even that fails.
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
const Cover = function ({ track }) {
    const ownUrl = coverUrlOf(track);
    // The URL that failed, not a boolean: a row re-rendered for another song
    // (or the record label, which outlives every song it shows) must try the
    // new cover instead of inheriting the previous song's failure. Comparing
    // the URL gets that for free, with no effect to reset the flag.
    const [brokenUrl, setBrokenUrl] = useState('');

    // 没有封面 / 封面挂了的歌都落到站点图标 (tab 上那颗): 列表缩略图和
    // 播放栏唱片共用这个组件, 于是一处兜底两边都生效 —— 一颗 logo 比空白
    // 方块更像「这首歌是有图的」。图标自己也挂了才彻底放弃, 退回调用方
    // 画的渐变 —— 兜底不能反过来把方块变没。
    let url = '';
    if (track) {
        url = ownUrl || FALLBACK_COVER;
        if (brokenUrl === ownUrl) url = FALLBACK_COVER;
        if (brokenUrl === FALLBACK_COVER) url = '';
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
