import React, { useState } from 'react';

import { formatAgo } from '../playStats';
import { parseTrackName } from '../shared';
import { IconRefresh } from '../icons';

import SheetChrome from './SheetChrome';
import styles from './StatsPage.module.scss';

/**
 * 听歌排行 — the visitor's own play counts, raised as a sheet from 账号.
 *
 * It has been three things. A card at the bottom of 账号 (wrong: a list of up to
 * fifty songs is a destination, not a settings card). Then a tab page of its
 * own (wrong differently: it had no tab bar to sit in, so its only entry was a
 * 账号 capsule in its own header and its only exit was the same capsule back —
 * two screens pointing at each other with no way out of the pair).
 *
 * It is a **panel** now, the same `SheetChrome` as 账号 / 音乐库 / 缓存管理: raised
 * by the 听歌排行 row on 账号, dismissed by its own 收起 button, which puts the
 * visitor back on the song list. That is the whole fix for the loop — a sheet
 * leaves, it does not navigate.
 *
 * Everything stateful arrives as props (`stats` / `loading` / `error` /
 * `reload`, from `usePlayStats`), and the panel owns only `scope`: which of the
 * two rankings is on screen. That is view state, like the search box — the
 * choice is not worth remembering across visits, and a panel that came back on
 * 最近 7 天 with no memory of why would read as a bug. It resets on every open
 * for free, because the shell mounts this only while it is up.
 *
 * The data is fetched by the hook while the panel is *up* (see `usePlayStats`).
 * Uploading what is still local is deliberately *not* here: it is one row on
 * 账号, next to the number it is about, and a ranking is not the place to
 * administer a queue.
 */
const StatsPage = function ({
    qq,
    stats,
    loading,
    error,
    reload,
    onGoAccount,
    closing,
    onClosed,
    onCancelClose,
    onClose,
}) {
    const [scope, setScope] = useState('all');
    const recent = scope === 'recent';
    const list = recent ? (stats ? stats.recent.list : []) : (stats ? stats.all : []);
    // The two totals come from two different queries (all-time and the rolling
    // window), so the line above the list always describes the list under it
    // rather than one of them twice.
    const summary = stats
        ? (recent
            ? `最近 7 天播放 ${stats.recent.plays} 次 · ${stats.recent.tracks} 首歌`
            : `共播放 ${stats.total.plays} 次 · ${stats.total.tracks} 首歌`)
        : '';

    const ranking = function () {
        if (loading && !stats) return <p className={styles['rank-state']}>加载中…</p>;
        if (error) {
            return (
                <p className={`${styles['rank-state']} ${styles['rank-state-bad']}`}>
                    {`读取失败：${error}`}
                </p>
            );
        }
        if (!stats) return <p className={styles['rank-state']}>加载中…</p>;
        if (list.length === 0) {
            return (
                <p className={styles['rank-state']}>
                    {recent ? '最近 7 天还没有播放记录' : '还没有播放记录，听几首歌就有了'}
                </p>
            );
        }
        return (
            <ol className={styles['rank-list']}>
                {list.map((row, index) => {
                    const { artist, title } = parseTrackName(row.name);
                    return (
                        <li key={row.id} className={styles['rank-item']}>
                            {/* The position is the payload of this list, so it
                                is drawn rather than implied by the order. */}
                            <span className={styles['rank-index']} aria-hidden="true">{index + 1}</span>
                            <span className={styles['rank-text']}>
                                <span className={styles['rank-title']}>{title}</span>
                                <span className={styles['rank-artist']}>
                                    {artist}
                                    {row.lastAt ? ` · ${formatAgo(row.lastAt)}` : ''}
                                </span>
                            </span>
                            <span className={styles['rank-count']}>{`${row.count} 次`}</span>
                        </li>
                    );
                })}
            </ol>
        );
    };

    return (
        <SheetChrome
            title="听歌排行"
            closing={closing}
            onClosed={onClosed}
            onCancelClose={onCancelClose}
            onClose={onClose}
            /* The panel's one control, where 音乐库 keeps its ⟳: it re-asks the
               database for *both* rankings, so it belongs to the panel rather
               than to the 全部 / 最近 7 天 switch — it is not "refresh this tab",
               it is "ask again". */
            action={{
                onClick: reload,
                disabled: loading,
                title: '刷新排行',
                icon: (
                    <span className={loading ? styles.spinning : undefined}>
                        <IconRefresh />
                    </span>
                ),
            }}
        >
            <div className={styles.body}>
                {!qq ? (
                    /* Reachable only if the number is cleared while this panel is
                       up (another tab, a second window). The panel has no way of
                       its own to fix that, so it says the one useful thing and
                       hands over to 账号. */
                    <section className={styles.group}>
                        <div className={styles.empty}>
                            <p className={styles.hint}>
                                听歌次数按 QQ 号记录，所以要先确认一个号码。
                                确认之后这里会显示你自己的播放次数排行，可以看全部，也可以看最近 7 天。
                            </p>
                            <button
                                type="button"
                                className={styles['primary-btn']}
                                onClick={onGoAccount}
                            >
                                去确认 QQ 号
                            </button>
                        </div>
                    </section>
                ) : (
                    <section className={styles.group}>
                        <div className={styles['rank-head']}>
                            <div className={styles['rank-tabs']} role="tablist" aria-label="排行范围">
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={!recent}
                                    className={`${styles['rank-tab']}${!recent ? ` ${styles['rank-tab-on']}` : ''}`}
                                    onClick={() => setScope('all')}
                                >
                                    全部
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={recent}
                                    className={`${styles['rank-tab']}${recent ? ` ${styles['rank-tab-on']}` : ''}`}
                                    onClick={() => setScope('recent')}
                                >
                                    最近 7 天
                                </button>
                            </div>
                        </div>
                        {/* Only when there is a list under it: with nothing to show,
                            "共播放 0 次" and the empty message are the same sentence
                            twice. */}
                        {summary && list.length > 0 && (
                            <p className={styles['rank-summary']}>{summary}</p>
                        )}
                        {ranking()}
                    </section>
                )}

                <p className={styles.footnote}>
                    {qq
                        ? '只统计确认 QQ 号之后的播放；记录先写在本机，联网时自动上传，也可以在账号面板里手动同步。'
                        : '播放记录先写在本机，联网时再上传；上传失败也不会影响听歌。'}
                </p>
            </div>
        </SheetChrome>
    );
};

export default StatsPage;
