/**
 * 歌词显示模式 / 译文排版 / 运动曲线。
 *
 * 移植自上游 Mineradio public/js/modules/02-visual/08-lyrics-display-modes.js
 * 上游许可证 GNU GPL v3 (用户已授权原样复制)。
 *
 * 为什么是原样搬运: 每种显示模式的行数、各行虚拟槽位的步长算法、以及
 * lyricMotionProfile 里六个风格分支那几十个数值都是逐帧调出来的手感, 改一
 * 个数就会变味道, 因此逐行保留, 包括看似冗余的 cache 失效 key 拼法。
 *
 * 相对上游的改动仅限:
 *   - 顶层 function / var 改为 ESM export;
 *   - `fx` `fxDefaults` `lyricsLines` `lyricsTranslationLines`
 *     `lyricsHasNativeKaraoke` `normalizeLyricTranslationText` 改从
 *     ./runtime.js 取;
 *   - `clampRange` 改用本仓库 visual/presetData.js 的实现;
 *   - `lyricLineTranslationTextAt` 从 ./14-stage-rendering.js 取。
 */

import { clampRange } from '../presetData.js';
import {
    fx,
    fxDefaults,
    lyricsLines,
    lyricsTranslationLines,
    lyricsHasNativeKaraoke,
    normalizeLyricTranslationText,
} from './runtime.js';
import { lyricLineTranslationTextAt } from './14-stage-rendering.js';

export var STAGE_LYRIC_MAX_LINES = 1;
export var STAGE_LYRIC_DISPLAY_MODES = { single: 1, dual: 1, triple: 1, cinema: 1, custom: 1 };
export var STAGE_LYRIC_TRANSLATION_MODES = { off: 1, current: 1, dual: 1, multi: 1 };
export var STAGE_LYRIC_MOTION_STYLES = { glass: 1, smooth: 1, float: 1, quick: 1, shine: 1, glitch: 1 };

export function normalizeLyricDisplayMode(mode) {
    mode = String(mode || 'single');
    return STAGE_LYRIC_DISPLAY_MODES[mode] ? mode : 'single';
}
export function normalizeLyricTranslationMode(mode) {
    mode = String(mode || 'off');
    return STAGE_LYRIC_TRANSLATION_MODES[mode] ? mode : 'off';
}
export function lyricCustomLineCountValue() {
    var raw = fx && fx.lyricCustomLineCount != null ? Number(fx.lyricCustomLineCount) : fxDefaults.lyricCustomLineCount;
    if (!isFinite(raw)) raw = fxDefaults.lyricCustomLineCount;
    return clampRange(Math.round(raw), 1, 10);
}
export function lyricDisplayLineCountForMode(mode) {
    mode = normalizeLyricDisplayMode(mode);
    if (mode === 'single') return 1;
    if (mode === 'dual') return 2;
    if (mode === 'triple') return 3;
    if (mode === 'cinema') return 5;
    return lyricCustomLineCountValue();
}
export function lyricDisplayOffsetsForMode(mode) {
    mode = normalizeLyricDisplayMode(mode);
    if (mode === 'single') return [0];
    if (mode === 'dual') return [0, 1];
    var count = lyricDisplayLineCountForMode(mode);
    var activeSlot = Math.floor(count / 2);
    var offsets = [];
    for (var i = 0; i < count; i++) offsets.push(i - activeSlot);
    return offsets;
}
export function normalizeLyricMotionStyle(style) {
    style = String(style || 'float');
    return STAGE_LYRIC_MOTION_STYLES[style] ? style : 'float';
}
export function lyricContextOpacityValue() {
    return clampRange(fx && fx.lyricContextOpacity == null ? fxDefaults.lyricContextOpacity : Number(fx && fx.lyricContextOpacity), 0.25, 1);
}
export function lyricContextSpreadValue() {
    return clampRange(fx && fx.lyricContextSpread == null ? fxDefaults.lyricContextSpread : Number(fx && fx.lyricContextSpread), 0.60, 2.40);
}
export function lyricTranslationGapValue() {
    return clampRange(fx && fx.lyricTranslationGap == null ? fxDefaults.lyricTranslationGap : Number(fx && fx.lyricTranslationGap), 0.28, 2.20);
}
export function lyricTranslationVisualGapValue() {
    var gap = lyricTranslationGapValue();
    var scale = lyricTranslationScaleValue();
    return clampRange(0.98 + (gap - 0.28) * 0.36 + Math.max(0, scale - 0.66) * 0.12, 0.92, 2.20);
}
export function lyricTranslationLayoutActive() {
    return normalizeLyricTranslationMode(fx && fx.lyricTranslationMode) !== 'off';
}
export function lyricPrimarySlotStepValue() {
    if (!lyricTranslationLayoutActive()) return 1;
    return clampRange(lyricTranslationVisualGapValue() + 0.82 + lyricTranslationScaleValue() * 0.14, 1.78, 2.88);
}
export function lyricLineHasTranslationAt(index) {
    if (!lyricTranslationLayoutActive()) return false;
    var n = Math.max(0, Math.round(Number(index) || 0));
    return !!lyricLineTranslationTextAt(n);
}
export function lyricLineSlotStepValue(index) {
    if (!lyricTranslationLayoutActive()) return 1;
    var n = Math.round(Number(index) || 0);
    var needsTranslationSlot = lyricLineHasTranslationAt(n) || (n >= 0 && lyricLineHasTranslationAt(n + 1));
    return needsTranslationSlot ? lyricPrimarySlotStepValue() : clampRange(1.04 + (lyricContextSpreadValue() - 1) * 0.10, 0.96, 1.24);
}
export var lyricPrimaryVirtualPrefixCache = { key: '', values: [0] };
export function lyricPrimaryVirtualPrefixKey() {
    var first = lyricsLines && lyricsLines[0];
    var last = lyricsLines && lyricsLines.length ? lyricsLines[lyricsLines.length - 1] : null;
    return [
        lyricTranslationLayoutActive() ? 1 : 0,
        Math.round(lyricTranslationGapValue() * 1000),
        Math.round(lyricTranslationScaleValue() * 1000),
        Math.round(lyricContextSpreadValue() * 1000),
        lyricsLines ? lyricsLines.length : 0,
        lyricsTranslationLines ? lyricsTranslationLines.length : 0,
        first ? normalizeLyricTranslationText(first.translation).slice(0, 12) : '',
        last ? normalizeLyricTranslationText(last.translation).slice(0, 12) : ''
    ].join('|');
}
export function lyricPrimaryVirtualIndex(index) {
    var n = Math.round(Number(index) || 0);
    if (!isFinite(n) || n === 0) return 0;
    if (!lyricTranslationLayoutActive()) return n;
    if (n < 0) return n * lyricPrimarySlotStepValue();
    var key = lyricPrimaryVirtualPrefixKey();
    if (!lyricPrimaryVirtualPrefixCache || lyricPrimaryVirtualPrefixCache.key !== key) {
        lyricPrimaryVirtualPrefixCache = { key: key, values: [0] };
    }
    var values = lyricPrimaryVirtualPrefixCache.values;
    for (var i = values.length; i <= n; i++) values[i] = values[i - 1] + lyricLineSlotStepValue(i - 1);
    return values[n] || 0;
}
export function lyricTranslationVirtualIndex(parentIndex) {
    return lyricPrimaryVirtualIndex(parentIndex) + lyricTranslationVisualGapValue();
}
export function lyricTranslationScaleValue() {
    return clampRange(fx && fx.lyricTranslationScale == null ? fxDefaults.lyricTranslationScale : Number(fx && fx.lyricTranslationScale), 0.46, 1.12);
}
export function lyricTranslationOpacityValue() {
    return clampRange(fx && fx.lyricTranslationOpacity == null ? fxDefaults.lyricTranslationOpacity : Number(fx && fx.lyricTranslationOpacity), 0.20, 1);
}
export function lyricEdgeFadeValue() {
    return clampRange(fx && fx.lyricEdgeFade == null ? fxDefaults.lyricEdgeFade : Number(fx && fx.lyricEdgeFade), 0, 1);
}
export function lyricMotionSoftnessValue() {
    return clampRange(fx && fx.lyricMotionSoftness == null ? fxDefaults.lyricMotionSoftness : Number(fx && fx.lyricMotionSoftness), 0.15, 1.2);
}
export function lyricGlitchIntensityValue() {
    return clampRange(fx && fx.lyricGlitchIntensity == null ? fxDefaults.lyricGlitchIntensity : Number(fx && fx.lyricGlitchIntensity), 0, 1.5);
}
export function lyricGlitchSliceValue() {
    return clampRange(fx && fx.lyricGlitchSlice == null ? fxDefaults.lyricGlitchSlice : Number(fx && fx.lyricGlitchSlice), 0, 1.4);
}
export function lyricGlitchChromaValue() {
    return clampRange(fx && fx.lyricGlitchChroma == null ? fxDefaults.lyricGlitchChroma : Number(fx && fx.lyricGlitchChroma), 0, 1.6);
}
export function lyricGlitchRateValue() {
    return clampRange(fx && fx.lyricGlitchRate == null ? fxDefaults.lyricGlitchRate : Number(fx && fx.lyricGlitchRate), 0.45, 2.2);
}
export function lyricGlitchJitterValue() {
    return clampRange(fx && fx.lyricGlitchJitter == null ? fxDefaults.lyricGlitchJitter : Number(fx && fx.lyricGlitchJitter), 0, 1.8);
}
export function lyricMotionProfile() {
    var style = normalizeLyricMotionStyle(fx && fx.lyricMotionStyle);
    var soft = lyricMotionSoftnessValue();
    var profile = {
        style: style,
        enter: 0.54,
        exit: 0.46,
        slide: 0.34,
        progressEase: lyricsHasNativeKaraoke ? 0.34 : 0.18,
        contextDrift: 0.060,
        edgeBoost: 1.0,
        sweep: 0.62,
        shimmer: 0.24,
        glitch: 0.0,
        glitchSlice: 0.0,
        glitchChroma: 0.0,
        glitchRate: 1.0,
        glitchJitter: 0.0,
        glitchCameraBind: false,
        glowLift: 1.0,
        floatAmp: 1.0
    };
    if (style === 'smooth') {
        profile.enter = 0.72; profile.exit = 0.62; profile.slide = 0.24; profile.progressEase *= 0.72; profile.contextDrift = 0.030; profile.edgeBoost = 0.62; profile.sweep = 0.18; profile.shimmer = 0.05; profile.glowLift = 0.74; profile.floatAmp = 0.55;
    } else if (style === 'float') {
        profile.enter = 0.86; profile.exit = 0.76; profile.slide = 0.54; profile.progressEase *= 0.66; profile.contextDrift = 0.120; profile.edgeBoost = 1.04; profile.sweep = 0.36; profile.shimmer = 0.14; profile.glowLift = 1.16; profile.floatAmp = 1.45;
    } else if (style === 'shine') {
        profile.enter = 0.50; profile.exit = 0.44; profile.slide = 0.34; profile.progressEase *= 1.02; profile.contextDrift = 0.052; profile.edgeBoost = 1.42; profile.sweep = 1.22; profile.shimmer = 0.34; profile.glowLift = 1.30; profile.floatAmp = 0.82;
    } else if (style === 'glitch') {
        profile.enter = 0.40; profile.exit = 0.36; profile.slide = 0.30; profile.progressEase *= 1.24; profile.contextDrift = 0.035; profile.edgeBoost = 1.18; profile.sweep = 0.54; profile.shimmer = 0.28; profile.glitch = lyricGlitchIntensityValue(); profile.glitchSlice = lyricGlitchSliceValue(); profile.glitchChroma = lyricGlitchChromaValue(); profile.glitchRate = lyricGlitchRateValue(); profile.glitchJitter = lyricGlitchJitterValue(); profile.glitchCameraBind = !!(fx && fx.lyricGlitchCameraBind); profile.glowLift = 1.08 + profile.glitch * 0.10; profile.floatAmp = 0.70;
    } else if (style === 'quick') {
        profile.enter = 0.36; profile.exit = 0.32; profile.slide = 0.22; profile.progressEase *= 1.34; profile.contextDrift = 0.034; profile.edgeBoost = 0.70; profile.sweep = 0.28; profile.shimmer = 0.10; profile.glowLift = 0.86; profile.floatAmp = 0.62;
    } else {
        profile.enter = 0.62; profile.exit = 0.52; profile.slide = 0.38; profile.progressEase *= 0.90; profile.contextDrift = 0.066; profile.edgeBoost = 1.18; profile.sweep = 0.72; profile.shimmer = 0.22; profile.glowLift = 1.0; profile.floatAmp = 1.0;
    }
    profile.enter *= soft;
    profile.exit *= soft;
    profile.slide *= clampRange(0.80 + soft * 0.35, 0.75, 1.28);
    profile.progressEase = clampRange(profile.progressEase / clampRange(soft, 0.35, 1.2), 0.08, 0.72);
    return profile;
}
