import React from 'react';

import {
    IconChevronRight,
    IconCloud,
    IconFolder,
    IconGoogleDrive,
    IconNoteList,
    IconPerson,
    IconRefresh,
} from '../icons';

import styles from './Profile.module.scss';

/**
 * The "我的" screen: the library you are browsing — which one it is, which folder
 * of it, and the way back to the rows.
 *
 * **连接云盘 lives here now.** It used to be the single entry in the song list's
 * ⋮ drawer, and both that entry and the ⋮ are gone. This is the page it belonged
 * to all along: the 音乐库 rows (文件夹 / 浏览歌曲) only ever appear once a drive
 * is connected, so the switch that makes them appear had no business being behind
 * a menu on a different page. The flow itself is still the sheet (`DriveSheet`) —
 * a multi-step authorization with a client-ID field is not a settings row, and
 * the sheet is not part of any one tab.
 *
 * The card at the top is deliberately the same shape as the Drive sheet's: the
 * same blue icon, the same 已连接 / 未连接 badge. Two screens answering the same
 * question ("which library am I on?") should answer it the same way — and the
 * badge is what makes the answer a *word* rather than something the visitor has
 * to infer from the title.
 *
 * The visitor's *own* things (the QQ number, 听歌排行, the sync button,
 * appearance, the cache) are on 账号, the page the app's mark opens: this one is
 * about which songs are here, that one is about who is listening. The public R2
 * catalogue is the default, so this page never blocks playback behind an
 * authorization step.
 *
 * **The 账号 capsule in the header is load-bearing, not decoration.** Until it
 * existed, this page was reachable from exactly one place — the "the library is
 * empty" prompt on the song list — which meant that in the normal case (a public
 * library with songs in it) it could not be opened at all. Moving the Drive
 * connection here would have hidden it behind a page nobody could reach. The two
 * settings-style pages now point at each other, and 歌曲 is one more tap from
 * either.
 */
const Profile = function ({
    sourceName,
    driveConnected,
    folders,
    folderId,
    folderName,
    onFolderChange,
    onRefresh,
    loading,
    trackCount,
    onGoList,
    onGoAccount,
    onOpenDrive,
}) {
    return (
        <div className={styles.page}>
            <header className={styles.head}>
                <div className={styles['head-row']}>
                    <h1 className={styles.title}>我的</h1>
                    <div className={styles['head-actions']}>
                        <button
                            type="button"
                            className={`${styles['refresh-btn']}${loading ? ` ${styles.spinning}` : ''}`}
                            title="刷新列表"
                            aria-label="刷新列表"
                            disabled={loading}
                            onClick={onRefresh}
                        >
                            <IconRefresh />
                        </button>
                        <button type="button" className={styles['nav-btn']} onClick={onGoAccount} title="账号">
                            <IconPerson />
                            <span>账号</span>
                        </button>
                        <button type="button" className={styles['nav-btn']} onClick={onGoList} title="歌曲">
                            <IconNoteList />
                            <span>歌曲</span>
                        </button>
                    </div>
                </div>
            </header>

            {/* The library card, standing on its own rather than nested in a
                `.group`: it is the page's *subject*, not one row among
                settings, and a card inside a card reads as a mistake. Its shape
                is the Drive sheet's card on purpose — same icon, same badge. */}
            <section className={styles.account}>
                <span className={styles['account-icon']}>
                    <IconCloud />
                </span>
                <span className={styles['account-text']}>
                    <span className={styles['account-name']}>
                        {driveConnected ? '我的 Google 云盘' : sourceName}
                    </span>
                    <span className={styles['account-sub']}>
                        {driveConnected
                            ? `${folderName} · ${loading ? '加载中…' : `${trackCount} 首歌曲`}`
                            : `当前曲库 · ${loading ? '加载中…' : `${trackCount} 首歌曲`} · 无需授权`}
                    </span>
                </span>
                {/* The word, not the inference. Without it the only way to tell
                    which library is loaded was to read the title and know what
                    the default one is called. */}
                <span className={driveConnected ? `${styles.badge} ${styles['badge-on']}` : styles.badge}>
                    {driveConnected ? '已连接' : '未连接'}
                </span>
            </section>

            {driveConnected ? (
                <section className={styles.group}>
                    <div className={styles['group-label']}>音乐库</div>
                    <label className={styles.row} htmlFor="music-folder-select">
                        <span className={styles['row-icon']}><IconFolder /></span>
                        <span className={styles['row-label']}>文件夹</span>
                        <select
                            id="music-folder-select"
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
                    <button type="button" className={`${styles.row} ${styles['row-btn']}`} onClick={onGoList}>
                        <span className={styles['row-icon']}><IconNoteList /></span>
                        <span className={styles['row-label']}>浏览歌曲</span>
                        <span className={styles['row-chev']}><IconChevronRight /></span>
                    </button>
                    {/* Opens the same sheet the connect row does. It is where
                        断开连接 lives — a two-tap confirm, which is not
                        something to put one stray thumb away from the folder
                        picker. */}
                    <button type="button" className={`${styles.row} ${styles['row-btn']}`} onClick={onOpenDrive}>
                        <span className={styles['row-icon']}><IconGoogleDrive size={20} /></span>
                        <span className={styles['row-label']}>云盘设置</span>
                        <span className={styles['row-chev']}><IconChevronRight /></span>
                    </button>
                </section>
            ) : (
                <section className={styles.group}>
                    <div className={styles['group-label']}>曲库</div>
                    <button type="button" className={`${styles.row} ${styles['row-btn']}`} onClick={onOpenDrive}>
                        <span className={styles['row-icon']}><IconGoogleDrive size={20} /></span>
                        <span className={styles['row-label']}>连接自己的云盘</span>
                        <span className={styles['row-chev']}><IconChevronRight /></span>
                    </button>
                    <p className={styles.hint}>
                        默认播放公共曲库，不需要任何授权。连接 Google 云盘后会改用你自己云盘里的歌曲，
                        播放、歌词和离线缓存体验完全一致。
                    </p>
                </section>
            )}

            <p className={styles.footnote}>
                授权令牌与客户端 ID 只保存在本机浏览器，不会上传到任何服务器；音频缓存同样只存在本地。
                外观切换、缓存管理和 QQ 号在应用图标进入的「账号」页里。
            </p>
        </div>
    );
};

export default Profile;
