/**
 * 歌词字体栈 / 文本度量 / 石印纹理。
 *
 * 移植自上游 Mineradio public/js/modules/02-visual/05-lyrics-fonts-texture.js
 * 上游许可证 GNU GPL v3 (用户已授权原样复制)。
 *
 * 为什么是原样搬运: 这里的字号步长、字重档位、度量缓存容量、 letterSpacing
 * 的探测写法、以及 applyStonePrintTexture 里那一整套噪声阈值
 * (0.82 / 0.62 / 0.48) 和 chip / 划痕 / 斑点的数量与透明度都是调出来的观感
 * 参数, 任何"顺手优化"都会改变最终画面, 因此逐行保留。
 *
 * 相对上游的改动仅限:
 *   - 顶层 function / var 改为 ESM export;
 *   - `clampRange` `normalizeHexColor` 改用本仓库 visual/presetData.js 的实现;
 *   - 上游在 00-core-stores.js 里声明的自定义字体常量与数组在本文件局部补
 *     一份(见下方局部 helper), 其余文件没有移植。
 */

import { clampRange, normalizeHexColor } from '../presetData.js';
import { fx } from './runtime.js';

// ---------------------------------------------------------------- 局部 helper
// 上游这三个符号声明在 00-state/00-core-stores.js, 不在本行移植范围内,
// 这里按上游原文补一份(数值与键名完全一致)以保证文件自洽。

const CUSTOM_LYRIC_FONT_STORE_KEY = 'mineradio-custom-lyric-fonts-v1';
const CUSTOM_LYRIC_FONT_MAX_COUNT = 6;

export function builtinLyricFontKeyPattern() {
    return /^(sans|hei|song|bold-song|stone-song|kai-song|serif-en|gothic|editorial|humanist|round|mono|display)$/;
}
export function customLyricFontKey(id) {
    id = String(id || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32);
    return id ? ('custom:' + id) : '';
}
export function customLyricFontIdFromKey(key) {
    var match = /^custom:([a-z0-9_-]{1,32})$/i.exec(String(key || ''));
    return match ? match[1] : '';
}
export function customLyricFontRecordForKey(key) {
    var id = customLyricFontIdFromKey(key);
    if (!id || !Array.isArray(customLyricFonts)) return null;
    for (var i = 0; i < customLyricFonts.length; i++) {
        if (customLyricFonts[i] && customLyricFonts[i].id === id) return customLyricFonts[i];
    }
    return null;
}
export function normalizeCustomLyricFontName(name) {
    name = String(name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return (name || '自定义字体').slice(0, 18);
}
export function normalizeCustomLyricFontRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var id = String(raw.id || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32);
    var dataUrl = String(raw.dataUrl || '');
    if (!id || !/^data:(font\/(ttf|otf|woff2?|sfnt)|application\/(font-woff|x-font-ttf|x-font-otf|octet-stream)|application\/vnd\.ms-fontobject);base64,/i.test(dataUrl)) return null;
    return {
        id: id,
        name: normalizeCustomLyricFontName(raw.name),
        family: String(raw.family || ('MineradioCustomLyricFont-' + id)).replace(/["\\]/g, '').slice(0, 72) || ('MineradioCustomLyricFont-' + id),
        dataUrl: dataUrl,
        size: Math.max(0, Number(raw.size) || 0),
        savedAt: Math.max(0, Number(raw.savedAt) || Date.now())
    };
}
export function readCustomLyricFonts() {
    try {
        var raw = JSON.parse(localStorage.getItem(CUSTOM_LYRIC_FONT_STORE_KEY) || '[]');
        if (!Array.isArray(raw)) return [];
        return raw.map(normalizeCustomLyricFontRecord).filter(Boolean).slice(0, CUSTOM_LYRIC_FONT_MAX_COUNT);
    } catch (e) {
        return [];
    }
}
export function saveCustomLyricFonts() {
    try {
        localStorage.setItem(CUSTOM_LYRIC_FONT_STORE_KEY, JSON.stringify(customLyricFonts || []));
        return true;
    } catch (e) {
        console.warn('[LyricFont] save failed', e);
        return false;
    }
}
export function quotedCssFontFamily(name) {
    return '"' + String(name || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}
export function registerCustomLyricFont(record) {
    var source = record;
    record = normalizeCustomLyricFontRecord(record);
    if (!record || typeof FontFace !== 'function' || !document.fonts) return Promise.resolve(false);
    if (source && source.loaded && source.id === record.id) return Promise.resolve(true);
    try {
        var face = new FontFace(record.family, 'url("' + record.dataUrl + '")');
        return face.load().then(function (loadedFace) {
            document.fonts.add(loadedFace);
            clearLyricTextMeasureCache();
            scheduleLyricTextMeasureWarmup(0);
            record.loaded = true;
            if (source && source.id === record.id) source.loaded = true;
            return true;
        }).catch(function (err) {
            console.warn('[LyricFont] load failed', err);
            return false;
        });
    } catch (e) {
        console.warn('[LyricFont] register failed', e);
        return Promise.resolve(false);
    }
}
export function registerSavedCustomLyricFonts() {
    if (!Array.isArray(customLyricFonts) || !customLyricFonts.length) return;
    customLyricFonts.forEach(function (record) { registerCustomLyricFont(record); });
}
export function normalizeLyricFontKey(value) {
    value = String(value || 'sans');
    if (builtinLyricFontKeyPattern().test(value)) return value;
    if (customLyricFontRecordForKey(value)) return value;
    return 'sans';
}
export function lyricFontStackForKey(key) {
    key = normalizeLyricFontKey(key);
    var customFont = customLyricFontRecordForKey(key);
    if (customFont) return quotedCssFontFamily(customFont.family) + ',"Noto Sans SC","Microsoft YaHei","PingFang SC",sans-serif';
    if (key === 'hei') return '"Noto Sans SC","Microsoft YaHei",SimHei,"PingFang SC",sans-serif';
    if (key === 'song') return '"Noto Serif SC","Source Han Serif SC",SimSun,"Songti SC",serif';
    if (key === 'bold-song') return '"Source Han Serif SC Heavy","Source Han Serif SC","Noto Serif SC Black","Noto Serif SC","STZhongsong","SimSun",serif';
    if (key === 'stone-song') return '"FZYaSongS-B-GB","FZCuSong-B09S","Source Han Serif SC Heavy","Noto Serif SC Black","STZhongsong","SimSun",serif';
    if (key === 'kai-song') return '"Kaiti SC","STKaiti","KaiTi","Source Han Serif SC","Noto Serif SC",serif';
    if (key === 'serif-en') return 'Georgia,"Times New Roman","Noto Serif SC","Source Han Serif SC",serif';
    if (key === 'gothic') return '"UnifrakturCook","UnifrakturMaguntia","Old English Text MT","Blackletter","Cinzel Decorative","Noto Serif SC",serif';
    if (key === 'editorial') return '"Didot","Bodoni 72","Libre Baskerville",Georgia,"Noto Serif SC",serif';
    if (key === 'humanist') return '"Avenir Next","Segoe UI","Inter","Noto Sans SC","PingFang SC",sans-serif';
    if (key === 'round') return '"HarmonyOS Sans SC","Microsoft YaHei UI","PingFang SC","Noto Sans SC",sans-serif';
    if (key === 'mono') return '"JetBrains Mono",Consolas,"Noto Sans SC","Microsoft YaHei",monospace';
    if (key === 'display') return '"Alibaba PuHuiTi","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
    return 'Inter,"Noto Sans SC","PingFang SC","Microsoft YaHei",Arial,sans-serif';
}
export function lyricFontWeightValue() {
    if (normalizeLyricFontKey(fx && fx.lyricFont) === 'stone-song') return 900;
    return Math.round(clampRange(Number(fx && fx.lyricWeight) || 900, 500, 900) / 50) * 50;
}
export function lyricFontCss(fontSize, weight) {
    var w = weight == null ? lyricFontWeightValue() : Math.round(clampRange(Number(weight) || lyricFontWeightValue(), 500, 900) / 50) * 50;
    return w + ' ' + fontSize + 'px ' + lyricFontStackForKey(fx && fx.lyricFont);
}
export function lyricLetterSpacingPx(fontSize) {
    return clampRange(Number(fx && fx.lyricLetterSpacing) || 0, -0.04, 0.18) * Math.max(1, fontSize || 1);
}
export function lyricLineHeightFactor() {
    return clampRange(Number(fx && fx.lyricLineHeight) || 1, 0.72, 1.80);
}
export var lyricTextMeasureCache = { fonts: {}, order: [], maxFonts: 64, maxCharsPerFont: 512 };
export function clearLyricTextMeasureCache() {
    lyricTextMeasureCache = { fonts: {}, order: [], maxFonts: 64, maxCharsPerFont: 512 };
}
export function lyricTextMeasureFontCache(ctx) {
    var key = String(ctx && ctx.font || '');
    var cache = lyricTextMeasureCache.fonts[key];
    if (cache) return cache;
    while (lyricTextMeasureCache.order.length >= lyricTextMeasureCache.maxFonts) {
        delete lyricTextMeasureCache.fonts[lyricTextMeasureCache.order.shift()];
    }
    cache = { values: {}, order: [] };
    lyricTextMeasureCache.fonts[key] = cache;
    lyricTextMeasureCache.order.push(key);
    return cache;
}
export function lyricMeasuredCharacterWidth(ctx, character) {
    character = String(character || '');
    var cache = lyricTextMeasureFontCache(ctx);
    if (Object.prototype.hasOwnProperty.call(cache.values, character)) return cache.values[character];
    while (cache.order.length >= lyricTextMeasureCache.maxCharsPerFont) delete cache.values[cache.order.shift()];
    var width = ctx.measureText(character).width;
    cache.values[character] = width;
    cache.order.push(character);
    return width;
}
export var lyricTextMeasureWarmupTimer = 0;
export function warmLyricTextMeasureCache() {
    lyricTextMeasureWarmupTimer = 0;
    if (typeof document === 'undefined') return;
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.font = lyricFontCss(128);
    measureTextWithLetterSpacing(ctx, '歌词 Lyrics 0123456789', lyricLetterSpacingPx(128));
}
export function scheduleLyricTextMeasureWarmup(delay) {
    if (lyricTextMeasureWarmupTimer) clearTimeout(lyricTextMeasureWarmupTimer);
    var run = warmLyricTextMeasureCache;
    delay = Math.max(0, Number(delay) || 0);
    lyricTextMeasureWarmupTimer = setTimeout(function () {
        lyricTextMeasureWarmupTimer = 0;
        if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 800 });
        else run();
    }, delay);
}
if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener('loadingdone', function () {
        clearLyricTextMeasureCache();
        scheduleLyricTextMeasureWarmup(0);
    });
}
scheduleLyricTextMeasureWarmup(120);
export function measureTextWithLetterSpacing(ctx, text, spacing) {
    text = String(text || '');
    spacing = Number(spacing) || 0;
    if (!spacing || text.length < 2) return ctx.measureText(text).width;
    var chars = Array.from(text);
    if ('fontKerning' in ctx && 'letterSpacing' in ctx) {
        var previousKerning = ctx.fontKerning;
        var previousLetterSpacing = ctx.letterSpacing;
        var probeSpacing = 0.001;
        try {
            ctx.fontKerning = 'none';
            ctx.letterSpacing = probeSpacing + 'px';
            var glyphWidth = ctx.measureText(text).width - probeSpacing * chars.length;
            if (isFinite(glyphWidth)) return Math.max(1, glyphWidth + spacing * (chars.length - 1));
        } finally {
            ctx.fontKerning = previousKerning;
            ctx.letterSpacing = previousLetterSpacing;
        }
    }
    var w = 0;
    for (var i = 0; i < chars.length; i++) {
        w += lyricMeasuredCharacterWidth(ctx, chars[i]);
        if (i < chars.length - 1) w += spacing;
    }
    return Math.max(1, w);
}
export function lyricMeasureText(ctx, text, fontSize) {
    return measureTextWithLetterSpacing(ctx, text, lyricLetterSpacingPx(fontSize));
}
export function lyricMeasureTextAtSize(ctx, text, fontSize, weight) {
    var prevFont = ctx.font;
    ctx.font = lyricFontCss(fontSize, weight);
    var width = lyricMeasureText(ctx, text, fontSize);
    ctx.font = prevFont;
    return width;
}
export function drawTextWithLetterSpacing(ctx, text, x, y, spacing, stroke) {
    text = String(text || '');
    spacing = Number(spacing) || 0;
    if (!spacing || text.length < 2) {
        if (stroke) ctx.strokeText(text, x, y);
        else ctx.fillText(text, x, y);
        return;
    }
    var chars = Array.from(text);
    var align = ctx.textAlign || 'left';
    var width = measureTextWithLetterSpacing(ctx, text, spacing);
    var start = x;
    if (align === 'center') start = x - width / 2;
    else if (align === 'right' || align === 'end') start = x - width;
    ctx.textAlign = 'left';
    var cursor = start;
    for (var i = 0; i < chars.length; i++) {
        if (stroke) ctx.strokeText(chars[i], cursor, y);
        else ctx.fillText(chars[i], cursor, y);
        cursor += lyricMeasuredCharacterWidth(ctx, chars[i]) + (i < chars.length - 1 ? spacing : 0);
    }
    ctx.textAlign = align;
}
export function lyricFillText(ctx, text, x, y, fontSize) {
    drawTextWithLetterSpacing(ctx, text, x, y, lyricLetterSpacingPx(fontSize), false);
}
export function lyricStrokeText(ctx, text, x, y, fontSize) {
    drawTextWithLetterSpacing(ctx, text, x, y, lyricLetterSpacingPx(fontSize), true);
}
export function applyStonePrintTexture(ctx, W, H, fontSize, randomFn) {
    if (normalizeLyricFontKey(fx && fx.lyricFont) !== 'stone-song') return;
    var random = typeof randomFn === 'function' ? randomFn : Math.random;
    var size = clampRange(fontSize || 128, 42, 180);
    var bandTop = H * 0.10;
    var bandH = H * 0.80;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';

    var noiseW = 300, noiseH = 110;
    var noise = document.createElement('canvas');
    noise.width = noiseW; noise.height = noiseH;
    var nctx = noise.getContext('2d');
    var img = nctx.createImageData(noiseW, noiseH);
    for (var p = 0; p < noiseW * noiseH; p++) {
        var x0 = p % noiseW;
        var y0 = Math.floor(p / noiseW);
        var vein = Math.sin(x0 * 0.19 + y0 * 0.043) * 0.10 + Math.sin(y0 * 0.31) * 0.06;
        var r = random() + vein;
        var a = 0;
        if (r > 0.82) a = 78 + random() * 92;
        else if (r > 0.62) a = 22 + random() * 54;
        else if (r > 0.48) a = 4 + random() * 24;
        img.data[p * 4] = 255;
        img.data[p * 4 + 1] = 255;
        img.data[p * 4 + 2] = 255;
        img.data[p * 4 + 3] = a;
    }
    nctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.34;
    ctx.drawImage(noise, 0, bandTop, W, bandH);

    var chips = Math.round(size * 7.2);
    for (var i = 0; i < chips; i++) {
        var x = random() * W;
        var y = bandTop + random() * bandH;
        var w = 0.7 + random() * (size * 0.052);
        var h = 0.45 + random() * (size * 0.026);
        ctx.globalAlpha = 0.16 + random() * 0.36;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((random() - 0.5) * 0.38);
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.restore();
    }

    ctx.lineCap = 'round';
    for (var s = 0; s < 44; s++) {
        var sx = random() * W;
        var sy = bandTop + random() * bandH;
        ctx.globalAlpha = 0.09 + random() * 0.16;
        ctx.lineWidth = 0.45 + random() * 1.2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + 10 + random() * 86, sy + (random() - 0.5) * 4.8);
        ctx.stroke();
    }

    for (var c = 0; c < 26; c++) {
        var cx = random() * W;
        var cy = bandTop + random() * bandH;
        var radius = 1.8 + random() * (size * 0.060);
        ctx.globalAlpha = 0.08 + random() * 0.18;
        ctx.beginPath();
        ctx.ellipse(cx, cy, radius * (0.7 + random() * 1.4), radius * (0.25 + random() * 0.55), random() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}
export function hexToRgb(hex) {
    hex = normalizeHexColor(hex).slice(1);
    return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16)
    };
}

// 上游在 00-core-stores.js 里于上述函数定义之后(函数声明提升)执行
// `var customLyricFonts = readCustomLyricFonts();`, 这里保持同样的时序:
// 放到文件末尾初始化, 避免 TDZ。
export var customLyricFonts = readCustomLyricFonts();
