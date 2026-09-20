import React, { useEffect, useState } from 'react';

import { normalizeQq, parseTrackName } from '../shared';
import { formatAgo } from '../playStats';
import {
    IconArchive,
    IconChevronRight,
    IconMoon,
    IconNote,
    IconNoteList,
    IconRefresh,
    IconSun,
} from '../icons';

import styles from './Account.module.scss';

/**
 * The "账号" screen, reached by tapping the avatar in the song list's top bar.
 *
 * It holds everything about *this visitor*: who the avatar is, what they have
 * been listening to, the appearance switch, and the cache. Those last two used
 * to sit in the list's three-dots drawer next to 谷歌云盘链接, which made that
 * drawer a mix of two unrelated things — a library action and personal
 * settings. The drawer is now the library's alone (one entry), and the settings
 * live behind the face they belong to.
 *
 * The QQ number is the visitor's, not the app's: it is stored in this browser
 * (`QQ_KEY`) and used for two things now — the avatar image, and the key the
 * play counts in 听歌排行 are recorded under. Nothing is sent anywhere except
 * the browser's own request for that picture and the play events themselves,
 * which is why the page says so out loud instead of hiding it in a privacy
 * footnote. The number is still *not* verified: see `normalizeQq`.
 */
const Account = function ({
    qq,
    avatarUrl,
    onAvatarError,
    onSaveQq,
    theme,
    onToggleTheme,
    onOpenCache,
    onGoList,
    playStats,
}) {
    // The field is a draft, not the setting: nothing is stored until 确定, so
    // a half-typed number never becomes the avatar. It follows the stored value
    // when that changes elsewhere (a clear, a second tab), which is why it is
    // an effect rather than an initial value only.
    const [draft, setDraft] = useState(qq);
    const [invalid, setInvalid] = useState(false);
    // Which ranking the card is showing. View state, like the search box — the
    // choice is not worth remembering across visits, and a page that came back
    // on 最近 7 天 with no memory of why would read as a bug.
    const [scope, setScope] = useState('all');

    useEffect(() => { setDraft(qq); }, [qq]);

    const submit = function (event) {
        event.preventDefault();
        const digits = normalizeQq(draft);
        if (!digits) {
            setInvalid(true);
            return;
        }
        setInvalid(false);
        onSaveQq(digits);
    };

    const clear = function () {
        setDraft('');
        setInvalid(false);
        onSaveQq('');
    };

    /* --- 听歌排行 --- */

    const { stats, loading, error, reload, pending, ready, syncing, syncNotice, sync } = playStats;
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
                    <h1 className={styles.title}>账号</h1>
                    <button type="button" className={styles['nav-btn']} onClick={onGoList} title="歌曲">
                        <IconNoteList />
                        <span>歌曲</span>
                    </button>
                </div>
            </header>

            <section className={styles.group}>
                <div className={styles.identity}>
                    <span className={styles['identity-avatar']}>
                        {avatarUrl ? (
                            <img src={avatarUrl} alt="" onError={onAvatarError} />
                        ) : (
                            <IconNote filled />
                        )}
                    </span>
                    <span className={styles['identity-text']}>
                        <span className={styles['identity-name']}>
                            {qq ? `QQ ${qq}` : '还没有绑定 QQ 号'}
                        </span>
                        {/* Three states, said plainly: no number, a number whose
                            picture is on screen, and a number whose picture did
                            not arrive. The middle one is the only one that needs
                            no explanation, and the last one has to admit it —
                            otherwise the note disc looks like the app ignored
                            what was just typed. */}
                        <span className={styles['identity-sub']}>
                            {!qq
                                ? '绑定后，列表左上角的头像会换成 QQ 头像'
                                : (avatarUrl
                                    ? '头像来自 QQ 的公开头像接口'
                                    : 'QQ 头像暂时取不到，先用默认音符')}
                        </span>
                    </span>
                </div>
            </section>

            <section className={styles.group}>
                <div className={styles['group-label']}>QQ 号</div>
                <form className={styles['qq-form']} onSubmit={submit}>
                    <input
                        className={styles['qq-input']}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="输入 QQ 号"
                        aria-label="QQ 号"
                        value={draft}
                        onChange={(event) => {
                            setDraft(event.target.value);
                            setInvalid(false);
                        }}
                    />
                    <button type="submit" className={styles['qq-save']}>确定</button>
                    {qq && (
                        <button type="button" className={styles['qq-clear']} onClick={clear}>
                            清除
                        </button>
                    )}
                </form>
                <p className={`${styles.hint}${invalid ? ` ${styles['hint-bad']}` : ''}`}>
                    {invalid
                        ? 'QQ 号是 5–11 位数字，再看一眼？'
                        : '保存在这台设备的浏览器里；头像由 QQ 的头像接口提供，听歌次数按这个号码记录。'}
                </p>
            </section>

            <section className={styles.group}>
                <div className={styles['group-label']}>听歌排行</div>
                {!qq ? (
                    <p className={styles.hint}>
                        绑定 QQ 号后，这里会显示你自己的播放次数排行（全部 / 最近 7 天）。
                        播放记录先写在本机，联网时再上传；上传失败也不会影响听歌。
                    </p>
                ) : (
                    <>
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
                            <button
                                type="button"
                                className={`${styles['rank-refresh']}${loading ? ` ${styles.spinning}` : ''}`}
                                title="刷新排行"
                                aria-label="刷新排行"
                                disabled={loading}
                                onClick={reload}
                            >
                                <IconRefresh />
                            </button>
                        </div>
                        {/* Only when there is a list under it: with nothing to
                            show, "共播放 0 次" and the empty message are the
                            same sentence twice. */}
                        {summary && list.length > 0 && (
                            <p className={styles['rank-summary']}>{summary}</p>
                        )}
                        {ranking()}
                    </>
                )}
                {/* The sync row is shown whenever there is something to sync or
                    something to say about it — including when no number is
                    bound, because clearing the QQ field does not clear plays
                    that are already waiting under the old number.
                    `ready` gates it: before the log has been counted once there
                    is no answer, and "已全部上传" would be a claim about a
                    question nobody asked. */}
                {ready && (qq || pending > 0 || syncNotice) && (
                    <div className={styles['sync-row']}>
                        <span className={styles['sync-text']}>
                            {pending > 0
                                ? `本地还有 ${pending} 条播放记录没上传`
                                : '本地播放记录已全部上传'}
                            {syncNotice && (
                                <span className={styles['sync-note']}>{syncNotice}</span>
                            )}
                        </span>
                        <button
                            type="button"
                            // Quiet when there is nothing to send, the accent
                            // button when there is — the same "one button, its
                            // look follows its state" shape as 置顶 and 喜欢. A
                            // loud 同步 over an empty log invites a press that
                            // does nothing.
                            className={`${styles['sync-btn']}${pending > 0 ? ` ${styles['sync-btn-hot']}` : ''}`}
                            disabled={syncing}
                            onClick={sync}
                        >
                            {syncing ? '同步中…' : '同步'}
                        </button>
                    </div>
                )}
            </section>

            <section className={styles.group}>
                <div className={styles['group-label']}>偏好</div>
                <button type="button" className={`${styles.row} ${styles['row-btn']}`} onClick={onToggleTheme}>
                    <span className={styles['row-icon']} aria-hidden="true">
                        {theme === 'dark' ? <IconSun size={20} /> : <IconMoon size={20} />}
                    </span>
                    <span className={styles['row-label']}>切换外观</span>
                    <span className={styles['row-value']}>{theme === 'dark' ? '深色' : '浅色'}</span>
                </button>
                <button type="button" className={`${styles.row} ${styles['row-btn']}`} onClick={onOpenCache}>
                    <span className={styles['row-icon']} aria-hidden="true">
                        <IconArchive size={20} />
                    </span>
                    <span className={styles['row-label']}>缓存管理</span>
                    <span className={styles['row-chev']}><IconChevronRight /></span>
                </button>
            </section>

            <p className={styles.footnote}>
                连接或切换自己的云盘曲库，仍然在歌曲列表右上角的菜单里。
            </p>
        </div>
    );
};

export default Account;
