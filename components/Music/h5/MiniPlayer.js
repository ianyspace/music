import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
    IconNote,
    IconPlay,
    IconPause,
    IconNext,
    IconLocate,
} from '../icons';
import { parseTrackName, trackGradient } from '../shared';
import Cover from '../Cover';
import Marquee from '../Marquee';

import styles from './MiniPlayer.module.scss';

// Progress ring geometry (viewBox units): r on a 36×36 canvas, so the dash
// maths below is exact and `stroke-linecap: round` gives the smooth caps.
const RING_R = 16;
const RING_C = 2 * Math.PI * RING_R;

// The song list's `id` (see `TrackList`) — the hook the jump button uses to
// find the rows without a ref threaded across components.
const LIST_ID = 'ms-track-list';

// How long the landed row stays tinted after a jump, and how long the button
// hides itself for while the scroll is still travelling (see `jumpToCurrent`).
const PULSE_MS = 1100;
const PULSE_MS_REDUCED = 400;
const SETTLE_MS = 700;

/**
 * The mini play bar docked above the bottom tab bar. Owned by the page
 * shell — not the list screen — so it stays visible while something is
 * playing. Tapping the bar opens the now-playing sheet; the vinyl disc
 * spins with playback, the "title - artist" label scrolls horizontally when
 * it does not fit (both ends fade while text is cut off), and the play
 * button wears the seek progress as a ring around itself. Only the two
 * transport buttons act in place.
 *
 * It also carries the "jump to the playing track" button on its top-right
 * shoulder. That button belongs to the bar, not to the list: it has to hold
 * still while the list scrolls, and the bar is the one fixed thing in this
 * layout, so it is also the only place where the button's glass can sit
 * against the bar without the two boxes drifting apart. The list is reached
 * through the DOM (`LIST_ID` + `data-track-id`), which keeps the two
 * components independent — the button does nothing at all when there is no
 * row to jump to, e.g. on the profile tab.
 */
const MiniPlayer = function ({
    current,
    isPlaying,
    progress,
    onTogglePlay,
    onNext,
    onOpenPlayer,
    listLoading,
    trackCount,
}) {
    const meta = parseTrackName(current.track.name);
    const percent = progress.duration > 0
        ? Math.min(100, Math.max(0, (progress.time / progress.duration) * 100))
        : 0;

    const currentId = current.track.id;
    // Hidden while the playing row is on screen: the button is a nudge back,
    // not a permanent fixture. Starts false so it cannot flash before the
    // first measurement lands, and is re-measured whenever the row might have
    // moved (song change, filtering, list reload).
    const [rowOffScreen, setRowOffScreen] = useState(false);
    // True for the length of a jump — the scroll is already on its way and the
    // list is about to move underneath, so the button is the wrong thing to
    // leave under a thumb.
    const [jumping, setJumping] = useState(false);
    const settleRef = useRef(null);
    const pulseRef = useRef(null);

    const rowOf = useCallback(function () {
        const list = document.getElementById(LIST_ID);
        return list
            ? list.querySelector(`[data-track-id="${CSS.escape(currentId)}"]`)
            : null;
    }, [currentId]);

    // "On screen" is measured against an inset viewport: the top strip the
    // floating header covers, and the bottom strip this very bar sits over.
    // Without the insets a row parked behind either would count as visible and
    // the button would stay hidden exactly when it is needed.
    //
    // `trackCount` is in the deps for the case where the playing row stops
    // being rendered at all — a search that filters it out. A removed node
    // generates no further entries, so without re-running here the last reading
    // would stick and the button would offer a jump to a row that is not there.
    useEffect(() => {
        const row = rowOf();
        if (!row) {
            setRowOffScreen(false);
            return undefined;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => setRowOffScreen(!entry.isIntersecting));
            },
            { rootMargin: '-72px 0px -96px 0px', threshold: 0 },
        );
        observer.observe(row);
        return () => observer.disconnect();
    }, [rowOf, listLoading, trackCount]);

    useEffect(() => () => {
        window.clearTimeout(settleRef.current);
        window.clearTimeout(pulseRef.current);
    }, []);

    const jumpToCurrent = useCallback(function () {
        const row = rowOf();
        if (!row) return;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        row.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
        // The row was already the playing one, so the flash is what answers
        // "where did it go?" rather than the red title the row always had.
        row.classList.add(styles['track-pulse']);
        window.clearTimeout(pulseRef.current);
        pulseRef.current = window.setTimeout(
            () => row.classList.remove(styles['track-pulse']),
            reduced ? PULSE_MS_REDUCED : PULSE_MS,
        );
        setJumping(true);
        window.clearTimeout(settleRef.current);
        settleRef.current = window.setTimeout(() => setJumping(false), SETTLE_MS);
    }, [rowOf]);

    const labelNode = (
        <>
            {meta.title}
            <span className={styles['label-artist']}> - {meta.artist}</span>
        </>
    );

    const actInPlace = function (event, handler) {
        // Transport taps must not bubble into "open the player sheet".
        event.stopPropagation();
        handler();
    };

    return (
        <div className={styles.wrap}>
            <div
                className={styles.mini}
                role="button"
                tabIndex={0}
                aria-label="打开播放页"
                onClick={onOpenPlayer}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onOpenPlayer();
                    }
                }}
            >
                <span
                    className={`${styles.disc}${isPlaying ? '' : ` ${styles['disc-paused']}`}`}
                    aria-hidden="true"
                >
                    <span
                        className={styles['disc-cover']}
                        style={{ background: trackGradient(current.track.name) }}
                    >
                        <Cover track={current.track} />
                        <IconNote />
                    </span>
                </span>
                <Marquee text={`${meta.title} - ${meta.artist}`} className={styles['mini-label']}>
                    {labelNode}
                </Marquee>
                <span className={styles['play-wrap']}>
                    <svg className={styles.ring} viewBox="0 0 36 36" aria-hidden="true">
                        <circle className={styles['ring-track']} cx="18" cy="18" r={RING_R} />
                        <circle
                            className={styles['ring-fill']}
                            cx="18"
                            cy="18"
                            r={RING_R}
                            style={{
                                strokeDasharray: RING_C.toFixed(2),
                                strokeDashoffset: (RING_C * (1 - percent / 100)).toFixed(2),
                                opacity: percent > 0.5 ? 1 : 0,
                            }}
                        />
                    </svg>
                    <button
                        type="button"
                        className={styles['play-btn']}
                        title={isPlaying ? '暂停' : '播放'}
                        aria-label={isPlaying ? '暂停' : '播放'}
                        onClick={(event) => actInPlace(event, onTogglePlay)}
                    >
                        {isPlaying ? <IconPause /> : <IconPlay />}
                    </button>
                </span>
                <button
                    type="button"
                    className={styles.btn}
                    title="下一首"
                    aria-label="下一首"
                    onClick={(event) => actInPlace(event, onNext)}
                >
                    <IconNext />
                </button>
            </div>

            {/* Top-right shoulder of the bar. Outside `.mini` on purpose: that
                box is the tappable "open the player" surface with
                `overflow: hidden`, so a button nested inside it would both be
                clipped at the rounded corner and inherit the tap. Glass on
                glass, sized to the transport buttons rather than to a tap
                target of its own. */}
            {!listLoading && rowOffScreen && !jumping && (
                <button
                    type="button"
                    className={styles['locate-btn']}
                    title="回到正在播放"
                    aria-label="回到正在播放"
                    onClick={jumpToCurrent}
                >
                    <IconLocate />
                </button>
            )}
        </div>
    );
};

export default MiniPlayer;
