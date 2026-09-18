import React from 'react';
import Link from 'next/link';

import styles from './index.module.scss';

/** Static export only emits the routes it knows; this is the Pages 404 page. */
const NotFound = function () {
    return (
        <div className={styles.splash}>
            <span>这里没有音乐</span>
            <Link href="/" className={styles['splash-link']}>
                回到播放器
            </Link>
        </div>
    );
};

export default NotFound;
