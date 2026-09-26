import React from 'react';

import {
    FX_SLIDERS,
    FX_RANGES,
    LYRIC_FX,
    LYRIC_FX_LABELS,
    LYRIC_MODES,
    LYRIC_MODE_LABELS,
    PRESET_ORDER,
    PRESETS_BY_ID,
} from './visualPresets';

import styles from './FxConsole.module.scss';

/**
 * The visual console: every knob the particle field exposes.
 *
 * Laid out the way a reference console is — **presets first as a grid of
 * cards**, then the amounts as sliders, then the layers as switches — because
 * the whole point of the page is that these twelve look different. A name in
 * a dropdown gives the visitor nothing to compare against; a card with a
 * drawing of its shape does.
 *
 * The icons are drawn here rather than shipped as a sprite: twelve small
 * paths is less code than a loader, and they inherit the text colour so the
 * whole console re-themes with one variable.
 */

const PresetIcon = function ({ name }) {
    const common = {
        width: 18,
        height: 18,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
    };
    switch (name) {
        case 'cover':
            return (
                <svg {...common}>
                    <path d="M3 14c3-2 5-2 8 0s5 2 8 0" />
                    <path d="M3 9c3-2 5-2 8 0s5 2 8 0" />
                    <path d="M3 19c3-2 5-2 8 0s5 2 8 0" />
                </svg>
            );
        case 'tunnel':
            return (
                <svg {...common}>
                    <circle cx="12" cy="12" r="9" />
                    <circle cx="12" cy="12" r="5" />
                    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
                </svg>
            );
        case 'orbit':
            return (
                <svg {...common}>
                    <circle cx="12" cy="12" r="7" />
                    <path d="M5 12a7 7 0 0 0 14 0" />
                    <path d="M4 8c2 1 3 1 4 0" />
                </svg>
            );
        case 'void':
            return (
                <svg {...common}>
                    <circle cx="12" cy="12" r="7" />
                    <path d="M8.8 8.8l6.4 6.4" />
                </svg>
            );
        case 'vinyl':
            return (
                <svg {...common}>
                    <circle cx="12" cy="12" r="8.5" />
                    <circle cx="12" cy="12" r="4.4" />
                    <path d="M17 5.4c1.8.8 3 2 3.6 3.8" />
                </svg>
            );
        case 'galaxy':
            return (
                <svg {...common}>
                    <path d="M3 15c2.2-4.4 4.4-4.4 6.6 0s4.4 4.4 6.6 0 3.4-4.4 4.8 0" />
                    <path d="M3 9c2.2 2.2 4.4 2.2 6.6 0s4.4-2.2 6.6 0 3.4 2.2 4.8 0" />
                    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
                </svg>
            );
        case 'requiem':
            return (
                <svg {...common}>
                    <path d="M10 3.5h4v6h4.2v3.6H14v7.4h-4v-7.4H5.8V9.5H10z" />
                </svg>
            );
        case 'sonic':
            return (
                <svg {...common}>
                    <path d="M3 18c2-3 4-3 6 0s4 3 6 0 4-3 6 0" />
                    <path d="M3 12c2-2.5 4-2.5 6 0s4 2.5 6 0 4-2.5 6 0" />
                    <path d="M3 6c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
                </svg>
            );
        case 'halo':
            return (
                <svg {...common} strokeWidth={1.4}>
                    <ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(-18 12 12)" />
                    <ellipse cx="12" cy="12" rx="6.3" ry="2.2" transform="rotate(24 12 12)" />
                    <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
                </svg>
            );
        case 'rain':
            return (
                <svg {...common} strokeWidth={1.4}>
                    <path d="M5 3v8M9 2v15M13 5v8M17 2v18M21 6v9" />
                    <path d="M4 19c4-3 8 3 16-1" opacity="0.7" />
                </svg>
            );
        case 'prism':
            return (
                <svg {...common} strokeWidth={1.35}>
                    <path d="M12 12 3 6l3 9 6-3 6 3 3-9-9 6Z" />
                    <path d="M12 12V4M6 15l3 4 3-7 3 7 3-4" />
                </svg>
            );
        case 'abyss':
            return (
                <svg {...common} strokeWidth={1.35}>
                    <path d="M12 20c-1-5-7-5-7-10 4 0 6 2 7 5 1-3 3-5 7-5 0 5-6 5-7 10Z" />
                    <path d="M12 15c-3-3-2-7 0-11 2 4 3 8 0 11Z" />
                </svg>
            );
        default:
            return (
                <svg {...common}>
                    <circle cx="12" cy="12" r="8" />
                </svg>
            );
    }
};

const LAYERS = [
    { key: 'starRiver', label: '背景星河', hint: '画面后方的尘埃场' },
    { key: 'lyricRiver', label: '歌词星河', hint: '歌词周围的火花' },
    { key: 'ripples', label: '封面涟漪', hint: '低频推开的扩散波纹' },
    { key: 'cinema', label: '电影镜头', hint: '鼓点推镜头与微震' },
    { key: 'palette', label: '封面取色', hint: '用封面主色统一色调' },
];

const FxConsole = function ({ preset, onPreset, fx, onFx }) {
    const setFlag = (key) => (event) => onFx(key, event.target.checked);
    const setSlider = (key) => (event) => onFx(key, Number(event.target.value));

    return (
        <>
            <section className={styles.section}>
                <h3 className={styles.title}>视觉预设</h3>
                <div className={styles.grid}>
                    {PRESET_ORDER.map((id) => {
                        const item = PRESETS_BY_ID[id];
                        if (!item) return null;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                className={`${styles.card}${preset === item.id ? ` ${styles['card-on']}` : ''}${item.premium ? ` ${styles['card-premium']}` : ''}`}
                                onClick={() => onPreset(item.id)}
                                aria-pressed={preset === item.id}
                                style={item.accent ? { '--card-accent': item.accent } : undefined}
                            >
                                <span className={styles.icon} aria-hidden="true">
                                    <PresetIcon name={item.icon} />
                                </span>
                                <span className={styles.text}>
                                    <span className={styles.name}>
                                        {item.name}
                                        {item.en ? <span className={styles.en}>{item.en}</span> : null}
                                    </span>
                                    <span className={styles.sub}>{item.sub}</span>
                                </span>
                                {item.premium ? <span className={styles.badge}>PRO</span> : null}
                            </button>
                        );
                    })}
                </div>
            </section>

            <section className={styles.section}>
                <h3 className={styles.title}>主控</h3>
                {FX_SLIDERS.map((slider) => {
                    const range = FX_RANGES[slider.key];
                    return (
                        <label key={slider.key} className={styles.slider}>
                            <span className={styles['slider-label']}>{slider.label}</span>
                            <input
                                type="range"
                                min={range.min}
                                max={range.max}
                                step={range.step}
                                value={fx[slider.key]}
                                onChange={setSlider(slider.key)}
                            />
                            <output className={styles['slider-value']}>
                                {Number(fx[slider.key]).toFixed(2)}
                            </output>
                        </label>
                    );
                })}
                <p className={styles.note}>封面清晰度提高会重新采样封面，拖动结束后有一次重新汇聚。</p>
            </section>

            <section className={styles.section}>
                <h3 className={styles.title}>叠加图层</h3>
                {LAYERS.map((layer) => (
                    <label key={layer.key} className={styles.toggle}>
                        <span className={styles['toggle-text']}>
                            {layer.label}
                            <span className={styles.hint}>{layer.hint}</span>
                        </span>
                        <input
                            type="checkbox"
                            checked={Boolean(fx[layer.key])}
                            onChange={setFlag(layer.key)}
                        />
                        <span className={styles['toggle-ui']} aria-hidden="true" />
                    </label>
                ))}
            </section>

            <section className={styles.section}>
                <h3 className={styles.title}>歌词舞台</h3>
                <div className={styles.row}>
                    <span className={styles.label}>行数</span>
                    <div className={styles.seg}>
                        {LYRIC_MODES.map((mode) => (
                            <button
                                key={mode}
                                type="button"
                                className={`${styles['seg-btn']}${fx.lyricMode === mode ? ` ${styles['seg-on']}` : ''}`}
                                onClick={() => onFx('lyricMode', mode)}
                                aria-pressed={fx.lyricMode === mode}
                            >
                                {LYRIC_MODE_LABELS[mode]}
                            </button>
                        ))}
                    </div>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>出场动效</span>
                    <div className={styles.seg}>
                        {LYRIC_FX.map((mode) => (
                            <button
                                key={mode}
                                type="button"
                                className={`${styles['seg-btn']}${fx.lyricFx === mode ? ` ${styles['seg-on']}` : ''}`}
                                onClick={() => onFx('lyricFx', mode)}
                                aria-pressed={fx.lyricFx === mode}
                            >
                                {LYRIC_FX_LABELS[mode]}
                            </button>
                        ))}
                    </div>
                </div>
            </section>
        </>
    );
};

export default FxConsole;
