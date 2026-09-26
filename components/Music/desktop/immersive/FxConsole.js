import React from 'react';

import {
    DENSITY_LABELS,
    LYRIC_FX,
    LYRIC_FX_LABELS,
    LYRIC_MODES,
    LYRIC_MODE_LABELS,
    MOTION_LABELS,
    VISUAL_PRESETS,
} from './visualPresets';

import styles from './FxConsole.module.scss';

/**
 * The visual console: every knob the page's particle field exposes.
 *
 * The presets are a *grid of modes*, not a dropdown, because the whole point
 * of the page is that these look different — a name in a select box gives the
 * visitor nothing to compare against. Each card carries a swatch drawn in CSS
 * from the same shapes the shader draws in pixels.
 *
 * Below the modes sit two kinds of control:
 * - **amounts** (intensity, density, motion) — segmented, because the steps
 *   are named and the middle one is the default;
 * - **layers** (star river, lyric river, ripples, the beat camera, cover
 *   palette) — switches, because they are independent additions to whatever
 *   preset is on screen.
 */

const INTENSITY_LABELS = { calm: '轻', standard: '标准', strong: '强' };

const LAYERS = [
    { key: 'starRiver', label: '背景星河', hint: '画面后方的尘埃场' },
    { key: 'lyricRiver', label: '歌词星河', hint: '歌词周围的火花' },
    { key: 'ripples', label: '封面涟漪', hint: '低频推开的扩散波纹' },
    { key: 'cinema', label: '电影镜头', hint: '鼓点推镜头与微震' },
    { key: 'palette', label: '封面取色', hint: '用封面主色统一色调' },
];

const FxConsole = function ({
    preset,
    onPreset,
    intensity,
    onIntensity,
    density,
    onDensity,
    motion,
    onMotion,
    fx,
    onFx,
}) {
    const setFlag = (key) => (event) => onFx(key, event.target.checked);

    return (
        <>
            <section className={styles.section}>
                <h3 className={styles.title}>视觉预设</h3>
                <div className={styles.grid}>
                    {VISUAL_PRESETS.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className={`${styles.card}${preset === item.id ? ` ${styles['card-on']}` : ''}`}
                            onClick={() => onPreset(item.id)}
                            aria-pressed={preset === item.id}
                        >
                            <span className={styles.swatch} data-preset={item.id} aria-hidden="true" />
                            <span className={styles.text}>
                                <span className={styles.name}>{item.name}</span>
                                <span className={styles.sub}>{item.sub}</span>
                            </span>
                        </button>
                    ))}
                </div>
            </section>

            <section className={styles.section}>
                <h3 className={styles.title}>强度与密度</h3>
                <div className={styles.row}>
                    <span className={styles.label}>律动强度</span>
                    <div className={styles.seg}>
                        {Object.keys(INTENSITY_LABELS).map((level) => (
                            <button
                                key={level}
                                type="button"
                                className={`${styles['seg-btn']}${intensity === level ? ` ${styles['seg-on']}` : ''}`}
                                onClick={() => onIntensity(level)}
                                aria-pressed={intensity === level}
                            >
                                {INTENSITY_LABELS[level]}
                            </button>
                        ))}
                    </div>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>粒子密度</span>
                    <div className={styles.seg}>
                        {Object.keys(DENSITY_LABELS).map((level) => (
                            <button
                                key={level}
                                type="button"
                                className={`${styles['seg-btn']}${density === level ? ` ${styles['seg-on']}` : ''}`}
                                onClick={() => onDensity(level)}
                                aria-pressed={density === level}
                            >
                                {DENSITY_LABELS[level]}
                            </button>
                        ))}
                    </div>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>运动感</span>
                    <div className={styles.seg}>
                        {Object.keys(MOTION_LABELS).map((level) => (
                            <button
                                key={level}
                                type="button"
                                className={`${styles['seg-btn']}${motion === level ? ` ${styles['seg-on']}` : ''}`}
                                onClick={() => onMotion(level)}
                                aria-pressed={motion === level}
                            >
                                {MOTION_LABELS[level]}
                            </button>
                        ))}
                    </div>
                </div>
                <p className={styles.note}>密度提高会重新采样封面，切换时会有一次重新汇聚。</p>
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
