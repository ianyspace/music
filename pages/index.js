import React, { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';

import styles from './index.module.scss';

/**
 * Entry route. `/` and `/music/` both land here and only decide which layout to
 * open, so the phone and desktop experiences can stay completely independent
 * while sharing every piece of playback state through `components/Music/MusicApp`.
 *
 * The old blog served the player at `/music/`, so this route keeps working there
 * too (Next rewrites `/` → the same component under `basePath: '/music'`).
 *
 * The match is evaluated on the client because the site is a static export.
 */
const DESKTOP_QUERY = '(min-width: 900px)';

const MusicRoute = function () {
    const router = useRouter();

    useEffect(() => {
        const media = window.matchMedia(DESKTOP_QUERY);
        const target = media.matches ? '/desktop' : '/h5';
        router.replace(target);
    }, [router]);

    // Rendered for the split second before the redirect lands.
    return (
        <div className={styles.splash}>
            <span>正在载入音乐…</span>
            {/* Static export: keep a plain link as a no-JS fallback. */}
            <Link href="/h5" className={styles['splash-link']}>
                没有跳转？点这里
            </Link>
        </div>
    );
};

export default MusicRoute;
