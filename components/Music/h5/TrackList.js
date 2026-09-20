import React, { useEffect, useRef } from 'react';

import {
    IconMoreVertical,
    IconNote,
    IconNoteList,
    IconPerson,
    IconRefresh,
    IconPlay,
    IconPause,
    IconSearch,
} from '../icons';
import { emptyListMessage, parseTrackName, trackGradient } from '../shared';
import { DRIVE_SOURCE } from '../librarySource';
import Cover from '../Cover';
import ListActions from './ListActions';

import styles from './TrackList.module.scss';

/**
 * The song list. The top bar holds the visitor's avatar and the search /
 * 我喜欢 / three-dots actions; tapping search unfolds the field into that row
 * and focuses it. The three-dots button opens the bottom drawer owned by the
 * shell (see `MusicApp`), which reports whether the drawer is open through
 * `menuOpen` — the button only shows its expanded state.
 *
 * The bar **scrolls away** with the list rather than sticking to the top, and
 * the shell takes over from there: it watches `headerRef` and floats a glass
 * avatar + capsule of the same three buttons in once this bar is out of view.
 * The search field's open state lives in the shell for that reason — the
 * floating bar needs to be able to unfold the field, and the field is in here.
 *
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
 * Each row's three-dots button opens a per-song drawer (置顶 / 喜欢)
 * that the shell owns, for the same reason the list's own drawer lives there: a
 * `position: fixed` child would be trapped by this column's `transform`ed
 * ancestor. `rowMenuId` is the track whose drawer is open, so the button can
 * report its expanded state.
 *
 * 我喜欢: the heart does not open a screen, it narrows this list to the liked
 * songs and narrows it back. `canLike` is false for a Drive library, where the
 * feature does not apply, and the button is not rendered at all in that case —
 * an entry that could only ever come back empty is worse than no entry.
 */
const TrackList = function ({
    connected,
    source,
    listLoading,
    visibleTracks,
    search,
    onSearch,
    searchOpen,
    onOpenSearch,
    onCloseSearch,
    canLike,
    likedOnly,
    onToggleLikedOnly,
    current,
    loadingId,
    isPlaying,
    onToggleTrack,
    onGoProfile,
    menuOpen,
    onOpenMenu,
    rowMenuId,
    onOpenRowMenu,
    headerRef,
}) {
    const keyword = search.trim();
    const currentId = current ? current.track.id : '';
    const eqClass = `${styles.eq}${isPlaying ? '' : ` ${styles['eq-paused']}`}`;
    // `likedOnly` has to go in, or an empty 我喜欢 reads as "there are no
    // audio files here" — see `emptyListMessage`.
    const empty = visibleTracks.length === 0 || listLoading
        ? emptyListMessage({ listLoading, keyword, folderHint: '我的', likedOnly })
        : '';
    // The search field only exists while unfolded; a tap on the search button
    // reveals it and puts the caret straight inside. *Which* of those it is
    // lives in the shell — see the note above — so all this holds is the input.
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

    return (
        <div className={styles.page}>
            <header className={styles.head} ref={headerRef}>
                <div className={styles['head-row']}>
                    {/* The visitor's avatar — a placeholder, and deliberately
                        not a button: a control that does nothing is worse than
                        a picture that does nothing. */}
                    <span className={styles.avatar} role="img" aria-label="用户头像">
                        <IconPerson />
                    </span>
                    {/* The library's name is still here, just not on screen.
                        It is the page's only heading, and it is the one thing
                        that says which library the rows below belong to — so
                        it stays in the document (and stays readable to the
                        smoke test, which watches it to see a source switch)
                        while the pixels go to the avatar. */}
                    <h1 className={styles['sr-only']}>
                        {source === DRIVE_SOURCE ? 'Google Drive' : 'Music Space'}
                    </h1>
                    {/* Unfolds between the avatar and the actions; its own
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
                                    if (event.key === 'Escape') onCloseSearch();
                                }}
                                aria-label="搜索歌曲"
                            />
                            <button
                                type="button"
                                className={styles['search-close']}
                                title="关闭搜索"
                                aria-label="关闭搜索"
                                onClick={onCloseSearch}
                            >
                                ×
                            </button>
                        </label>
                    )}
                    <div className={styles['head-actions']}>
                        <ListActions
                            // The field takes this slot while it is open, so
                            // the button goes rather than sitting next to the
                            // × that closes it.
                            showSearch={connected && !searchOpen}
                            canLike={connected && canLike}
                            likedOnly={likedOnly}
                            menuOpen={menuOpen}
                            onOpenSearch={onOpenSearch}
                            onToggleLikedOnly={onToggleLikedOnly}
                            onOpenMenu={onOpenMenu}
                        />
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
