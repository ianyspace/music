/**
 * 视觉预设元数据与默认参数。
 *
 * 来源: Mineradio (https://github.com/XxHuberrr/Mineradio-paused)
 *  - 预设清单 / 图标 / 展示顺序 / 歌词色板 / 参数默认值 取自
 *    public/js/modules/07-fx/00-preset-archive-data.js 与
 *    public/js/modules/00-state/04-fx-defaults.js
 *  - 原工程许可证: GNU GPL v3。此处按用户要求原样移植, 仅做 React/ESM 适配。
 *
 * 之所以原样搬运而不是另写一套: 控制台的每一个滑块、每一个预设卡片的
 * 名称与顺序, 都是和着色器里的 uPreset 分支一一对应的。改动任何一侧
 * 都会让存档分享码在两端之间失效。
 */

export const SKULL_PRESET_INDEX = 6;
export const SONIC_PRESET_INDEX = 7;
export const SONIC_WORKSHOP_PRESET_INDEX = 8;

export const presetMeta = [
    { name: 'emily专辑封面', desc: '封面粒子 · 快速入场' },
    { name: '滚筒', desc: '隧道 · 沉浸感' },
    { name: '星球', desc: '星球 · 雕塑感' },
    { name: '虚空', desc: '无粒子 · 自定义背景' },
    { name: '唱片', desc: '唱片 · 圆形封面' },
    { name: '星河', desc: '壁纸粒子 · 音乐律动' },
    { name: '安魂', desc: '骷髅·YUI7W', descHtml: '骷髅·<span class="pc-yui7w">YUI7W</span>' },
    {
        name: '音域回响',
        nameHtml: '音域回响 <span class="pc-name-en">Sonic-Topography</span>',
        desc: '作者 Ajin',
        descHtml: '作者 <span class="pc-author-ajin">Ajin</span>',
    },
    {
        name: '音域回响',
        nameHtml: '音域回响 <span class="pc-name-en">Wallpaper Engine</span>',
        desc: '作者 CmzYa',
    },
    {
        name: '月蚀圣环',
        nameHtml: '月蚀圣环 <span class="pc-name-en">ECLIPSE HALO</span>',
        desc: '黑曜轨道 · 冷金日冕',
        premiumVisual: true,
        accent: '#e8c98d',
        accent2: '#8fd8ff',
    },
    {
        name: '雨幕霓虹',
        nameHtml: '雨幕霓虹 <span class="pc-name-en">NEON DRIZZLE</span>',
        desc: '城市雨丝 · 色谱残光',
        premiumVisual: true,
        accent: '#67efff',
        accent2: '#ff6bb5',
    },
    {
        name: '折光蝶群',
        nameHtml: '折光蝶群 <span class="pc-name-en">PRISM FLOCK</span>',
        desc: '折纸翼阵 · 光谱迁徙',
        premiumVisual: true,
        accent: '#f0d7ff',
        accent2: '#75e6d1',
    },
    {
        name: '深海绽放',
        nameHtml: '深海绽放 <span class="pc-name-en">ABYSSAL BLOOM</span>',
        desc: '生物荧光 · 潮汐花冠',
        premiumVisual: true,
        accent: '#75f0d0',
        accent2: '#8178ff',
    },
];

export const presetIcons = [
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 14c3-2 5-2 8 0s5 2 8 0M3 10c3-2 5-2 8 0s5 2 8 0M3 18c3-2 5-2 8 0s5 2 8 0"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"/><path d="M5 12a7 7 0 0 0 14 0"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="7"/><path d="M8.8 8.8l6.4 6.4"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.4"/><path d="M16.5 5.2c2.1.9 3.4 2.4 4 4.5"/><path d="M18.8 3.2l1.5 4.8"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 15c2.2-4.4 4.4-4.4 6.6 0s4.4 4.4 6.6 0S20.6 10.6 23 15"/><path d="M3 9c2.2 2.2 4.4 2.2 6.6 0s4.4-2.2 6.6 0S20.6 11.2 23 9"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.2h4v6.2h4.2v3.8H14v7.6h-4v-7.6H5.8V9.4H10z"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/><path d="M3 12c2-2.5 4-2.5 6 0s4 2.5 6 0 4-2.5 6 0"/><path d="M3 6c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><circle cx="18" cy="5" r="1.2" fill="currentColor"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18"/><path d="M5 15c1.4-4 2.8-4 4.2 0s2.8 4 4.2 0 2.8-4 4.6 0"/><path d="M4 10c2-2 4-2 6 0s4 2 6 0 3-2 4 0"/><path d="M7 6h10"/><circle cx="18.2" cy="5.8" r="1.35" fill="currentColor"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45"><ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(-18 12 12)"/><ellipse cx="12" cy="12" rx="6.3" ry="2.2" transform="rotate(24 12 12)"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"><path d="M5 3v8M9 2v15M13 5v8M17 2v18M21 6v9"/><path d="M4 19c4-3 8 3 16-1" opacity=".7"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"><path d="M12 12 3 6l3 9 6-3 6 3 3-9-9 6Z"/><path d="M12 12V4M6 15l3 4 3-7 3 7 3-4"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"><path d="M12 20c-1-5-7-5-7-10 4 0 6 2 7 5 1-3 3-5 7-5 0 5-6 5-7 10Z"/><path d="M12 15c-3-3-2-7 0-11 2 4 3 8 0 11Z"/><circle cx="12" cy="15" r="1.2" fill="currentColor" stroke="none"/></svg>',
];

export const presetDisplayOrder = [0, 9, 10, 11, 12, 6, 7, 8, 5, 4, 2, 1, 3];

export const lyricColorPresets = [
    { name: '雾蓝', color: '#a9b8c8' },
    { name: '银蓝', color: '#9db8cf' },
    { name: '冰川', color: '#7ec8d8' },
    { name: '青绿', color: '#66d2b5' },
    { name: '松针', color: '#7fa894' },
    { name: '月白', color: '#d7d2c4' },
    { name: '岩金', color: '#c3ae7c' },
    { name: '琥珀', color: '#d9a45f' },
    { name: '暮粉', color: '#c78aa4' },
    { name: '玫红', color: '#d76a8d' },
    { name: '烟紫', color: '#9b83d3' },
    { name: '电紫', color: '#8d70ff' },
    { name: '靛蓝', color: '#5e78d8' },
    { name: '海蓝', color: '#3c9fe0' },
    { name: '霓青', color: '#28c5c3' },
    { name: '夜绿', color: '#245c49' },
    { name: '酒红', color: '#6d1f35' },
    { name: '墨黑', color: '#111318' },
];

/**
 * 默认参数。键名与上游存档格式保持一致, 这样导入上游分享码时
 * 未知字段会被忽略、已知字段会被正确识别。
 */
export const fxDefaults = {
    preset: 0,
    intensity: 0.85,
    cinemaShake: 0.5,
    depth: 0.2,
    coverResolution: 1.55,
    point: 1.0,
    speed: 1.0,
    twist: 0.0,
    color: 1.1,
    scatter: 0.0,
    bgFade: 0.2,
    bloomStrength: 0.62,
    lyricGlowStrength: 0.28,
    lyricBackgroundAdapt: 0.72,
    lyricScale: 1.0,
    lyricOffsetX: 0,
    lyricOffsetY: 0,
    lyricOffsetZ: 0,
    lyricTiltX: 0,
    lyricTiltY: 0,
    lyricColorMode: 'auto',
    lyricColor: '#7ec8d8',
    lyricHighlightMode: 'auto',
    lyricHighlightColor: '#fff0b8',
    lyricGlowLinked: true,
    lyricGlowColor: '#9db8cf',
    lyricDisplayMode: 'cinema',
    lyricTranslationMode: 'multi',
    lyricMotionStyle: 'float',
    lyricCustomLineCount: 10,
    lyricGlitchCameraBind: true,
    lyricGlitchIntensity: 1.0,
    lyricGlitchSlice: 0.72,
    lyricGlitchChroma: 0.86,
    lyricGlitchRate: 1.0,
    lyricGlitchJitter: 0.72,
    lyricContextOpacity: 0.54,
    lyricContextSpread: 1.96,
    lyricTranslationGap: 0.92,
    lyricTranslationScale: 0.65,
    lyricTranslationOpacity: 0.86,
    lyricEdgeFade: 0.32,
    lyricMotionSoftness: 0.72,
    lyricFont: 'sans',
    lyricLetterSpacing: 0,
    lyricLineHeight: 1.0,
    lyricWeight: 750,
    lyricTextureClarity: 1,
    lyricBackdropAdapt: true,
    coverBackdropAdapt: true,
    visualTintMode: 'auto',
    visualTintColor: '#9db8cf',
    uiAccentColor: '#ffffff',
    backgroundColorMode: 'cover',
    backgroundColor: '#000000',
    backgroundOpacity: 1,
    backgroundGlassOpacity: 0,
    backgroundImage: '',
    backgroundAlbumCover: false,
    backgroundMediaCropX: 50,
    backgroundMediaCropY: 50,
    backgroundMediaZoom: 1,
    floatLayer: false,
    cinema: true,
    edge: false,
    aiDepth: false,
    bloom: false,
    lyricGlow: true,
    lyricGlowBeat: true,
    lyricGlowParticles: false,
    lyricVerticalFloat: true,
    backgroundStarRiver: true,
    lyricPauseHold: true,
    lyricCameraLock: false,
    performanceBackground: 'release',
    performanceQuality: 'eco',
    foregroundFpsMode: 'vsync',
};

export const clampRange = function (v, min, max) {
    return Math.max(min, Math.min(max, v));
};

export const normalizeCoverResolution = function (v) {
    return clampRange(Number(v) || 1, 0.75, 1.55);
};

export const coverParticleGridForResolution = function (v) {
    let grid = Math.round(118 * normalizeCoverResolution(v));
    grid = Math.max(88, Math.min(183, grid));
    return grid % 2 ? grid : grid + 1;
};

export const coverParticleCountLabel = function (v) {
    const grid = coverParticleGridForResolution(v);
    return grid + 'x' + grid;
};

export const coverTextureSizeForResolution = function (v) {
    const value = normalizeCoverResolution(v);
    if (value >= 1.32) return 512;
    if (value >= 1.1) return 384;
    return 256;
};

export const normalizeHexColor = function (value, fallback) {
    const raw = String(value == null ? '' : value).trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
        return ('#' + raw[1] + raw[1] + raw[2] + raw[2] + raw[3] + raw[3]).toLowerCase();
    }
    return String(fallback || '#ffffff').toLowerCase();
};

export const normalizePerformanceQuality = function (v) {
    const value = String(v || '');
    return /^(eco|balanced|high|ultra)$/.test(value) ? value : fxDefaults.performanceQuality;
};

export const normalizeForegroundFpsMode = function (value) {
    const mode = String(value || '').trim().toLowerCase();
    if (mode === 'vsync' || mode === 'adaptive') return mode;
    if (/^(45|60|75|90|120)$/.test(mode)) return mode;
    return 'vsync';
};

/** 每个预设的相机取景基线 (theta 偏航 / phi 俯仰 / radius 距离)。 */
export const defaultOrbitStateForPreset = function (p) {
    const index = Number(p) || 0;
    if (index === 1) return { theta: 0.0, phi: 0.03, radius: 6.2 };
    if (index === 2) return { theta: 0.0, phi: 0.15, radius: 7.0 };
    if (index === 3) return { theta: 0.0, phi: 0.05, radius: 8.0 };
    if (index === 4) return { theta: 0.0, phi: 0.04, radius: 6.5 };
    if (index === 6) return { theta: 0.18, phi: 0.1, radius: 7.4 };
    if (index === 7) return { theta: 0.0, phi: 0.18, radius: 8.4 };
    if (index === 9) return { theta: -0.08, phi: 0.12, radius: 7.4 };
    if (index === 10) return { theta: 0.0, phi: 0.02, radius: 7.15 };
    if (index === 11) return { theta: 0.1, phi: 0.11, radius: 7.0 };
    if (index === 12) return { theta: -0.12, phi: 0.18, radius: 7.35 };
    return { theta: 0.0, phi: 0.08, radius: 6.6 };
};

export const normalizeFx = function (raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const out = { ...fxDefaults };
    Object.keys(fxDefaults).forEach((key) => {
        if (source[key] === undefined || source[key] === null) return;
        out[key] = source[key];
    });
    out.preset = clampRange(Math.round(Number(out.preset) || 0), 0, presetMeta.length - 1);
    out.intensity = clampRange(Number(out.intensity), 0, 2);
    out.cinemaShake = clampRange(Number(out.cinemaShake), 0, 1);
    out.depth = clampRange(Number(out.depth), 0, 2);
    out.coverResolution = normalizeCoverResolution(out.coverResolution);
    out.point = clampRange(Number(out.point), 0.4, 2);
    out.speed = clampRange(Number(out.speed), 0, 2);
    out.twist = clampRange(Number(out.twist), 0, 1);
    out.color = clampRange(Number(out.color), 0.6, 1.8);
    out.scatter = clampRange(Number(out.scatter), 0, 0.4);
    out.bgFade = clampRange(Number(out.bgFade), 0, 1);
    out.bloomStrength = clampRange(Number(out.bloomStrength), 0, 1.5);
    out.lyricScale = clampRange(Number(out.lyricScale), 0.5, 2);
    out.performanceQuality = normalizePerformanceQuality(out.performanceQuality);
    out.foregroundFpsMode = normalizeForegroundFpsMode(out.foregroundFpsMode);
    return out;
};

/** 存档分享用的字段白名单。 */
export const FX_SHARE_KEYS = [
    'preset',
    'intensity',
    'cinemaShake',
    'depth',
    'coverResolution',
    'point',
    'speed',
    'twist',
    'color',
    'scatter',
    'bgFade',
    'bloomStrength',
    'lyricGlowStrength',
    'lyricBackgroundAdapt',
    'lyricScale',
    'lyricOffsetX',
    'lyricOffsetY',
    'lyricOffsetZ',
    'lyricTiltX',
    'lyricTiltY',
    'lyricCameraLock',
    'lyricColorMode',
    'lyricColor',
    'lyricHighlightMode',
    'lyricHighlightColor',
    'lyricGlowLinked',
    'lyricGlowColor',
    'lyricDisplayMode',
    'lyricTranslationMode',
    'lyricMotionStyle',
    'lyricCustomLineCount',
    'lyricGlitchCameraBind',
    'lyricGlitchIntensity',
    'lyricGlitchSlice',
    'lyricGlitchChroma',
    'lyricGlitchRate',
    'lyricGlitchJitter',
    'lyricContextOpacity',
    'lyricContextSpread',
    'lyricTranslationGap',
    'lyricTranslationScale',
    'lyricTranslationOpacity',
    'lyricEdgeFade',
    'lyricMotionSoftness',
    'lyricFont',
    'lyricLetterSpacing',
    'lyricLineHeight',
    'lyricWeight',
    'visualTintMode',
    'visualTintColor',
    'uiAccentColor',
    'backgroundColorMode',
    'backgroundColor',
    'backgroundOpacity',
    'backgroundGlassOpacity',
];
