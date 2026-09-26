/**
 * 官方 3D 歌词系统的共享运行时。
 *
 * 上游 Mineradio 是 IIFE 脚本包: 顶层 function / var 全是隐式全局, 任何
 * 文件都能直接引用 `scene` `fx` `lyricsLines` `audio` 这些名字。这里是同一
 * 份可变状态, 但改成显式 ESM 模块。
 *
 * 关键点: ESM 的 export 绑定是「活的」—— `export let bass` 被别的模块
 * import 后, 运行时改值那边立刻可见。上游每帧给这些标量重新赋值的行为因此
 * 可以原样保留, 不需要把 `bass` 包成 `{ value }`。
 *
 * 移植来源: Mineradio public/js/modules/02-visual/{02,03,05,07,08,09,10,11,12,13,14}-*.js
 * 上游许可证 GNU GPL v3。
 */

// ---------------------------------------------------------------- three.js

export let THREE = null;
export let scene = null;
export let camera = null;
export let renderer = null;
export let uniforms = null;

export const bindStage = function (nextThree, nextScene, nextCamera, nextRenderer, nextUniforms) {
    THREE = nextThree;
    scene = nextScene;
    camera = nextCamera;
    renderer = nextRenderer;
    uniforms = nextUniforms;
};

/** 顶层常量在 import 期就可能要用到 THREE, 统一走这个惰性取值。 */
export const three = () => THREE;

// ---------------------------------------------------------------- fx

/**
 * 控制台参数。对象标识必须稳定 —— 上游到处 `fx.xxx` 读取, 我们只往同一个
 * 对象里拷贝字段, 不整体替换引用。
 */
export const fx = {
    particleLyrics: true,
    preset: 0,
    cinemaShake: 0.5,
    lyricDisplayMode: 'cinema',
    lyricTranslationMode: 'multi',
    lyricMotionStyle: 'float',
    lyricCustomLineCount: 10,
    lyricColorMode: 'auto',
    lyricColor: '#7ec8d8',
    lyricHighlightMode: 'auto',
    lyricHighlightColor: '#fff0b8',
    lyricGlow: true,
    lyricGlowStrength: 0.28,
    lyricGlowBeat: true,
    lyricGlowParticles: false,
    lyricGlowLinked: true,
    lyricGlowColor: '#9db8cf',
    lyricScale: 1.0,
    lyricOffsetX: 0,
    lyricOffsetY: 0,
    lyricOffsetZ: 0,
    lyricTiltX: 0,
    lyricTiltY: 0,
    lyricBackgroundAdapt: 0.72,
    lyricBackdropAdapt: true,
    lyricFont: 'sans',
    lyricWeight: 750,
    lyricLetterSpacing: 0,
    lyricLineHeight: 1.0,
    lyricTextureClarity: 1,
    lyricCameraLock: false,
    lyricVerticalFloat: true,
    lyricPauseHold: true,
    lyricContextOpacity: 0.54,
    lyricContextSpread: 1.96,
    lyricTranslationGap: 0.92,
    lyricTranslationScale: 0.65,
    lyricTranslationOpacity: 0.86,
    lyricEdgeFade: 0.32,
    lyricMotionSoftness: 0.72,
    lyricGlitchCameraBind: true,
    lyricGlitchIntensity: 1.0,
    lyricGlitchSlice: 0.72,
    lyricGlitchChroma: 0.86,
    lyricGlitchRate: 1.0,
    lyricGlitchJitter: 0.72,
    uiAccentColor: '#ffffff',
};

export const fxDefaults = fx;

export const applyFx = function (next) {
    if (!next || typeof next !== 'object') return;
    Object.keys(next).forEach((key) => {
        if (next[key] !== undefined) fx[key] = next[key];
    });
};

// ---------------------------------------------------------------- 音频

/** 播放状态。对象标识同样要稳定, 逐帧改字段。 */
export const audio = {
    currentTime: 0,
    duration: 0,
    paused: true,
    ended: false,
    src: '',
};

export let playing = false;
export let currentIdx = 0;
export let bass = 0;
export let mid = 0;
export let treble = 0;
export let beatPulse = 0;

export const beatCam = {
    punch: 0,
    radiusKick: 0,
    thetaKick: 0,
    phiKick: 0,
    rollKick: 0,
};

/**
 * 每帧把本项目的分析结果喂进来。参数是 VisualStage 已经算好的平滑值,
 * 与上游 11-main-loop.js 里的 smoothBass / smoothMid / smoothTreb 同义。
 */
export const setAudioFrame = function (state) {
    const now = state || {};
    audio.currentTime = Number(now.currentTime) || 0;
    audio.duration = Number(now.duration) || 0;
    audio.paused = now.paused !== false;
    // 上游的 audio 就是 <audio> 元素本身: src 非空 + ended 标志参与
    // 「暂停时是否保留歌词」的判定, 这里必须一并喂进来。
    if (now.src) audio.src = String(now.src);
    audio.ended = Boolean(now.ended);
    playing = Boolean(now.playing);
    bass = Number(now.bass) || 0;
    mid = Number(now.mid) || 0;
    treble = Number(now.high) || 0;
    beatPulse = Number(now.beatPulse) || 0;
    beatCam.punch = Number(now.camPunch) || 0;
    beatCam.radiusKick = Number(now.radiusKick) || 0;
    beatCam.thetaKick = Number(now.thetaKick) || 0;
    beatCam.phiKick = Number(now.phiKick) || 0;
    beatCam.rollKick = Number(now.rollKick) || 0;
    currentIdx = Number(now.currentIdx) || 0;
};

// ---------------------------------------------------------------- 歌词数据

/**
 * 当前歌曲的歌词行。上游由 06-lyrics/00-lyrics-fetch-parse.js 写入全局数组,
 * 这套系统在每帧自行二分查找当前应显示哪一行 —— 是「拉取」而不是「推送」。
 *
 * 行结构与上游一致: { t, text, source, duration, charCount, translation?, words? }
 * 数组就地改写而不能整体替换, 因为移植过来的模块 import 的是同一个引用。
 */
export const lyricsLines = [];
export const lyricsTranslationLines = [];

export let lyricsVisible = false;
export let lyricsHasNativeKaraoke = false;
export let currentLyricFallbackText = '';

export const setLyricsPayload = function (lines, translations, hasKaraoke, visible, fallbackText) {
    lyricsLines.length = 0;
    (Array.isArray(lines) ? lines : []).forEach((line) => lyricsLines.push(line));
    lyricsTranslationLines.length = 0;
    (Array.isArray(translations) ? translations : []).forEach((line) => lyricsTranslationLines.push(line));
    lyricsHasNativeKaraoke = Boolean(hasKaraoke);
    lyricsVisible = visible !== false;
    currentLyricFallbackText = String(fallbackText || '');
};

// ---------------------------------------------------------------- 外部桩

// 下面这些在上游来自播放器 / 桌面客户端 / 书架 UI, 本项目没有对等物。
// 给出同签名的空实现, 让移植过来的调用点保持原样即可。

export const normalizeLyricTranslationText = function (value) {
    return String(value == null ? '' : value);
};

export const getAdjustedLyricPlaybackTime = function (t) {
    return Number(t) || 0;
};

export const getProgressDragPreviewSeconds = function () {
    return null;
};

export const isProgressDragPreviewActive = function () {
    return false;
};

export const markRenderInteraction = function () {
    /* 桌面客户端的性能埋点, 网页不需要 */
};

export const runtimeHardwareProfile = { tier: 'desktop', low: false };

export const isDeepBackgroundMode = function () {
    return false;
};

export const isHiddenForBackgroundOptimization = function () {
    return false;
};

export const shouldAvoidStageLyricsForShelf = function () {
    return false;
};

export const shouldDimWallpaperForShelf = function () {
    return false;
};

export const shouldOffsetLyricsForShelfDetail = function () {
    return false;
};

export const shouldUseWallpaperLyricCameraLock = function () {
    return false;
};

export const updateSonicGroundColorControls = function () {
    /* sonic 预设的色彩同步, 已下线 */
};

export const updateSonicWorkshopColorControls = function () {
    /* sonic workshop 预设的色彩同步, 已下线 */
};

export const syncSkullParticleColors = function () {
    /* 骷髅层自行取色, 这里不需要额外同步 */
};

export const songProviderKey = '';
export const currentAppliedLyricRenderSignature = '';

export const visualEase = function (t) {
    const x = Math.max(0, Math.min(1, Number(t) || 0));
    return x * x * (3 - 2 * x);
};

// 歌词太阳(唱针光点)能量。上游在 00-core-stores 里由频段累积驱动。
export let lyricSunEnergy = 0;
export let lyricSunAvg = 0;
export let lyricSunPeak = 0;

export const setLyricSunEnergy = function (value) {
    lyricSunEnergy = Number(value) || 0;
    lyricSunAvg = lyricSunAvg * 0.94 + lyricSunEnergy * 0.06;
    lyricSunPeak = Math.max(lyricSunPeak * 0.97, lyricSunEnergy);
};

// 上游 `requestIdleCallback` 在 Electron / Chromium 里是原生的,
// Safari 与老版本 Firefox 没有 —— 这里补一个 rAF 兜底。
export const requestIdle = (typeof requestIdleCallback === 'function'
    ? (cb) => requestIdleCallback(cb, { timeout: 220 })
    : (cb) => setTimeout(() => cb({ didTimeout: true, timeRemaining: () => 0 }), 1));

export const cancelIdle = (typeof cancelIdleCallback === 'function'
    ? (id) => cancelIdleCallback(id)
    : (id) => clearTimeout(id));
