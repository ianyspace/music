/**
 * The visual console's vocabulary: which presets exist, which knobs the
 * visitor can turn, and what the console restores when nothing is stored.
 *
 * ## Presets are shapes, not just motions
 *
 * Each preset owns a **geometry builder** (see `presetFields.js`) that lays
 * the particles out in its own structure — a vinyl disc, a sphere shell, a
 * tunnel wall, a flock of wings. Sharing one cover grid between them and only
 * changing how it moves made every mode read as the same cloud in a different
 * mood; giving each its own distribution is what makes twelve modes actually
 * look like twelve things.
 *
 * `index` is the shader's `uPreset` branch. It is stored explicitly rather
 * than derived, so reordering the list never silently re-assigns somebody's
 * saved choice.
 */

export const VISUAL_PRESETS = [
    {
        id: 'emily',
        index: 0,
        name: 'emily专辑封面',
        sub: '封面粒子 · 快速入场',
        icon: 'cover',
    },
    {
        id: 'tunnel',
        index: 1,
        name: '滚筒',
        sub: '隧道 · 沉浸感',
        icon: 'tunnel',
    },
    {
        id: 'orbit',
        index: 2,
        name: '星球',
        sub: '星球 · 雕塑感',
        icon: 'orbit',
    },
    {
        id: 'void',
        index: 3,
        name: '虚空',
        sub: '无粒子 · 自定义背景',
        icon: 'void',
    },
    {
        id: 'vinyl',
        index: 4,
        name: '唱片',
        sub: '唱片 · 圆形封面',
        icon: 'vinyl',
    },
    {
        id: 'galaxy',
        index: 5,
        name: '星河',
        sub: '壁纸粒子 · 音乐律动',
        icon: 'galaxy',
    },
    {
        id: 'requiem',
        index: 6,
        name: '安魂',
        sub: '骷髅 · 点云建模',
        icon: 'requiem',
    },
    {
        id: 'sonic',
        index: 7,
        name: '音域回响',
        en: 'Sonic-Topography',
        sub: '频谱地形 · 作者 Ajin',
        icon: 'sonic',
    },
    {
        id: 'halo',
        index: 8,
        name: '月蚀圣环',
        en: 'ECLIPSE HALO',
        sub: '黑曜轨道 · 冷金日冕',
        icon: 'halo',
        premium: true,
        accent: '#e8c98d',
        accent2: '#8fd8ff',
    },
    {
        id: 'rain',
        index: 9,
        name: '雨幕霓虹',
        en: 'NEON DRIZZLE',
        sub: '城市雨丝 · 色谱残光',
        icon: 'rain',
        premium: true,
        accent: '#67efff',
        accent2: '#ff6bb5',
    },
    {
        id: 'prism',
        index: 10,
        name: '折光蝶群',
        en: 'PRISM FLOCK',
        sub: '折纸翼阵 · 光谱迁徙',
        icon: 'prism',
        premium: true,
        accent: '#f0d7ff',
        accent2: '#75e6d1',
    },
    {
        id: 'abyss',
        index: 11,
        name: '深海绽放',
        en: 'ABYSSAL BLOOM',
        sub: '生物荧光 · 潮汐花冠',
        icon: 'abyss',
        premium: true,
        accent: '#75f0d0',
        accent2: '#8178ff',
    },
];

// The shelf order: the default first, then the premium visuals, then the
// rest — so the console opens on what most people will leave it on.
export const PRESET_ORDER = [
    'emily', 'halo', 'rain', 'prism', 'abyss',
    'requiem', 'sonic', 'galaxy', 'vinyl', 'orbit', 'tunnel', 'void',
];

export const PRESETS_BY_ID = VISUAL_PRESETS.reduce((map, preset) => {
    map[preset.id] = preset;
    return map;
}, {});

export const PRESET_INDEX = VISUAL_PRESETS.reduce((map, preset) => {
    map[preset.id] = preset.index;
    return map;
}, {});

export const PRESET_IDS = VISUAL_PRESETS.map((preset) => preset.id);

// How many lines the lyric stage shows at once.
export const LYRIC_MODES = ['single', 'double', 'cinema'];

export const LYRIC_MODE_LABELS = { single: '单行', double: '双行', cinema: '影院' };

// What a line does as it arrives. `shine` is a light sweeping across the
// words; `glow` is a softer bloom; `none` leaves the beat pulse as the only
// motion, which is the right answer for people who read along.
export const LYRIC_FX = ['none', 'glow', 'shine'];

export const LYRIC_FX_LABELS = { none: '无', glow: '微光', shine: '扫光' };

// --- the console's knobs -------------------------------------------------
//
// Every one of these is a number the visitor drags, with the range the slider
// runs over kept next to the value it produces. They are grouped into the
// sections the console renders (see `FX_SLIDERS`).
export const FX_RANGES = {
    gain: { min: 0.2, max: 1.6, step: 0.01 },
    depth: { min: 0.2, max: 1.8, step: 0.01 },
    coverRes: { min: 0.75, max: 1.55, step: 0.01 },
    shake: { min: 0, max: 1.8, step: 0.01 },
    lyricGlow: { min: 0, max: 0.85, step: 0.01 },
};

export const FX_SLIDERS = [
    { key: 'gain', label: '律动强度' },
    { key: 'depth', label: '立体感' },
    { key: 'coverRes', label: '封面清晰度' },
    { key: 'shake', label: '镜头晃动' },
    { key: 'lyricGlow', label: '歌词溢光' },
];

// What the console loads when the visitor has never opened it. Ripples, the
// beat camera and the star river are on: they are the layers that make the
// field feel like it is listening, which is the whole point of the page.
export const DEFAULT_FX = {
    preset: 'emily',
    gain: 0.85,
    depth: 1,
    coverRes: 1.15,
    shake: 0.5,
    lyricGlow: 0.28,
    starRiver: true,
    lyricRiver: true,
    ripples: true,
    cinema: true,
    palette: true,
    lyricMode: 'single',
    lyricFx: 'shine',
};

export const FX_FLAGS = ['starRiver', 'lyricRiver', 'ripples', 'cinema', 'palette'];

const clampTo = function (value, range, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(range.max, Math.max(range.min, n));
};

/** Coerce anything read back out of storage into a usable settings object. */
export const normalizeFx = function (raw) {
    const fx = { ...DEFAULT_FX };
    if (!raw || typeof raw !== 'object') return fx;
    if (PRESET_IDS.includes(raw.preset)) fx.preset = raw.preset;
    if (LYRIC_MODES.includes(raw.lyricMode)) fx.lyricMode = raw.lyricMode;
    if (LYRIC_FX.includes(raw.lyricFx)) fx.lyricFx = raw.lyricFx;
    Object.keys(FX_RANGES).forEach((key) => {
        if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') {
            fx[key] = clampTo(raw[key], FX_RANGES[key], DEFAULT_FX[key]);
        }
    });
    FX_FLAGS.forEach((key) => {
        if (typeof raw[key] === 'boolean') fx[key] = raw[key];
    });
    return fx;
};

/** Rows sampled from the cover. Higher resolution, more particles. */
export const gridForRes = function (coverRes) {
    const rows = Math.round(300 * clampTo(coverRes, FX_RANGES.coverRes, 1.15));
    return Math.min(560, Math.max(160, rows));
};
