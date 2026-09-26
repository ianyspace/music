import { loadCoverResilient } from './coverImage';

/**
 * The cover's own colour scheme, for every layer that wants to agree with
 * the artwork instead of with a hard-coded palette.
 *
 * The idea (the same one the big desktop visualisers use, written from
 * scratch here): average colour is useless — a cover that is half black and
 * half neon averages to mud. What reads as "the song's colour" is the
 * *saturated* part of the picture, so pixels are scored by chroma and by how
 * far they sit from the extremes of light and dark, then binned by hue. The
 * dominant bin is the primary; the strongest bin far enough away in hue is
 * the secondary; the single most saturated usable pixel is the accent.
 *
 * Everything is 0–1 floats, because every consumer is a shader uniform.
 */

const CACHE_PREFIX = 'music.cover-palette.';
const SAMPLE_SIDE = 48;

// A pixel has to be this visible, and this far from pure black / white, to
// count towards a colour opinion at all.
const MIN_ALPHA = 0.5;
const MIN_LUMA = 0.06;
const MAX_LUMA = 0.96;

const HUE_BINS = 12;

const memory = new Map();

const rgbToHue = function (r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    if (delta < 1e-6) return 0;
    let hue;
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue /= 6;
    return hue < 0 ? hue + 1 : hue;
};

const hueDistance = function (a, b) {
    const d = Math.abs(a - b);
    return d > 0.5 ? 1 - d : d;
};

/** @returns {{primary:number[],secondary:number[],accent:number[],average:number[],monochrome:boolean}} */
export const extractPalette = function (image) {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIDE;
    canvas.height = SAMPLE_SIDE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    try {
        ctx.drawImage(image, 0, 0, SAMPLE_SIDE, SAMPLE_SIDE);
    } catch (error) {
        return null;
    }

    let pixels;
    try {
        pixels = ctx.getImageData(0, 0, SAMPLE_SIDE, SAMPLE_SIDE).data;
    } catch (error) {
        return null; // tainted: the image arrived without CORS after all
    }

    const bins = [];
    for (let i = 0; i < HUE_BINS; i += 1) {
        bins.push({ weight: 0, r: 0, g: 0, b: 0 });
    }

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let counted = 0;
    let chromaSum = 0;
    let accentScore = -1;
    let accent = [0.5, 0.5, 0.5];

    for (let y = 0; y < SAMPLE_SIDE; y += 2) {
        for (let x = 0; x < SAMPLE_SIDE; x += 2) {
            const at = (y * SAMPLE_SIDE + x) * 4;
            const a = pixels[at + 3] / 255;
            if (a < MIN_ALPHA) continue;
            const r = pixels[at] / 255;
            const g = pixels[at + 1] / 255;
            const b = pixels[at + 2] / 255;
            const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            if (luma < MIN_LUMA || luma > MAX_LUMA) continue;

            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const chroma = max - min;
            const hue = rgbToHue(r, g, b);

            // Centrality keeps a mid-tone beat over a near-black one: a
            // picture's colour identity lives in the middle of its range.
            const centrality = 1 - Math.abs(luma - 0.5) * 1.6;
            const weight = Math.max(0.001, chroma * 1.5 + centrality * 0.35);

            const bin = bins[Math.min(HUE_BINS - 1, Math.floor(hue * HUE_BINS))];
            bin.weight += weight;
            bin.r += r * weight;
            bin.g += g * weight;
            bin.b += b * weight;

            sumR += r;
            sumG += g;
            sumB += b;
            counted += 1;
            chromaSum += chroma;

            const accentScoreHere = chroma * 2 + centrality * 0.4;
            if (accentScoreHere > accentScore) {
                accentScore = accentScoreHere;
                accent = [r, g, b];
            }
        }
    }

    if (!counted) return null;

    const finish = (bin) => {
        if (!bin || bin.weight <= 0) return [0.5, 0.5, 0.5];
        return [
            Math.min(1, bin.r / bin.weight),
            Math.min(1, bin.g / bin.weight),
            Math.min(1, bin.b / bin.weight),
        ];
    };

    const ranked = bins.slice().sort((a, b) => b.weight - a.weight);
    const primary = finish(ranked[0]);
    const primaryHue = rgbToHue(primary[0], primary[1], primary[2]);

    // The secondary has to be a *different* colour, or a two-tone cover just
    // hands back the same answer twice.
    const second = ranked.slice(1).find((bin) => {
        const colour = finish(bin);
        return hueDistance(rgbToHue(colour[0], colour[1], colour[2]), primaryHue) > 0.17;
    });
    const secondary = finish(second || ranked[1]);

    const average = [sumR / counted, sumG / counted, sumB / counted];

    // A greyscale cover has no opinion; every consumer should fall back to
    // the song's gradient instead of to a muddy near-grey.
    const monochrome = chromaSum / counted < 0.06;

    return { primary, secondary, accent, average, monochrome };
};

const readCache = function (url) {
    if (memory.has(url)) return memory.get(url);
    try {
        const raw = localStorage.getItem(CACHE_PREFIX + url);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        memory.set(url, parsed);
        return parsed;
    } catch (error) {
        return null;
    }
};

const writeCache = function (url, palette) {
    memory.set(url, palette);
    try {
        localStorage.setItem(CACHE_PREFIX + url, JSON.stringify(palette));
    } catch (error) {
        // Quota: this is an accelerator — losing it only costs one resample.
    }
};

/** The cover's palette, or null when there is no cover to read. */
export const loadCoverPalette = async function (url) {
    if (!url) return null;
    const cached = readCache(url);
    if (cached) return cached;
    const image = await loadCoverResilient(url);
    if (!image) return null;
    const palette = extractPalette(image);
    if (palette) writeCache(url, palette);
    return palette;
};

/**
 * A palette that is always safe to hand a shader: covers that failed to load,
 * greyscale artwork and the pre-load frame all get the song's gradient tint
 * rather than a null.
 */
export const paletteFromGradient = function (gradient) {
    const match = /#([0-9a-f]{6})/i.exec(String(gradient || ''));
    const base = match ? parseInt(match[1], 16) : 0xfa233b;
    const r = ((base >> 16) & 255) / 255;
    const g = ((base >> 8) & 255) / 255;
    const b = (base & 255) / 255;
    const lift = (channel) => Math.min(1, channel * 0.7 + 0.3);
    return {
        primary: [r, g, b],
        secondary: [b, r, g],
        accent: [lift(r), lift(g), lift(b)],
        average: [r, g, b],
        monochrome: false,
    };
};
