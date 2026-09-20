import React from 'react';

import { IconHeart, IconMoreVertical, IconSearch } from '../icons';

import styles from './ListActions.module.scss';

/**
 * The song list's three icon actions: 搜索 / 只看喜欢 / 更多.
 *
 * They are defined once because they are on screen in two places — in the
 * list's own header, and in the floating bar that takes over once that header
 * has scrolled away. Those two are never visible at the same time, but they are
 * the same three controls reading the same state, so a second copy of this
 * markup would be a second place for the labels, the `aria-pressed` values and
 * the disabled conditions to drift. Only the wrapper differs (a header row vs a
 * glass capsule), and that belongs to the caller.
 *
 * `showSearch` is a prop rather than something derived here, because the two
 * places genuinely disagree about it: the header hides the button while the
 * search field is unfolded — the field *is* that slot — while the capsule keeps
 * it, since there is no field in the bar and tapping it is how the visitor gets
 * back to the one in the header.
 */
const ListActions = function ({
    showSearch,
    canLike,
    likedOnly,
    menuOpen,
    onOpenSearch,
    onToggleLikedOnly,
    onOpenMenu,
}) {
    return (
        <>
            {showSearch && (
                <button
                    type="button"
                    className={styles.btn}
                    title="搜索"
                    aria-label="搜索"
                    onClick={onOpenSearch}
                >
                    <IconSearch />
                </button>
            )}
            {/* 只看喜欢 — a filter, not a destination: it narrows the list
                below and stays lit while it does. It keeps working alongside
                the search, so it is not hidden while the field is open, unlike
                the search button itself. `aria-pressed` is what makes it a
                toggle to a screen reader rather than two different buttons
                whose labels happen to alternate. */}
            {canLike && (
                <button
                    type="button"
                    className={likedOnly ? `${styles.btn} ${styles['btn-on']}` : styles.btn}
                    title={likedOnly ? '显示全部歌曲' : '只看喜欢的歌曲'}
                    aria-label={likedOnly ? '显示全部歌曲' : '只看喜欢的歌曲'}
                    aria-pressed={likedOnly}
                    onClick={onToggleLikedOnly}
                >
                    <IconHeart filled={likedOnly} />
                </button>
            )}
            {/* Opens the shell's bottom drawer, which carries the entry to
                「我的」 and the Google Drive connection. */}
            <button
                type="button"
                className={styles.btn}
                title="更多"
                aria-label="更多"
                aria-haspopup="menu"
                aria-expanded={Boolean(menuOpen)}
                onClick={onOpenMenu}
            >
                <IconMoreVertical />
            </button>
        </>
    );
};

export default ListActions;
