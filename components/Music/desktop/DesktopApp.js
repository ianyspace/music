import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
    normalizeQq,
    parseTrackName,
    storageGet,
    storageSet,
    trackGradient,
    VISUAL_3D_KEY,
    VISUAL_INTENSITIES,
    VISUAL_INTENSITY_KEY,
} from '../shared';
import { attachAnalyser, resumeAnalyser } from '../core/audioAnalyser';
import usePlayer from '../core/usePlayer';
import PageHead from '../core/PageHead';
import PlayerAudio from '../core/PlayerAudio';
import Cover from '../Cover';
import DesktopMusic from './DesktopMusic';
import {
    IconHeart,
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
 *  - the **row drawer** (置顶 / 喜欢). It is rendered here, not in the
 *    list, so it can centre itself over the viewport instead of inside the
 *    scroller. The phone's row drawer holds the same two rows in the same
 *    order — the two layouts teach one behaviour, and that is also why the
 *    state behind them lives in the hook rather than in either layout.
 *  - the **账号 card**, raised by the app's mark at the top of the list column
 *    and centred over the workspace for the same reason. It holds one thing on
 *    this layout: the QQ number. The phone's 账号 sheet is the visitor's whole
 *    panel — the number, 听歌排行 and 数据同步 — and this one deliberately is
 *    not: neither of the other two screens exists here, and a card that carried
 *    a row for a screen it cannot open would be a dead end.
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
        isLiked,
        toggleLike,
        likedOnly,
        toggleLikedOnly,
        qq,
        saveQq,
        avatarUrl,
        onAvatarError,
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

    /* --- the visual effects ------------------------------------------------
     *
     * The two preferences live here rather than in `DesktopMusic` for the same
     * reason the theme does: this shell owns what is stored, and the workspace
     * is a plain view of it.
     *
     * 3D starts **on**. It is the reason the page exists, a visitor who never
     * opens the panel still gets it, and the way to turn it off is one click
     * in the corner. Starting it off would make the feature invisible to
     * everyone who does not go looking.
     */
    const [visual3d, setVisual3d] = useState(true);
    const [visualIntensity, setVisualIntensity] = useState('standard');
    // Read back after mount, never in the initialiser: this is a static export,
    // so a `useState` that touched localStorage would also run on the build
    // machine and hand the browser markup that disagrees with what it reads.
    // One effect restores both and writes both, so the two cannot race — a
    // read-effect plus a write-effect would, because effects run in
    // declaration order and the writer would still see the default.
    const visualSyncedRef = useRef(false);
    useEffect(() => {
        if (!visualSyncedRef.current) {
            visualSyncedRef.current = true;
            const saved3d = storageGet(VISUAL_3D_KEY);
            if (saved3d === 'off') setVisual3d(false);
            else if (saved3d === 'on') setVisual3d(true);
            const savedIntensity = storageGet(VISUAL_INTENSITY_KEY);
            if (VISUAL_INTENSITIES.includes(savedIntensity)) setVisualIntensity(savedIntensity);
            return;
        }
        storageSet(VISUAL_3D_KEY, visual3d ? 'on' : 'off');
        storageSet(VISUAL_INTENSITY_KEY, visualIntensity);
    }, [visual3d, visualIntensity]);

    // --- the spectrum -------------------------------------------------------
    //
    // Built on the first play, not on mount. Two reasons, and either alone
    // would be enough: an `AudioContext` created before any gesture starts
    // `suspended`, and *routing* the element through a suspended context mutes
    // it — the graph takes the audio out of the normal output path and only
    // gives it back at `destination`. And building it at all is a cost nobody
    // who left the switch off should pay.
    //
    // `isPlaying` only ever becomes true from a click, so this runs inside the
    // gesture's sticky activation and `resume()` is allowed to work.
    const [analyser, setAnalyser] = useState(null);
    useEffect(() => {
        if (!visual3d || !isPlaying) return;
        const element = audioRef.current;
        if (!element) return;
        const node = attachAnalyser(element);
        if (!node) return;
        resumeAnalyser();
        setAnalyser(node);
    }, [visual3d, isPlaying, audioRef]);

    /* --- 账号, the one card this shell raises over the workspace ---------- */

    const [accountOpen, setAccountOpen] = useState(false);
    const [accountClosing, setAccountClosing] = useState(false);

    const openAccount = useCallback(function () {
        setAccountClosing(false);
        setAccountOpen(true);
    }, []);

    // The same shape as the row drawer's own close, including the reduced-motion
    // branch: with animations disabled no `animationend` ever arrives, so the
    // card has to unmount here instead of waiting for one.
    const closeAccount = useCallback(function () {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setAccountOpen(false);
            setAccountClosing(false);
            return;
        }
        setAccountClosing(true);
    }, []);

    // Escape closes it, exactly like the row drawer. It is the one card with no
    // visible way out other than its scrim.
    useEffect(() => {
        if (!accountOpen) return undefined;
        const onKeyDown = (event) => { if (event.key === 'Escape') closeAccount(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [accountOpen, closeAccount]);

    // The field is a draft, not the setting: nothing is stored until 确认, so a
    // half-typed number never becomes the avatar. It follows the stored value
    // when that changes elsewhere (a clear, a second tab), which is why it is an
    // effect rather than an initial value only. Same two rules as the phone's
    // 账号 sheet, and the same `normalizeQq` — the number is one thing, and two
    // entry points that disagreed about what a number *is* would be a bug.
    const [qqDraft, setQqDraft] = useState(qq);
    const [qqInvalid, setQqInvalid] = useState(false);

    useEffect(() => { setQqDraft(qq); }, [qq]);

    const submitQq = function (event) {
        event.preventDefault();
        const digits = normalizeQq(qqDraft);
        if (!digits) {
            setQqInvalid(true);
            return;
        }
        setQqInvalid(false);
        saveQq(digits);
    };

    const clearQq = function () {
        setQqDraft('');
        setQqInvalid(false);
        saveQq('');
    };

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
                likedOnly={likedOnly}
                onToggleLikedOnly={toggleLikedOnly}
                isLiked={isLiked}
                qqBound={Boolean(qq)}
                onOpenAccount={openAccount}
                visual3d={visual3d}
                visualIntensity={visualIntensity}
                analyser={analyser}
                onToggleVisual3d={() => setVisual3d((on) => !on)}
                onChooseVisualIntensity={setVisualIntensity}
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
                        {/* 喜欢 sits under 置顶 because that is the order of what
                            it does to the song: arranges it, then keeps it. The
                            label carries the current state rather than reading
                            喜欢 either way — this card is where the visitor
                            finds out whether a song is already liked, since no
                            row shows a heart.

                            The sub-line says where the like lands, which is the
                            one thing the visitor cannot see: under a number it
                            goes to the database, without one it stays in this
                            browser. Same two sentences as the phone's drawer,
                            because it is the same fact.

                            No source check: the phone hides this row for a
                            Drive track (a cloud file id means nothing outside
                            that account), and this layout only ever plays the
                            public library, so that test can never be false
                            here. */}
                        <button
                            type="button"
                            className={styles.item}
                            role="menuitem"
                            onClick={() => {
                                toggleLike(rowMenu);
                                closeRowMenu();
                            }}
                        >
                            <span className={styles['item-icon']} aria-hidden="true">
                                <IconHeart size={18} filled={isLiked(rowMenu)} />
                            </span>
                            <span className={styles['item-text']}>
                                <span className={styles['item-title']}>
                                    {isLiked(rowMenu) ? '取消喜欢' : '喜欢'}
                                </span>
                                <span className={styles['item-sub']}>
                                    {isLiked(rowMenu)
                                        ? '从「我喜欢」里移出'
                                        : (qq
                                            ? '加入「我喜欢」，按你的 QQ 号保存'
                                            : '加入「我喜欢」，只保存在本机')}
                                </span>
                            </span>
                        </button>
                    </div>
                </div>
            )}

            {/* 账号 — raised by the app's mark at the top of the list column.
                The same centred card as the row drawer above, because on a wide
                screen that *is* this layout's dialog: the phone's version rises
                from the bottom edge, which here would be nowhere near the thing
                that opened it.

                One block, two states, exactly like the phone's card: with a
                number it is the identity card (avatar, the number, what the
                number is for) and a 清除 button on it; without one it is the
                field, 确认 and the hint. They are never both on screen — the
                same question ("is my number in?") used to have two
                half-answers at once, which is why the phone's version was
                rewritten this way and why this one starts out that way. */}
            {accountOpen && (
                <div
                    className={accountClosing
                        ? `${styles.scrim} ${styles['scrim-out']}`
                        : styles.scrim}
                    role="presentation"
                    onClick={closeAccount}
                    onAnimationEnd={(event) => {
                        // Only the scrim's own fade ends the card; the card and
                        // its children animate independently.
                        if (accountClosing && event.target === event.currentTarget) {
                            setAccountOpen(false);
                            setAccountClosing(false);
                        }
                    }}
                >
                    <div
                        className={accountClosing
                            ? `${styles.card} ${styles['card-out']}`
                            : styles.card}
                        role="dialog"
                        aria-modal="true"
                        aria-label="账号"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <h2 className={styles['card-title']}>账号</h2>
                        {qq ? (
                            <div className={styles.identity}>
                                <span className={styles['identity-avatar']}>
                                    {avatarUrl ? (
                                        <img src={avatarUrl} alt="" onError={onAvatarError} />
                                    ) : (
                                        <IconNote filled />
                                    )}
                                </span>
                                <span className={styles['identity-text']}>
                                    <span className={styles['identity-name']}>{`QQ ${qq}`}</span>
                                    {/* Two things, said plainly: where the
                                        picture came from, and what the number
                                        is *for*. A number whose picture did not
                                        arrive admits it, otherwise the note
                                        disc looks like the app ignored what was
                                        just typed. */}
                                    <span className={styles['identity-sub']}>
                                        {avatarUrl
                                            ? '头像来自 QQ 的公开头像接口；喜欢和听歌次数都记在这个号码下'
                                            : 'QQ 头像暂时取不到，先用默认音符；喜欢和听歌次数仍记在这个号码下'}
                                    </span>
                                </span>
                                <button
                                    type="button"
                                    className={styles['identity-clear']}
                                    onClick={clearQq}
                                >
                                    清除
                                </button>
                            </div>
                        ) : (
                            <form className={styles['qq-form']} onSubmit={submitQq}>
                                <label className={styles['qq-label']} htmlFor="desktop-qq">QQ 号</label>
                                <div className={styles['qq-row']}>
                                    <input
                                        id="desktop-qq"
                                        className={styles['qq-input']}
                                        type="text"
                                        inputMode="numeric"
                                        autoComplete="off"
                                        placeholder="输入 QQ 号"
                                        aria-label="QQ 号"
                                        value={qqDraft}
                                        onChange={(event) => {
                                            setQqDraft(event.target.value);
                                            setQqInvalid(false);
                                        }}
                                    />
                                    <button type="submit" className={styles['qq-save']}>确认</button>
                                </div>
                                <p className={`${styles.hint}${qqInvalid ? ` ${styles['hint-bad']}` : ''}`}>
                                    {qqInvalid
                                        ? 'QQ 号是 5–11 位数字，再看一眼？'
                                        : '5–11 位数字，保存在这台设备的浏览器里。确认之后喜欢和听歌次数都按这个号码记录，换设备也能看到。'}
                                </p>
                            </form>
                        )}
                    </div>
                </div>
            )}

            {(error || notice) && (
                <div className={`${styles.toast}${error ? ` ${styles['toast-error']}` : ''}`} role="status">
                    {error || notice}
                </div>
            )}

            {/* `crossOrigin` is safe here and only here: `/desktop` plays the
                public R2 library, whose bucket answers with the request's own
                `Origin`. The phone layout passes nothing, because its library
                can be a visitor's own Drive folder and those files are served
                without CORS — asking for it there would fail the load. */}
            <PlayerAudio
                audioRef={audioRef}
                crossOrigin="anonymous"
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
