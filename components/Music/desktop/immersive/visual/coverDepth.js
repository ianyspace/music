/**
 * 封面 → 边缘 / 深度纹理。
 *
 * 移植自 Mineradio public/js/modules/02-visual/15-ripples-cover-depth.js
 * (buildEdgeAndDepth)。上游许可证 GNU GPL v3。
 *
 * 输出 256×256 RGBA: R=depth G=edge B=前景mask A=亮度。
 * 着色器只认这四个通道的含义, 换算法会连带改掉丝绸预设的立体感,
 * 所以这里连常数都原样保留。
 */

const W = 256;
const H = 256;
const N = W * H;

export const buildEdgeAndDepth = function (srcCanvas) {
    const normalized = document.createElement('canvas');
    normalized.width = W;
    normalized.height = H;
    const sctx = normalized.getContext('2d');
    sctx.drawImage(srcCanvas, 0, 0, W, H);
    const src = sctx.getImageData(0, 0, W, H).data;
    const lum = new Float32Array(N);
    const blur = new Float32Array(N);
    const tmp = new Float32Array(N);

    for (let i = 0; i < N; i += 1) {
        const di = i * 4;
        lum[i] = (src[di] * 0.299 + src[di + 1] * 0.587 + src[di + 2] * 0.114) / 255;
    }

    const blurH = (s, d, r) => {
        for (let y = 0; y < H; y += 1) {
            let sum = 0;
            for (let x = -r; x <= r; x += 1) sum += s[y * W + Math.max(0, Math.min(W - 1, x))];
            for (let x = 0; x < W; x += 1) {
                d[y * W + x] = sum / (2 * r + 1);
                const xR = Math.min(W - 1, x + r + 1);
                const xL = Math.max(0, x - r);
                sum += s[y * W + xR] - s[y * W + xL];
            }
        }
    };
    const blurV = (s, d, r) => {
        for (let x = 0; x < W; x += 1) {
            let sum = 0;
            for (let y = -r; y <= r; y += 1) sum += s[Math.max(0, Math.min(H - 1, y)) * W + x];
            for (let y = 0; y < H; y += 1) {
                d[y * W + x] = sum / (2 * r + 1);
                const yD = Math.min(H - 1, y + r + 1);
                const yU = Math.max(0, y - r);
                sum += s[yD * W + x] - s[yU * W + x];
            }
        }
    };
    blurH(lum, tmp, 4);
    blurV(tmp, blur, 4);

    const edge = new Float32Array(N);
    for (let y = 1; y < H - 1; y += 1) {
        for (let x = 1; x < W - 1; x += 1) {
            const gx = -blur[(y - 1) * W + (x - 1)] - 2 * blur[y * W + (x - 1)] - blur[(y + 1) * W + (x - 1)]
                + blur[(y - 1) * W + (x + 1)] + 2 * blur[y * W + (x + 1)] + blur[(y + 1) * W + (x + 1)];
            const gy = -blur[(y - 1) * W + (x - 1)] - 2 * blur[(y - 1) * W + x] - blur[(y - 1) * W + (x + 1)]
                + blur[(y + 1) * W + (x - 1)] + 2 * blur[(y + 1) * W + x] + blur[(y + 1) * W + (x + 1)];
            edge[y * W + x] = Math.min(1.0, Math.sqrt(gx * gx + gy * gy) * 1.4);
        }
    }

    const depth = new Float32Array(N);
    for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
            const i = y * W + x;
            const cx = (x / (W - 1) - 0.5) * 2.0;
            const cy = (y / (H - 1) - 0.5) * 2.0;
            const rr = Math.sqrt(cx * cx + cy * cy);
            const centerBias = 1.0 - Math.min(1, rr * 0.75);
            depth[i] = Math.min(1.0, blur[i] * 0.45 + centerBias * 0.55);
        }
    }

    const fg = new Float32Array(N);
    for (let i = 0; i < N; i += 1) {
        fg[i] = Math.min(1.0, depth[i] * 0.6 + edge[i] * 0.5);
    }

    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const octx = out.getContext('2d');
    const imgOut = octx.createImageData(W, H);
    for (let i = 0; i < N; i += 1) {
        const di = i * 4;
        imgOut.data[di] = Math.round(depth[i] * 255);
        imgOut.data[di + 1] = Math.round(edge[i] * 255);
        imgOut.data[di + 2] = Math.round(fg[i] * 255);
        imgOut.data[di + 3] = Math.round(lum[i] * 255);
    }
    octx.putImageData(imgOut, 0, 0);
    return out;
};

/** 封面还没算完深度时用的中性贴图: 深度 0.5、无边缘、全前景。 */
export const applyNeutralEdgeCanvas = function () {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(128,0,255,255)';
    ctx.fillRect(0, 0, 64, 64);
    return cv;
};

/** 把任意图片裁成正方形封面画布 (唱片/星云的采样都按正方形来)。 */
export const makeSquareCoverCanvas = function (img, size) {
    const target = size || 512;
    const cv = document.createElement('canvas');
    cv.width = target;
    cv.height = target;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, target, target);
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const s = Math.min(iw, ih);
    ctx.drawImage(img, (iw - s) / 2, (ih - s) / 2, s, s, 0, 0, target, target);
    return cv;
};
