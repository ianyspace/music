import React, { useEffect, useRef } from 'react';

import {
    IconPause,
    IconPlay,
    IconRefresh,
} from '../../icons';
import {
    ART_NEUTRAL_FILL,
    parseTrackName,
    trackGradient,
} from '../../shared';
import Cover from '../../Cover';

import styles from './PlaylistPanel.module.scss';

/**
 * The immersive page's track list: a bare column of rows hugging the left
 * edge. Plain rows — cover, title, artist — in a native scrolling list; the
 * playing row is tinted and carries the equalizer glyph. No 3D, no windowing:
 * every track is one row, the browser scrolls.
 *
 * No panel shell (fill / blur / border) and no app mark: the rows sit straight
 * on the stage. 账号 used to be reachable only through the mark — it is an
 * entry in the settings popover now.
 *
 * Presentational on purpose — the fold timer and hover state live in
 * `ImmersiveApp`, because the summon edge sits outside this component and
 * both halves need the same state. Click = play/pause that track.
 */

const PlaylistPanel = function ({
    expanded,
    onExpand,
    onHoverChange,
    listLoading,
    visibleTracks,
    current,
    loadingId,
    isPlaying,
    onToggleTrack,
    ambient = false,
}) {
    const listRef = useRef(null);
    const activeRef = useRef(null);

    // 封面缩略图的占位色: 氛围底色开着时用歌曲渐变, 关了(纯黑底)时用中性色,
    // 否则整页只剩这一块高饱和色斑。
    const thumbFill = function (name) {
        return ambient ? trackGradient(name) : ART_NEUTRAL_FILL;
    };

    const currentId = current ? current.track.id : '';
    const total = visibleTracks.length;

    // The playing row scrolls itself into view — gently, and only if it is
    // not already on screen (`nearest`), so a manual browse is never yanked.
    useEffect(() => {
        if (!currentId || !activeRef.current) return;
        activeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [currentId]);

    return (
        <>
            {/* The summon handle, on the left edge while folded. */}
            <button
                type="button"
                className={`${styles.handle}${expanded ? ` ${styles['handle-hidden']}` : ''}`}
                onClick={() => onExpand(true)}
                aria-label="展开歌单"
                aria-expanded={expanded}
                title="歌曲列表"
            >
                <span className={styles['handle-glyph']} aria-hidden="true">
                    <i /><i /><i />
                </span>
            </button>

            <div
                className={`${styles.stage}${expanded ? '' : ` ${styles['stage-folded']}`}`}
                onPointerEnter={() => onHoverChange(true)}
                onPointerLeave={() => onHoverChange(false)}
                aria-label="歌曲列表"
            >
                {/* No header row: the mark, the count and the fold button are
                    all gone. Folding is time-based — the page's hide timer and
                    the 自动收起 switch do it, and the edge handle brings the
                    column back. */}
                {total === 0 ? (
                    <p className={styles.empty}>
                        {listLoading ? '曲库加载中…' : '还没有歌曲'}
                    </p>
                ) : (
                    <ul className={styles.list} ref={listRef}>
                        {visibleTracks.map((track) => {
                            const item = parseTrackName(track.name);
                            const active = track.id === currentId;
                            const loading = loadingId === track.id;
                            return (
                                <li key={track.id}>
                                    <button
                                        type="button"
                                        ref={active ? activeRef : undefined}
                                        className={`${styles.row}${active ? ` ${styles['row-active']}` : ''}`}
                                        disabled={loading}
                                        onClick={() => onToggleTrack(track)}
                                        title={`${item.title} - ${item.artist}`}
                                    >
                                        <span
                                            className={styles.thumb}
                                            style={{ background: thumbFill(track.name) }}
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
                                        {active && !loading ? (
                                            <span
                                                className={styles.eq}
                                                data-paused={!isPlaying || undefined}
                                                aria-hidden="true"
                                            >
                                                <i /><i /><i />
                                            </span>
                                        ) : null}
                                        {loading ? (
                                            <span className={styles.spin} aria-hidden="true">
                                                <IconRefresh size={14} />
                                            </span>
                                        ) : null}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </>
    );
};

export default PlaylistPanel;
