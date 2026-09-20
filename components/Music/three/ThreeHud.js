import React from 'react';
import Link from 'next/link';

import Cover from '../Cover';
import { formatTime, parseTrackName } from '../shared';
import {
    IconClose,
    IconCube,
    IconExit,
    IconList,
    IconLyrics,
    IconNext,
    IconPause,
    IconPlay,
    IconPrev,
    IconRepeat,
    IconRepeatOne,
    IconShuffle,
    IconSpinner,
} from './icons';

import styles from './ThreeApp.module.scss';

/**
 * The 3D page's chrome: everything that is drawn over the canvas.
 *
 * It is a sibling of the canvas, never a parent of it — a `<div>` with a
 * `backdrop-filter` wrapped around a WebGL canvas is the fastest way to make a
 * 60fps scene into a 20fps one, so the panels sit *beside* the scene and the
 * canvas is left alone.
 *
 * The layout follows the wide-screen page in the two places that matter — a
 * list down the left, a capsule at the bottom — and departs from it everywhere
 * else. There is no settings sheet, no cache manager, no Drive connection and
 * no theme switch: the room is dark, and the library is whatever `/desktop`
 * already connected.
 */

const MODE = {
    off: { icon: <IconRepeat />, label: '循环关闭' },
    all: { icon: <IconRepeat />, label: '列表循环' },
    one: { icon: <IconRepeatOne />, label: '单曲循环' },
    shuffle: { icon: <IconShuffle />, label: '随机播放' },
};

const ThreeHud = function ({
    listOpen,
    onToggleList,
    listLoading,
    onRefresh,
    visibleTracks,
    trackCount,
    sourceName,
    search,
    onSearch,
    current,
    loadingId,
    isPlaying,
    progress,
    onToggleTrack,
    onTogglePlay,
    onPrev,
    onNext,
    onSeek,
    playbackMode,
    onCyclePlaybackMode,
    lyricsVisible,
    onToggleLyrics,
    notice,
    error,
}) {
    const percent = progress.duration > 0
        ? Math.min(100, (progress.time / progress.duration) * 100)
        : 0;
    const mode = MODE[playbackMode] || MODE.off;
    // `current` is `{ track, url, startTime, shouldPlay }` — the song is one
    // level down. `current.name` is `undefined`, and `parseTrackName` calls
    // `.match` on its argument, so this one line took the whole page down:
    // every click on a track threw during render and the error boundary
    // replaced the room with a card.
    const playing = current ? parseTrackName(current.track.name) : null;

    // The shared `emptyListMessage` is written for the two places that can
    // *change* the source — it ends with "go and pick another folder". Neither
    // of those things can be done from this page, so the wording here says
    // where they can be done instead.
    //
    // There used to be a branch between the search and the fallback, for "the
    // library has songs but they are all hidden in 不喜欢". Nothing hides a
    // song any more, so an empty list here *is* an empty library.
    let emptyNote = '';
    if (listLoading) emptyNote = '正在载入曲库';
    else if (search) emptyNote = `没有匹配「${search}」的歌曲`;
    else emptyNote = '曲库是空的，回简洁版连接云盘或换个文件夹';

    return (
        <>
            <header className={styles.top}>
                <span className={styles.brand}>
                    <span className={styles['brand-mark']} aria-hidden="true">
                        <IconCube size={15} />
                    </span>
                    <span className={styles['brand-text']}>3D 沉浸模式</span>
                </span>

                <div className={styles.actions}>
                    <button
                        type="button"
                        className={lyricsVisible
                            ? `${styles['icon-btn']} ${styles['icon-btn-on']}`
                            : styles['icon-btn']}
                        onClick={onToggleLyrics}
                        aria-pressed={lyricsVisible}
                        title={lyricsVisible ? '隐藏歌词' : '显示歌词'}
                    >
                        <IconLyrics size={18} />
                    </button>
                    <button
                        type="button"
                        className={listOpen
                            ? `${styles['icon-btn']} ${styles['icon-btn-on']}`
                            : styles['icon-btn']}
                        onClick={onToggleList}
                        aria-pressed={listOpen}
                        title={listOpen ? '收起列表' : '展开列表'}
                    >
                        <IconList size={18} />
                    </button>
                    {/* A plain link, not a button with a router call: leaving
                        the room is a navigation, and the back button should
                        work like one. */}
                    <Link className={styles['icon-btn']} href="/desktop" title="返回简洁版">
                        <IconExit size={16} />
                    </Link>
                </div>
            </header>

            <aside className={listOpen ? styles.side : `${styles.side} ${styles['side-folded']}`}>
                <div className={styles['side-head']}>
                    <span className={styles['side-title']}>{sourceName || '公共曲库'}</span>
                    <span className={styles['side-count']}>{trackCount}</span>
                    <button
                        type="button"
                        className={styles['side-refresh']}
                        onClick={onRefresh}
                        title="重新载入曲库"
                        aria-label="重新载入曲库"
                    >
                        <IconSpinner size={14} />
                    </button>
                </div>

                <label className={styles.search}>
                    <input
                        type="search"
                        value={search}
                        onChange={(event) => onSearch(event.target.value)}
                        placeholder="搜索歌曲"
                        aria-label="搜索歌曲"
                    />
                    {search && (
                        <button
                            type="button"
                            className={styles['search-clear']}
                            onClick={() => onSearch('')}
                            aria-label="清空搜索"
                        >
                            <IconClose size={14} />
                        </button>
                    )}
                </label>

                <div className={styles['side-body']}>
                    {visibleTracks.length === 0 && (
                        <p className={styles['side-note']}>
                            {listLoading && (
                                <span className={styles.spin}><IconSpinner size={14} /></span>
                            )}
                            {emptyNote}
                        </p>
                    )}

                    <ul className={styles.list}>
                        {visibleTracks.map((track) => {
                            // Also one level down — this read `current.id`,
                            // which is always `undefined`, so the row of the
                            // song that was actually playing never lit up.
                            const active = current && current.track.id === track.id;
                            const name = parseTrackName(track.name);
                            return (
                                <li key={track.id}>
                                    <button
                                        type="button"
                                        className={active
                                            ? `${styles.row} ${styles['row-active']}`
                                            : styles.row}
                                        onClick={() => onToggleTrack(track)}
                                        aria-current={active ? 'true' : undefined}
                                    >
                                        <span className={styles['row-cover']} aria-hidden="true">
                                            <Cover track={track} />
                                        </span>
                                        <span className={styles['row-text']}>
                                            <span className={styles['row-title']}>{name.title}</span>
                                            <span className={styles['row-artist']}>{name.artist}</span>
                                        </span>
                                        {loadingId === track.id
                                            ? (
                                                <span className={styles.spin}>
                                                    <IconSpinner size={14} />
                                                </span>
                                            )
                                            : (active && isPlaying ? <span className={styles.pulse} /> : null)}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </aside>

            <footer className={styles.bar}>
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

                <div className={styles['bar-row']}>
                    <span className={styles['bar-track']}>
                        <span className={styles['bar-title']}>
                            {playing ? playing.title : '还没有播放中的歌曲'}
                        </span>
                        <span className={styles['bar-artist']}>
                            {playing ? playing.artist : '从列表里挑一首'}
                        </span>
                    </span>

                    <span className={styles.transport}>
                        <button
                            type="button"
                            className={styles['ctrl-btn']}
                            onClick={onPrev}
                            disabled={!current}
                            aria-label="上一首"
                        >
                            <IconPrev />
                        </button>
                        <button
                            type="button"
                            className={styles['ctrl-play']}
                            onClick={onTogglePlay}
                            disabled={!current}
                            aria-label={isPlaying ? '暂停' : '播放'}
                        >
                            {isPlaying ? <IconPause /> : <IconPlay />}
                        </button>
                        <button
                            type="button"
                            className={styles['ctrl-btn']}
                            onClick={onNext}
                            disabled={!current}
                            aria-label="下一首"
                        >
                            <IconNext />
                        </button>
                    </span>

                    <span className={styles['bar-right']}>
                        <button
                            type="button"
                            className={styles['mode-btn']}
                            onClick={onCyclePlaybackMode}
                            title={mode.label}
                            aria-label={mode.label}
                        >
                            {mode.icon}
                        </button>
                        <span className={styles.time}>{formatTime(progress.time)}</span>
                        <span className={styles['time-sep']}>/</span>
                        <span className={styles.time}>
                            {progress.duration > 0 ? formatTime(progress.duration) : '--:--'}
                        </span>
                    </span>
                </div>
            </footer>

            {/* The controls are invisible, so they get said once, out loud. */}
            <p className={styles.hint} aria-hidden="true">
                拖动旋转视角 · 滚轮拉近拉远 · 点击唱片看歌词 · 空格播放暂停
            </p>

            {(error || notice) && (
                <div className={`${styles.toast}${error ? ` ${styles['toast-error']}` : ''}`} role="status">
                    {error || notice}
                </div>
            )}
        </>
    );
};

export default ThreeHud;
