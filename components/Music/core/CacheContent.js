import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    IconArchive,
    IconClose,
    IconNote,
} from '../icons';
import { formatSize, formatExpiry, parseTrackName, trackGradient } from '../shared';
import Cover from '../Cover';

import styles from './CacheContent.module.scss';

/**
 * The body of the cache manager: every audio blob currently held in IndexedDB,
 * with its size and freshness, plus 「全部缓存」 / 「全部删除」.
 *
 * This is the *content* half of the panel and is rendered by both layouts —
 * the phone's `h5/CacheManager` and, until the desktop's settings dialog was
 * deleted, the desktop's own card around the same body. It is only the phone
 * now, but the split still earns its keep: nothing here knows about scrims,
 * columns or entrance animations, and the return value is a fragment rather
 * than a wrapper element, because the chrome it is dropped into is a flex
 * column and these blocks have to be its direct children to keep their
 * `flex-shrink: 0` / `flex: 1`.
 *
 * The stored records are keyed `<source>:<trackId>` (`audioCacheKey`), so an
 * entry still renders even when its track is not in the current list: the key
 * is split and matched against the list the shell passes in, and anything
 * unmatched is shown from the key alone. Removal frees the blob straight away;
 * a download in flight writes its own record back, so the list re-reads from
 * the store after each action instead of being patched in place.
 */
const CacheContent = function ({
    entries,
    tracks,
    loading,
    busyId,
    caching,
    cacheProgress,
    onDelete,
    onCacheAll,
}) {
    const [confirmingClear, setConfirmingClear] = useState(false);
    const scrollerRef = useRef(null);

    // Key → track, for the entries that are still part of the visible library.
    const trackByKey = useMemo(() => {
        const map = new Map();
        tracks.forEach((track) => {
            map.set(`${track.source}:${track.id}`, track);
        });
        return map;
    }, [tracks]);

    // Newest first is not something the store hands us, so sort by when the
    // blob was saved — the freshest cache sits on top, matching how it gets
    // used. Legacy rows without a `savedAt` fall back to their old expiry.
    const ordered = useMemo(
        () => entries.slice().sort((a, b) => (b.savedAt || b.expiresAt) - (a.savedAt || a.expiresAt)),
        [entries],
    );

    const totalSize = useMemo(
        () => entries.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0),
        [entries],
    );

    // Anything not in the current list cannot be downloaded again from here —
    // "全部缓存" only covers what the list holds.
    const cacheableCount = useMemo(() => {
        if (caching) return 0;
        return tracks.filter((track) => !entries.some((entry) => entry.id === `${track.source}:${track.id}`)).length;
    }, [tracks, entries, caching]);

    useEffect(() => {
        if (confirmingClear) setConfirmingClear(false);
        // A re-read after an action replaces the list; scroll back to the top
        // so the user sees the start of the new one.
        if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
    }, [entries]);

    const handleClearAll = useCallback(() => {
        if (!confirmingClear) {
            setConfirmingClear(true);
            return;
        }
        setConfirmingClear(false);
        onDelete([]);
    }, [confirmingClear, onDelete]);

    const labelOf = function (entry) {
        const key = String(entry.id || '');
        const separator = key.indexOf(':');
        const source = separator > 0 ? key.slice(0, separator) : '';
        const trackId = separator > 0 ? key.slice(separator + 1) : key;
        const track = trackByKey.get(key);
        if (track) return { name: track.name, track };
        return { name: trackId || key, track: null, source };
    };

    return (
        <>
            <div className={styles.summary}>
                <div className={styles['summary-item']}>
                    <span className={styles['summary-value']}>{loading ? '—' : entries.length}</span>
                    <span className={styles['summary-label']}>已缓存</span>
                </div>
                <div className={styles['summary-item']}>
                    <span className={styles['summary-value']}>
                        {loading ? '—' : (formatSize(totalSize) || '0 MB')}
                    </span>
                    <span className={styles['summary-label']}>占用空间</span>
                </div>
                <div className={styles['summary-item']}>
                    <span className={styles['summary-value']}>
                        {loading ? '—' : Math.max(0, tracks.length - entries.length)}
                    </span>
                    <span className={styles['summary-label']}>未缓存</span>
                </div>
            </div>

            <div className={styles.actions}>
                <button
                    type="button"
                    className={`${styles['action-btn']}${styles['action-primary']}`}
                    onClick={onCacheAll}
                    disabled={caching || loading || cacheableCount === 0}
                >
                    {caching
                        ? `缓存中… ${cacheProgress.done}/${cacheProgress.total}`
                        : `全部缓存${cacheableCount > 0 ? `（${cacheableCount}）` : ''}`}
                </button>
                <button
                    type="button"
                    className={`${styles['action-btn']}${confirmingClear ? ` ${styles['action-danger']}` : ''}`}
                    onClick={handleClearAll}
                    disabled={loading || caching || entries.length === 0}
                >
                    {confirmingClear ? '再点一次确认' : '全部删除'}
                </button>
            </div>

            {caching && (
                <div className={styles.progress} role="status">
                    <div
                        className={styles['progress-bar']}
                        style={{
                            width: `${cacheProgress.total > 0
                                ? Math.round((cacheProgress.done / cacheProgress.total) * 100)
                                : 0}%`,
                        }}
                    />
                </div>
            )}

            <div className={styles.list} ref={scrollerRef}>
                {loading && entries.length === 0 && (
                    <p className={styles.state}>读取缓存中…</p>
                )}

                {!loading && entries.length === 0 && (
                    <div className={styles.empty}>
                        <span className={styles['empty-icon']} aria-hidden="true"><IconArchive size={26} /></span>
                        <p className={styles['empty-title']}>还没有缓存</p>
                        <p className={styles['empty-sub']}>
                            播放一首歌就会把它存到本地；也可以用上面的「全部缓存」
                            把整个列表一次存下来。存下来的歌从本机播放、不用再下载，
                            页面开着的时候断网也照样听。
                        </p>
                    </div>
                )}

                {ordered.map((entry) => {
                    const { name, track, source } = labelOf(entry);
                    const meta = parseTrackName(name);
                    const busy = busyId === entry.id;
                    return (
                        <div className={styles.item} key={entry.id}>
                            <span
                                className={styles['item-thumb']}
                                style={{ background: trackGradient(name) }}
                                aria-hidden="true"
                            >
                                <Cover track={track} />
                                <IconNote />
                            </span>
                            <span className={styles['item-text']}>
                                <span className={styles['item-title']}>{meta.title}</span>
                                <span className={styles['item-sub']}>
                                    {meta.artist}
                                    {entry.size > 0 ? ` · ${formatSize(entry.size)}` : ''}
                                    {source === 'drive' ? ' · 云盘' : ''}
                                    {entry.expiresAt > 0 ? ` · ${formatExpiry(entry.expiresAt)}` : ''}
                                </span>
                            </span>
                            <button
                                type="button"
                                className={styles['item-remove']}
                                title={busy ? '删除中' : '删除缓存'}
                                aria-label={`删除 ${meta.title} 的缓存`}
                                onClick={() => onDelete([entry.id])}
                                disabled={busy || caching}
                            >
                                <IconClose size={16} />
                            </button>
                            {!track && (
                                <span className={styles['item-orphan']} title="该歌曲已不在当前列表中">
                                    已移除
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </>
    );
};

export default CacheContent;
