/**
 * The visual console's vocabulary: which presets exist, which knobs the
 * visitor can turn, and what the console restores when nothing is stored.
 *
 * The presets are *modes of one particle field*, not separate components —
 * the renderer keeps a single buffer of cover-sampled particles and picks a
 * placement function per frame, which is what makes switching instant (no
 * re-upload, no reload) and what keeps eight visual modes at the cost of one
 * WebGL program.
 */

// `index` is the shader's `uPreset` branch. It is stored explicitly rather
// than derived, so reordering this list never silently re-assigns somebody's
// saved choice.
export const VISUAL_PRESETS = [
    { id: 'nebula', index: 0, name: '星云', sub: '封面粒子 · 默认' },
    { id: 'tunnel', index: 1, name: '粒子隧道', sub: '封面卷成筒向前冲' },
    { id: 'orbit', index: 2, name: '星球', sub: '粒子聚成的悬浮星球' },
    { id: 'galaxy', index: 3, name: '星河', sub: '极光色带全屏律动' },
    { id: 'halo', index: 4, name: '月蚀圣环', sub: '轨道环与逆光日冕' },
    { id: 'rain', index: 5, name: '雨幕霓虹', sub: '雨丝下坠 · 色谱拖尾' },
    { id: 'terrain', index: 6, name: '音域回响', sub: '频谱地形起伏' },
    { id: 'void', index: 7, name: '虚空', sub: '近乎留白' },
];

export const PRESET_INDEX = VISUAL_PRESETS.reduce((map, preset) => {
    map[preset.id] = preset.index;
    return map;
}, {});

export const PRESET_IDS = VISUAL_PRESETS.map((preset) => preset.id);

// Sampled rows per side of the cover. 400 → ~160k particles at medium.
export const DENSITY_GRID = {
    low: 280,
    medium: 400,
    high: 520,
};

export const DENSITY_LABELS = { low: '稀疏', medium: '标准', high: '密集' };

// A multiplier on every per-frame motion, for people who find the standard
// amount of drift distracting.
export const MOTION_SCALE = { calm: 0.55, standard: 1, strong: 1.4 };

export const MOTION_LABELS = { calm: '静', standard: '标准', strong: '强' };

// How many lines the lyric stage shows at once.
export const LYRIC_MODES = ['single', 'double', 'cinema'];

export const LYRIC_MODE_LABELS = { single: '单行', double: '双行', cinema: '影院' };

// What a line does as it arrives. `shine` is a light sweeping across the
// words; `glow` is a softer bloom; `none` leaves the beat pulse as the only
// motion, which is the right answer for people who read along.
export const LYRIC_FX = ['none', 'glow', 'shine'];

export const LYRIC_FX_LABELS = { none: '无', glow: '微光', shine: '扫光' };

// What the console loads when the visitor has never opened it. Ripples, the
// beat camera and the star river are on: they are the layers that make the
// field feel like it is listening, which is the whole point of the page.
export const DEFAULT_FX = {
    preset: 'nebula',
    density: 'medium',
    motion: 'standard',
    starRiver: true,
    lyricRiver: true,
    ripples: true,
    cinema: true,
    palette: true,
    lyricMode: 'single',
    lyricFx: 'shine',
};

const FLAGS = ['starRiver', 'lyricRiver', 'ripples', 'cinema', 'palette'];

/** Coerce anything read back out of storage into a usable settings object. */
export const normalizeFx = function (raw) {
    const fx = { ...DEFAULT_FX };
    if (!raw || typeof raw !== 'object') return fx;
    if (PRESET_IDS.includes(raw.preset)) fx.preset = raw.preset;
    if (DENSITY_GRID[raw.density]) fx.density = raw.density;
    if (MOTION_SCALE[raw.motion]) fx.motion = raw.motion;
    if (LYRIC_MODES.includes(raw.lyricMode)) fx.lyricMode = raw.lyricMode;
    if (LYRIC_FX.includes(raw.lyricFx)) fx.lyricFx = raw.lyricFx;
    FLAGS.forEach((key) => {
        if (typeof raw[key] === 'boolean') fx[key] = raw[key];
    });
    return fx;
};
