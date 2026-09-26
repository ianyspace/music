import React, { useEffect, useRef, useState } from 'react';

import { IconClose } from '../../icons';
import FxConsole from './FxConsole';
import { presetDisplayOrder } from './visual/presetData';

import styles from './ImmersiveSettings.module.scss';

/**
 * The immersive page's settings: a glass popover dropping from the corner
 * gear. Everything stored about this page is changed here and nowhere else —
 * the visual console (preset, amounts, layers), the custom background
 * library, the readability filter, the account (QQ) entry, and the page's
 * behaviour switches.
 *
 * The popover closes on Escape and on an outside click; the closing animation
 * is the scrim pattern the shell already uses elsewhere (wait for the fade,
 * then unmount).
 */

// What kind of thing a pasted URL points at, from its path alone. A query
// string is fine — the test runs on the pathname.
const typeOfUrl = function (url) {
    try {
        const path = new URL(url, window.location.href).pathname.toLowerCase();
        if (/\.(gif)$/.test(path)) return 'gif';
        if (/\.(jpe?g|png|webp|avif)$/.test(path)) return 'image';
        return 'video';
    } catch (error) {
        return 'video';
    }
};

const ImmersiveSettings = function ({
    open,
    closing,
    onClose,
    onAnimationEnd,
    bgMode,
    onBgMode,
    customItems,
    selectedId,
    onAddCustom,
    onRemoveCustom,
    onSelectCustom,
    filter,
    onFilter,
    autoCollapse,
    onAutoCollapse,
    lyricInNebula,
    onLyricInNebula,
    ambient,
    onAmbient,
    preset,
    onPreset,
    fx,
    onFx,
    palette,
    qqBound = false,
    onOpenAccount,
}) {
    const rootRef = useRef(null);
    const [urlDraft, setUrlDraft] = useState('');
    const [urlInvalid, setUrlInvalid] = useState(false);

    // Escape closes; a click anywhere outside closes too.
    useEffect(() => {
        if (!open || closing) return undefined;
        const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
        const onPointerDown = (event) => {
            if (rootRef.current && !rootRef.current.contains(event.target)) onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('pointerdown', onPointerDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('pointerdown', onPointerDown);
        };
    }, [open, closing, onClose]);

    if (!open) return null;

    const submitUrl = function (event) {
        event.preventDefault();
        const url = urlDraft.trim();
        let parsed;
        try {
            parsed = new URL(url, window.location.href);
        } catch (error) {
            parsed = null;
        }
        if (!parsed || !/^https?:$/.test(parsed.protocol)) {
            setUrlInvalid(true);
            return;
        }
        if (customItems.some((item) => item.url === parsed.href)) {
            setUrlInvalid(true);
            return;
        }
        setUrlInvalid(false);
        onAddCustom({
            id: `custom-${Date.now()}`,
            type: typeOfUrl(url),
            url: parsed.href,
        });
        setUrlDraft('');
    };

    return (
        <div
            ref={rootRef}
            className={`${styles.root}${closing ? ` ${styles['root-closing']}` : ''}`}
            role="dialog"
            aria-modal="false"
            aria-label="沉浸页设置"
            onAnimationEnd={onAnimationEnd}
        >
            <header className={styles.head}>
                <h2 className={styles.title}>沉浸页设置</h2>
                <button type="button" className={styles.close} onClick={onClose} aria-label="关闭设置">
                    <IconClose size={16} />
                </button>
            </header>

            {/* --- background -------------------------------------------------- */}
            <section className={styles.section}>
                <h3 className={styles['section-title']}>背景</h3>
                <div className={styles['mode-row']}>
                    <button
                        type="button"
                        className={`${styles['mode-card']}${bgMode === 'nebula' ? ` ${styles['mode-on']}` : ''}`}
                        onClick={() => onBgMode('nebula')}
                        aria-pressed={bgMode === 'nebula'}
                    >
                        <span className={styles['mode-swatch']} data-mode="nebula" aria-hidden="true" />
                        <span>
                            <span className={styles['mode-name']}>粒子视觉</span>
                            <span className={styles['mode-sub']}>{presetDisplayOrder.length} 种预设 · 默认</span>
                        </span>
                    </button>
                    <button
                        type="button"
                        className={`${styles['mode-card']}${bgMode === 'custom' ? ` ${styles['mode-on']}` : ''}`}
                        onClick={() => onBgMode('custom')}
                        aria-pressed={bgMode === 'custom'}
                    >
                        <span className={styles['mode-swatch']} data-mode="custom" aria-hidden="true" />
                        <span>
                            <span className={styles['mode-name']}>自定义背景</span>
                            <span className={styles['mode-sub']}>视频 / 图片</span>
                        </span>
                    </button>
                </div>

                {/* 氛围底色: 关 = 纯黑底(和上游一致), 开 = 歌曲渐变光晕 +
                    模糊封面垫在画布下。两种背景模式都受它管。 */}
                <label className={styles.toggle}>
                    <span>氛围底色（渐变光晕 + 封面模糊）</span>
                    <input
                        type="checkbox"
                        checked={ambient}
                        onChange={(event) => onAmbient(event.target.checked)}
                    />
                    <span className={styles['toggle-ui']} aria-hidden="true" />
                </label>

                {bgMode === 'custom' && (
                    <div className={styles.library}>
                        <p className={styles['preset-item']}>
                            <button
                                type="button"
                                className={`${styles['bg-item']}${selectedId === 'preset' ? ` ${styles['bg-item-on']}` : ''}`}
                                onClick={() => onSelectCustom('preset')}
                            >
                                <span className={styles['bg-swatch']} data-kind="preset" aria-hidden="true" />
                                氛围流光（内置预设）
                            </button>
                        </p>
                        {customItems.map((item) => (
                            <p key={item.id} className={styles['preset-item']}>
                                <button
                                    type="button"
                                    className={`${styles['bg-item']}${selectedId === item.id ? ` ${styles['bg-item-on']}` : ''}`}
                                    onClick={() => onSelectCustom(item.id)}
                                    title={item.url}
                                >
                                    <span className={styles['bg-swatch']} data-kind={item.type} aria-hidden="true" />
                                    <span className={styles['bg-name']}>{item.url}</span>
                                </button>
                                <button
                                    type="button"
                                    className={styles['bg-remove']}
                                    aria-label="删除这个背景"
                                    title="删除"
                                    onClick={() => onRemoveCustom(item.id)}
                                >
                                    ×
                                </button>
                            </p>
                        ))}
                        <form className={styles['url-form']} onSubmit={submitUrl}>
                            <input
                                type="url"
                                className={`${styles['url-input']}${urlInvalid ? ` ${styles['url-bad']}` : ''}`}
                                placeholder="粘贴视频或图片直链（https://…）"
                                value={urlDraft}
                                onChange={(event) => {
                                    setUrlDraft(event.target.value);
                                    setUrlInvalid(false);
                                }}
                                aria-label="背景地址"
                            />
                            <button type="submit" className={styles['url-add']}>添加</button>
                        </form>
                        {urlInvalid && (
                            <p className={styles['url-hint']}>地址要是一个 http(s) 链接，并且没有添加过。</p>
                        )}
                    </div>
                )}

                <FxConsole
                    preset={preset}
                    onPreset={onPreset}
                    fx={fx}
                    onFx={onFx}
                    palette={palette}
                />

                {bgMode === 'custom' && (
                    <div className={styles.row}>
                        <span className={styles['row-label']}>歌词可读性</span>
                        <input
                            type="range"
                            min={0}
                            max={100}
                            value={filter}
                            onChange={(event) => onFilter(Number(event.target.value))}
                            style={{ '--fill': `${filter}%` }}
                            className={styles.filter}
                            aria-label="歌词可读性滤镜强度"
                        />
                    </div>
                )}
            </section>

            {/* --- behaviour --------------------------------------------------- */}
            <section className={styles.section}>
                <h3 className={styles['section-title']}>行为</h3>
                <label className={styles.toggle}>
                    <span>播放时歌单自动收起</span>
                    <input
                        type="checkbox"
                        checked={autoCollapse}
                        onChange={(event) => onAutoCollapse(event.target.checked)}
                    />
                    <span className={styles['toggle-ui']} aria-hidden="true" />
                </label>
                <label className={styles.toggle}>
                    <span>星云模式下显示歌词</span>
                    <input
                        type="checkbox"
                        checked={lyricInNebula}
                        onChange={(event) => onLyricInNebula(event.target.checked)}
                    />
                    <span className={styles['toggle-ui']} aria-hidden="true" />
                </label>
            </section>

            {/* --- account ---------------------------------------------------
                以前是歌单顶部的 logo(MarkNote): 它既是应用标记又是账号入口。
                logo 去掉后账号只能从这里进, 所以这行同时要把绑定状态说清楚。 */}
            <section className={styles.section}>
                <h3 className={styles['section-title']}>账号</h3>
                <div className={styles.row}>
                    <span
                        className={`${styles['row-label']} ${styles['account-state']}${qqBound ? ` ${styles['account-on']}` : ''}`}
                    >
                        QQ 音乐{qqBound ? ' · 已绑定' : ' · 未绑定'}
                    </span>
                    <button
                        type="button"
                        className={styles.mini}
                        onClick={onOpenAccount}
                    >
                        {qqBound ? '管理' : '绑定'}
                    </button>
                </div>
            </section>
        </div>
    );
};

export default ImmersiveSettings;
