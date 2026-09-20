import React from 'react';

import {
    IconChevronRight,
    IconCloud,
    IconFolder,
    IconNoteList,
    IconRefresh,
} from '../icons';

import styles from './Profile.module.scss';

/**
 * The "我的" screen: sticky top bar (title + refresh + "歌曲" entry) over the
 * current library card and, once Drive is connected, the folder picker.
 *
 * The connect flow itself lives in its own sheet (`DriveSheet`), opened from
 * the song list's drawer — that keeps this page about the library you are
 * browsing, not about a form. The visitor's *own* settings (appearance, cache,
 * the QQ number behind the avatar) are on 账号, the page the avatar opens: this
 * one is about which songs are here, that one is about who is listening. The
 * public R2 catalogue is the default, so this page never blocks playback behind
 * an authorization step.
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
                        <button type="button" className={styles['nav-btn']} onClick={onGoList} title="歌曲">
                            <IconNoteList />
                            <span>歌曲</span>
                        </button>
                    </div>
                </div>
            </header>

            <section className={styles.group}>
                <div className={styles.account}>
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
                </div>
            </section>

            {driveConnected && (
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
                </section>
            )}

            <p className={styles.footnote}>
                公共曲库来自 Cloudflare R2，无需登录即可播放。想改用自己云盘里的歌曲，
                在歌曲列表右上角的菜单里打开「谷歌云盘链接」；外观切换和缓存管理在
                列表左上角头像进入的「账号」页里。授权令牌与客户端 ID 只保存在本机浏览器，
                音频缓存同样只存在本地。
            </p>
        </div>
    );
};

export default Profile;
