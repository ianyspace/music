import React, { useEffect, useState } from 'react';

import {
    IconChevronDown,
    IconChevronRight,
    IconCloud,
    IconFolder,
    IconGoogleDrive,
    IconLogout,
    IconNoteList,
    IconRefresh,
} from './icons';

import styles from './DriveSheet.module.scss';

/**
 * Google Drive connection — a full-height sheet opened from the song list's
 * drawer, built on the same chrome as the cache manager (`Sheet.module.scss`):
 * same column width, same rise-and-scale entrance, same collapse button.
 *
 * It deliberately holds nothing but Drive: the library card up top, then
 * either the "connect your own drive" steps or the folder picker and the
 * disconnect row once a token is live. Appearance and the cache live in their
 * own entries, so this screen never turns into a settings page.
 *
 * Connecting is the one place in the app that may raise Google's account
 * picker — every other path falls back to the public library silently, so the
 * button here is the only thing that ever triggers authorization UI.
 */
const DriveSheet = function ({
    driveConnected,
    sourceName,
    gsiReady,
    clientId,
    clientIdDraft,
    onClientIdDraft,
    onConnect,
    onDisconnect,
    folders,
    folderId,
    onFolderChange,
    loading,
    trackCount,
    closing,
    onClosed,
    onCancelClose,
    onClose,
    onRefresh,
    onGoList,
}) {
    const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

    // A confirmed-then-reopened sheet must not land back on "再点一次确认".
    useEffect(() => {
        if (!driveConnected) setConfirmingDisconnect(false);
    }, [driveConnected]);

    const handleDisconnect = function () {
        if (!confirmingDisconnect) {
            setConfirmingDisconnect(true);
            return;
        }
        setConfirmingDisconnect(false);
        onDisconnect();
    };

    return (
        <div
            className={closing ? `${styles.veil} ${styles['veil-out']}` : styles.veil}
            onAnimationEnd={() => { if (closing) onClosed(); }}
            onPointerDown={() => { if (closing) onCancelClose(); }}
        >
            <div className={closing ? `${styles.page} ${styles['page-out']}` : styles.page}>
                <div className={styles.topbar}>
                    <button type="button" className={styles['top-btn']} title="收起" aria-label="收起" onClick={onClose}>
                        <IconChevronDown />
                    </button>
                    <h2 className={styles['top-title']}>谷歌云盘链接</h2>
                    {/* Equal-width twin of the collapse button: it keeps the
                        title centred and re-reads the folder list. */}
                    <button
                        type="button"
                        className={styles['top-btn']}
                        title="刷新"
                        aria-label="刷新"
                        onClick={onRefresh}
                        disabled={!driveConnected || loading}
                    >
                        <IconRefresh />
                    </button>
                </div>

                <div className={styles.body}>
                    <div className={styles.account}>
                        <span className={styles['account-icon']}>
                            <IconCloud />
                        </span>
                        <span className={styles['account-text']}>
                            <span className={styles['account-name']}>
                                {driveConnected ? '已连接 Google 云盘' : sourceName}
                            </span>
                            <span className={styles['account-sub']}>
                                {driveConnected
                                    ? `${loading ? '加载中…' : `${trackCount} 首歌曲`}`
                                    : `当前曲库 · ${loading ? '加载中…' : `${trackCount} 首歌曲`} · 无需授权`}
                            </span>
                        </span>
                        <span className={driveConnected ? `${styles.badge} ${styles['badge-on']}` : styles.badge}>
                            {driveConnected ? '已连接' : '未连接'}
                        </span>
                    </div>

                    {!driveConnected ? (
                        <>
                            <p className={styles.lead}>
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

                            <input
                                className={styles.input}
                                type="text"
                                placeholder="粘贴 OAuth 客户端 ID（xxxx.apps.googleusercontent.com）"
                                value={clientIdDraft}
                                onChange={(event) => onClientIdDraft(event.target.value)}
                            />

                            <button
                                type="button"
                                className={styles['primary-btn']}
                                disabled={!gsiReady}
                                onClick={onConnect}
                            >
                                <IconGoogleDrive size={18} />
                                {gsiReady ? '连接 Google 云盘' : '正在加载 Google 组件…'}
                            </button>

                            {clientId && (
                                <p className={styles.hint}>检测到已保存的客户端 ID，直接点击连接即可。</p>
                            )}
                        </>
                    ) : (
                        <>
                            <div className={styles['section-label']}>音乐库</div>

                            <label className={styles.row} htmlFor="drive-sheet-folder">
                                <span className={styles['row-icon']}><IconFolder /></span>
                                <span className={styles['row-label']}>文件夹</span>
                                <select
                                    id="drive-sheet-folder"
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

                            <button
                                type="button"
                                className={`${styles.row} ${styles['row-btn']} ${styles['row-danger']}`
                                    + (confirmingDisconnect ? ` ${styles['row-confirm']}` : '')}
                                onClick={handleDisconnect}
                            >
                                <span className={styles['row-icon']}><IconLogout /></span>
                                <span className={styles['row-label']}>
                                    {confirmingDisconnect ? '再点一次确认断开' : '断开连接'}
                                </span>
                            </button>

                            <p className={styles.hint}>
                                断开后会切回公共曲库；已缓存的歌曲仍留在本机，可以继续离线播放。
                            </p>
                        </>
                    )}

                    <p className={styles.footnote}>
                        授权令牌与客户端 ID 只保存在本机浏览器，不会上传到任何服务器；
                        音频缓存同样只存在本地。
                    </p>
                </div>
            </div>
        </div>
    );
};

export default DriveSheet;
