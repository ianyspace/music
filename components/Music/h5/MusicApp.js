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
import {
    IconArchive,
    IconCloud,
    IconHeart,
    IconMoon,
    IconNote,
    IconPin,
    IconSun,
} from '../icons';
import { DRIVE_SOURCE } from '../librarySource';

import styles from './MusicApp.module.scss';

/**
 * A panel that mounts on open and unmounts once its exit animation has run —
 * the shape 缓存管理, 谷歌云盘链接, 账号, 音乐库 and 听歌排行 all share.
 *
 * Three copies of it already existed as player state (`playerOpen` / `cacheOpen`
 * / `driveOpen`, which belong there because the player owns the data behind
 * them). This is the same shape for the panels *this* shell owns, written
 * once so the reduced-motion branch — the one that has to unmount immediately,
 * because a disabled animation never fires an end event — cannot be forgotten in
 * one of them.
 */
const useSheet = function () {
    const [open, setOpen] = useState(false);
    const [closing, setClosing] = useState(false);

    const show = useCallback(function () {
        setClosing(false);
        setOpen(true);
    }, []);

    const hide = useCallback(function () {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setOpen(false);
            setClosing(false);
            return;
        }
        setClosing(true);
    }, []);

    const finish = useCallback(function () {
        setOpen(false);
        setClosing(false);
    }, []);

    // A tap while the exit animation runs — bring the panel back.
    const cancel = useCallback(function () {
        setClosing(false);
    }, []);

    return { open, closing, show, hide, finish, cancel };
};

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
 * phone-only UI state — which panels are up, and whether the full-screen player
 * is open. All of it lives in this shell rather than the hook because the
 * desktop has no equivalent of any of it, and the panels have to be mounted at
 * this level anyway: the list column sits under a `transform`ed ancestor, which
 * would break `position: fixed` inside it.
 *
 * **One screen, five sheets, two drawers.** The song list is the only thing here
 * that is a *place* — you stay on it, scroll it, and it is the page every panel
 * rises over and returns you to. 账号 (the visitor), 音乐库 (the library),
 * 听歌排行 (their plays), 缓存管理 and 谷歌云盘链接 are all *sheets*: they arrive
 * from the bottom edge, over whatever you were looking at, and go away again —
 * which is why none of them carries a page header with navigation capsules in
 * it. A sheet is dismissed by its own collapse button, and a second row of
 * destinations inside it would be a page pretending to be a panel.
 *
 * 听歌排行 is the sheet this file used to get wrong. It was a *tab page* beside
 * the list, reachable only through a 账号 capsule in its own header — while 账号's
 * only way to it was the row that opened it. Two screens pointing at each other,
 * with no third thing to leave through. As a sheet it simply closes, and closing
 * it lands on the list.
 *
 * The entries: the app's mark (leading end of the list's bar) opens 账号; the ⋮
 * opens the drawer, which holds 音乐库 (which is also where the Drive library is
 * connected and switched — one entry for "which songs are here"), 缓存管理, and
 * 切换外观. 听歌排行 is one row inside 账号, next to the number it is about.
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

    // The panels this shell owns. They are independent: the drawer opens 音乐库
    // *and* closes itself, 账号 can be raised from the list, and 听歌排行 is
    // raised from 账号 — which then gets out of the way, because a sheet that is
    // replaced by another sheet must not be what the second one collapses back
    // to (see `goStats`).
    const menu = useSheet();
    const account = useSheet();
    const profile = useSheet();
    const stats = useSheet();

    const [playerOpen, setPlayerOpen] = useState(false);
    // While true the sheet plays its slide-down exit animation and only
    // unmounts when that finishes (`onClosed`).
    const [playerClosing, setPlayerClosing] = useState(false);

    // Escape closes the drawer while it is open — it is the one panel with no
    // visible way out other than its scrim.
    useEffect(() => {
        if (!menu.open) return undefined;
        const onKeyDown = (event) => { if (event.key === 'Escape') menu.hide(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [menu.open, menu.hide]);

    /* --- the visitor's own panels --- */

    // 听歌排行: the visitor's play counts, all time and for the last seven days.
    //
    // `active` is "is that panel up", not "is this hook mounted": the hook lives
    // in the shell, which outlives every panel, so a ranking loaded on mount
    // would be a request every time the app opens. It is owned here rather than
    // inside `StatsPage` for the same reason the cache manager's data is owned
    // by the player — the panel stays a view.
    const playStats = usePlayStats({ qq, active: stats.open });

    // 账号's 数据同步 row: how much of the visitor's own data (plays *and*
    // likes) is still only on this device, and the button that pushes it. Both
    // queues, one row, one button — the visitor does not have two kinds of
    // unsent data, they have unsent data. It is counted while the sheet is up,
    // which is the only moment the row exists, and re-counted whenever the
    // number changes, because confirming one adopts the guest's likes into the
    // outbox (`adoptGuestLikes`).
    const dataSync = useDataSync({ active: account.open, revision: qq });

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
    const closePlayer = useCallback(function () {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setPlayerOpen(false);
            setPlayerClosing(false);
        } else {
            setPlayerClosing(true);
        }
    }, []);

    const finishClosePlayer = useCallback(function () {
        setPlayerOpen(false);
        setPlayerClosing(false);
    }, []);

    // A new tap while the exit animation runs — bring the sheet back.
    const cancelClosePlayer = useCallback(function () {
        setPlayerClosing(false);
    }, []);

    // 听歌排行 lives behind 账号, and 账号 gets out of the way as it opens: the
    // ranking replaces it rather than stacking on top of it. Otherwise the
    // ranking's 收起 button would reveal 账号 — a collapse that uncovers another
    // panel is not a collapse — and the pair would be the two-screen loop this
    // arrangement exists to remove.
    const goStats = useCallback(function () {
        account.hide();
        stats.show();
    }, [account.hide, stats.show]);

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
                {/* The one screen. It used to be one of two tab pages, each in a
                    `.view` wrapper that stayed mounted so its scroll position
                    survived the switch; with 听歌排行 gone to a sheet there is
                    nothing to switch between, so the wrapper — and the
                    `transform` it carried, which is why every panel in this
                    shell had to be rendered outside it — is gone with it. */}
                <TrackList
                    connected={hasLibrary}
                    source={librarySource}
                    listLoading={listLoading}
                    visibleTracks={visibleTracks}
                    search={search}
                    onSearch={setSearch}
                    // 喜欢 is the public library's feature — the Drive
                    // library gets no filter button and no heart — but it is
                    // *not* gated on a QQ number any more: a guest's likes
                    // live in this browser instead of the database, and a
                    // feature that hides itself until you sign up is a
                    // feature most visitors never find.
                    canLike={librarySource !== DRIVE_SOURCE}
                    likedOnly={likedOnly}
                    onToggleLikedOnly={toggleLikedOnly}
                    current={current}
                    loadingId={loadingId}
                    isPlaying={isPlaying}
                    onToggleTrack={toggleTrack}
                    // The empty-library prompt goes straight to the Drive
                    // sheet: it has exactly one useful next step, so it does
                    // not route through the drawer to offer it.
                    onOpenDrive={openDriveSheet}
                    onGoAccount={account.show}
                    onOpenMenu={menu.show}
                    menuOpen={menu.open && !menu.closing}
                    // Drawn as a dot on the mark's corner: the state of the
                    // visitor's number, readable from the list. A boolean
                    // rather than the number itself, because that is the
                    // whole of what the dot has to say.
                    qqBound={Boolean(qq)}
                    rowMenuId={rowMenuId}
                    onOpenRowMenu={openRowMenu}
                />
            </div>

            {/* Mini bar belongs to the song list only — the panels show
                settings, not playback UI. It also carries the jump-to-
                the-playing-track button, which is why it is the one place the
                list's loading state is still needed. */}
            {current && !playerOpen && (
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
                    onClose={closePlayer}
                    onOpenList={closePlayer}
                    lyrics={lyrics}
                    lyricsLoading={lyricsLoading}
                    lyricsVisible={lyricsVisible}
                    onToggleLyrics={toggleLyrics}
                    ripples={ripples}
                    onToggleRipples={toggleRipples}
                />
            )}

            {/* The list's ⋮ drawer, opened from the top bar. It belongs to the
                shell so that on a wide screen it stays centred over the phone
                column instead of hanging off the list.

                Three entries, and they are the ones about *this device and this
                library*: 音乐库 (which songs are here, which folder of them, and
                where they come from — the Drive connection is inside that panel
                rather than a drawer entry of its own, because "connect my own
                drive" and "which library am I on" are one question and the panel
                is where the answer is drawn), 缓存管理 (what of them is stored
                locally), and 切换外观 (how all of it is painted).

                The visitor's own things — the number, the ranking, the sync —
                are behind the app's mark instead, which is the same split the
                panels have. */}
            {menu.open && (
                <div
                    className={menu.closing
                        ? `${styles['menu-scrim']} ${styles['menu-scrim-out']}`
                        : styles['menu-scrim']}
                    role="presentation"
                    onClick={menu.hide}
                    onAnimationEnd={(event) => {
                        // Only the scrim's own fade ends the drawer; the sheet
                        // and its children animate independently.
                        if (menu.closing && event.target === event.currentTarget) menu.finish();
                    }}
                >
                    <div
                        className={menu.closing
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
                            onClick={() => { menu.hide(); profile.show(); }}
                        >
                            <span className={styles['menu-icon']} aria-hidden="true">
                                <IconCloud />
                            </span>
                            <span className={styles['menu-text']}>
                                <span className={styles['menu-title']}>音乐库</span>
                                <span className={styles['menu-sub']}>
                                    当前曲库、文件夹，以及连接自己的云盘
                                </span>
                            </span>
                        </button>
                        <button
                            type="button"
                            className={styles['menu-item']}
                            role="menuitem"
                            onClick={() => { menu.hide(); goCacheManager(); }}
                        >
                            <span className={styles['menu-icon']} aria-hidden="true">
                                <IconArchive size={20} />
                            </span>
                            <span className={styles['menu-text']}>
                                <span className={styles['menu-title']}>缓存管理</span>
                                <span className={styles['menu-sub']}>查看和清理本机缓存的音频</span>
                            </span>
                        </button>
                        {/* 外观 moved here from 账号: it is a property of *this
                            screen*, not of the person listening, and the drawer
                            is the menu about the device. The row wears the icon
                            of the theme it would switch *to*, the same way the
                            row on 账号 did. */}
                        <button
                            type="button"
                            className={styles['menu-item']}
                            role="menuitem"
                            onClick={() => { menu.hide(); toggleTheme(); }}
                        >
                            <span className={styles['menu-icon']} aria-hidden="true">
                                {theme === 'dark' ? <IconSun size={20} /> : <IconMoon size={20} />}
                            </span>
                            <span className={styles['menu-text']}>
                                <span className={styles['menu-title']}>切换外观</span>
                                <span className={styles['menu-sub']}>
                                    {theme === 'dark' ? '现在是深色，切成浅色' : '现在是浅色，切成深色'}
                                </span>
                            </span>
                        </button>
                    </div>
                </div>
            )}

            {/* 账号 — the visitor's own sheet, raised by the app's mark. It is a
                *panel*, not a page: it holds who is listening and what of theirs
                is still on this device, and it is dismissed by the collapse
                button rather than by navigating away. */}
            {account.open && (
                <Account
                    qq={qq}
                    avatarUrl={avatarUrl}
                    onAvatarError={onAvatarError}
                    onSaveQq={saveQq}
                    onGoStats={goStats}
                    // The 数据同步 row's whole data source, as one prop: it
                    // is a single hook's output and this sheet is its only
                    // consumer, unlike the player's eighty fields which
                    // each screen picks a different subset of.
                    dataSync={dataSync}
                    closing={account.closing}
                    onClosed={account.finish}
                    onCancelClose={account.cancel}
                    onClose={account.hide}
                />
            )}

            {/* 听歌排行 — the visitor's plays, as a sheet beside 账号 rather than
                a page behind it. Rendered after 账号 so that, for the moment the
                two overlap (账号 sliding out, this one rising in), the ranking is
                the one on top. */}
            {stats.open && (
                <StatsPage
                    qq={qq}
                    stats={playStats.stats}
                    loading={playStats.loading}
                    error={playStats.error}
                    reload={playStats.reload}
                    onGoAccount={account.show}
                    closing={stats.closing}
                    onClosed={stats.finish}
                    onCancelClose={stats.cancel}
                    onClose={stats.hide}
                />
            )}

            {/* 音乐库 — the library sheet: which library is loaded, which folder of
                it, and the way to connect or switch to the visitor's own Drive.
                Raised from the ⋮ drawer, which is where the library-level entries
                live. The Drive sheet it opens stacks on top of it (it is rendered
                after this one), so closing the connection returns here rather than
                to the list. */}
            {profile.open && (
                <Profile
                    sourceName={sourceName}
                    driveConnected={!!token}
                    folders={folders}
                    folderId={folderId}
                    folderName={folderName}
                    onFolderChange={handleFolderChange}
                    onRefresh={refreshTracks}
                    onOpenDrive={openDriveSheet}
                    loading={listLoading}
                    trackCount={tracks.length}
                    onGoList={profile.hide}
                    closing={profile.closing}
                    onClosed={profile.finish}
                    onCancelClose={profile.cancel}
                    onClose={profile.hide}
                />
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
                            since no row shows a heart.

                            The sub-line says where the like lands, because that
                            is the one thing the visitor cannot see: under a
                            number it goes to the database, without one it stays
                            in this browser. */}
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
                                            : (qq
                                                ? '加入「我喜欢」，按你的 QQ 号保存'
                                                : '加入「我喜欢」，只保存在本机')}
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
                    onGoList={closeDriveSheet}
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
