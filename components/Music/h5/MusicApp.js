import React, { useCallback, useEffect, useState } from 'react';

import {
    parseTrackName,
    qqAvatarUrl,
    trackGradient,
} from '../shared';
import usePlayer from '../core/usePlayer';
import usePlayStats from './usePlayStats';
import useDataSync from './useDataSync';
import PageHead from '../core/PageHead';
import PlayerAudio from '../core/PlayerAudio';
import Cover from '../Cover';
import Account from './Account';
import CacheManager from './CacheManager';
import DriveSheet from './DriveSheet';
import Profile from './Profile';
import StatsPage from './StatsPage';
import MiniPlayer from './MiniPlayer';
import NowPlaying from './NowPlaying';
import TrackList from './TrackList';
import { IconHeart, IconNote, IconPin } from '../icons';
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
 * up, and whether a per-song drawer is open. All of it lives in this shell
 * rather than the hook because the desktop has no equivalent of any of it, and
 * the row drawer has to be mounted at this level anyway: the list column sits
 * under a `transform`ed ancestor, which would break `position: fixed` inside it.
 *
 * There are four tab pages, and they are not all peers: 歌曲 is the app, 我的 is
 * the library (which songs are here, and where they come from — the Drive
 * connection opens from there), and 账号 / 听歌排行 are the visitor's own, the
 * second reached from the first. All four stay mounted so their scroll positions
 * survive a switch, which is why every per-page data hook here takes an `active`
 * flag rather than loading on mount.
 *
 * The avatar URL is derived here rather than inside `Account` for the same
 * reason the number itself lives in `usePlayer`: the picture depends on the
 * number, and a fallback each caller decides for itself is two fallbacks that
 * can disagree.
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

    // 'list' | 'profile' | 'account' | 'stats' — which tab page is showing; the
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

    /* --- the visitor's own pages --- */

    // 听歌排行: the visitor's play counts, all time and for the last seven days.
    //
    // `active` is "is that page on screen", not "is this component mounted":
    // all four tab pages stay mounted so their scroll positions survive (see
    // the note on `tab`), so a ranking loaded on mount would be a request every
    // time the app opens. It is owned here rather than inside `StatsPage` for
    // the same reason the cache manager's data is owned by the player — the
    // page stays a view.
    const playStats = usePlayStats({ qq, active: tab === 'stats' });

    // 账号's 数据同步 row: how much of the visitor's own data (plays *and*
    // likes) is still only on this device, and the button that pushes it. Both
    // queues, one row, one button — the visitor does not have two kinds of
    // unsent data, they have unsent data.
    const dataSync = useDataSync({ active: tab === 'account' });

    // The QQ number behind the identity card. It lives in `usePlayer` now
    // rather than here, because it is no longer only about the avatar: it is
    // also the key every play count and every like is recorded under, and both
    // are recorded by the player — which all three layouts share. One storage
    // read, one answer to "who is listening".
    //
    // What stays here is the *picture*: the URL and the "it failed to load"
    // flag. The list's top bar draws the app's mark now, not a face, so 账号's
    // identity card is the only caller — but the fallback stays here anyway,
    // because that is where the number it depends on is turned into a URL, and
    // a caller deciding for itself is a fallback that can disagree with the
    // next one.
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
                {/* All four tab pages stay mounted (scroll position survives
                    the switch); the shown one replays its enter transition. */}
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
                        // 喜欢 is the public library's feature, and it belongs
                        // to a QQ number now that it lives in the database —
                        // so the Drive library gets no filter button and no
                        // heart, and neither does a visitor who has not bound a
                        // number. A button that would always come back empty is
                        // worse than no button.
                        canLike={librarySource !== DRIVE_SOURCE && Boolean(qq)}
                        likedOnly={likedOnly}
                        onToggleLikedOnly={toggleLikedOnly}
                        current={current}
                        loadingId={loadingId}
                        isPlaying={isPlaying}
                        onToggleTrack={toggleTrack}
                        onGoProfile={() => setTab('profile')}
                        onGoAccount={() => setTab('account')}
                        // Drawn as a dot on the mark's corner: the state of the
                        // visitor's number, readable from the list. A boolean
                        // rather than the number itself, because that is the
                        // whole of what the dot has to say.
                        qqBound={Boolean(qq)}
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
                        // The two settings-style pages point at each other:
                        // 「我的」 is the library's, 账号 is the visitor's, and
                        // neither is a dead end.
                        onGoAccount={() => setTab('account')}
                        // 连接云盘 lives here now — it is the page about *which
                        // songs are here*, and its 音乐库 rows (文件夹 / 浏览歌曲)
                        // only ever appear next to it. The sheet itself is
                        // unchanged and still owned by this shell, because it is
                        // a full-height panel over the whole column rather than
                        // something that belongs to one tab.
                        onOpenDrive={openDriveSheet}
                    />
                </div>
                <div
                    className={`${styles.view}${tab === 'account' ? ` ${styles['view-in']}` : ` ${styles['view-off']}`}`}
                >
                    {/* The visitor's own page, opened by tapping the app's mark.
                        The appearance switch and the cache used to be entries in
                        the list's three-dots drawer, which mixed a library
                        action (谷歌云盘链接) with personal settings; both that
                        drawer and the ⋮ that opened it are gone, and this page
                        holds the personal half while 「我的」 holds the library
                        half. */}
                    <Account
                        qq={qq}
                        avatarUrl={avatarUrl}
                        onAvatarError={onAvatarError}
                        onSaveQq={saveQq}
                        theme={theme}
                        onToggleTheme={toggleTheme}
                        onOpenCache={goCacheManager}
                        onGoList={() => setTab('list')}
                        onGoProfile={() => setTab('profile')}
                        onGoStats={() => setTab('stats')}
                        // The 数据同步 row's whole data source, as one prop: it
                        // is a single hook's output and this page is its only
                        // consumer, unlike the player's eighty fields which
                        // each screen picks a different subset of.
                        dataSync={dataSync}
                    />
                </div>
                <div
                    className={`${styles.view}${tab === 'stats' ? ` ${styles['view-in']}` : ` ${styles['view-off']}`}`}
                >
                    {/* 听歌排行, one hop from 账号. It is a tab page like the
                        others — kept mounted, animated in — rather than a
                        sheet, because it is a place you can stay for a while
                        and scroll, not a modal decision. */}
                    <StatsPage
                        qq={qq}
                        stats={playStats.stats}
                        loading={playStats.loading}
                        error={playStats.error}
                        reload={playStats.reload}
                        onGoAccount={() => setTab('account')}
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

            {/* The list's bottom drawer used to be here. It is gone, along with
                the ⋮ that opened it: 缓存管理 and 切换外观 had already left for
                账号, which left it holding one entry (谷歌云盘链接) — and a menu
                of one costs a tap and a decision to reach something that could
                have been a row. That entry is a row on 「我的」 now.

                The *row* drawer below is a different thing and stays: it is
                per-song, it has more than one entry, and it has to be mounted at
                this level (the list column sits under a `transform`ed ancestor,
                which would trap a `position: fixed` child). */}

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
                                            : '加入「我喜欢」，按你的 QQ 号保存'}
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
