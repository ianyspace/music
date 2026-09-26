import React from 'react';

import {
    lyricColorPresets,
    presetDisplayOrder,
    presetIcons,
    presetMeta,
} from './visual/presetData';

import styles from './FxConsole.module.scss';

/**
 * 视觉控制台 —— 与上游 Mineradio 的 FX 面板同构: 预设卡片网格在最前,
 * 其后是分组滑块, 再后是开关与存档。
 *
 * 之所以不做成折叠/精简版: 这些参数彼此牵制(律动强度会改变频段上限、
 * 封面清晰度会重建粒子网格), 藏起来只会让人调不出想要的效果。
 */

const VISUAL_BASIC = [
    { key: 'intensity', label: '律动强度', min: 0.2, max: 1.6, step: 0.01 },
    { key: 'depth', label: '立体感', min: 0.2, max: 1.8, step: 0.01 },
    { key: 'coverResolution', label: '封面清晰度', min: 0.75, max: 1.55, step: 0.01 },
    { key: 'cinemaShake', label: '镜头晃动', min: 0, max: 1.8, step: 0.01 },
];

const PARTICLE_SHAPE = [
    { key: 'point', label: '粒子大小', min: 0.4, max: 2, step: 0.01 },
    { key: 'speed', label: '流动速度', min: 0, max: 2, step: 0.01 },
    { key: 'twist', label: '扭曲', min: 0, max: 1, step: 0.01 },
    { key: 'color', label: '色彩饱和', min: 0.6, max: 1.8, step: 0.01 },
    { key: 'scatter', label: '离散', min: 0, max: 0.4, step: 0.005 },
    { key: 'bgFade', label: '背景压暗', min: 0, max: 1, step: 0.01 },
];

const LYRIC_PLACEMENT = [
    { key: 'lyricScale', label: '歌词大小', min: 0.35, max: 1.65, step: 0.01 },
    { key: 'lyricOffsetX', label: '水平位置', min: -4, max: 4, step: 0.05 },
    { key: 'lyricOffsetY', label: '垂直位置', min: -2.4, max: 2.7, step: 0.05 },
    { key: 'lyricOffsetZ', label: '景深位置', min: -3.2, max: 3.2, step: 0.05 },
    { key: 'lyricTiltX', label: '上下角度', min: -84, max: 84, step: 1 },
    { key: 'lyricTiltY', label: '左右角度', min: -84, max: 84, step: 1 },
];

const LYRIC_TEXT = [
    { key: 'lyricLetterSpacing', label: '字间距', min: -0.04, max: 0.18, step: 0.005 },
    { key: 'lyricLineHeight', label: '行距', min: 0.72, max: 1.8, step: 0.01 },
    { key: 'lyricWeight', label: '字重', min: 500, max: 900, step: 10 },
    { key: 'lyricEdgeFade', label: '边缘渐隐', min: 0, max: 1, step: 0.01 },
    { key: 'lyricContextOpacity', label: '上下句清晰', min: 0.25, max: 1, step: 0.01 },
    { key: 'lyricMotionSoftness', label: '动画柔顺', min: 0.15, max: 1.2, step: 0.01 },
];

const LYRIC_GLITCH = [
    { key: 'lyricGlitchIntensity', label: '故障强度', min: 0, max: 1.5, step: 0.01 },
    { key: 'lyricGlitchSlice', label: '切片幅度', min: 0, max: 1.4, step: 0.01 },
    { key: 'lyricGlitchChroma', label: '色散强度', min: 0, max: 1.6, step: 0.01 },
    { key: 'lyricGlitchRate', label: '触发速度', min: 0.45, max: 2.2, step: 0.01 },
    { key: 'lyricGlitchJitter', label: '抖动幅度', min: 0, max: 1.8, step: 0.01 },
];

const DISPLAY_MODES = [
    { value: 'single', label: '单行' },
    { value: 'double', label: '双行' },
    { value: 'cinema', label: '影院' },
];

const TRANSLATION_MODES = [
    { value: 'off', label: '关闭' },
    { value: 'multi', label: '多行' },
];

const MOTION_STYLES = [
    { value: 'static', label: '静止' },
    { value: 'float', label: '浮动' },
    { value: 'glitch', label: '故障' },
];

const FONT_CHOICES = [
    { value: 'sans', label: '黑体' },
    { value: 'serif', label: '宋体' },
    { value: 'rounded', label: '圆体' },
];

const QUALITY_CHOICES = [
    { value: 'eco', label: '节能' },
    { value: 'balanced', label: '均衡' },
    { value: 'high', label: '高' },
    { value: 'ultra', label: '极致' },
];

const FPS_CHOICES = [
    { value: 'vsync', label: '跟随' },
    { value: 'adaptive', label: '自适应' },
    { value: '45', label: '45' },
    { value: '60', label: '60' },
    { value: '90', label: '90' },
    { value: '120', label: '120' },
];

const BG_MODES = [
    { value: 'cover', label: '封面' },
    { value: 'color', label: '纯色' },
];

const Slider = function ({ item, value, onChange }) {
    return (
        <label className={styles.slider}>
            <span className={styles['slider-label']}>{item.label}</span>
            <input
                type="range"
                min={item.min}
                max={item.max}
                step={item.step}
                value={value}
                onChange={(event) => onChange(item.key, Number(event.target.value))}
            />
            <output className={styles['slider-value']}>
                {Number(value).toFixed(item.step < 0.01 ? 3 : 2)}
            </output>
        </label>
    );
};

const Seg = function ({ label, value, choices, onChange }) {
    return (
        <div className={styles.row}>
            <span className={styles.label}>{label}</span>
            <div className={styles.seg}>
                {choices.map((choice) => (
                    <button
                        key={choice.value}
                        type="button"
                        className={`${styles['seg-btn']}${String(value) === String(choice.value) ? ` ${styles['seg-on']}` : ''}`}
                        onClick={() => onChange(choice.value)}
                        aria-pressed={String(value) === String(choice.value)}
                    >
                        {choice.label}
                    </button>
                ))}
            </div>
        </div>
    );
};

const Toggle = function ({ label, hint, checked, onChange }) {
    return (
        <label className={styles.toggle}>
            <span className={styles['toggle-text']}>
                {label}
                {hint ? <span className={styles.hint}>{hint}</span> : null}
            </span>
            <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} />
            <span className={styles['toggle-ui']} aria-hidden="true" />
        </label>
    );
};

const ColorPick = function ({ label, value, onChange, swatches }) {
    return (
        <div className={styles.colorRow}>
            <span className={styles.label}>{label}</span>
            <input
                type="color"
                className={styles.colorInput}
                value={value}
                onChange={(event) => onChange(event.target.value)}
            />
            {swatches ? (
                <div className={styles.swatches}>
                    {swatches.map((item) => (
                        <button
                            key={item.color}
                            type="button"
                            className={styles.swatch}
                            style={{ background: item.color }}
                            title={item.name}
                            onClick={() => onChange(item.color)}
                            aria-label={item.name}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
};

const FxConsole = function ({ preset, onPreset, fx, onFx, palette }) {
    const presetOrder = presetDisplayOrder.filter((id) => id >= 0 && id < presetMeta.length);

    return (
        <>
            <section className={styles.section}>
                <h3 className={styles.title}>视觉预设</h3>
                <div className={styles.grid}>
                    {presetOrder.map((id) => {
                        const item = presetMeta[id];
                        const premium = Boolean(item.premiumVisual);
                        return (
                            <button
                                key={id}
                                type="button"
                                className={`${styles.card}${preset === id ? ` ${styles['card-on']}` : ''}${premium ? ` ${styles['card-premium']}` : ''}`}
                                onClick={() => onPreset(id)}
                                aria-pressed={preset === id}
                                style={premium ? { '--card-accent': item.accent, '--card-accent-2': item.accent2 } : undefined}
                            >
                                <span
                                    className={styles.icon}
                                    aria-hidden="true"
                                    dangerouslySetInnerHTML={{ __html: presetIcons[id] || '' }}
                                />
                                <span className={styles.text}>
                                    <span
                                        className={styles.name}
                                        dangerouslySetInnerHTML={{ __html: item.nameHtml || item.name }}
                                    />
                                    <span
                                        className={styles.sub}
                                        dangerouslySetInnerHTML={{ __html: item.descHtml || item.desc }}
                                    />
                                </span>
                                {premium ? <span className={styles.badge}>PRO</span> : null}
                            </button>
                        );
                    })}
                </div>
            </section>

            <section className={styles.section}>
                <h3 className={styles.title}>画面基础</h3>
                {VISUAL_BASIC.map((item) => (
                    <Slider key={item.key} item={item} value={fx[item.key]} onChange={onFx} />
                ))}
                <p className={styles.note}>封面清晰度会重建粒子网格，拖动结束后会重新汇聚一次。</p>
            </section>

            <section className={styles.section}>
                <h3 className={styles.title}>粒子形态</h3>
                {PARTICLE_SHAPE.map((item) => (
                    <Slider key={item.key} item={item} value={fx[item.key]} onChange={onFx} />
                ))}
            </section>

            <section className={styles.section}>
                <h3 className={styles.title}>泛光与色调</h3>
                <Toggle
                    label="粒子泛光"
                    hint="叠加一层放大的加法混合点"
                    checked={fx.bloom}
                    onChange={(value) => onFx('bloom', value)}
                />
                <Slider
                    item={{ key: 'bloomStrength', label: '泛光强度', min: 0, max: 1.5, step: 0.01 }}
                    value={fx.bloomStrength}
                    onChange={onFx}
                />
                <Toggle
                    label="边缘增强"
                    hint="用封面轮廓提亮边缘粒子"
                    checked={fx.edge}
                    onChange={(value) => onFx('edge', value)}
                />
                <Seg
                    label="画面染色"
                    value={fx.visualTintMode}
                    choices={[
                        { value: 'auto', label: '跟随封面' },
                        { value: 'custom', label: '自定义' },
                    ]}
                    onChange={(value) => onFx('visualTintMode', value)}
                />
                <ColorPick
                    label="染色颜色"
                    value={fx.visualTintColor}
                    onChange={(value) => onFx('visualTintColor', value)}
                    swatches={palette && palette.secondary ? [{ name: '封面副色', color: palette.secondary }] : null}
                />
                <Slider
                    item={{ key: 'lyricBackgroundAdapt', label: '亮底避光', min: 0, max: 1, step: 0.01 }}
                    value={fx.lyricBackgroundAdapt}
                    onChange={onFx}
                />
            </section>

            <section className={styles.section}>
                <h3 className={styles.title}>歌词舞台</h3>
                <Seg label="显示模式" value={fx.lyricDisplayMode} choices={DISPLAY_MODES} onChange={(value) => onFx('lyricDisplayMode', value)} />
                <Seg label="译文" value={fx.lyricTranslationMode} choices={TRANSLATION_MODES} onChange={(value) => onFx('lyricTranslationMode', value)} />
                <Seg label="动态" value={fx.lyricMotionStyle} choices={MOTION_STYLES} onChange={(value) => onFx('lyricMotionStyle', value)} />
                <Seg label="字体" value={fx.lyricFont} choices={FONT_CHOICES} onChange={(value) => onFx('lyricFont', value)} />
                <Slider
                    item={{ key: 'lyricCustomLineCount', label: '显示行数', min: 1, max: 10, step: 1 }}
                    value={fx.lyricCustomLineCount}
                    onChange={onFx}
                />
                {LYRIC_PLACEMENT.map((item) => (
                    <Slider key={item.key} item={item} value={fx[item.key]} onChange={onFx} />
                ))}
                <Toggle label="镜头锁定" hint="镜头推拉时不移动歌词" checked={fx.lyricCameraLock} onChange={(value) => onFx('lyricCameraLock', value)} />
            </section>

            <section className={styles.section}>
                <h3 className={styles.title}>歌词颜色</h3>
                <Seg
                    label="正文颜色"
                    value={fx.lyricColorMode}
                    choices={[{ value: 'auto', label: '跟随封面' }, { value: 'custom', label: '自定义' }]}
                    onChange={(value) => onFx('lyricColorMode', value)}
                />
                <ColorPick label="正文色" value={fx.lyricColor} onChange={(value) => onFx('lyricColor', value)} swatches={lyricColorPresets.slice(0, 9)} />
                <Seg
                    label="强调颜色"
                    value={fx.lyricHighlightMode}
                    choices={[{ value: 'auto', label: '跟随封面' }, { value: 'custom', label: '自定义' }]}
                    onChange={(value) => onFx('lyricHighlightMode', value)}
                />
                <ColorPick label="强调色" value={fx.lyricHighlightColor} onChange={(value) => onFx('lyricHighlightColor', value)} swatches={lyricColorPresets.slice(9)} />
                <Toggle label="溢光联动" hint="溢光跟随正文色" checked={fx.lyricGlowLinked} onChange={(value) => onFx('lyricGlowLinked', value)} />
                <ColorPick label="溢光色" value={fx.lyricGlowColor} onChange={(value) => onFx('lyricGlowColor', value)} />
                <Slider
                    item={{ key: 'lyricGlowStrength', label: '歌词溢光', min: 0, max: 0.85, step: 0.01 }}
                    value={fx.lyricGlowStrength}
                    onChange={onFx}
                />
                <Toggle label="溢光跟鼓点" checked={fx.lyricGlowBeat} onChange={(value) => onFx('lyricGlowBeat', value)} />
            </section>

            <section className={styles.section}>
                <h3 className={styles.title}>歌词排版</h3>
                {LYRIC_TEXT.map((item) => (
                    <Slider key={item.key} item={item} value={fx[item.key]} onChange={onFx} />
                ))}
            </section>

            <section className={styles.section}>
                <h3 className={styles.title}>故障效果</h3>
                <Toggle label="跟随镜头" checked={fx.lyricGlitchCameraBind} onChange={(value) => onFx('lyricGlitchCameraBind', value)} />
                {LYRIC_GLITCH.map((item) => (
                    <Slider key={item.key} item={item} value={fx[item.key]} onChange={onFx} />
                ))}
            </section>

            <section className={styles.section}>
                <h3 className={styles.title}>背景</h3>
                <Seg label="背景来源" value={fx.backgroundColorMode} choices={BG_MODES} onChange={(value) => onFx('backgroundColorMode', value)} />
                <ColorPick label="背景色" value={fx.backgroundColor} onChange={(value) => onFx('backgroundColor', value)} />
                <Slider
                    item={{ key: 'backgroundOpacity', label: '背景透明度', min: 0, max: 1, step: 0.01 }}
                    value={fx.backgroundOpacity}
                    onChange={onFx}
                />
                <Toggle label="背景星河" hint="画面后方的尘埃场" checked={fx.backgroundStarRiver} onChange={(value) => onFx('backgroundStarRiver', value)} />
                <Toggle label="电影镜头" hint="鼓点推镜头与微震" checked={fx.cinema} onChange={(value) => onFx('cinema', value)} />
            </section>

            <section className={styles.section}>
                <h3 className={styles.title}>性能</h3>
                <Seg label="渲染档位" value={fx.performanceQuality} choices={QUALITY_CHOICES} onChange={(value) => onFx('performanceQuality', value)} />
                <Seg label="帧率" value={fx.foregroundFpsMode} choices={FPS_CHOICES} onChange={(value) => onFx('foregroundFpsMode', value)} />
            </section>

        </>
    );
};

export default FxConsole;
