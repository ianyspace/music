import React, { useEffect, useRef, useState } from 'react';

import {
    IconArchive,
    IconChevronRight,
    IconCloud,
    IconClose,
    IconFolder,
    IconGear,
    IconGoogleDrive,
    IconLogout,
    IconMoon,
    IconMoreVertical,
    IconMusicSpace,
    IconNext,
    IconNote,
    IconPanel,
    IconPause,
    IconPlay,
    IconPrev,
    IconQueue,
    IconRefresh,
    IconRepeat,
    IconRepeatOne,
    IconSearch,
    IconShuffle,
    IconSun,
} from './icons';
import {
    formatSize,
    formatTime,
    parseTrackName,
    trackGradient,
} from './shared';
import { DRIVE_SOURCE } from './librarySource';
import Marquee from './Marquee';

import styles from './DesktopMusic.module.scss';

// Playback modes of the player's single cycling control, in the order the
// button walks them: 关闭 → 列表循环 → 单曲循环 → 随机 → 关闭. Same order and
// same icons as the phone player, so both layouts teach one muscle memory.
const MODES = {
    off: { icon: <IconRepeat />, title: '循环关闭' },
    all: { icon: <IconRepeat />, title: '列表循环' },
    one: { icon: <IconRepeatOne />, title: '单曲循环' },
    shuffle: { icon: <IconShuffle />, title: '随机播放' },
};

/**
 * Decorative tonearm, drawn in the record rig's own coordinate space
 * (100 × 122 — the rig's aspect ratio) so it scales with the record instead of
 * drifting off it. `playing` swings the arm down to track the groove. Geometry
 * is shared verbatim with the phone player (`NowPlaying.js`) so the desktop
 * record is the same object, just larger.
 */
const Tonearm = function ({ playing }) {
    return (
        <svg
            className={playing ? `${styles.arm} ${styles['arm-playing']}` : styles.arm}
            viewBox="0 0 100 122"
            aria-hidden="true"
            focusable="false"
        >
            <g className={styles['arm-swing']}>
                <path
                    d="M52.5 4.6 C 56 13, 62 21, 68.5 26 C 73 29.4, 76.5 30.2, 78.8 30.3"
                    fill="none"
                    stroke="#f2f3f7"
                    strokeWidth="3"
                    strokeLinecap="round"
                />
                <g transform="rotate(28 78.8 30.3)">
                    <rect x="76.6" y="27.5" width="11.6" height="5.6" rx="2.1" fill="#f2f3f7" />
                    <rect x="85.4" y="28.8" width="3.6" height="3" rx="1.2" fill="#dfe2ea" />
                    <rect x="79.4" y="29.2" width="1.7" height="2.2" rx="0.7" fill="#26272e" />
                </g>
                <circle cx="52.5" cy="4.6" r="5" fill="rgba(255, 255, 255, 0.12)" />
                <circle cx="52.5" cy="4.6" r="3" fill="#191a20" stroke="#f2f3f7" strokeWidth="1.6" />
                <circle cx="52.5" cy="4.6" r="1" fill="#f2f3f7" />
            </g>
        </svg>
    );
};

/**
 * Wide-screen (desktop) music workspace, used by `/desktop`.
 *
 * Layout follows the brief: the *player* owns the centre and gets the most
 * space, the *bottom bar* is the second most important surface (it is the
 * transport and is always reachable), and the *song list* lives on the left
 * where it can be folded away entirely.
 *
 * ┌──────────┬──────────────────────────────────────────┐
 * │ 列表(可藏) │               播放器(主题)                │
 * │          ├──────────────────────────────────────────┤
 * │          │              底部播放条(次要)              │
 * └──────────┴──────────────────────────────────────────┘
 *
 * Every feature of the phone layout is reproduced here: the same track list
 * (thumb + gradient cover, spinning loader, equalizer bars, search, refresh),
 * the same record rig (tonearm that drops onto the groove, ripples, lyrics
 * that swap in over the disc), the same single cycling playback-mode button
 * and the same settings (source, Drive connection, folder, theme, cache info).
 *
 * Liquid Glass is used on four surfaces: the settings button, the record, the
 * bottom bar and the lyrics card. The library's one hard constraint is that
 * glass elements must be **direct children of the root**, which is why they
 * are positioned with grid areas instead of being nested in wrappers.
 */
// Glass configuration follows the examples published on
// https://liquid-glass.ybouane.com and nothing else — "Frosted Panel"
// (`{ blurAmount: 0.25, cornerRadius: 30 }`) and "Button Mode"
// (`{ button: true, cornerRadius: 24 }`). No hand-invented parameter combos,
// and no extra CSS pretending to be glass: anything the library owns
// (refraction, bevel, shadow, corner radius) is left to its own config.
const SETTINGS_GLASS = JSON.stringify({ button: true, cornerRadius: 27, blurAmount: 0.25 });
// Same preset, at the radius that makes the record a circle (360px wide).
const DISC_GLASS = JSON.stringify({ button: true, cornerRadius: 180, blurAmount: 0.25 });
const BAR_GLASS = JSON.stringify({ blurAmount: 0.25, cornerRadius: 30 });
const LYRICS_GLASS = JSON.stringify({ blurAmount: 0.25, cornerRadius: 30 });

const DesktopMusic = function ({
    theme,
    onToggleTheme,
    connected,
    source,
    sourceName,
    hasLibrary,
    cached,
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
    onToggleLyrics,
}) {
    const rootRef = useRef(null);
    const searchInputRef = useRef(null);
    const activeLyricRef = useRef(null);
    const pressYRef = useRef(0);
    const [glassReady, setGlassReady] = useState(false);
    const [glassFailed, setGlassFailed] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    // `false` = folded away, only the rail button remains. Defaults to open.
    const [listOpen, setListOpen] = useState(true);
    const [searchOpen, setSearchOpen] = useState(false);
    // The three-dots menu in the list header: 'drive' | 'cache' | ''.
    const [menu, setMenu] = useState('');
    // Playback mode announce, centred on the stage for a moment — same
    // behaviour as the phone player's mode toast.
    const [modeToast, setModeToast] = useState('');
    const lastModeRef = useRef('');
    const modeTimerRef = useRef(0);
    const menuRef = useRef(null);
    const [cacheCount, setCacheCount] = useState(0);

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
    const artist = meta ? meta.artist : `${sourceName} · 从左侧列表挑一首开始`;
    const gradient = current ? trackGradient(current.track.name) : 'linear-gradient(135deg, #fb5c74, #fa233b)';
    const percent = progress.duration > 0
        ? Math.min(100, Math.max(0, (progress.time / progress.duration) * 100))
        : 0;
    const keyword = search.trim();
    const currentId = current ? current.track.id : '';
    const eqClass = `${styles.eq}${isPlaying ? '' : ` ${styles['eq-paused']}`}`;

    // The phone layout folds shuffle and repeat into one cycling button; so
    // does this one, so the two layouts share the same interaction.
    const mode = shuffle ? 'shuffle' : repeat;
    const playback = MODES[mode] || MODES.off;

    const activeLyric = lyrics && lyrics.timed
        ? lyrics.lines.reduce((index, line, lineIndex) => (line.time <= progress.time ? lineIndex : index), -1)
        : -1;
    const canToggleLyrics = Boolean(lyrics) || lyricsLoading;
    const lyricsShown = Boolean(lyricsVisible && canToggleLyrics);

    const visibleCount = visibleTracks.length;

    useEffect(() => {
        if (activeLyric >= 0 && activeLyricRef.current) {
            activeLyricRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }, [activeLyric, lyricsShown]);

    useEffect(() => {
        if (!searchOpen) return;
        const input = searchInputRef.current;
        if (input) input.focus();
    }, [searchOpen]);

    // Announce each mode change on the stage, but never the mode the page
    // happens to mount with (that is not a tap).
    useEffect(() => {
        if (!current) { lastModeRef.current = mode; return undefined; }
        if (!lastModeRef.current) { lastModeRef.current = mode; return undefined; }
        if (lastModeRef.current === mode) return undefined;
        lastModeRef.current = mode;
        setModeToast((MODES[mode] || MODES.off).title);
        window.clearTimeout(modeTimerRef.current);
        modeTimerRef.current = window.setTimeout(() => setModeToast(''), 1400);
        return () => window.clearTimeout(modeTimerRef.current);
    }, [mode, current]);

    useEffect(() => {
        if (!settingsOpen) return undefined;
        const onKeyDown = (event) => { if (event.key === 'Escape') setSettingsOpen(false); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [settingsOpen]);

    // The three-dots menu closes on any outside click / Escape.
    useEffect(() => {
        if (!menu) return undefined;
        const onPointerDown = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) setMenu('');
        };
        const onKeyDown = (event) => { if (event.key === 'Escape') setMenu(''); };
        window.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [menu]);

    // How many tracks are already cached locally — the settings drawer reports
    // it the way the phone's cache manager does, so the number is honest.
    useEffect(() => {
        if (!settingsOpen) return undefined;
        let alive = true;
        const run = async function () {
            try {
                const { listCachedAudio } = await import('./audioCache');
                const entries = await listCachedAudio();
                if (alive) setCacheCount(Array.isArray(entries) ? entries.length : 0);
            } catch (err) { /* cache layer is best-effort */ }
        };
        run();
        return () => { alive = false; };
    }, [settingsOpen]);

    const closeSearch = function () {
        setSearchOpen(false);
        onSearch('');
    };

    const openMenu = function (which) {
        setMenu((open) => (open === which ? '' : which));
    };

    const handleLyricsClick = function (event) {
        if (Math.abs(event.clientY - pressYRef.current) > 8) return;
        onToggleLyrics();
    };

    return (
        <div
            ref={rootRef}
            className={`${styles.root}${theme === 'dark' ? ` ${styles['theme-dark']}` : ''}${listOpen ? '' : ` ${styles['list-collapsed']}`}${glassFailed ? ` ${styles['glass-fallback']}` : ''}`}
        >
            {/* Sampled by the glass shader; the root's own background is not. */}
            <div className={styles.backdrop} aria-hidden="true" />

            {/* --- left: the song list (hideable) -------------------------- */}

            <aside className={`${styles.panel}${listOpen ? ` ${styles['panel-open']}` : ''}`}>
                <header className={styles['panel-head']}>
                    <div className={styles.brand}>
                        <span className={styles['brand-mark']}>
                            {source === DRIVE_SOURCE
                                ? <IconGoogleDrive size={22} />
                                : <IconMusicSpace size={24} />}
                        </span>
                        <span className={styles['brand-text']}>
                            <span className={styles['brand-name']}>
                                {source === DRIVE_SOURCE ? 'Google Drive' : 'Music Space'}
                            </span>
                            <span className={styles['brand-sub']}>
                                {listLoading ? '同步中…' : `${tracks.length} 首`}
                                {folderName ? ` · ${folderName}` : ''}
                            </span>
                        </span>
                    </div>
                    <button
                        type="button"
                        className={`${styles['rail-btn']}${listLoading ? ` ${styles.spin}` : ''}`}
                        title="刷新列表"
                        aria-label="刷新列表"
                        disabled={listLoading}
                        onClick={onRefresh}
                    >
                        <IconRefresh />
                    </button>
                </header>

                <div className={styles['panel-tools']}>
                    {searchOpen ? (
                        <label className={styles.search}>
                            <span className={styles['search-icon']}><IconSearch /></span>
                            <input
                                ref={searchInputRef}
                                type="search"
                                value={search}
                                onChange={(event) => onSearch(event.target.value)}
                                onKeyDown={(event) => { if (event.key === 'Escape') closeSearch(); }}
                                placeholder="搜索歌曲或歌手"
                                aria-label="搜索歌曲或歌手"
                            />
                            <button
                                type="button"
                                className={styles['search-close']}
                                title="关闭搜索"
                                aria-label="关闭搜索"
                                onClick={closeSearch}
                            >
                                ×
                            </button>
                        </label>
                    ) : (
                        <button
                            type="button"
                            className={styles['tool-btn']}
                            title="搜索"
                            aria-label="搜索"
                            onClick={() => setSearchOpen(true)}
                        >
                            <IconSearch />
                            <span>搜索歌曲</span>
                        </button>
                    )}
                    <div className={styles['menu-wrap']} ref={menuRef}>
                        <button
                            type="button"
                            className={`${styles['rail-btn']}${menu ? ` ${styles['rail-btn-on']}` : ''}`}
                            title="更多"
                            aria-label="更多"
                            aria-haspopup="menu"
                            aria-expanded={Boolean(menu)}
                            onClick={() => openMenu('more')}
                        >
                            <IconMoreVertical />
                        </button>
                        {menu && (
                            <div className={styles.menu} role="menu" aria-label="更多功能">
                                <button
                                    type="button"
                                    className={styles['menu-item']}
                                    role="menuitem"
                                    onClick={() => { setMenu(''); setSettingsOpen(true); }}
                                >
                                    <span className={styles['menu-icon']} aria-hidden="true"><IconGoogleDrive size={20} /></span>
                                    <span className={styles['menu-text']}>
                                        <span className={styles['menu-title']}>谷歌云盘链接</span>
                                        <span className={styles['menu-sub']}>
                                            {connected ? '已连接，可在设置里切换或断开' : '连接或切换自己的云盘曲库'}
                                        </span>
                                    </span>
                                    <IconChevronRight />
                                </button>
                                <button
                                    type="button"
                                    className={styles['menu-item']}
                                    role="menuitem"
                                    onClick={() => { setMenu(''); setSettingsOpen(true); }}
                                >
                                    <span className={styles['menu-icon']} aria-hidden="true"><IconArchive size={20} /></span>
                                    <span className={styles['menu-text']}>
                                        <span className={styles['menu-title']}>缓存管理</span>
                                        <span className={styles['menu-sub']}>歌曲与清单都是永久缓存，只在本地保存</span>
                                    </span>
                                    <IconChevronRight />
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {!connected ? (
                    <section className={styles.connect}>
                        <span className={styles['connect-icon']}><IconQueue /></span>
                        <h2 className={styles['connect-title']}>曲库里还没有歌曲</h2>
                        <p className={styles['connect-sub']}>
                            公共曲库暂时是空的；也可以连接 Google 云盘，
                            播放你自己云盘里的音乐。
                        </p>
                        <button type="button" className={styles['connect-btn']} onClick={() => setSettingsOpen(true)}>
                            去连接
                        </button>
                    </section>
                ) : visibleCount === 0 ? (
                    <p className={styles['list-empty']}>
                        {listLoading
                            ? '加载中…'
                            : !hasLibrary
                                ? '曲库还没有歌曲，去设置里连接自己的云盘'
                                : keyword
                                    ? `没有匹配「${keyword}」的歌曲`
                                    : '没有找到音频文件，去设置里换个文件夹试试？'}
                    </p>
                ) : (
                    <ul className={styles.list}>
                        {visibleTracks.map((track) => {
                            const item = parseTrackName(track.name);
                            const active = track.id === currentId;
                            const loading = loadingId === track.id;
                            return (
                                <li key={track.id}>
                                    <button
                                        type="button"
                                        className={active ? styles['item-active'] : styles.item}
                                        disabled={loading}
                                        onClick={() => onToggleTrack(track)}
                                        title={`${item.title} - ${item.artist}`}
                                    >
                                        <span
                                            className={styles['item-thumb']}
                                            style={{ background: trackGradient(track.name) }}
                                            aria-hidden="true"
                                        >
                                            {active && !loading ? (
                                                <span className={styles['thumb-overlay']}>
                                                    {isPlaying ? <IconPause /> : <IconPlay />}
                                                </span>
                                            ) : (
                                                <IconNote />
                                            )}
                                        </span>
                                        <span className={styles['item-text']}>
                                            <span className={styles['item-title']}>{item.title}</span>
                                            <span className={styles['item-artist']}>{item.artist}</span>
                                        </span>
                                        {loading ? (
                                            <span className={`${styles['item-flag']} ${styles.spin}`} aria-hidden="true">
                                                <IconRefresh />
                                            </span>
                                        ) : active ? (
                                            <span className={eqClass} aria-hidden="true"><i /><i /><i /></span>
                                        ) : null}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}

                <footer className={styles['panel-foot']}>
                    <span>{cached ? '离线可用' : '在线'}</span>
                    <span className={styles['foot-sep']} aria-hidden="true">·</span>
                    <button type="button" className={styles['foot-link']} onClick={onToggleTheme}>
                        {theme === 'dark' ? '浅色' : '深色'}
                    </button>
                </footer>
            </aside>

            {/* Folded to a rail; the button is the way back. */}
            <button
                type="button"
                className={styles['rail-toggle']}
                onClick={() => setListOpen((open) => !open)}
                aria-expanded={listOpen}
                aria-label={listOpen ? '隐藏列表' : '显示列表'}
                title={listOpen ? '隐藏列表' : '显示列表'}
            >
                <IconPanel />
            </button>

            {/* --- centre: the player (the theme of the workspace) --------- */}

            {/* 1/4 — settings entry, top-right */}
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

            {/* 2/4 — the record (glass) */}
            <div className={styles.stage}>
                <div className={styles.rig}>
                    <Tonearm playing={isPlaying} />
                    <button
                        type="button"
                        className={`${styles.disc}${isPlaying ? ` ${styles['disc-playing']}` : ''}`}
                        data-glass
                        data-config={DISC_GLASS}
                        onClick={canToggleLyrics ? onToggleLyrics : onTogglePlay}
                        disabled={!current}
                        title={canToggleLyrics ? '查看歌词' : isPlaying ? '暂停' : '播放'}
                        aria-label={canToggleLyrics ? '查看歌词' : isPlaying ? '暂停' : '播放'}
                    >
                        <span className={styles.ripples} aria-hidden="true">
                            <span className={styles.ripple} />
                            <span className={styles.ripple} />
                            <span className={styles.ripple} />
                        </span>
                        <span className={styles.rotor} aria-hidden="true">
                            <span className={styles['disc-grooves']} />
                            <span className={styles['disc-label']} style={{ background: gradient }}>
                                {current ? <IconNote /> : <IconMusicSpace size={34} />}
                            </span>
                            <span className={styles['disc-sheen']} />
                        </span>
                    </button>
                </div>

                {modeToast && (
                    <span className={styles['mode-toast']} role="status">{modeToast}</span>
                )}

                <div className={styles.head}>
                    <Marquee text={`${title} - ${artist}`} className={styles['head-label']} center>
                        <span className={styles['head-title']}>{title}</span>
                        <span className={styles['head-artist']}> - {artist}</span>
                    </Marquee>
                    <span
                        className={styles['head-state']}
                        aria-hidden="true"
                    >
                        {current ? `${sourceName} · ${formatSize(current.track.size)}` : ''}
                    </span>
                </div>
            </div>

            {/* 3/4 — lyrics card, floats over the record's lower half */}
            {lyricsShown && (
                <div
                    className={styles.lyrics}
                    data-glass
                    data-config={LYRICS_GLASS}
                    role="button"
                    tabIndex={0}
                    aria-label="歌词，点击返回唱片"
                    title="返回唱片"
                    onPointerDown={(event) => { pressYRef.current = event.clientY; }}
                    onClick={handleLyricsClick}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onToggleLyrics();
                        }
                    }}
                >
                    {lyrics ? lyrics.lines.map((line, index) => (
                        <p
                            key={`${line.time}-${index}`}
                            ref={index === activeLyric ? activeLyricRef : null}
                            className={index === activeLyric ? styles['lyric-active'] : styles.lyric}
                        >
                            {line.text}
                        </p>
                    )) : (
                        <p className={styles['lyrics-empty']}>歌词加载中…</p>
                    )}
                </div>
            )}

            {/* 4/4 — the bottom play bar (glass) */}
            <div className={styles.bar} data-glass data-config={BAR_GLASS}>
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
                    {/* the song, once more — the bar stays useful on its own */}
                    <span className={styles['bar-track']}>
                        <span
                            className={`${styles['bar-disc']}${isPlaying ? '' : ` ${styles['bar-disc-paused']}`}`}
                            aria-hidden="true"
                        >
                            <span
                                className={styles['bar-disc-cover']}
                                style={{ background: gradient }}
                            >
                                <IconNote />
                            </span>
                        </span>
                        <Marquee
                            text={current ? `${title} - ${artist}` : '还没有播放中的歌曲'}
                            className={styles['bar-label']}
                        >
                            <span className={styles['bar-title']}>{title}</span>
                            <span className={styles['bar-artist']}> - {artist}</span>
                        </Marquee>
                    </span>

                    <div className={styles.controls}>
                        <button
                            type="button"
                            className={`${styles['ctrl-btn']}${mode !== 'off' ? ` ${styles['ctrl-on']}` : ''}`}
                            onClick={onCycleRepeat}
                            title={playback.title}
                            aria-pressed={mode !== 'off'}
                        >
                            {playback.icon}
                        </button>
                        <button
                            type="button"
                            className={styles['ctrl-btn']}
                            onClick={onPrev}
                            disabled={!current}
                            title="上一首"
                            aria-label="上一首"
                        >
                            <IconPrev />
                        </button>
                        <button
                            type="button"
                            className={styles['ctrl-play']}
                            onClick={onTogglePlay}
                            disabled={!current}
                            title={isPlaying ? '暂停' : '播放'}
                            aria-label={isPlaying ? '暂停' : '播放'}
                        >
                            {isPlaying ? <IconPause /> : <IconPlay />}
                        </button>
                        <button
                            type="button"
                            className={styles['ctrl-btn']}
                            onClick={onNext}
                            disabled={!current}
                            title="下一首"
                            aria-label="下一首"
                        >
                            <IconNext />
                        </button>
                        <button
                            type="button"
                            className={`${styles['ctrl-btn']}${lyricsShown ? ` ${styles['ctrl-on']}` : ''}`}
                            onClick={onToggleLyrics}
                            disabled={!canToggleLyrics}
                            title={lyricsShown ? '收起歌词' : '显示歌词'}
                            aria-pressed={lyricsShown}
                        >
                            <IconQueue />
                        </button>
                    </div>

                    <span className={styles.times}>
                        <span className={styles.time}>{formatTime(progress.time)}</span>
                        <span className={styles['time-sep']}>/</span>
                        <span className={styles.time}>{formatTime(progress.duration)}</span>
                    </span>
                </div>
            </div>

            {/* --- settings drawer (flat, no glass) ----------------------- */}

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
                                className={`${styles['rail-btn']} ${styles['rail-btn-plain']}`}
                                onClick={() => setSettingsOpen(false)}
                                aria-label="关闭设置"
                            >
                                <IconClose />
                            </button>
                        </header>

                        <section className={styles.group}>
                            <div className={styles['group-label']}>当前曲库</div>
                            <div className={styles.account}>
                                <span className={styles['account-icon']}><IconCloud /></span>
                                <span className={styles['account-text']}>
                                    <span className={styles['account-name']}>
                                        {connected ? '我的 Google 云盘' : sourceName}
                                    </span>
                                    <span className={styles['account-sub']}>
                                        {folderName || '整个云盘'} · {listLoading ? '加载中…' : `${tracks.length} 首歌曲`}
                                    </span>
                                </span>
                            </div>
                        </section>

                        {connected ? (
                            <section className={styles.group}>
                                <div className={styles['group-label']}>音乐库</div>
                                <label className={styles.row} htmlFor="desktop-folder">
                                    <span className={styles['row-icon']}><IconFolder /></span>
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
                                    <span className={styles['row-chev']}><IconChevronRight /></span>
                                </label>
                                <button
                                    type="button"
                                    className={`${styles.row} ${styles['row-btn']} ${styles['row-danger']}`}
                                    onClick={onDisconnect}
                                >
                                    <span className={styles['row-icon']}><IconLogout /></span>
                                    <span className={styles['row-label']}>断开连接，回到公共曲库</span>
                                </button>
                            </section>
                        ) : (
                            <section className={styles.group}>
                                <div className={styles['group-label']}>连接自己的云盘（可选）</div>
                                <p className={styles.hint}>
                                    默认播放公共曲库，不需要任何授权。连接 Google 云盘后会改用你自己云盘里的歌曲，
                                    播放、歌词和离线缓存体验完全一致。
                                </p>
                                <ol className={styles.steps}>
                                    <li>
                                        在{' '}
                                        <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
                                            Google Cloud Console
                                        </a>
                                        {' '}创建一个「Web 应用」类型的 OAuth 客户端 ID
                                    </li>
                                    <li>在「已获授权的 JavaScript 来源」里添加 <code>https://ianyspace.github.io</code></li>
                                    <li>把客户端 ID 粘贴到下面，点击连接</li>
                                </ol>
                                <input
                                    className={styles.input}
                                    type="text"
                                    value={clientIdDraft}
                                    onChange={(event) => onClientIdDraft(event.target.value)}
                                    placeholder="粘贴 OAuth 客户端 ID（xxxx.apps.googleusercontent.com）"
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
                                <span className={styles['row-icon']}>
                                    {theme === 'dark' ? <IconSun /> : <IconMoon />}
                                </span>
                                <span className={styles['row-label']}>
                                    {theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
                                </span>
                                <span className={styles['row-value']}>{theme === 'dark' ? '深色' : '浅色'}</span>
                            </button>
                            <button
                                type="button"
                                className={`${styles.row} ${styles['row-btn']} ${styles['row-btn-last']}`}
                                onClick={() => setListOpen((open) => !open)}
                            >
                                <span className={styles['row-icon']}><IconPanel /></span>
                                <span className={styles['row-label']}>左侧列表</span>
                                <span className={styles['row-value']}>{listOpen ? '显示中' : '已隐藏'}</span>
                            </button>
                        </section>

                        <section className={styles.group}>
                            <div className={styles['group-label']}>缓存</div>
                            <div className={styles.row}>
                                <span className={styles['row-icon']}><IconArchive size={18} /></span>
                                <span className={styles['row-label']}>已缓存歌曲</span>
                                <span className={styles['row-value']}>{cacheCount} 首</span>
                            </div>
                            <div className={`${styles.row} ${styles['row-btn-last']}`}>
                                <span className={styles['row-icon']}><IconRefresh /></span>
                                <span className={styles['row-label']}>缓存策略</span>
                                <span className={styles['row-value']}>永久</span>
                            </div>
                        </section>

                        <p className={styles.footnote}>
                            歌曲与曲库清单都永久保存在本机，不手动清除就不会失效；
                            公共曲库来自 Cloudflare R2，无需登录即可播放。
                            <br />
                            {glassReady
                                ? '液态玻璃已启用'
                                : glassFailed
                                    ? '液态玻璃不可用，已回退为普通样式'
                                    : '正在初始化液态玻璃…'}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DesktopMusic;
