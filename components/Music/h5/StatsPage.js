import React, { useState } from 'react';

import { formatAgo } from '../playStats';
import { parseTrackName } from '../shared';
import { IconPerson, IconRefresh } from '../icons';

import styles from './StatsPage.module.scss';

/**
 * 听歌排行 — the visitor's own play counts, as a page of its own.
 *
 * It used to be a card at the bottom of 账号. It moved out for two reasons: a
 * list of up to fifty songs is a *destination*, not a settings card, and it is
 * only meaningful for a visitor who has bound a QQ number — so as a page it can
 * simply not exist for everyone else, instead of being a card that has to
 * explain its own emptiness.
 *
 * Everything stateful arrives as props (`stats` / `loading` / `error` /
 * `reload`, from `usePlayStats`), and the page owns only `scope`: which of the
 * two rankings is on screen. That is view state, like the search box — the
 * choice is not worth remembering across visits, and a page that came back on
 * 最近 7 天 with no memory of why would read as a bug.
 *
 * The data is fetched by the hook while `active` (the page being *on screen*,
 * not merely mounted — all three tab pages stay mounted, see `MusicApp`).
 * Uploading what is still local is deliberately *not* here: it is one row on
 * 账号, next to the number it is about, and a page about listening is not the
 * place to administer a queue.
 */
const StatsPage = function ({ qq, stats, loading, error, reload, onGoAccount }) {
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
        <div className={styles.page}>
            <header className={styles.head}>
                <div className={styles['head-row']}>
                    <h1 className={styles.title}>听歌排行</h1>
                    <div className={styles['head-actions']}>
                        {/* Back where the visitor came from. This page has no
                            list to go to — 歌曲 is one hop further, through the
                            page that opened this one — so the single entry here
                            is the page above it, not a third destination. */}
                        <button
                            type="button"
                            className={styles['nav-btn']}
                            title="账号"
                            onClick={onGoAccount}
                        >
                            <IconPerson />
                            <span>账号</span>
                        </button>
                        {/* Reloads both rankings, so it belongs to the page
                            rather than to the 全部 / 最近 7 天 control: it is
                            not "refresh this tab", it is "ask the database
                            again". */}
                        <button
                            type="button"
                            className={`${styles['refresh-btn']}${loading ? ` ${styles.spinning}` : ''}`}
                            title="刷新排行"
                            aria-label="刷新排行"
                            disabled={loading}
                            onClick={reload}
                        >
                            <IconRefresh />
                        </button>
                    </div>
                </div>
            </header>

            {!qq ? (
                <section className={styles.group}>
                    <div className={styles.empty}>
                        <p className={styles.hint}>
                            听歌次数按 QQ 号记录，所以要先绑定一个号码。
                            绑定之后这里会显示你自己的播放次数排行，可以看全部，也可以看最近 7 天。
                        </p>
                        <button
                            type="button"
                            className={styles['primary-btn']}
                            onClick={onGoAccount}
                        >
                            去绑定 QQ 号
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
                    ? '只统计绑定 QQ 号之后的播放；记录先写在本机，联网时自动上传，也可以在账号页手动同步。'
                    : '播放记录先写在本机，联网时再上传；上传失败也不会影响听歌。'}
            </p>
        </div>
    );
};

export default StatsPage;
