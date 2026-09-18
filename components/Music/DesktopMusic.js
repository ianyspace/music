import React, { useEffect, useRef, useState } from 'react';

import {
    IconClose,
    IconFolder,
    IconGear,
    IconLogout,
    IconMoon,
    IconNext,
    IconNote,
    IconPause,
    IconPlay,
    IconPrev,
    IconRefresh,
    IconRepeat,
    IconRepeatOne,
    IconSearch,
    IconShuffle,
    IconSun,
} from './icons';
import { formatTime, parseTrackName } from './shared';

import styles from './DesktopMusic.module.scss';

/**
 * Wide-screen (tablet / desktop) music workspace, used by `/desktop`.
 *
 * Layout: the song list sits on the left, the whole middle column is the
 * lyric player — cover disc on top, then metadata, then the scrolling lyrics —
 * and the transport bar is docked at the bottom of that column. Everything
 * that needs Google (source switch, Drive connection, folder, theme) lives
 * behind the single gear button in the top-right corner.
 *
 * Liquid Glass is used on exactly three surfaces: the gear button, the cover
 * disc and the bottom bar. Everything else is flat, which keeps the minimal
 * look and spares the WebGL compositor. Note the library's constraint: glass
 * elements must be *direct children* of the root, which is why these three are
 * positioned with grid areas instead of being nested in wrappers.
 */
// Glass configuration follows the examples published on
// https://liquid-glass.ybouane.com and nothing else — "Frosted Panel"
// (`{ blurAmount: 0.25, cornerRadius: 30 }`) and "Button Mode"
// (`{ button: true, cornerRadius: 24 }`). No hand-invented parameter combos,
// and no extra CSS pretending to be glass: anything the library owns
// (refraction, bevel, shadow, corner radius) is left to its own config.
const SETTINGS_GLASS = JSON.stringify({ button: true, cornerRadius: 27, blurAmount: 0.25 });
// Same preset, at the radius that makes the cover disc a circle (224px wide).
const DISC_GLASS = JSON.stringify({ button: true, cornerRadius: 112, blurAmount: 0.25 });
const BAR_GLASS = JSON.stringify({ blurAmount: 0.25, cornerRadius: 30 });

const DesktopMusic = function ({
    theme,
    onToggleTheme,
    connected,
    sourceName,
    hasLibrary,
    gsiReady,
    clientIdDraft,
    onClientIdDraft,
    onConnect,
    onDisconnect,
    folders,
    folderId,
    folderName,
    onFolderChange,
    onRefresh,
    listLoading,
    tracks,
    visibleTracks,
    search,
    onSearch,
    current,
    loadingId,
    isPlaying,
    onToggleTrack,
    onTogglePlay,
    onPrev,
    onNext,
    onSeek,
    progress,
    shuffle,
    repeat,
    onToggleShuffle,
    onCycleRepeat,
    lyrics,
    lyricsLoading,
    lyricsVisible,
}) {
    const rootRef = useRef(null);
    const activeLyricRef = useRef(null);
    const [glassReady, setGlassReady] = useState(false);
    const [glassFailed, setGlassFailed] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);

    useEffect(() => {
        let instance;
        let cancelled = false;
        if (!rootRef.current) return undefined;
        (async function initGlass() {
            try {
                const module = await import('@ybouane/liquidglass');
                if (cancelled || !rootRef.current) return;
                instance = await module.LiquidGlass.init({
                    root: rootRef.current,
                    glassElements: rootRef.current.querySelectorAll('[data-glass]'),
                });
                if (!cancelled) setGlassReady(true);
            } catch (err) {
                if (!cancelled) setGlassFailed(true);
            }
        }());
        return () => {
            cancelled = true;
            if (instance && typeof instance.destroy === 'function') instance.destroy();
        };
    }, []);

    const meta = current ? parseTrackName(current.track.name) : null;
    const title = meta ? meta.title : '还没有播放中的歌曲';
    const artist = meta ? meta.artist : sourceName;
    const percent = progress.duration > 0 ? Math.min(100, (progress.time / progress.duration) * 100) : 0;
    const activeLyric = lyrics && lyrics.timed
        ? lyrics.lines.reduce((index, line, lineIndex) => (line.time <= progress.time ? lineIndex : index), -1)
        : -1;
    const showLyrics = Boolean(lyrics) && lyricsVisible;

    useEffect(() => {
        if (activeLyric >= 0 && activeLyricRef.current) {
            activeLyricRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }, [activeLyric]);

    useEffect(() => {
        if (!settingsOpen) return undefined;
        const onKeyDown = (event) => { if (event.key === 'Escape') setSettingsOpen(false); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [settingsOpen]);

    return (
        <div
            ref={rootRef}
            className={`${styles.root} ${theme === 'dark' ? styles['theme-dark'] : ''} ${glassFailed ? styles['glass-fallback'] : ''}`}
        >
            {/* Sampled by the glass shader; the root's own background is not. */}
            <div className={styles.backdrop} aria-hidden="true" />

            <aside className={styles.sidebar}>
                <header className={styles['side-head']}>
                    <div className={styles['side-title']}>
                        <h1>音乐</h1>
                        <p>{sourceName} · {listLoading ? '同步中…' : `${tracks.length} 首`}</p>
                    </div>
                    <button
                        type="button"
                        className={`${styles['ghost-btn']}${listLoading ? ` ${styles.spin}` : ''}`}
                        title="刷新列表"
                        aria-label="刷新列表"
                        disabled={listLoading}
                        onClick={onRefresh}
                    >
                        <IconRefresh />
                    </button>
                </header>

                <label className={styles.search}>
                    <IconSearch />
                    <input
                        type="search"
                        value={search}
                        onChange={(event) => onSearch(event.target.value)}
                        placeholder="搜索歌曲或歌手"
                        aria-label="搜索歌曲或歌手"
                    />
                </label>

                {visibleTracks.length === 0 ? (
                    <p className={styles['list-empty']}>
                        {hasLibrary ? '没有匹配的歌曲' : '曲库还没有歌曲，右侧设置里可以连接自己的云盘'}
                    </p>
                ) : (
                    <ul className={styles.list}>
                        {visibleTracks.map((track) => {
                            const item = parseTrackName(track.name);
                            const active = current && current.track.id === track.id;
                            return (
                                <li key={track.id}>
                                    <button
                                        type="button"
                                        className={`${styles.item}${active ? ` ${styles['item-active']}` : ''}`}
                                        disabled={loadingId === track.id}
                                        onClick={() => onToggleTrack(track)}
                                    >
                                        <span className={styles['item-text']}>
                                            <span className={styles['item-title']}>{item.title}</span>
                                            <span className={styles['item-artist']}>{item.artist}</span>
                                        </span>
                                        {loadingId === track.id
                                            ? <span className={`${styles['item-flag']} ${styles.spin}`}>◌</span>
                                            : active && isPlaying
                                                ? <span className={styles['item-flag']}>♪</span>
                                                : null}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </aside>

            {/* 1/3 — settings entry, top-right */}
            <button
                type="button"
                className={styles['settings-btn']}
                data-glass
                data-config={SETTINGS_GLASS}
                onClick={() => setSettingsOpen(true)}
                aria-label="打开设置"
                title="设置"
            >
                <IconGear />
            </button>

            {/* 2/3 — cover disc */}
            <button
                type="button"
                className={styles.disc}
                data-glass
                data-config={DISC_GLASS}
                onClick={onTogglePlay}
                disabled={!current}
                aria-label={isPlaying ? '暂停' : '播放'}
                title={isPlaying ? '暂停' : '播放'}
            >
                <span className={styles['disc-icon']}>
                    {!current ? <IconNote /> : isPlaying ? <IconPause /> : <IconPlay />}
                </span>
            </button>

            {/* 3/3 — lyrics stage (flat) */}
            <section className={styles.stage}>
                <div className={styles.meta}>
                    <h2 className={styles['meta-title']}>{title}</h2>
                    <p className={styles['meta-artist']}>{artist}</p>
                </div>

                {showLyrics ? (
                    <div className={styles.lyrics} aria-label="歌词">
                        {lyrics.lines.map((line, index) => (
                            <p
                                key={`${line.time}-${index}`}
                                ref={index === activeLyric ? activeLyricRef : null}
                                className={index === activeLyric ? styles['lyric-active'] : styles.lyric}
                            >
                                {line.text}
                            </p>
                        ))}
                    </div>
                ) : (
                    <p className={styles['lyrics-empty']}>
                        {lyricsLoading ? '歌词加载中…' : lyrics ? '歌词已隐藏' : '这首歌没有歌词'}
                    </p>
                )}
            </section>

            {/* 3/3 — bottom transport bar */}
            <div className={styles.bar} data-glass data-config={BAR_GLASS}>
                <input
                    className={styles.seek}
                    type="range"
                    min={0}
                    max={progress.duration || 1}
                    step={0.1}
                    value={Math.min(progress.time, progress.duration || 1)}
                    disabled={!current || !progress.duration}
                    onChange={(event) => onSeek(Number(event.target.value))}
                    style={{ '--fill': `${percent}%` }}
                    aria-label="播放进度"
                />
                <div className={styles['bar-row']}>
                    <span className={styles.time}>{formatTime(progress.time)}</span>
                    <div className={styles.controls}>
                        <button
                            type="button"
                            className={`${styles['ctrl-btn']}${shuffle ? ` ${styles['ctrl-on']}` : ''}`}
                            onClick={onToggleShuffle}
                            title="随机播放"
                            aria-pressed={shuffle}
                        >
                            <IconShuffle />
                        </button>
                        <button type="button" className={styles['ctrl-btn']} onClick={onPrev} title="上一首">
                            <IconPrev />
                        </button>
                        <button
                            type="button"
                            className={styles['ctrl-play']}
                            onClick={onTogglePlay}
                            disabled={!current}
                            title={isPlaying ? '暂停' : '播放'}
                        >
                            {isPlaying ? <IconPause /> : <IconPlay />}
                        </button>
                        <button type="button" className={styles['ctrl-btn']} onClick={onNext} title="下一首">
                            <IconNext />
                        </button>
                        <button
                            type="button"
                            className={`${styles['ctrl-btn']}${repeat !== 'off' ? ` ${styles['ctrl-on']}` : ''}`}
                            onClick={onCycleRepeat}
                            title={repeat === 'one' ? '单曲循环' : repeat === 'all' ? '列表循环' : '循环关闭'}
                            aria-pressed={repeat !== 'off'}
                        >
                            {repeat === 'one' ? <IconRepeatOne /> : <IconRepeat />}
                        </button>
                    </div>
                    <span className={styles.time}>{formatTime(progress.duration)}</span>
                </div>
            </div>

            {settingsOpen && (
                <div className={styles['settings-scrim']} onClick={() => setSettingsOpen(false)} role="presentation">
                    <div
                        className={styles.settings}
                        role="dialog"
                        aria-modal="true"
                        aria-label="设置"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <header className={styles['settings-head']}>
                            <h2>设置</h2>
                            <button
                                type="button"
                                className={styles['ghost-btn']}
                                onClick={() => setSettingsOpen(false)}
                                aria-label="关闭设置"
                            >
                                <IconClose />
                            </button>
                        </header>

                        <section className={styles.group}>
                            <div className={styles['group-label']}>当前曲库</div>
                            <div className={styles['source-row']}>
                                <span className={styles['source-name']}>{connected ? '我的 Google 云盘' : sourceName}</span>
                                <span className={styles['source-sub']}>{folderName} · {tracks.length} 首</span>
                            </div>
                        </section>

                        {connected ? (
                            <section className={styles.group}>
                                <div className={styles['group-label']}>我的云盘</div>
                                <label className={styles.row} htmlFor="desktop-folder">
                                    <IconFolder />
                                    <span className={styles['row-label']}>文件夹</span>
                                    <select
                                        id="desktop-folder"
                                        className={styles['row-select']}
                                        value={folderId}
                                        onChange={onFolderChange}
                                    >
                                        <option value="">整个云盘</option>
                                        {folders.map((folder) => (
                                            <option key={folder.id} value={folder.id}>{folder.name}</option>
                                        ))}
                                    </select>
                                </label>
                                <button type="button" className={`${styles.row} ${styles['row-btn']}`} onClick={onDisconnect}>
                                    <IconLogout />
                                    <span className={styles['row-label']}>断开连接，回到公共曲库</span>
                                </button>
                            </section>
                        ) : (
                            <section className={styles.group}>
                                <div className={styles['group-label']}>连接自己的云盘（可选）</div>
                                <p className={styles.hint}>
                                    默认播放公共曲库，不需要任何授权。填入 Google OAuth 客户端 ID
                                    连接后，会改用你自己云盘里的歌曲。
                                </p>
                                <input
                                    className={styles.input}
                                    type="text"
                                    value={clientIdDraft}
                                    onChange={(event) => onClientIdDraft(event.target.value)}
                                    placeholder="粘贴 OAuth 客户端 ID"
                                    aria-label="Google OAuth 客户端 ID"
                                />
                                <button
                                    type="button"
                                    className={styles['primary-btn']}
                                    onClick={onConnect}
                                    disabled={!gsiReady}
                                >
                                    {gsiReady ? '连接 Google 云盘' : '正在加载 Google 组件…'}
                                </button>
                            </section>
                        )}

                        <section className={styles.group}>
                            <div className={styles['group-label']}>外观</div>
                            <button type="button" className={`${styles.row} ${styles['row-btn']}`} onClick={onToggleTheme}>
                                {theme === 'dark' ? <IconSun /> : <IconMoon />}
                                <span className={styles['row-label']}>
                                    {theme === 'dark' ? '切换到浅色' : '切换到深色'}
                                </span>
                            </button>
                        </section>

                        <p className={styles.footnote}>
                            {glassReady ? '液态玻璃已启用' : glassFailed ? '液态玻璃不可用，已回退为普通样式' : '正在初始化液态玻璃…'}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DesktopMusic;
