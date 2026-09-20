import React from 'react';

import {
    IconChevronRight,
    IconCloud,
    IconFolder,
    IconGoogleDrive,
    IconNoteList,
    IconRefresh,
} from '../icons';

import SheetChrome from './SheetChrome';
import styles from './Profile.module.scss';

/**
 * 音乐库 — the library sheet: which library you are browsing, which folder of it,
 * and the way to connect or switch to your own Google Drive.
 *
 * **It is a panel, not a page** (`SheetChrome`, the same chrome as 缓存管理 and
 * 谷歌云盘链接), raised from the list's ⋮ drawer. The visitor's own things (the
 * QQ number, 听歌排行, the sync button) are the *other* sheet, behind the app's
 * mark: this one is about which songs are here, that one is about who is
 * listening.
 *
 * **谷歌云盘链接 is one of this panel's rows now.** It used to be a drawer entry
 * beside 音乐库, which made the drawer answer the same question twice: "which
 * library am I on?" was the card in here, and "connect my own drive" was the
 * entry out there — two taps for one thought. The drawer has one library entry
 * now, and the connection is where the answer is drawn: a row under the card,
 * opening the Drive sheet *on top of this one* (it is rendered after this panel,
 * so closing it comes back here rather than dropping the visitor on the list).
 *
 * The card at the top is deliberately the same shape as the Drive sheet's: the
 * same blue icon, the same 已连接 / 未连接 badge. Two screens answering the same
 * question should answer it the same way — and the badge is what makes the
 * answer a *word* rather than something the visitor has to infer from the title.
 */
const Profile = function ({
    sourceName,
    driveConnected,
    folders,
    folderId,
    folderName,
    onFolderChange,
    onRefresh,
    onOpenDrive,
    loading,
    trackCount,
    onGoList,
    closing,
    onClosed,
    onCancelClose,
    onClose,
}) {
    return (
        <SheetChrome
            title="音乐库"
            closing={closing}
            onClosed={onClosed}
            onCancelClose={onCancelClose}
            onClose={onClose}
            /* Equal-width twin of the collapse button: it keeps the title
               centred and re-reads the list. */
            action={{
                onClick: onRefresh,
                disabled: loading,
                title: '刷新列表',
                icon: (
                    <span className={loading ? styles.spinning : undefined}>
                        <IconRefresh />
                    </span>
                ),
            }}
        >
            <div className={styles.body}>
                {/* The library card, standing on its own rather than nested in a
                    `.group`: it is the panel's *subject*, not one row among
                    settings, and a card inside a card reads as a mistake. Its
                    shape is the Drive sheet's card on purpose — same icon, same
                    badge. */}
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
                    {/* The word, not the inference. Without it the only way to
                        tell which library is loaded was to read the title and
                        know what the default one is called. */}
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
                        {/* Switching or disconnecting lives in the Drive sheet,
                            not here: this panel says *which* library is loaded,
                            and that one owns the connection itself. */}
                        <button
                            type="button"
                            className={`${styles.row} ${styles['row-btn']}`}
                            onClick={onOpenDrive}
                        >
                            <span className={styles['row-icon']}><IconGoogleDrive /></span>
                            <span className={styles['row-label']}>谷歌云盘链接</span>
                            <span className={styles['row-chev']}><IconChevronRight /></span>
                        </button>
                    </section>
                ) : (
                    <section className={styles.group}>
                        <div className={styles['group-label']}>曲库</div>
                        {/* The one useful next step, as a row rather than as a
                            sentence pointing at a menu that no longer holds
                            it. */}
                        <button
                            type="button"
                            className={`${styles.row} ${styles['row-btn']}`}
                            onClick={onOpenDrive}
                        >
                            <span className={styles['row-icon']}><IconGoogleDrive /></span>
                            <span className={styles['row-label']}>连接 Google 云盘</span>
                            <span className={styles['row-chev']}><IconChevronRight /></span>
                        </button>
                        <p className={styles.hint}>
                            默认播放公共曲库，不需要任何授权。连接自己的云盘后会改用云盘里的歌曲，
                            这里也会多出文件夹选择。
                        </p>
                    </section>
                )}

                <p className={styles.footnote}>
                    授权令牌与客户端 ID 只保存在本机浏览器，不会上传到任何服务器；音频缓存同样只存在本地。
                </p>
            </div>
        </SheetChrome>
    );
};

export default Profile;
