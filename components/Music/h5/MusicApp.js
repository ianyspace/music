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
    IconGoogleDrive,
    IconHeart,
    IconNote,
    IconPin,
} from '../icons';
import { DRIVE_SOURCE } from '../librarySource';

import styles from './MusicApp.module.scss';

/**
 * A panel that mounts on open and unmounts once its exit animation has run —
 * the shape 缓存管理, 谷歌云盘链接, 账号 and 我的 all share.
 *
 * Three copies of it already existed as player state (`playerOpen` / `cacheOpen`
 * / `driveOpen`, which belong there because the player owns the data behind
 * them). This is the same shape for the three panels *this* shell owns, written
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
 * phone-only UI state — which tab page is showing, which panels are up, and
 * whether the full-screen player is open. All of it lives in this shell rather
 * than the hook because the desktop has no equivalent of any of it, and the
 * panels have to be mounted at this level anyway: the list column sits under a
 * `transform`ed ancestor, which would break `position: fixed` inside it.
 *
 * **Two tab pages and three sheets.** 歌曲 and 听歌排行 are *pages*: places you
 * stay for a while, with a scroll position worth keeping, so both stay mounted
 * and every per-page data hook takes an `active` flag rather than loading on
 * mount. 我的 (the library), 账号 (the visitor), and the ⋮ drawer are *sheets* —
 * they arrive from the bottom edge, over whatever you were looking at, and go
 * away again — which is also why the two settings screens no longer carry a page
 * header with navigation capsules in it: a sheet is dismissed by its own
 * collapse button, and a second row of destinations inside it would be a page
 * pretending to be a panel.
 *
 * The entries: the app's mark (leading end of the list's bar) opens 账号; the ⋮
 * opens the drawer, which holds 音乐库 (我的), 谷歌云盘链接 and 缓存管理. 听歌排行
 * is one row inside 账号 — it is the only thing here that is neither a page you
 * are on nor a panel over one, because a ranking is a destination.
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

    // 'list' | 'stats' — which tab page is showing; the sheets float above it
    // while they are up. Scroll the body back to top whenever the active tab
    // changes, so the visitor does not land in the middle of a page they have
    // never seen. The scroll position of the *hidden* tab is implicitly
    // preserved because its DOM stays mounted and the browser remembers the
    // scroll offset of elements that are removed from layout and later restored.
    const [tab, setTab] = useState('list');
    useEffect(() => {
        // `scrollTo(x, y)` rather than an options object: `behavior: 'instant'`
        // is a newer enum member and an unrecognised value there is a TypeError
        // on older mobile browsers, which would take the whole page down.
        window.scrollTo(0, 0);
    }, [tab]);

    // The three panels this shell owns. They are independent: the drawer opens
    // 音乐库 *and* closes itself, and 账号 can be raised from the list or from
    // 听歌排行.
    const menu = useSheet();
    const account = useSheet();
    const profile = useSheet();

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

    /* --- the visitor's own page --- */

    // 听歌排行: the visitor's play counts, all time and for the last seven days.
    //
    // `active` is "is that page on screen", not "is this component mounted":
    // both tab pages stay mounted so their scroll positions survive (see the
    // note on `tab`), so a ranking loaded on mount would be a request every time
    // the app opens. It is owned here rather than inside `StatsPage` for the
    // same reason the cache manager's data is owned by the player — the page
    // stays a view.
    const playStats = usePlayStats({ qq, active: tab === 'stats' });

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

    // 听歌排行 lives behind 账号, and a sheet cannot stay up while the page it
    // opens is showing: the ranking is a page, so the sheet gets out of the way.
    const goStats = useCallback(function () {
        account.hide();
        setTab('stats');
    }, [account.hide]);

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
                <div
                    className={`${styles.view}${tab === 'stats' ? ` ${styles['view-in']}` : ` ${styles['view-off']}`}`}
                >
                    {/* 听歌排行, one hop from 账号 — which is a sheet, so the
                        button here raises it rather than navigating to it. It is
                        a tab page like 歌曲 rather than a sheet, because it is a
                        place you can stay for a while and scroll, not a modal
                        decision. */}
                    <StatsPage
                        qq={qq}
                        stats={playStats.stats}
                        loading={playStats.loading}
                        error={playStats.error}
                        reload={playStats.reload}
                        onGoAccount={account.show}
                    />
                </div>
            </div>

            {/* Mini bar belongs to the song list only — the other page shows
        settings, not playback UI. It also carries the jump-to-
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

            {/* The list's ⋮ drawer, opened from the top bar. It belongs to the
                shell so that on a wide screen it stays centred over the phone
                column instead of hanging off the list.

                Three entries, and they are the ones about *this device and this
                library*: 音乐库 (which songs are here, and which folder of
                them), 谷歌云盘链接 (where they come from), 缓存管理 (what of them
                is stored locally). The visitor's own things — the number, the
                ranking, the sync, the appearance — are behind the app's mark
                instead, which is the same split the two sheets have. */}
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
                                <span className={styles['menu-sub']}>当前曲库、文件夹和歌曲数</span>
                            </span>
                        </button>
                        <button
                            type="button"
                            className={styles['menu-item']}
                            role="menuitem"
                            onClick={() => { menu.hide(); openDriveSheet(); }}
                        >
                            <span className={styles['menu-icon']} aria-hidden="true">
                                <IconGoogleDrive size={20} />
                            </span>
                            <span className={styles['menu-text']}>
                                <span className={styles['menu-title']}>谷歌云盘链接</span>
                                <span className={styles['menu-sub']}>连接或切换自己的云盘曲库</span>
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
                    </div>
                </div>
            )}

            {/* 账号 — the visitor's own sheet, raised by the app's mark (or by
                the 账号 button on 听歌排行). It is a *panel*, not a page: it
                holds who is listening and what of theirs is still on this
                device, and it is dismissed by the collapse button rather than by
                navigating away. */}
            {account.open && (
                <Account
                    qq={qq}
                    avatarUrl={avatarUrl}
                    onAvatarError={onAvatarError}
                    onSaveQq={saveQq}
                    theme={theme}
                    onToggleTheme={toggleTheme}
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

            {/* 我的 — the library sheet: which library is loaded, which folder of
                it, and the way back to the rows. Raised from the ⋮ drawer, which
                is where the library-level entries live. */}
            {profile.open && (
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
                    onGoList={() => { profile.hide(); setTab('list'); }}
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
