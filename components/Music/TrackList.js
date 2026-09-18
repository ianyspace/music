import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
    IconNote,
    IconNoteList,
    IconRefresh,
    IconMoreVertical,
    IconPlay,
    IconPause,
    IconSearch,
    IconMusicSpace,
    IconGoogleDrive,
    IconLocate,
} from './icons';
import { parseTrackName, trackGradient } from './shared';
import { DRIVE_SOURCE } from './librarySource';

import styles from './TrackList.module.scss';

/**
 * The song list. The sticky top bar holds the library's brand mark (Music Space
 * for the public library, Google Drive once the visitor's own drive is
 * connected) and the search / three-dots actions; tapping search unfolds the
 * field into the title row and focuses it. The three-dots button opens the
 * bottom drawer owned by the shell (see `MusicApp`), which reports whether the
 * drawer is open through `menuOpen` — the button only shows its expanded state.
 * The track rows scroll underneath.
 * Rows cover every audio file, sorted by name; the folder chosen on the
 * profile page filters the whole list.
 *
 * A "locate" button floats over the bottom-right while the playing row is off
 * screen: the list is document-scrolled and can run to hundreds of rows, so
 * finding the current song by hand is a lot of thumb work. It watches the
 * active row with an IntersectionObserver rather than measuring on every scroll
 * event, and hides itself the moment that row is visible — the button is a
 * nudge back, not a permanent fixture.
 */
const TrackList = function ({
    connected,
    source,
    listLoading,
    visibleTracks,
    search,
    onSearch,
    current,
    loadingId,
    isPlaying,
    onToggleTrack,
    onGoProfile,
    menuOpen,
    onOpenMenu,
}) {
    const keyword = search.trim();
    const currentId = current ? current.track.id : '';
    const eqClass = `${styles.eq}${isPlaying ? '' : ` ${styles['eq-paused']}`}`;
    // The search field only exists while unfolded; a tap on the search button
    // reveals it and puts the caret straight inside.
    const [searchOpen, setSearchOpen] = useState(false);
    const searchInputRef = useRef(null);
    // Scope for the row lookups below, so a same-named attribute added
    // elsewhere (the player sheet, the cache sheet) can never be picked up.
    const listRef = useRef(null);
    // Whether the playing row is currently on screen. Starts true so the button
    // does not flash before the observer's first callback lands.
    const [activeVisible, setActiveVisible] = useState(true);
    // Set for the duration of the "landed" pulse, so the row the list jumped to
    // is obvious even though it was already the playing one.
    const [pulsing, setPulsing] = useState(false);
    const pulseTimerRef = useRef(null);

    useEffect(() => {
        if (!searchOpen) return undefined;
        const input = searchInputRef.current;
        if (input) input.focus();
        return undefined;
    }, [searchOpen]);

    // Track the playing row's visibility. Re-armed whenever the row moves
    // (song change, search filtering, list reload) — the observed node is a
    // different element each time, so the observer has to be rebuilt.
    useEffect(() => {
        const list = listRef.current;
        const row = currentId && list
            ? list.querySelector(`[data-track-id="${CSS.escape(currentId)}"]`)
            : null;
        if (!row) {
            setActiveVisible(true);
            return undefined;
        }
        // `rootMargin` trims the top strip the floating header covers and the
        // bottom strip the mini bar sits over, so a row hidden behind either is
        // correctly reported as "not really visible".
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => setActiveVisible(entry.isIntersecting));
            },
            { rootMargin: '-72px 0px -96px 0px', threshold: 0 },
        );
        observer.observe(row);
        return () => observer.disconnect();
    }, [currentId, visibleTracks, listLoading]);

    useEffect(() => () => {
        if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    }, []);

    const jumpToCurrent = useCallback(function () {
        const list = listRef.current;
        const row = list ? list.querySelector(`[data-track-id="${CSS.escape(currentId)}"]`) : null;
        if (!row) return;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        row.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
        setPulsing(true);
        if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
        pulseTimerRef.current = setTimeout(() => setPulsing(false), reduced ? 400 : 1100);
    }, [currentId]);

    const openSearch = function () {
        setSearchOpen(true);
    };

    const closeSearch = function () {
        setSearchOpen(false);
        onSearch('');
    };

    return (
        <div className={styles.page}>
            {/* Sticky colour wash parked directly under the floating glass —
                it gives the header's backdrop-filter something to refract
                even before the first row scrolls beneath it. */}
            <span className={styles['head-glow']} aria-hidden="true" />
            <header className={styles.head}>
                <div className={styles['head-row']}>
                    <h1 className={styles.title}>
                        {source === DRIVE_SOURCE
                            ? <IconGoogleDrive size={21} />
                            : <IconMusicSpace size={23} />}
                        <span className={styles['title-word']}>
                            {source === DRIVE_SOURCE ? 'Google Drive' : 'Music Space'}
                        </span>
                    </h1>
                    {/* Unfolds between the title and the actions; its own
                        toggle hides while it is open. */}
                    {connected && searchOpen && (
                        <label className={styles['search-box']}>
                            <span className={styles['search-icon']}><IconSearch /></span>
                            <input
                                ref={searchInputRef}
                                className={styles['search-input']}
                                type="search"
                                placeholder="搜索歌曲"
                                value={search}
                                onChange={(event) => onSearch(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Escape') closeSearch();
                                }}
                                aria-label="搜索歌曲"
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
                    )}
                    <div className={styles['head-actions']}>
                        {connected && !searchOpen && (
                            <button
                                type="button"
                                className={styles['nav-btn']}
                                title="搜索"
                                aria-label="搜索"
                                onClick={openSearch}
                            >
                                <IconSearch />
                            </button>
                        )}
                        {/* Opens the shell's bottom drawer, which carries the
                            entry to 「我的」 and the Google Drive connection. */}
                        <button
                            type="button"
                            className={styles['nav-btn']}
                            title="更多"
                            aria-label="更多"
                            aria-haspopup="menu"
                            aria-expanded={Boolean(menuOpen)}
                            onClick={onOpenMenu}
                        >
                            <IconMoreVertical />
                        </button>
                    </div>
                </div>
            </header>

            {!connected ? (
                <section className={styles.connect}>
                    <span className={styles['connect-icon']}><IconNoteList /></span>
                    <h2 className={styles['connect-title']}>曲库里还没有歌曲</h2>
                    <p className={styles['connect-sub']}>
                        公共曲库暂时是空的；也可以在「我的」页面连接 Google 云盘，
                        播放你自己云盘里的音乐。
                    </p>
                    <button type="button" className={styles['connect-btn']} onClick={onGoProfile}>
                        去看看
                    </button>
                </section>
            ) : (
                <>
                    <ul className={styles.tracks} ref={listRef}>
                        {listLoading && (
                            <p className={styles['lib-loading']}>加载中…</p>
                        )}
                        {!listLoading && visibleTracks.length === 0 && (
                            <p className={styles['lib-empty']}>
                                {keyword
                                    ? `没有匹配「${keyword}」的歌曲`
                                    : '没有找到音频文件，去「我的」换个文件夹试试？'}
                            </p>
                        )}
                        {visibleTracks.map((track) => {
                            const active = track.id === currentId;
                            const loading = loadingId === track.id;
                            const meta = parseTrackName(track.name);
                            return (
                                <li key={track.id} data-track-id={track.id}>
                                    <button
                                        type="button"
                                        className={active
                                            ? `${styles['track-active']}${pulsing ? ` ${styles['track-pulse']}` : ''}`
                                            : styles.track}
                                        disabled={loading}
                                        onClick={() => onToggleTrack(track)}
                                    >
                                        <span
                                            className={styles['track-thumb']}
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
                                        <span className={styles['track-text']}>
                                            <span className={styles['track-title']}>{meta.title}</span>
                                            <span className={styles['track-artist']}>{meta.artist}</span>
                                        </span>
                                        {loading ? (
                                            <span className={`${styles['track-dot']} ${styles.spinning}`} aria-hidden="true">
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

                    {/* Only while the playing row is off screen — hidden means
                        "you are already looking at it". */}
                    {current && !activeVisible && !listLoading && (
                        <button
                            type="button"
                            className={styles['locate-btn']}
                            title="定位到正在播放"
                            aria-label="定位到正在播放"
                            onClick={jumpToCurrent}
                        >
                            <IconLocate />
                        </button>
                    )}
                </>
            )}
        </div>
    );
};

export default TrackList;
