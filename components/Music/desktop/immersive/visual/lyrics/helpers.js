/**
 * 歌词系统共用的颜色 / 数值工具。
 *
 * 原样取自上游 public/js/modules/02-visual/04-visual-settings-persistence.js
 * 的开头一段; 那里绝大部分是 UI 持久化逻辑, 只有这几个纯函数被歌词模块
 * 反复调用, 单独抽出来避免把整个 1075 行的文件拖进来。
 *
 * clampRange / normalizeHexColor 用本仓库 visual/presetData.js 已有的版本,
 * 不在这里重复定义。上游许可证 GNU GPL v3。
 */

export const clamp01 = function (v) {
    return Math.max(0, Math.min(1, v));
};

export const rgbToHsl = function (r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
        else if (max === gn) h = (bn - rn) / d + 2;
        else h = (rn - gn) / d + 4;
        h /= 6;
    }
    return { h, s, l };
};

export const hslToRgb = function (h, s, l) {
    const hue2rgb = function (p, q, t) {
        let tt = t;
        if (tt < 0) tt += 1;
        if (tt > 1) tt -= 1;
        if (tt < 1 / 6) return p + (q - p) * 6 * tt;
        if (tt < 1 / 2) return q;
        if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
        return p;
    };
    let r;
    let g;
    let b;
    if (s === 0) {
        r = l; g = l; b = l;
    } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
};

export const rgbCss = function (c, a) {
    if (a == null) return `rgb(${c.r},${c.g},${c.b})`;
    return `rgba(${c.r},${c.g},${c.b},${a})`;
};

export const normalizeLyricTextureClarity = function (v) {
    let value = Number(v);
    if (!Number.isFinite(value)) value = 1;
    // 上游为 1 / 1.25 / 1.5 三个历史档位留下兼容换算。
    if (Math.abs(value - 1.25) < 0.001) return 2;
    if (Math.abs(value - 1.5) < 0.001) return 4;
    return Math.max(1, Math.min(4, Math.round(value)));
};

export const layoutNumber = function (value, fallback, min, max) {
    let n = Number(value);
    if (!Number.isFinite(n)) n = Number(fallback);
    if (!Number.isFinite(n)) n = min;
    return Math.max(min, Math.min(max, n));
};

export const layoutInteger = function (value, fallback, min, max) {
    return Math.round(layoutNumber(value, fallback, min, max));
};
