import React from 'react';

import { parseTrackName, trackGradient } from '../shared';
import usePlayer from '../core/usePlayer';
import PageHead from '../core/PageHead';
import PlayerAudio from '../core/PlayerAudio';
import Cover from '../Cover';
import DesktopMusic from './DesktopMusic';
import DesktopCachePanel from './DesktopCachePanel';
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
 *    and the `--glass-*` recipe, and `DesktopMusic` plus the panels below
 *    consume them. One declaration is what keeps the workspace and its chrome
 *    from drifting apart.
 *  - the **row drawer** (置顶). It is rendered here, not in the
 *    list, so it can centre itself over the viewport instead of inside the
 *    scroller.
 *  - the **cache manager panel**, the same body the phone layout shows in a
 *    bottom sheet — only the frame differs.
 *
 * `lyricsAutoOpen` is the one genuine disagreement between the layouts: the
 * desktop stage *is* the lyrics card, so opening them for a song that has them
 * is right there, while the phone would be covering its own list for no reason.
 */
const DesktopApp = function () {
    const {
        theme,
        toggleTheme,
        ripples,
        toggleRipples,
        isPinned,
        togglePin,
        tracks,
        visibleTracks,
        sourceName,
        folderName,
        folders,
        folderId,
        handleFolderChange,
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
        cacheOpen,
        cacheClosing,
        setCacheOpen,
        setCacheClosing,
        cacheEntries,
        cacheLoading,
        cacheBusyId,
        cacheAllRunning,
        cacheProgress,
        goCacheManager,
        closeCacheManager,
        readCache,
        deleteCacheEntries,
        cacheAllTracks,
        gsiReady,
        setGsiReady,
        clientIdDraft,
        setClientIdDraft,
        token,
        connect,
        disconnect,
        error,
        notice,
        setError,
        audioRef,
        onEnded,
        onPlay,
        onPause,
        onTimeUpdate,
        onMetadata,
    } = usePlayer({ lyricsAutoOpen: true });

    return (
        <div className={`${styles.page}${theme === 'dark' ? ` ${styles['theme-dark']}` : ''}`}>
            <PageHead
                onReady={() => setGsiReady(true)}
                onError={() => setError('Google 登录组件加载失败，请检查网络')}
            />

            <DesktopMusic
                theme={theme}
                onToggleTheme={toggleTheme}
                connected={!!token}
                sourceName={sourceName}
                gsiReady={gsiReady}
                clientIdDraft={clientIdDraft}
                onClientIdDraft={setClientIdDraft}
                onConnect={connect}
                onDisconnect={disconnect}
                folders={folders}
                folderId={folderId}
                folderName={folderName}
                onFolderChange={handleFolderChange}
                listLoading={listLoading}
                visibleTracks={visibleTracks}
                trackCount={visibleTracks.length}
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
                ripples={ripples}
                onToggleRipples={toggleRipples}
                rowMenuId={rowMenuId}
                onOpenRowMenu={openRowMenu}
                onOpenCache={goCacheManager}
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

            {cacheOpen && (
                <DesktopCachePanel
                    entries={cacheEntries}
                    tracks={tracks}
                    loading={cacheLoading}
                    busyId={cacheBusyId}
                    caching={cacheAllRunning}
                    cacheProgress={cacheProgress}
                    closing={cacheClosing}
                    onClosed={() => { setCacheOpen(false); setCacheClosing(false); }}
                    onCancelClose={() => setCacheClosing(false)}
                    onClose={closeCacheManager}
                    onRefresh={readCache}
                    onDelete={deleteCacheEntries}
                    onCacheAll={cacheAllTracks}
                />
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
