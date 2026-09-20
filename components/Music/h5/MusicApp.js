import React, { useCallback, useEffect, useState } from 'react';

import {
    parseTrackName,
    qqAvatarUrl,
    trackGradient,
} from '../shared';
import usePlayer from '../core/usePlayer';
import usePlayStats from './usePlayStats';
import PageHead from '../core/PageHead';
import PlayerAudio from '../core/PlayerAudio';
import Cover from '../Cover';
import Account from './Account';
import CacheManager from './CacheManager';
import DriveSheet from './DriveSheet';
import Profile from './Profile';
import MiniPlayer from './MiniPlayer';
import NowPlaying from './NowPlaying';
import TrackList from './TrackList';
import { IconGoogleDrive, IconHeart, IconNote, IconPin } from '../icons';
import { DRIVE_SOURCE } from '../librarySource';

import styles from './MusicApp.module.scss';

/**
 * Phone-width music experience, served by `/h5`.
 *
 * It shares nothing with the desktop layout except `components/Music/core` and
 * the pure helpers beside it — no component here is imported by, or imports,
 * anything under `components/Music/desktop/`. That is the point of the split:
 * the two layouts are separate trees, and the seam between them is gone rather
 * than merely widened.
 *
 * Everything stateful comes from `usePlayer`; what is left here is genuinely
 * phone-only UI state — which tab is showing, whether the full-screen player is
 * up, whether the list's three-dots drawer is open, and who the avatar is. All
 * of it lives in this shell rather than the hook because the desktop has no
 * equivalent of any of it, and the drawer has to be mounted at this level
 * anyway: the list column sits under a `transform`ed ancestor, which would break
 * `position: fixed` inside it.
 *
 * The avatar URL is derived here rather than inside `TrackList` for the same
 * reason: the same picture is drawn on the 账号 page, and a load-failure
 * fallback that each caller decides for itself is two fallbacks that can
 * disagree.
 */
const MusicApp = function () {
    const player = usePlayer({ lyricsAutoOpen: false });
    const {
        theme,
        toggleTheme,
        ripples,
        toggleRipples,
        isPinned,
        togglePin,
        isLiked,
        toggleLike,
        likedOnly,
        toggleLikedOnly,
        qq,
        saveQq,
        tracks,
        visibleTracks,
        librarySource,
        sourceName,
        folderName,
        folders,
        folderId,
        handleFolderChange,
        listLoading,
        refreshTracks,
        hasLibrary,
        search,
        setSearch,
        current,
        loadingId,
        isPlaying,
        progress,
        playbackMode,
        toggleTrack,
        togglePlay,
        playPrev,
        playNext,
        cyclePlaybackMode,
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
        driveOpen,
        driveClosing,
        setDriveOpen,
        setDriveClosing,
        openDriveSheet,
        closeDriveSheet,
        gsiReady,
        setGsiReady,
        clientId,
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
    } = player;

    // 'list' | 'profile' | 'account' — which tab page is showing; the
    // full-screen now-playing page floats above it while `playerOpen` is true.
    const [tab, setTab] = useState('list');
    // Scroll the body back to top whenever the active tab changes, so the
    // visitor does not land in the middle of a page they have never seen.
    // The scroll position of the *hidden* tab is implicitly preserved because
    // its DOM stays mounted and the browser remembers the scroll offset of
    // elements that are removed from layout and later restored.
    useEffect(() => {
        // `scrollTo(x, y)` rather than an options object: `behavior: 'instant'`
        // is a newer enum member and an unrecognised value there is a TypeError
        // on older mobile browsers, which would take the whole page down.
        window.scrollTo(0, 0);
    }, [tab]);
    const [playerOpen, setPlayerOpen] = useState(false);
    // While true the sheet plays its slide-down exit animation and only
    // unmounts when that finishes (`onClosed`).
    const [playerClosing, setPlayerClosing] = useState(false);
    // The song list's three-dots drawer. It is owned by this shell — not by
    // `TrackList` — because the list column sits under a `transform`ed
    // ancestor, which would break `position: fixed` inside it (see the drawer
    // note in MusicApp.module.scss). `open` mounts it, `closing` plays the exit
    // animation first (the sheet-unmount-via-animation-end trick).
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuClosing, setMenuClosing] = useState(false);

    /* --- the visitor's avatar --- */

    // The 账号 page's 听歌排行 card: the visitor's own play counts, all time and
    // for the last seven days.
    //
    // `active` is "is that page on screen", not "is this component mounted":
    // all three tab pages stay mounted so their scroll positions survive (see
    // the note on `tab`), so a ranking loaded on mount would be a request every
    // time the app opens. It is owned here rather than inside `Account` for the
    // same reason the cache manager's data is owned by the player — the page
    // stays a view.
    const playStats = usePlayStats({ qq, active: tab === 'account' });

    // The QQ number behind the header avatar. It lives in `usePlayer` now
    // rather than here, because it is no longer only about the avatar: it is
    // also the key every play count is recorded under, and plays are recorded
    // by the player — which all three layouts share. One storage read, one
    // answer to "who is listening".
    //
    // What stays here is the *picture*: the URL and the "it failed to load"
    // flag, because the same disc is drawn on two screens (the list's header
    // and the 账号 page) and a fallback each caller decides for itself is two
    // fallbacks that can disagree — one showing a QQ avatar while the other
    // shows the note glyph.
    const [avatarBroken, setAvatarBroken] = useState(false);

    // Cleared whenever the number changes, because "this picture failed" says
    // nothing about the next one.
    useEffect(() => {
        setAvatarBroken(false);
    }, [qq]);

    // '' means "draw the note": either no number is bound, or its picture did
    // not arrive. Both callers get the same answer.
    const avatarUrl = qq && !avatarBroken ? qqAvatarUrl(qq) : '';

    const onAvatarError = useCallback(function () {
        setAvatarBroken(true);
    }, []);

    /* --- three-dots drawer --- */

    const closeMenu = useCallback(function () {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setMenuOpen(false);
            setMenuClosing(false);
            return;
        }
        setMenuClosing(true);
    }, []);

    const openMenu = useCallback(function () {
        setMenuClosing(false);
        setMenuOpen(true);
    }, []);

    // Escape closes the drawer while it is open.
    useEffect(() => {
        if (!menuOpen) return undefined;
        const onKeyDown = (event) => { if (event.key === 'Escape') closeMenu(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [menuOpen, closeMenu]);

    /* --- now-playing transitions (mini bar ⇄ sheet) --- */

    const openPlayer = useCallback(function () {
        setPlayerClosing(false);
        setPlayerOpen(true);
    }, []);

    // Dismiss = slide the sheet back down; it unmounts via `onClosed`.
    // With reduced motion the CSS animation never fires an end event, so
    // unmount immediately instead.
    const closePlayer = useCallback(function (nextTab) {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setPlayerOpen(false);
            setPlayerClosing(false);
        } else {
            setPlayerClosing(true);
        }
        if (nextTab) setTab(nextTab);
    }, []);

    const finishClosePlayer = useCallback(function () {
        setPlayerOpen(false);
        setPlayerClosing(false);
    }, []);

    // A new tap while the exit animation runs — bring the sheet back.
    const cancelClosePlayer = useCallback(function () {
        setPlayerClosing(false);
    }, []);

    return (
        <div className={`${styles.page} ${theme === 'dark' ? styles['theme-dark'] : ''}`}>
            <PageHead
                onReady={() => setGsiReady(true)}
                onError={() => setError('Google 登录组件加载失败，请检查网络')}
            />

            {/* The phone layout's ambient blobs — its own background, since the
                desktop workspace paints one of its own. */}
            <div className={styles.bg} aria-hidden="true">
                <span className={`${styles.blob} ${styles['blob-1']}`} />
                <span className={`${styles.blob} ${styles['blob-2']}`} />
                <span className={`${styles.blob} ${styles['blob-3']}`} />
            </div>

            <div className={styles.app}>
                {/* Both tab pages stay mounted (scroll position survives the
            switch); the shown one replays its enter transition. */}
                <div
                    className={`${styles.view}${tab === 'list' ? ` ${styles['view-in']}` : ` ${styles['view-off']}`}`}
                >
                    <TrackList
                        connected={hasLibrary}
                        source={librarySource}
                        listLoading={listLoading}
                        visibleTracks={visibleTracks}
                        search={search}
                        onSearch={setSearch}
                        // 喜欢 is the public library's feature; the Drive library
                        // gets no filter button and no heart, rather than a
                        // button that would always come back empty.
                        canLike={librarySource !== DRIVE_SOURCE}
                        likedOnly={likedOnly}
                        onToggleLikedOnly={toggleLikedOnly}
                        current={current}
                        loadingId={loadingId}
                        isPlaying={isPlaying}
                        onToggleTrack={toggleTrack}
                        onGoProfile={() => setTab('profile')}
                        onGoAccount={() => setTab('account')}
                        avatarUrl={avatarUrl}
                        onAvatarError={onAvatarError}
                        menuOpen={menuOpen && !menuClosing}
                        onOpenMenu={openMenu}
                        rowMenuId={rowMenuId}
                        onOpenRowMenu={openRowMenu}
                    />
                </div>
                <div
                    className={`${styles.view}${tab === 'profile' ? ` ${styles['view-in']}` : ` ${styles['view-off']}`}`}
                >
                    <Profile
                        sourceName={sourceName}
                        driveConnected={!!token}
                        folders={folders}
                        folderId={folderId}
                        folderName={folderName}
                        onFolderChange={handleFolderChange}
                        onRefresh={refreshTracks}
                        loading={listLoading}
                        trackCount={tracks.length}
                        onGoList={() => setTab('list')}
                    />
                </div>
                <div
                    className={`${styles.view}${tab === 'account' ? ` ${styles['view-in']}` : ` ${styles['view-off']}`}`}
                >
                    {/* The visitor's own page, opened by tapping the avatar.
                        The appearance switch and the cache used to be entries in
                        the list's three-dots drawer, which mixed a library
                        action (谷歌云盘链接) with personal settings; the drawer
                        is the library's now, and these are the face's. */}
                    <Account
                        qq={qq}
                        avatarUrl={avatarUrl}
                        onAvatarError={onAvatarError}
                        onSaveQq={saveQq}
                        theme={theme}
                        onToggleTheme={toggleTheme}
                        onOpenCache={goCacheManager}
                        onGoList={() => setTab('list')}
                        // The 听歌排行 card's whole data source, as one prop:
                        // it is a single hook's output and this page is its
                        // only consumer, unlike the player's eighty fields
                        // which each screen picks a different subset of.
                        playStats={playStats}
                    />
                </div>
            </div>

            {/* Mini bar belongs to the song list only — the profile page
        shows settings, not playback UI. It also carries the jump-to-
        the-playing-track button, which is why it is the one place the
        list's loading state is still needed. */}
            {tab === 'list' && current && !playerOpen && (
                <MiniPlayer
                    current={current}
                    isPlaying={isPlaying}
                    progress={progress}
                    listLoading={listLoading}
                    trackCount={visibleTracks.length}
                    onTogglePlay={togglePlay}
                    onNext={playNext}
                    onOpenPlayer={openPlayer}
                />
            )}

            {playerOpen && current && (
                <NowPlaying
                    track={current.track}
                    isPlaying={isPlaying}
                    progress={progress}
                    mode={playbackMode}
                    // Read here rather than inside the player so the page stays a
                    // plain view: it renders a heart, it does not know how a
                    // like is stored or which library it belongs to.
                    liked={isLiked(current.track)}
                    canLike={current.track.source !== DRIVE_SOURCE}
                    onToggleLike={() => toggleLike(current.track)}
                    listLoading={listLoading}
                    closing={playerClosing}
                    onClosed={finishClosePlayer}
                    onCancelClose={cancelClosePlayer}
                    onCycleMode={cyclePlaybackMode}
                    onTogglePlay={togglePlay}
                    onPrev={playPrev}
                    onNext={playNext}
                    onSeek={seek}
                    onClose={() => closePlayer()}
                    onOpenList={() => closePlayer('list')}
                    lyrics={lyrics}
                    lyricsLoading={lyricsLoading}
                    lyricsVisible={lyricsVisible}
                    onToggleLyrics={toggleLyrics}
                    ripples={ripples}
                    onToggleRipples={toggleRipples}
                />
            )}

            {/* Bottom drawer opened by the song list's three-dots button. It
                belongs to the shell, so on a wide screen it stays centred over
                the phone column instead of hanging off the list.

                It holds one entry, and that is the point: 缓存管理 and 切换外观
                moved to 账号 (behind the avatar) because a library action and
                personal settings are not the same kind of thing, and the ⋮ sits
                on the library. What is left is the one entry that is about the
                library you are browsing. */}
            {menuOpen && (
                <div
                    className={menuClosing
                        ? `${styles['menu-scrim']} ${styles['menu-scrim-out']}`
                        : styles['menu-scrim']}
                    role="presentation"
                    onClick={closeMenu}
                    onAnimationEnd={(event) => {
                        // Only the scrim's own fade ends the drawer; the sheet
                        // and its children animate independently.
                        if (menuClosing && event.target === event.currentTarget) {
                            setMenuOpen(false);
                            setMenuClosing(false);
                        }
                    }}
                >
                    <div
                        className={menuClosing
                            ? `${styles.menu} ${styles['menu-out']}`
                            : styles.menu}
                        role="menu"
                        aria-label="更多功能"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <span className={styles['menu-grip']} aria-hidden="true" />
                        <button
                            type="button"
                            className={styles['menu-item']}
                            role="menuitem"
                            onClick={() => { closeMenu(); openDriveSheet(); }}
                        >
                            <span className={styles['menu-icon']} aria-hidden="true">
                                <IconGoogleDrive size={20} />
                            </span>
                            <span className={styles['menu-text']}>
                                <span className={styles['menu-title']}>谷歌云盘链接</span>
                                <span className={styles['menu-sub']}>连接或切换自己的云盘曲库</span>
                            </span>
                        </button>
                    </div>
                </div>
            )}

            {/* The row drawer, opened by a row's own three-dots button. It gets
                the same treatment as the drawer above — the cover, the title
                and the two actions — but nothing else: the song's playback
                state is already legible from the row under the scrim. */}
            {rowMenu && (
                <div
                    className={rowMenuClosing
                        ? `${styles['menu-scrim']} ${styles['menu-scrim-out']}`
                        : styles['menu-scrim']}
                    role="presentation"
                    onClick={closeRowMenu}
                    onAnimationEnd={(event) => {
                        if (rowMenuClosing && event.target === event.currentTarget) {
                            setRowMenu(null);
                            setRowMenuClosing(false);
                        }
                    }}
                >
                    <div
                        className={rowMenuClosing
                            ? `${styles.menu} ${styles['menu-out']}`
                            : styles.menu}
                        role="dialog"
                        aria-modal="true"
                        aria-label="歌曲操作"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <span className={styles['menu-grip']} aria-hidden="true" />
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
                        {/* 置顶 / 取消置顶 — one button whose label follows its
                            state, the same shape as 喜欢 below it. It used to be
                            one-way and greyed itself out once the song reached
                            the first row, which meant the visitor could pin but
                            never take it back.

                            The state comes from `isPinned` (is the song in the
                            stored ranking) rather than from the first row, and
                            those stopped being the same question the moment a
                            search or 只看喜欢 could push a pinned song down. */}
                        <button
                            type="button"
                            className={styles['menu-item']}
                            role="menuitem"
                            onClick={() => {
                                togglePin(rowMenu);
                                closeRowMenu();
                            }}
                        >
                            <span className={styles['menu-icon']} aria-hidden="true">
                                <IconPin size={20} filled={isPinned(rowMenu)} />
                            </span>
                            <span className={styles['menu-text']}>
                                <span className={styles['menu-title']}>
                                    {isPinned(rowMenu) ? '取消置顶' : '置顶'}
                                </span>
                                <span className={styles['menu-sub']}>
                                    {isPinned(rowMenu)
                                        ? '回到列表里原来的位置'
                                        : '把这首歌移到列表第一位'}
                                </span>
                            </span>
                        </button>
                        {/* 喜欢 sits under 置顶 because that is the order of
                            what it does to the song: arranges it, then keeps
                            it. The label carries the current state rather than
                            reading 喜欢 either way — the drawer is where the
                            visitor finds out whether a song is already liked,
                            since no row shows a heart. */}
                        {rowMenu.source !== DRIVE_SOURCE && (
                            <button
                                type="button"
                                className={styles['menu-item']}
                                role="menuitem"
                                onClick={() => {
                                    toggleLike(rowMenu);
                                    closeRowMenu();
                                }}
                            >
                                <span className={styles['menu-icon']} aria-hidden="true">
                                    <IconHeart size={20} filled={isLiked(rowMenu)} />
                                </span>
                                <span className={styles['menu-text']}>
                                    <span className={styles['menu-title']}>
                                        {isLiked(rowMenu) ? '取消喜欢' : '喜欢'}
                                    </span>
                                    <span className={styles['menu-sub']}>
                                        {isLiked(rowMenu)
                                            ? '从「我喜欢」里移出'
                                            : '加入「我喜欢」，只保存在本机'}
                                    </span>
                                </span>
                            </button>
                        )}
                    </div>
                </div>
            )}

            {cacheOpen && (
                <CacheManager
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

            {driveOpen && (
                <DriveSheet
                    driveConnected={!!token}
                    sourceName={sourceName}
                    gsiReady={gsiReady}
                    clientId={clientId}
                    clientIdDraft={clientIdDraft}
                    onClientIdDraft={setClientIdDraft}
                    onConnect={connect}
                    onDisconnect={disconnect}
                    folders={folders}
                    folderId={folderId}
                    onFolderChange={handleFolderChange}
                    loading={listLoading}
                    trackCount={tracks.length}
                    closing={driveClosing}
                    onClosed={() => { setDriveOpen(false); setDriveClosing(false); }}
                    onCancelClose={() => setDriveClosing(false)}
                    onClose={closeDriveSheet}
                    onRefresh={refreshTracks}
                    onGoList={() => { closeDriveSheet(); setTab('list'); }}
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

export default MusicApp;
