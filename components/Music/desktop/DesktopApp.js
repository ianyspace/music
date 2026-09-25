import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
    normalizeQq,
    parseTrackName,
} from '../shared';
import usePlayer from '../core/usePlayer';
import PageHead from '../core/PageHead';
import PlayerAudio from '../core/PlayerAudio';
import Cover from '../Cover';
import ImmersiveApp from './immersive/ImmersiveApp';
import {
    IconNote,
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
 * Since the immersive redesign, this shell is thin on purpose. The page the
 * visitor sees is `ImmersiveApp` — the full-viewport nebula with floating
 * glass — and every preference *it* owns (background, intensity, filter,
 * volume, the panel's fold) is stored and restored inside that component,
 * beside the features they belong to. What is left here is what belongs to
 * *no* layout and has to be mounted above one:
 *
 *  - the **token root**. `DesktopApp.module.scss` declares the desktop palette
 *    and the `--glass-*` recipe. Dark-only, no theme switch.
 *  - the **账号 card**, centred over the viewport — raised by the mark at the
 *    top of the immersive playlist panel. It holds one thing on this layout:
 *    the QQ number. The phone's 账号 sheet is the visitor's whole panel, and
 *    this one deliberately is not: neither of its other screens exists here.
 *
 * What this layout deliberately does not have (unchanged by the redesign):
 * the Google Drive library — `/desktop` plays the public library, full stop —
 * and the cache manager's screen; audio caching itself is untouched and still
 * shared with the phone.
 */
const DesktopApp = function () {
    const {
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
        error,
        notice,
        audioRef,
        onEnded,
        onPlay,
        onPause,
        onTimeUpdate,
        onMetadata,
    } = usePlayer({ lyricsAutoOpen: true, drive: false });

    /* --- 账号, the one card this shell raises over the page --------------- */

    const [accountOpen, setAccountOpen] = useState(false);
    const [accountClosing, setAccountClosing] = useState(false);

    const openAccount = useCallback(function () {
        setAccountClosing(false);
        setAccountOpen(true);
    }, []);

    // The same shape as the immersive settings' close: with animations
    // disabled no `animationend` ever arrives, so the card unmounts here
    // instead of waiting for one.
    const closeAccount = useCallback(function () {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setAccountOpen(false);
            setAccountClosing(false);
            return;
        }
        setAccountClosing(true);
    }, []);

    useEffect(() => {
        if (!accountOpen) return undefined;
        const onKeyDown = (event) => { if (event.key === 'Escape') closeAccount(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [accountOpen, closeAccount]);

    // The field is a draft, not the setting: nothing is stored until 确认, so
    // a half-typed number never becomes the avatar. It follows the stored
    // value when that changes elsewhere (a clear, a second tab).
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

            <ImmersiveApp
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
                likedOnly={likedOnly}
                onToggleLikedOnly={toggleLikedOnly}
                isLiked={isLiked}
                onToggleLike={toggleLike}
                qqBound={Boolean(qq)}
                onOpenAccount={openAccount}
                audioRef={audioRef}
            />

            {/* 账号 — raised by the mark at the top of the immersive playlist
                panel, centred over the page for the same reason the row drawer
                used to be: on a wide screen a fixed card *is* this layout's
                dialog. */}
            {accountOpen && (
                <div
                    className={accountClosing
                        ? `${styles.scrim} ${styles['scrim-out']}`
                        : styles.scrim}
                    role="presentation"
                    onClick={closeAccount}
                    onAnimationEnd={(event) => {
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
