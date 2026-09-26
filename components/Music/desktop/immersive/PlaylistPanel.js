import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
    IconPause,
    IconPlay,
    IconRefresh,
} from '../../icons';
import {
    parseTrackName,
    trackGradient,
} from '../../shared';
import Cover from '../../Cover';
import MarkNote from '../../core/MarkNote';

import styles from './PlaylistPanel.module.scss';

/**
 * The immersive page's song cards: *no panel*. A stack of free-floating glass
 * cards hovering over the nebula on the right (the reference layout): the
 * front card is the playing song, large and near face-on; the ones behind it
 * recede into depth — lower, further right, tipped back — each occluded by
 * the card in front, so the column reads as objects in space, not lines in a
 * box.
 *
 * Browsing: the wheel rotates the window one card at a time; the cards glide
 * between depth slots (the transition is on the `li`). When the song changes
 * the playing card glides to the front on its own — the front slot *is* the
 * now-playing slot.
 *
 * Presentational on purpose — the fold timer and hover state live in
 * `ImmersiveApp`, because the summon edge sits outside this component and
 * both halves need the same state. Click = play/pause that track; that is
 * still a card's only action.
 */

// How many cards the stack renders at once. Five: one in focus, four
// receding — more than that and the back cards shrink into noise.
const SLOTS = 5;

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
    qqBound,
    onOpenAccount,
}) {
    const [start, setStart] = useState(0);

    const meta = current ? parseTrackName(current.track.name) : null;
    const currentId = current ? current.track.id : '';
    const total = visibleTracks.length;

    // Clamp the window when the list shrinks (search is gone; this is for
    // library reloads).
    useEffect(() => {
        setStart((s) => Math.min(s, Math.max(0, total - SLOTS)));
    }, [total]);

    // The playing song owns the front slot: on change, glide its card there.
    useEffect(() => {
        if (!currentId) return;
        const index = visibleTracks.findIndex((t) => t.id === currentId);
        if (index >= 0) {
            setStart(Math.max(0, Math.min(index, Math.max(0, total - SLOTS))));
        }
    }, [currentId, visibleTracks, total]);

    const onWheel = (event) => {
        if (total <= SLOTS) return;
        const delta = event.deltaY > 0 ? 1 : -1;
        setStart((s) => Math.max(0, Math.min(total - SLOTS, s + delta)));
    };

    const window5 = useMemo(
        () => visibleTracks.slice(start, start + SLOTS),
        [visibleTracks, start],
    );

    // Pointerenter/leave on the whole stack feeds the fold timer.
    return (
        <>
            {/* The summon handle, on the right edge while folded. */}
            <button
                type="button"
                className={`${styles.handle}${expanded ? ` ${styles['handle-hidden']}` : ''}`}
                onClick={() => onExpand(true)}
                aria-label="展开歌单"
                aria-expanded={expanded}
                title="歌曲卡片"
            >
                <span className={styles['handle-glyph']} aria-hidden="true">
                    <i /><i /><i />
                </span>
            </button>

            <div
                className={`${styles.stage}${expanded ? '' : ` ${styles['stage-folded']}`}`}
                onWheel={onWheel}
                onPointerEnter={() => onHoverChange(true)}
                onPointerLeave={() => onHoverChange(false)}
                aria-label="歌曲卡片"
            >
            {/* The floating control row: nothing here belongs to a card. */}
            <div className={styles.bar}>
                <MarkNote
                    className={styles.mark}
                    playing={isPlaying}
                    qqBound={qqBound}
                    onOpen={onOpenAccount}
                />
                {total > 0 ? (
                    <span className={styles.count} aria-hidden="true">
                        {`${Math.min(start + 1, total)}–${Math.min(start + SLOTS, total)} / ${total}`}
                    </span>
                ) : null}
                <button
                    type="button"
                    className={styles.fold}
                    onClick={() => onExpand(false)}
                    aria-label="收起歌单"
                    aria-expanded={expanded}
                    title="收起"
                >
                    <span className={styles['fold-glyph']} aria-hidden="true">»</span>
                </button>
            </div>

            {total === 0 ? (
                <p className={styles.empty}>
                    {listLoading ? '曲库加载中…' : '还没有歌曲'}
                </p>
            ) : (
                <ul className={styles.stack}>
                    {window5.map((track, slot) => {
                        const item = parseTrackName(track.name);
                        const active = track.id === currentId;
                        const loading = loadingId === track.id;
                        return (
                            <li key={track.id} className={styles[`slot${slot}`]}>
                                <button
                                    type="button"
                                    className={`${styles.card}${active ? ` ${styles['card-active']}` : ''}`}
                                    disabled={loading}
                                    onClick={() => onToggleTrack(track)}
                                    title={`${item.title} - ${item.artist}`}
                                >
                                    <span
                                        className={styles.thumb}
                                        style={{ background: trackGradient(track.name) }}
                                        aria-hidden="true"
                                    >
                                        <Cover track={track} />
                                        {active && !loading ? (
                                            <span className={styles['thumb-overlay']}>
                                                {isPlaying ? <IconPause size={22} /> : <IconPlay size={22} />}
                                            </span>
                                        ) : null}
                                    </span>
                                    <span className={styles.text}>
                                        {active ? (
                                            <span className={styles['now-tag']} aria-hidden="true">
                                                {loading
                                                    ? <span className={styles.spin}><IconRefresh size={11} /></span>
                                                    : <span className={styles.eq} data-paused={!isPlaying || undefined}><i /><i /><i /></span>}
                                                正在播放
                                            </span>
                                        ) : null}
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
        </>
    );
};

export default PlaylistPanel;
