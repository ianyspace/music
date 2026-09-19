import React, { useEffect, useRef, useState } from 'react';

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
} from './icons';
import { emptyListMessage, parseTrackName, trackGradient } from './shared';
import { DRIVE_SOURCE } from './librarySource';
import Cover from './Cover';

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
 * Two list-scoped behaviours are handed upward rather than implemented here:
 * the "jump to the playing track" button lives in `MiniPlayer` (it is anchored
 * to that bar, so it must not be caught inside this column's scrolling), and
 * the row (de)marking that the jump targets is done through the DOM attributes
 * this component writes — `data-track-id` on every row, and the transient
 * `track-pulse` class.
 *
 * Each row's three-dots button opens a per-song drawer (置顶 / 移入不喜欢) that
 * the shell owns, for the same reason the list's own drawer lives there: a
 * `position: fixed` child would be trapped by this column's `transform`ed
 * ancestor. `rowMenuId` is the track whose drawer is open, so the button can
 * report its expanded state.
 */
const TrackList = function ({
    connected,
    source,
    listLoading,
    visibleTracks,
    libraryCount,
    search,
    onSearch,
    current,
    loadingId,
    isPlaying,
    onToggleTrack,
    onGoProfile,
    menuOpen,
    onOpenMenu,
    rowMenuId,
    onOpenRowMenu,
}) {
    const keyword = search.trim();
    const currentId = current ? current.track.id : '';
    const eqClass = `${styles.eq}${isPlaying ? '' : ` ${styles['eq-paused']}`}`;
    // `libraryCount` is the library *before* the list preferences and the
    // search ran, which is the only way to tell "this library is empty" from
    // "this library is all hidden" — see `emptyListMessage`.
    const empty = visibleTracks.length === 0 || listLoading
        ? emptyListMessage({ listLoading, keyword, libraryCount, folderHint: '我的' })
        : '';
    // The search field only exists while unfolded; a tap on the search button
    // reveals it and puts the caret straight inside.
    const [searchOpen, setSearchOpen] = useState(false);
    const searchInputRef = useRef(null);
    // The document outlives every re-render here, so the "did the row appear"
    // test lives in `MiniPlayer` — it owns the button and reads the list back
    // out of the DOM through this id. Nothing here has to observe anything.
    const listId = 'ms-track-list';

    useEffect(() => {
        if (!searchOpen) return undefined;
        const input = searchInputRef.current;
        if (input) input.focus();
        return undefined;
    }, [searchOpen]);

    const openSearch = function () {
        setSearchOpen(true);
    };

    const closeSearch = function () {
        setSearchOpen(false);
        onSearch('');
    };

    return (
        <div className={styles.page}>
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

            {/* The "connect a drive" prompt is for a library that is genuinely
                empty, not for one that is still arriving. Without the
                `listLoading` guard a first visit — no list cache yet — showed
                「曲库里还没有歌曲」 for as long as the public library took to
                load, which reads as "there is nothing here" rather than as a
                page still working. */}
            {!connected && !listLoading ? (
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
                    {/* The list stays mounted even when there is nothing in it,
                        because `MiniPlayer`'s jump button looks it up by id —
                        and the message about the list is its *sibling*, never a
                        child. A `<ul>` may only contain `<li>`: a stray `<p>`
                        inside one is invalid HTML, and it makes the list
                        announce the message as an item of its own. */}
                    <ul className={styles.tracks} id={listId}>
                        {visibleTracks.map((track) => {
                            const active = track.id === currentId;
                            const loading = loadingId === track.id;
                            const meta = parseTrackName(track.name);
                            const rowMenuOpen = rowMenuId === track.id;
                            return (
                                <li key={track.id} data-track-id={track.id} className={styles['row']}>
                                    {/* A row is two sibling controls, not a
                                        button wrapping another button — which
                                        is invalid HTML and gets the inner one
                                        torn out of the accessibility tree. The
                                        play target is therefore a div carrying
                                        the button role, with the whole row's
                                        hit area, and the three-dots button sits
                                        next to it as its own button. */}
                                    <div
                                        className={active ? styles['track-active'] : styles.track}
                                        role="button"
                                        tabIndex={loading ? -1 : 0}
                                        aria-disabled={loading || undefined}
                                        aria-label={`播放 ${meta.title}`}
                                        onClick={() => { if (!loading) onToggleTrack(track); }}
                                        onKeyDown={(event) => {
                                            if (loading) return;
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                onToggleTrack(track);
                                            }
                                        }}
                                    >
                                        <span
                                            className={styles['track-thumb']}
                                            style={{ background: trackGradient(track.name) }}
                                            aria-hidden="true"
                                        >
                                            {/* First child on purpose: the
                                                cover swallows the note glyph
                                                underneath it, but the
                                                play/pause scrim below has to
                                                land on top of the photo. */}
                                            <Cover track={track} />
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
                                    </div>
                                    {/* Muted by default — the row's own play
                                        target is the primary action, and a
                                        full-contrast dots button on every row
                                        would turn the list into a toolbar. It
                                        comes up to full strength on hover and
                                        while its drawer is open. */}
                                    <button
                                        type="button"
                                        className={rowMenuOpen
                                            ? `${styles['row-more']} ${styles['row-more-on']}`
                                            : styles['row-more']}
                                        title="更多操作"
                                        aria-label={`${meta.title} 的更多操作`}
                                        aria-haspopup="dialog"
                                        aria-expanded={rowMenuOpen}
                                        onClick={() => onOpenRowMenu(track)}
                                    >
                                        <IconMoreVertical />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    {empty && (
                        <p className={styles['list-empty']}>{empty}</p>
                    )}
                </>
            )}
        </div>
    );
};

export default TrackList;
