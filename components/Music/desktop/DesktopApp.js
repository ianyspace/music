import React from 'react';

import { parseTrackName, trackGradient } from '../shared';
import usePlayer from '../core/usePlayer';
import PageHead from '../core/PageHead';
import PlayerAudio from '../core/PlayerAudio';
import Cover from '../Cover';
import DesktopMusic from './DesktopMusic';
import {
    IconNote,
    IconPin,
} from '../icons';

import styles from './DesktopApp.module.scss';

/**
 * Wide-screen music experience, served by `/desktop`.
 *
 * It shares nothing with the phone layout except `components/Music/core` and
 * the pure helpers beside it — no component here is imported by, or imports,
 * anything under `components/Music/h5/`. That is the point of the split: the
 * two layouts are separate trees.
 *
 * Everything stateful comes from `usePlayer`; what is left here is the shell —
 * the pieces that belong to *no* layout but have to be mounted above the
 * workspace:
 *
 *  - the **token root**. `DesktopApp.module.scss` declares the desktop palette
 *    and the `--glass-*` recipe, and `DesktopMusic` consumes them. One
 *    declaration is what keeps the workspace and its chrome from drifting
 *    apart. That palette is dark-only: this layout has no theme switch and no
 *    light values, so `usePlayer`'s `theme` is deliberately not read here — the
 *    phone's copy of that preference has no say on `/desktop`.
 *  - the **row drawer** (置顶). It is rendered here, not in the
 *    list, so it can centre itself over the viewport instead of inside the
 *    scroller.
 *
 * Two things the phone layout has and this one deliberately does not:
 *
 *  - **the Google Drive library.** `/desktop` plays the public library, full
 *    stop — `drive: false` on the hook, no GSI script in the head, and no
 *    connect screen anywhere. There used to be a settings dialog here that
 *    could raise Google's account picker; it is gone, and with it the folder
 *    picker, the disconnect row and the "connect your own Drive" steps.
 *  - **the cache manager.** Its only entry on this layout was a row in that
 *    same dialog. Audio caching itself is untouched and still shared with the
 *    phone (one IndexedDB, one 30-day policy) — what is gone is the screen.
 *
 * `lyricsAutoOpen` is the one genuine disagreement between the layouts: the
 * desktop stage *is* the lyrics card, so opening them for a song that has them
 * is right there, while the phone would be covering its own list for no reason.
 */
const DesktopApp = function () {
    const {
        isPinned,
        togglePin,
        visibleTracks,
        listLoading,
        search,
        setSearch,
        current,
        loadingId,
        isPlaying,
        progress,
        shuffle,
        repeat,
        toggleTrack,
        togglePlay,
        playPrev,
        playNext,
        cycleRepeat,
        seek,
        lyrics,
        lyricsLoading,
        lyricsVisible,
        toggleLyrics,
        rowMenu,
        rowMenuClosing,
        rowMenuId,
        openRowMenu,
        closeRowMenu,
        setRowMenu,
        setRowMenuClosing,
        error,
        notice,
        audioRef,
        onEnded,
        onPlay,
        onPause,
        onTimeUpdate,
        onMetadata,
    } = usePlayer({ lyricsAutoOpen: true, drive: false });

    return (
        <div className={styles.page}>
            {/* No GSI script: this layout has no Drive connection to make. */}
            <PageHead gsi={false} />

            <DesktopMusic
                listLoading={listLoading}
                visibleTracks={visibleTracks}
                search={search}
                onSearch={setSearch}
                current={current}
                loadingId={loadingId}
                isPlaying={isPlaying}
                onToggleTrack={toggleTrack}
                onTogglePlay={togglePlay}
                onPrev={playPrev}
                onNext={playNext}
                onSeek={seek}
                progress={progress}
                shuffle={shuffle}
                repeat={repeat}
                onCycleRepeat={cycleRepeat}
                lyrics={lyrics}
                lyricsLoading={lyricsLoading}
                lyricsVisible={lyricsVisible}
                onToggleLyrics={toggleLyrics}
                rowMenuId={rowMenuId}
                onOpenRowMenu={openRowMenu}
            />

            {/* The row drawer, opened by a row's own three-dots button. It is
                centred over the viewport rather than anchored to the row: on a
                wide screen the row is nowhere near the bottom edge, and a sheet
                rising from there would read as a different app. Same actions as
                the phone's, so both layouts teach one behaviour. */}
            {rowMenu && (
                <div
                    className={rowMenuClosing
                        ? `${styles.scrim} ${styles['scrim-out']}`
                        : styles.scrim}
                    role="presentation"
                    onClick={closeRowMenu}
                    onAnimationEnd={(event) => {
                        // Only the scrim's own fade ends the drawer; the card
                        // and its children animate independently.
                        if (rowMenuClosing && event.target === event.currentTarget) {
                            setRowMenu(null);
                            setRowMenuClosing(false);
                        }
                    }}
                >
                    <div
                        className={rowMenuClosing
                            ? `${styles.card} ${styles['card-out']}`
                            : styles.card}
                        role="dialog"
                        aria-modal="true"
                        aria-label="歌曲操作"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className={styles['row-head']}>
                            <span
                                className={styles['row-cover']}
                                style={{ background: trackGradient(rowMenu.name) }}
                                aria-hidden="true"
                            >
                                <Cover track={rowMenu} />
                                <IconNote size={22} />
                            </span>
                            <span className={styles['row-meta']}>
                                <span className={styles['row-title']}>
                                    {parseTrackName(rowMenu.name).title}
                                </span>
                                <span className={styles['row-artist']}>
                                    {parseTrackName(rowMenu.name).artist}
                                </span>
                            </span>
                        </div>
                        {/* 置顶 / 取消置顶 — see the phone layout's note; the two
                            drawers are deliberately the same rows in the same
                            order, and this one is the reason the shared
                            `isPinned` / `togglePin` live in the hook rather than
                            in either layout. */}
                        <button
                            type="button"
                            className={styles.item}
                            role="menuitem"
                            onClick={() => {
                                togglePin(rowMenu);
                                closeRowMenu();
                            }}
                        >
                            <span className={styles['item-icon']} aria-hidden="true">
                                <IconPin size={18} filled={isPinned(rowMenu)} />
                            </span>
                            <span className={styles['item-text']}>
                                <span className={styles['item-title']}>
                                    {isPinned(rowMenu) ? '取消置顶' : '置顶'}
                                </span>
                                <span className={styles['item-sub']}>
                                    {isPinned(rowMenu)
                                        ? '回到列表里原来的位置'
                                        : '把这首歌移到列表第一位'}
                                </span>
                            </span>
                        </button>
                    </div>
                </div>
            )}

            {(error || notice) && (
                <div className={`${styles.toast}${error ? ` ${styles['toast-error']}` : ''}`} role="status">
                    {error || notice}
                </div>
            )}

            <PlayerAudio
                audioRef={audioRef}
                onEnded={onEnded}
                onPlay={onPlay}
                onPause={onPause}
                onTimeUpdate={onTimeUpdate}
                onMetadata={onMetadata}
            />
        </div>
    );
};

export default DesktopApp;
