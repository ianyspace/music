import React from 'react';

import {
    IconCloud,
    IconFolder,
    IconRefresh,
    IconLogout,
    IconSun,
    IconMoon,
    IconChevronRight,
    IconNoteList,
} from './icons';

import styles from './Profile.module.scss';

/**
 * The "我的" screen: sticky top bar (title + refresh + "歌曲" entry) over
 * settings-style grouped cards — the current library, the optional Google
 * Drive connection, the library folder and the app theme.
 *
 * The default library is the public R2 catalogue, so this page never blocks
 * playback behind an authorization step; connecting Drive is an opt-in
 * upgrade that swaps the list for the visitor's own songs.
 */
const Profile = function ({
    theme,
    onToggleTheme,
    connected,
    sourceName,
    driveConnected,
    gsiReady,
    clientId,
    clientIdDraft,
    onClientIdDraft,
    onConnect,
    onDisconnect,
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
                        {connected && (
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
                        )}
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

            {!driveConnected ? (
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
                        <li>
                            在「已获授权的 JavaScript 来源」里添加{' '}
                            <code>https://ianyspace.github.io</code>
                            （本地调试再加 <code>http://localhost:3000</code>）
                        </li>
                        <li>把客户端 ID 粘贴到下面，点击连接</li>
                    </ol>
                    <div className={styles.field}>
                        <input
                            className={styles.input}
                            type="text"
                            placeholder="粘贴 OAuth 客户端 ID（xxxx.apps.googleusercontent.com）"
                            value={clientIdDraft}
                            onChange={(event) => onClientIdDraft(event.target.value)}
                        />
                    </div>
                    <button
                        type="button"
                        className={styles['primary-btn']}
                        disabled={!gsiReady}
                        onClick={onConnect}
                    >
                        {gsiReady ? '连接 Google 云盘' : '正在加载 Google 组件…'}
                    </button>
                    {clientId && (
                        <p className={styles.hint}>检测到已保存的客户端 ID，直接点击连接即可。</p>
                    )}
                </section>
            ) : (
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
                    <button type="button" className={`${styles.row} ${styles['row-btn']} ${styles['row-danger']}`} onClick={onDisconnect}>
                        <span className={styles['row-icon']}><IconLogout /></span>
                        <span className={styles['row-label']}>断开连接</span>
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
            </section>

            <p className={styles.footnote}>
                公共曲库来自 Cloudflare R2，无需登录即可播放。连接 Google 云盘后改用你自己云盘里的歌曲；
                授权令牌与客户端 ID 只保存在本机浏览器，音频缓存同样只存在本地。
            </p>
        </div>
    );
};

export default Profile;
