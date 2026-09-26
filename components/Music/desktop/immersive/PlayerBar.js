import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
    IconExpand,
    IconHeart,
    IconNote,
    IconPause,
    IconPlay,
    IconPrev,
    IconNext,
    IconQueue,
    IconRepeat,
    IconRepeatOne,
    IconShuffle,
} from '../../icons';
import { formatTime } from '../../shared';
import Cover from '../../Cover';
import Marquee from '../../Marquee';
import { advanceVinyl } from './visual/vinylSpin';

import styles from './PlayerBar.module.scss';

/**
 * The immersive page's play bar: a glass capsule pinned to the bottom edge,
 * *always* visible — that is the product decision, so there is no hide timer
 * in here to remove later.
 *
 * Everything it does is the old bar's behaviour (the same cycle button, the
 * same seek, the same heart); fullscreen is the document's and local to this
 * bar, so it does not belong in `usePlayer`.
 *
 * No volume control: the listening level is the system's, and the stored
 * preference is still applied to the `<audio>` element by the page — there is
 * simply nothing to drag here. No gear either: settings opens from the
 * corner button now.
 */

const MODES = {
    off: { icon: <IconRepeat />, title: '循环关闭' },
    all: { icon: <IconRepeat />, title: '列表循环' },
    one: { icon: <IconRepeatOne />, title: '单曲循环' },
    shuffle: { icon: <IconShuffle />, title: '随机播放' },
};

const PlayerBar = function ({
    current,
    title,
    artist,
    gradient,
    isPlaying,
    progress,
    onSeek,
    onPrev,
    onNext,
    onTogglePlay,
    onCycleRepeat,
    shuffle,
    repeat,
    lyricsShown,
    canToggleLyrics,
    onToggleLyrics,
    liked,
    onToggleLike,
    audioRef,
}) {
    const percent = progress.duration > 0
        ? Math.min(100, Math.max(0, (progress.time / progress.duration) * 100))
        : 0;
    const mode = shuffle ? 'shuffle' : repeat;
    const playback = MODES[mode] || MODES.off;

    /* --- the disc ---------------------------------------------------------
       The little disc and the 3D vinyl preset read their angle from the same
       module, so they turn at the same rate, sit at the same angle, and both
       stop dead when playback pauses (14 s per revolution). */
    const discRef = useRef(null);
    useEffect(() => {
        let raf = 0;
        let last = performance.now();
        const tick = (now) => {
            const dt = (now - last) / 1000;
            last = now;
            const angle = advanceVinyl(dt, isPlaying);
            if (discRef.current) discRef.current.style.transform = `rotate(${angle}rad)`;
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [isPlaying]);

    // --- fullscreen -------------------------------------------------------
    const [fullscreen, setFullscreen] = useState(false);
    useEffect(() => {
        const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);

    const toggleFullscreen = useCallback(function () {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        } else {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    }, []);

    return (
        <div className={styles.bar}>
            <input
                className={styles.seek}
                type="range"
                min={0}
                max={progress.duration > 0 ? progress.duration : 1}
                step={0.1}
                value={Math.min(progress.time, progress.duration > 0 ? progress.duration : 1)}
                disabled={!current || progress.duration <= 0}
                onChange={(event) => onSeek(Number(event.target.value))}
                style={{ '--fill': `${percent}%` }}
                aria-label="播放进度"
            />

            <div className={styles.row}>
                <span className={styles.track}>
                    <span className={styles.disc} ref={discRef} aria-hidden="true">
                        <span className={styles['disc-cover']} style={{ background: gradient }}>
                            <Cover track={current ? current.track : null} />
                            {current ? null : <IconNote />}
                        </span>
                    </span>
                    <Marquee
                        text={current ? `${title} - ${artist}` : '还没有播放中的歌曲'}
                        className={styles.label}
                    >
                        <span className={styles.title}>{title}</span>
                        <span className={styles.artist}> - {artist}</span>
                    </Marquee>
                </span>

                <div className={styles.controls}>
                    <button
                        type="button"
                        className={`${styles.btn}${mode !== 'off' ? ` ${styles['btn-on']}` : ''}`}
                        onClick={onCycleRepeat}
                        title={playback.title}
                        aria-pressed={mode !== 'off'}
                    >
                        {playback.icon}
                    </button>
                    <button
                        type="button"
                        className={styles.btn}
                        onClick={onPrev}
                        disabled={!current}
                        title="上一首"
                        aria-label="上一首"
                    >
                        <IconPrev />
                    </button>
                    <button
                        type="button"
                        className={styles.play}
                        onClick={onTogglePlay}
                        disabled={!current}
                        title={isPlaying ? '暂停' : '播放'}
                        aria-label={isPlaying ? '暂停' : '播放'}
                    >
                        {isPlaying ? <IconPause /> : <IconPlay />}
                    </button>
                    <button
                        type="button"
                        className={styles.btn}
                        onClick={onNext}
                        disabled={!current}
                        title="下一首"
                        aria-label="下一首"
                    >
                        <IconNext />
                    </button>
                    <button
                        type="button"
                        className={`${styles.btn}${lyricsShown ? ` ${styles['btn-on']}` : ''}`}
                        onClick={onToggleLyrics}
                        disabled={!canToggleLyrics}
                        title={lyricsShown ? '隐藏歌词' : '显示歌词'}
                        aria-pressed={lyricsShown}
                    >
                        <IconQueue />
                    </button>
                </div>

                <span className={styles.end}>
                    <button
                        type="button"
                        className={`${styles.btn}${liked ? ` ${styles['btn-on']}` : ''}`}
                        onClick={onToggleLike}
                        disabled={!current}
                        title={liked ? '取消喜欢' : '喜欢'}
                        aria-label={liked ? '取消喜欢' : '喜欢'}
                        aria-pressed={liked}
                    >
                        <IconHeart filled={liked} />
                    </button>
                    <span className={styles.times}>
                        <span>{formatTime(progress.time)}</span>
                        <span className={styles.sep}>/</span>
                        <span>{formatTime(progress.duration)}</span>
                    </span>
                    <button
                        type="button"
                        className={styles.btn}
                        onClick={toggleFullscreen}
                        title={fullscreen ? '退出全屏' : '全屏'}
                        aria-label={fullscreen ? '退出全屏' : '全屏'}
                    >
                        <IconExpand size={18} />
                    </button>
                </span>
            </div>
        </div>
    );
};

export default PlayerBar;
