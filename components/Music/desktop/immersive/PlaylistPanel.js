import React, { useEffect, useRef, useState } from 'react';

import {
    IconHeart,
    IconPause,
    IconPlay,
    IconRefresh,
    IconSearch,
} from '../../icons';
import {
    emptyListMessage,
    parseTrackName,
    trackGradient,
} from '../../shared';
import Cover from '../../Cover';
import MarkNote from '../../core/MarkNote';

import styles from './PlaylistPanel.module.scss';

/**
 * The immersive page's playlist: a glass panel hugging the left edge, with a
 * 3D tilt on its rows and a fold that hides it behind a handle.
 *
 * Presentational on purpose — the fold timer, the hover logic and the
 * preference live in `ImmersiveApp`, because the handle that summons the
 * panel back sits *outside* it and both halves need the same state.
 *
 * The rows keep the old list's semantics (click = play/pause that track,
 * search narrows, the heart filters) but drop the row drawer: on this page a
 * row's only useful action is playing it, and the space a three-dots button
 * would hold is given back to the titles.
 */

const PlaylistPanel = function ({
    expanded,
    onExpand,
    onHoverChange,
    listLoading,
    visibleTracks,
    search,
    onSearch,
    likedOnly,
    onToggleLikedOnly,
    current,
    loadingId,
    isPlaying,
    onToggleTrack,
    isLiked,
    qqBound,
    onOpenAccount,
}) {
    const searchRef = useRef(null);
    const listRef = useRef(null);
    const activeRowRef = useRef(null);
    const [searchOpen, setSearchOpen] = useState(false);

    const meta = current ? parseTrackName(current.track.name) : null;
    const currentId = current ? current.track.id : '';
    const keyword = search.trim();

    useEffect(() => {
        if (searchOpen && searchRef.current) searchRef.current.focus();
    }, [searchOpen]);

    // When the panel opens (or the song changes), bring the playing row into
    // view — by scrolling the list's own scrollTop, never `scrollIntoView`:
    // that would also scroll the page shell and push the play bar off screen.
    useEffect(() => {
        if (!expanded || !activeRowRef.current || !listRef.current) return;
        const list = listRef.current;
        const row = activeRowRef.current;
        list.scrollTo({
            top: Math.max(0, row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2),
            behavior: 'smooth',
        });
    }, [expanded, currentId]);

    return (
        <>
            {/* The handle, on the left edge, always present while folded —
                and hidden while expanded so it cannot be under the panel. */}
            <button
                type="button"
                className={`${styles.handle}${expanded ? ` ${styles['handle-hidden']}` : ''}`}
                onClick={onExpand}
                aria-label="展开歌单"
                aria-expanded={expanded}
                title="歌单"
            >
                <span className={styles['handle-glyph']} aria-hidden="true">
                    <i /><i /><i />
                </span>
            </button>

            <aside
                className={`${styles.panel}${expanded ? '' : ` ${styles['panel-folded']}`}`}
                aria-label="歌单"
                aria-hidden={!expanded || undefined}
                onPointerEnter={() => onHoverChange(true)}
                onPointerLeave={() => onHoverChange(false)}
            >
                <header className={styles.head}>
                    <MarkNote
                        className={styles.mark}
                        playing={isPlaying}
                        qqBound={qqBound}
                        onOpen={onOpenAccount}
                    />
                    <span className={styles['head-text']}>
                        <span className={styles['head-title']}>歌单</span>
                        <span className={styles['head-sub']}>
                            {`${visibleTracks.length} 首${likedOnly ? ' · 只看喜欢' : ''}`}
                        </span>
                    </span>
                    <button
                        type="button"
                        className={styles['head-btn']}
                        onClick={() => onExpand(false)}
                        aria-label="收起歌单"
                        title="收起"
                    >
                        <span className={styles['fold-glyph']} aria-hidden="true">«</span>
                    </button>
                </header>

                <div className={styles.tools}>
                    {searchOpen ? (
                        <div className={styles['search-box']}>
                            <span className={styles['search-icon']} aria-hidden="true"><IconSearch size={15} /></span>
                            <input
                                ref={searchRef}
                                type="search"
                                value={search}
                                onChange={(event) => onSearch(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Escape') {
                                        setSearchOpen(false);
                                        onSearch('');
                                    }
                                }}
                                placeholder="搜索歌曲或歌手"
                                aria-label="搜索歌曲或歌手"
                            />
                            <button
                                type="button"
                                className={styles['search-close']}
                                title="关闭搜索"
                                aria-label="关闭搜索"
                                onClick={() => {
                                    setSearchOpen(false);
                                    onSearch('');
                                }}
                            >
                                ×
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            className={styles.tool}
                            onClick={() => setSearchOpen(true)}
                            title="搜索"
                            aria-label="搜索歌曲"
                        >
                            <IconSearch size={15} />
                        </button>
                    )}
                    <button
                        type="button"
                        className={`${styles.tool}${likedOnly ? ` ${styles['tool-on']}` : ''}`}
                        onClick={onToggleLikedOnly}
                        title={likedOnly ? '显示全部歌曲' : '只看喜欢的歌曲'}
                        aria-label={likedOnly ? '显示全部歌曲' : '只看喜欢的歌曲'}
                        aria-pressed={likedOnly}
                    >
                        <IconHeart size={15} filled={likedOnly} />
                    </button>
                </div>

                <div className={styles.list} ref={listRef}>
                    {visibleTracks.length === 0 ? (
                        <p className={styles.empty}>
                            {emptyListMessage({ listLoading, keyword, likedOnly })}
                        </p>
                    ) : (
                        <ul>
                            {visibleTracks.map((track, index) => {
                                const item = parseTrackName(track.name);
                                const active = track.id === currentId;
                                const loading = loadingId === track.id;
                                return (
                                    <li key={track.id}>
                                        <button
                                            type="button"
                                            ref={active ? activeRowRef : null}
                                            className={`${styles.row}${active ? ` ${styles['row-active']}` : ''}`}
                                            disabled={loading}
                                            onClick={() => onToggleTrack(track)}
                                            title={`${item.title} - ${item.artist}`}
                                        >
                                            <span className={styles.index} aria-hidden="true">
                                                {active
                                                    ? (loading
                                                        ? <span className={styles.spin}><IconRefresh size={13} /></span>
                                                        : <span className={styles.eq} data-paused={!isPlaying || undefined}><i /><i /><i /></span>)
                                                    : String(index + 1).padStart(2, '0')}
                                            </span>
                                            <span
                                                className={styles.thumb}
                                                style={{ background: trackGradient(track.name) }}
                                                aria-hidden="true"
                                            >
                                                <Cover track={track} />
                                                {active && !loading ? (
                                                    <span className={styles['thumb-overlay']}>
                                                        {isPlaying ? <IconPause size={16} /> : <IconPlay size={16} />}
                                                    </span>
                                                ) : null}
                                            </span>
                                            <span className={styles.text}>
                                                <span className={styles.title}>{item.title}</span>
                                                <span className={styles.artist}>{item.artist}</span>
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </aside>
        </>
    );
};

export default PlaylistPanel;
