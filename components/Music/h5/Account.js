import React, { useEffect, useState } from 'react';

import { normalizeQq } from '../shared';
import {
    IconArchive,
    IconChart,
    IconChevronRight,
    IconCloud,
    IconMoon,
    IconNote,
    IconNoteList,
    IconRefresh,
    IconSun,
} from '../icons';

import styles from './Account.module.scss';

/**
 * The "账号" screen, reached by tapping the app's mark in the song list's top
 * bar.
 *
 * It holds everything about *this visitor*: who they are, what data of theirs
 * is still only on this device, the appearance switch, and the cache. Those
 * last two used to sit in the list's three-dots drawer next to 谷歌云盘链接,
 * which made that drawer a mix of two unrelated things — a library action and
 * personal settings. Both the drawer and its ⋮ are gone now, 谷歌云盘链接 went
 * to 「我的」 (the page about which songs are here), and this page holds the
 * personal half.
 *
 * The QQ number is the visitor's, not the app's: it is stored in this browser
 * (`QQ_KEY`) and it is now the key *everything personal* is recorded under —
 * play counts (`playStats.js`) and 我喜欢 (`likes.js`) both live in the Worker's
 * D1 database under this number. The number is still *not* verified: see
 * `normalizeQq`. What it buys is exactly two things — an avatar, and a place to
 * put your own data — and the page says so out loud rather than hiding it in a
 * privacy footnote.
 *
 * **The page says whether the number took, twice.** The identity card carries a
 * 已确认 / 未确认 badge (the word), and the list's app mark carries a dot in the
 * same colour (the glance). Before this, "did my number get saved?" had no
 * answer on screen: the field kept whatever was typed, the title showed a
 * number either way, and the avatar might not have loaded — three signals, none
 * of which was a confirmation. The word 确认 is used throughout rather than
 * 绑定, because that is the verb the visitor performs.
 *
 * The ranking used to be a card on this page. It is its own page now
 * (`StatsPage`): a list of up to fifty songs is a destination, not a settings
 * card, and putting it behind a row keeps this page about *who you are* rather
 * than about numbers. This page keeps the two things that are genuinely its
 * own — confirming the number, and getting the queues off the device.
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
    onGoProfile,
    onGoStats,
    dataSync,
}) {
    // The field is a draft, not the setting: nothing is stored until 确定, so
    // a half-typed number never becomes the avatar. It follows the stored value
    // when that changes elsewhere (a clear, a second tab), which is why it is
    // an effect rather than an initial value only.
    const [draft, setDraft] = useState(qq);
    const [invalid, setInvalid] = useState(false);

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

    /* --- 我的数据 --- */

    const { pending, ready, syncing, notice, sync } = dataSync;

    // The card appears when there is something in it: a number to show a
    // ranking for, or a queue worth talking about. It is *not* gated on `qq`
    // alone, because clearing the QQ field does not clear the plays and likes
    // already waiting under the old number — those still have to be sendable.
    //
    // `ready` gates the "已全部上传" claim for the same reason as in
    // `useDataSync`: before the queues have been counted there is no answer,
    // and an empty card would be a claim about a question nobody asked.
    const showData = Boolean(qq) || (ready && (pending > 0 || Boolean(notice)));

    return (
        <div className={styles.page}>
            <header className={styles.head}>
                <div className={styles['head-row']}>
                    <h1 className={styles.title}>账号</h1>
                    <div className={styles['head-actions']}>
                        {/* The other half of the visitor's settings. Until this
                            capsule existed, 「我的」 was reachable only from the
                            song list's "the library is empty" prompt — which
                            meant a page about the library you are browsing could
                            not be opened while you were browsing it. The two
                            pages point at each other now, and 歌曲 is one more
                            tap from either. */}
                        <button type="button" className={styles['nav-btn']} onClick={onGoProfile} title="我的">
                            <IconCloud />
                            <span>我的</span>
                        </button>
                        <button type="button" className={styles['nav-btn']} onClick={onGoList} title="歌曲">
                            <IconNoteList />
                            <span>歌曲</span>
                        </button>
                    </div>
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
                        {/* Name and state on one line, so the badge sits next to
                            the thing it describes rather than floating at the
                            card's edge. The name is what changes; the badge is
                            the *verdict*, in a word — before it, the only
                            evidence a number had been accepted was the title
                            above and an avatar that may or may not have loaded,
                            and neither of those reads as a confirmation.

                            Green, and the same green as the dot on the list's
                            app mark: one state, one colour, wherever it is
                            drawn. */}
                        <span className={styles['identity-head']}>
                            <span className={styles['identity-name']}>
                                {qq ? `QQ ${qq}` : '访客'}
                            </span>
                            <span className={qq ? `${styles.badge} ${styles['badge-on']}` : styles.badge}>
                                {qq ? '已确认' : '未确认'}
                            </span>
                        </span>
                        {/* Three states, said plainly: no number, a number whose
                            picture is on screen, and a number whose picture did
                            not arrive. The middle one is the only one that needs
                            no explanation, and the last one has to admit it —
                            otherwise the note disc looks like the app ignored
                            what was just typed. */}
                        <span className={styles['identity-sub']}>
                            {!qq
                                ? '确认一个 QQ 号，听歌次数和喜欢才有归属'
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
                        placeholder={qq ? '换一个 QQ 号' : '输入 QQ 号'}
                        aria-label="QQ 号"
                        value={draft}
                        onChange={(event) => {
                            setDraft(event.target.value);
                            setInvalid(false);
                        }}
                    />
                    <button type="submit" className={styles['qq-save']}>确认</button>
                    {qq && (
                        <button type="button" className={styles['qq-clear']} onClick={clear}>
                            清除
                        </button>
                    )}
                </form>
                <p className={`${styles.hint}${invalid ? ` ${styles['hint-bad']}` : ''}`}>
                    {invalid
                        ? 'QQ 号是 5–11 位数字，再看一眼？'
                        : (qq
                            ? `当前按 ${qq} 记录听歌次数和喜欢。换号后新的记录算在新号码下，旧的不会跟过来。`
                            : '5–11 位数字，保存在这台设备的浏览器里；确认后听歌次数和喜欢都按这个号码记录。')}
                </p>
            </section>

            {/* 我的数据: the visitor's own numbers, and the only place the two
                local queues can be pushed by hand. 听歌排行 leads somewhere;
                数据同步 is an action. They share a card because they share a
                subject, and that subject is not "settings". */}
            {showData && (
                <section className={styles.group}>
                    <div className={styles['group-label']}>我的数据</div>
                    {/* Only with a number: the ranking is per QQ, so with none
                        bound there is nothing to open — and the empty page it
                        would lead to is worse than a row that is not there.
                        (The prompt to bind lives on the pages that need it:
                        the heart in the player, and the row drawer.) */}
                    {qq && (
                        <button
                            type="button"
                            className={`${styles.row} ${styles['row-btn']}`}
                            onClick={onGoStats}
                        >
                            <span className={styles['row-icon']} aria-hidden="true">
                                <IconChart size={20} />
                            </span>
                            <span className={styles['row-label']}>听歌排行</span>
                            <span className={styles['row-chev']}><IconChevronRight /></span>
                        </button>
                    )}
                    {/* The sync row is shown whenever there is something to sync
                        or something to say about it — including when no number
                        is bound, because clearing the QQ field does not clear
                        plays that are already waiting under the old number. */}
                    <div className={styles.row}>
                        <span className={styles['row-icon']} aria-hidden="true">
                            <IconRefresh size={20} />
                        </span>
                        <span className={styles['row-label']}>数据同步</span>
                        <button
                            type="button"
                            // Quiet when there is nothing to send, the accent
                            // button when there is — the same "one button, its
                            // look follows its state" shape as 置顶 and 喜欢.
                            className={`${styles['sync-btn']}${pending > 0 ? ` ${styles['sync-btn-hot']}` : ''}`}
                            disabled={syncing}
                            onClick={sync}
                        >
                            {syncing ? '同步中…' : '同步'}
                        </button>
                    </div>
                    <p className={styles['sync-note']}>
                        {pending > 0
                            ? `本地还有 ${pending} 条数据没上传`
                            : '本地记录已全部上传'}
                    </p>
                    {/* The outcome of the last attempt, on its own line so it
                        reads as an answer to the press rather than as part of
                        the standing sentence above it. */}
                    {notice && <p className={styles['sync-note']}>{notice}</p>}
                </section>
            )}

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
