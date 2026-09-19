import React from 'react';

import {
    IconChevronDown,
    IconDislike,
    IconNote,
} from './icons';
import { parseTrackName, trackGradient } from './shared';
import Cover from './Cover';

import styles from './DislikedSheet.module.scss';

/**
 * 不喜欢歌曲 — the manager for the keep-out list.
 *
 * The stored value is a set of `<source>:<id>` keys (the same form the audio
 * cache uses), and a key alone is enough to render a row: split it and the
 * source tells the visitor which library it came from. When the song *is*
 * still in the current library its real name is used, so the common case —
 * hiding, then changing your mind — reads with the full title and artist
 * rather than an id.
 *
 * A song can end up here whose source library is no longer loaded (disliked
 * from a Drive folder, then disconnected). Those rows still render and can
 * still be removed: letting a song *out* of the list must never depend on
 * being able to fetch it.
 *
 * `closing` triggers the reverse of the slide-up animation; `onClosed` fires
 * once it finished and the shell may unmount it.
 */
const DislikedSheet = function ({
    keys,
    tracks,
    closing,
    onClosed,
    onCancelClose,
    onClose,
    onRestore,
}) {
    // Key → track, so a row shows the song's real title when we still have it.
    const trackByKey = new Map();
    (tracks || []).forEach((track) => {
        trackByKey.set(`${track.source || ''}:${track.id}`, track);
    });

    // Newest first. The store is a plain array whose tail is the most recent
    // addition (`concat` on dislike), so reversing the read order puts what the
    // visitor just hid on top — which is where they look for it.
    const rows = (keys || []).slice().reverse().map((key) => {
        const separator = key.indexOf(':');
        const source = separator > 0 ? key.slice(0, separator) : '';
        const track = trackByKey.get(key);
        return {
            key,
            track,
            source,
            name: track ? track.name : key.slice(separator + 1),
        };
    });

    return (
        <div
            className={closing ? `${styles.veil} ${styles['veil-out']}` : styles.veil}
            onAnimationEnd={() => { if (closing) onClosed(); }}
            onPointerDown={() => { if (closing) onCancelClose(); }}
        >
            <div className={closing ? `${styles.page} ${styles['page-out']}` : styles.page}>
                <div className={styles.topbar}>
                    <button type="button" className={styles['top-btn']} title="收起" aria-label="收起" onClick={onClose}>
                        <IconChevronDown />
                    </button>
                    <h2 className={styles['top-title']}>不喜欢歌曲</h2>
                    {/* Equal-width twin keeps the title centred. Nothing to
                        refresh here — this list is state, not a store read. */}
                    <span className={styles['top-spacer']} aria-hidden="true" />
                </div>

                <div className={styles.summary}>
                    <div className={styles['summary-item']}>
                        <span className={styles['summary-value']}>{rows.length}</span>
                        <span className={styles['summary-label']}>已隐藏</span>
                    </div>
                    <div className={styles['summary-item']}>
                        <span className={styles['summary-value']}>
                            {rows.filter((row) => row.track).length}
                        </span>
                        <span className={styles['summary-label']}>在库可恢复</span>
                    </div>
                </div>

                <p className={styles.hint}>
                    移出后歌曲会重新出现在列表里，下次播放会照常缓存。
                </p>

                <div className={styles.list}>
                    {rows.length === 0 && (
                        <div className={styles.empty}>
                            <span className={styles['empty-icon']} aria-hidden="true">
                                <IconDislike size={26} />
                            </span>
                            <p className={styles['empty-title']}>还没有隐藏的歌曲</p>
                            <p className={styles['empty-sub']}>
                                在列表里点某首歌右侧的三个点，选择「移入不喜欢」，
                                它就会出现在这里。
                            </p>
                        </div>
                    )}

                    {rows.map((row) => {
                        const meta = parseTrackName(row.name);
                        return (
                            <div className={styles.item} key={row.key}>
                                <span
                                    className={styles['item-thumb']}
                                    style={{ background: trackGradient(row.name) }}
                                    aria-hidden="true"
                                >
                                    <Cover track={row.track} />
                                    <IconNote />
                                </span>
                                <span className={styles['item-text']}>
                                    <span className={styles['item-title']}>{meta.title}</span>
                                    <span className={styles['item-sub']}>
                                        {meta.artist}
                                        {row.source === 'drive' ? ' · 云盘' : ' · 公共曲库'}
                                    </span>
                                </span>
                                <button
                                    type="button"
                                    className={styles['item-restore']}
                                    title="移出"
                                    aria-label={`把 ${meta.title} 移出不喜欢`}
                                    onClick={() => onRestore(row.key)}
                                >
                                    移出
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default DislikedSheet;
