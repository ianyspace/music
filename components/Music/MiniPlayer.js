import React from 'react';

import {
    IconNote,
    IconPlay,
    IconPause,
    IconNext,
} from './icons';
import { parseTrackName, trackGradient } from './shared';
import Marquee from './Marquee';

import styles from './MiniPlayer.module.scss';

// Progress ring geometry (viewBox units): r on a 36×36 canvas, so the dash
// maths below is exact and `stroke-linecap: round` gives the smooth caps.
const RING_R = 16;
const RING_C = 2 * Math.PI * RING_R;

/**
 * The mini play bar docked above the bottom tab bar. Owned by the page
 * shell — not the list screen — so it stays visible while something is
 * playing. Tapping the bar opens the now-playing sheet; the vinyl disc
 * spins with playback, the "title - artist" label scrolls horizontally when
 * it does not fit (both ends fade while text is cut off), and the play
 * button wears the seek progress as a ring around itself. Only the two
 * transport buttons act in place.
 */
const MiniPlayer = function ({
    current,
    isPlaying,
    progress,
    onTogglePlay,
    onNext,
    onOpenPlayer,
}) {
    const meta = parseTrackName(current.track.name);
    const percent = progress.duration > 0
        ? Math.min(100, Math.max(0, (progress.time / progress.duration) * 100))
        : 0;

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
        </div>
    );
};

export default MiniPlayer;
