import React, { useState } from 'react';

import { coverUrlOf } from './librarySource';

import styles from './Cover.module.scss';

/**
 * A track's artwork: the same-name cover image when the library has one, the
 * gradient the caller already painted when it does not.
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
    const url = coverUrlOf(track);
    // The URL that failed, not a boolean: a row re-rendered for another song
    // (or the record label, which outlives every song it shows) must try the
    // new cover instead of inheriting the previous song's failure. Comparing
    // the URL gets that for free, with no effect to reset the flag.
    const [brokenUrl, setBrokenUrl] = useState('');

    if (!url || url === brokenUrl) return null;

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
