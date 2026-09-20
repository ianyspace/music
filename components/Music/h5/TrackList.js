import React, { useEffect, useRef, useState } from 'react';

import {
    IconHeart,
    IconMoreVertical,
    IconNote,
    IconNoteList,
    IconRefresh,
    IconPlay,
    IconPause,
    IconSearch,
} from '../icons';
import { assetUrl, emptyListMessage, parseTrackName, trackGradient } from '../shared';
import { DRIVE_SOURCE } from '../librarySource';
import Cover from '../Cover';

import styles from './TrackList.module.scss';

/**
 * The song list. The sticky top bar holds the search / 我喜欢 actions and the
 * app's mark, at the far right; tapping search unfolds the field into that row
 * and focuses it. The track rows scroll underneath.
 *
 * The bar has **no ⋮ any more**. It opened the shell's bottom drawer, which had
 * been reduced to a single entry (谷歌云盘链接) once 缓存管理 and 切换外观 moved
 * to 账号 — and a menu of one is worse than no menu: it costs a tap and a
 * decision to reach something that could have been a row. That entry is on
 * 「我的」 now, which is the page about *which songs are here*.
 *
 * The mark is the way into 账号: tapping it opens the page that holds the
 * visitor's own things (the QQ number, 听歌排行, the sync button, appearance,
 * the cache). It used to be the visitor's *avatar* — a QQ picture once a number
 * was bound; that moved to 账号's identity card, where a face belongs. It also
 * used to sit on the left, where the library's brand name had been; it moved to
 * the trailing end because the left edge of a list is where the content starts.
 *
 * `qqBound` is drawn as a dot on the mark's bottom-right corner (grey / green)
 * and spoken in its label: the button doubles as the "is my number in?" light,
 * so that question does not need a page visit to answer.
 *
 * The library's *name* did not leave with the title, though: it is still here as
 * the page's only `<h1>`, off screen (see `.sr-only`). It is the one thing that
 * says which library the rows below belong to, and the smoke test watches it to
 * see a source switch.
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
 * that the shell owns, for the same reason the list's own drawer lived there: a
 * `position: fixed` child would be trapped by this column's `transform`ed
 * ancestor. `rowMenuId` is the track whose drawer is open, so the button can
 * report its expanded state.
 *
 * 我喜欢: the heart does not open a screen, it narrows this list to the liked
 * songs and narrows it back. `canLike` is false for a Drive library, where the
 * feature does not apply, **and for a visitor with no QQ number bound** — likes
 * belong to a number now that they live in the database, so a filter with
 * nothing behind it is not rendered at all. (The prompt for that case lives on
 * the heart in the player and in the row drawer, which stay visible and say what
 * is missing — see `toggleLike`.)
 */
const TrackList = function ({
    connected,
    source,
    listLoading,
    visibleTracks,
    search,
    onSearch,
    canLike,
    likedOnly,
    onToggleLikedOnly,
    current,
    loadingId,
    isPlaying,
    onToggleTrack,
    onGoProfile,
    onGoAccount,
    qqBound,
    rowMenuId,
    onOpenRowMenu,
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
                    {/* The library's name is still here, just not on screen.
                        It is the page's only heading, and it is the one thing
                        that says which library the rows below belong to — so
                        it stays in the document (and stays readable to the
                        smoke test, which watches it to see a source switch)
                        while the pixels go to the mark on the right.

                        It is also the *only* thing on the left now: the mark
                        moved to the trailing end of the row (see below), so
                        with no search open the bar is this heading and three
                        buttons. `position: absolute` takes it out of the flex
                        flow, which is why its position in the markup does not
                        matter. */}
                    <h1 className={styles['sr-only']}>
                        {source === DRIVE_SOURCE ? 'Google Drive' : 'Music Space'}
                    </h1>
                    {/* Unfolds between the mark and the actions; its own
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
                        {/* 我喜欢 — a filter, not a destination: it narrows the
                            list below and stays lit while it does. It keeps
                            working alongside the search, so it is not hidden
                            while the field is open, unlike the search button
                            itself. `aria-pressed` is what makes it a toggle to
                            a screen reader rather than two different buttons
                            whose labels happen to alternate.
                            Not rendered without a QQ number: the likes it would
                            filter live in the database under that number, so
                            there is nothing for it to narrow to. */}
                        {connected && canLike && (
                            <button
                                type="button"
                                className={likedOnly
                                    ? `${styles['nav-btn']} ${styles['nav-btn-on']}`
                                    : styles['nav-btn']}
                                title={likedOnly ? '显示全部歌曲' : '只看喜欢的歌曲'}
                                aria-label={likedOnly ? '显示全部歌曲' : '只看喜欢的歌曲'}
                                aria-pressed={likedOnly}
                                onClick={onToggleLikedOnly}
                            >
                                <IconHeart filled={likedOnly} />
                            </button>
                        )}
                        {/* The app's mark, at the **far right** of the bar, and
                            the way into 账号 — the page holding the QQ number,
                            听歌排行, the sync button, appearance and the cache.

                            It used to sit on the left, where the library's brand
                            name had been; it moved because the left edge of a
                            list is where the *content* starts, and a control
                            that leaves the list should not be the first thing
                            the eye lands on. The ⋮ that used to close this row
                            is gone: its only remaining entry (谷歌云盘链接) is
                            on 「我的」 now, and a button whose whole job is to
                            open a menu of one is worse than no button.

                            Two details are the button's whole look:
                            - it is a **rounded square**, not a circle, so the
                              artwork reads as an app icon rather than as an
                              avatar (the visitor's face is on 账号's identity
                              card, where a face belongs);
                            - the **dot at its bottom-right** is the QQ state:
                              grey = 未确认, green = 已确认. It is the answer to
                              "did my number actually take?" at a glance, before
                              opening a page to find out — the button *is* the
                              indicator, so the state is legible from the list.

                            The file is the published app icon — the same artwork
                            as the favicon, so the tab and the page agree. It is
                            a plain `<img>` rather than an `icon` component
                            because it is a picture, and `assetUrl` is what adds
                            the basePath (files under `public/` are not prefixed
                            by Next). */}
                        <button
                            type="button"
                            className={styles.mark}
                            title={qqBound ? '账号 · 已确认 QQ' : '账号 · 未确认 QQ'}
                            aria-label={qqBound ? '账号，已确认 QQ' : '账号，未确认 QQ'}
                            onClick={onGoAccount}
                        >
                            <img className={styles['mark-img']} src={assetUrl('/icon-192.png')} alt="" />
                            {/* Decorative: the state is already in the label
                                above, and a screen reader does not need to be
                                told about a coloured pixel. */}
                            <span
                                className={qqBound
                                    ? `${styles['mark-dot']} ${styles['mark-dot-on']}`
                                    : styles['mark-dot']}
                                aria-hidden="true"
                            />
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
