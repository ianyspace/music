import React, { useEffect, useState } from 'react';

import { normalizeQq } from '../shared';
import {
    IconArchive,
    IconChevronRight,
    IconMoon,
    IconNote,
    IconNoteList,
    IconSun,
} from '../icons';

import styles from './Account.module.scss';

/**
 * The "账号" screen, reached by tapping the avatar in the song list's top bar.
 *
 * It holds everything about *this visitor*: who the avatar is, the appearance
 * switch, and the cache. Those last two used to sit in the list's three-dots
 * drawer next to 谷歌云盘链接, which made that drawer a mix of two unrelated
 * things — a library action and personal settings. The drawer is now the
 * library's alone (one entry), and the settings live behind the face they
 * belong to.
 *
 * The QQ number is the visitor's, not the app's: it is stored in this browser
 * (`QQ_KEY`) and used for one thing, the avatar image. Nothing is sent
 * anywhere except the browser's own request for that picture, which is why the
 * page says so out loud instead of hiding it in a privacy footnote.
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
                        : '只保存在这台设备的浏览器里，不会上传；头像由 QQ 的头像接口提供。'}
                </p>
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
