import * as THREE from 'three';

/**
 * Procedural textures for the 3D stage.
 *
 * Nothing here is an asset file. The page ships no images at all — the grooves,
 * the particle dot, the floor glow, the room the vinyl reflects and the
 * placeholder artwork are all drawn into a `<canvas>` at mount and uploaded
 * once. That keeps the route's payload to the three.js bundle and means the
 * record looks the same on a machine that cannot reach the cover host.
 *
 * The one exception is the album cover, and even that goes through a canvas:
 * see `coverTexture` for why it is not simply a `TextureLoader`.
 */

const makeCanvas = function (width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
};

/**
 * The vinyl surface: concentric grooves on near-black, plus a few wider gaps
 * where a real record separates its tracks.
 *
 * Drawn as a *square* canvas even though it lands on a disc, because a
 * `CylinderGeometry` cap maps its unit square onto the circle — the centre of
 * the canvas is the centre of the record, and the corners are simply never
 * sampled. Drawing it round would only lose resolution.
 *
 * The label covers the inner 34% of the radius, so the grooves start at 17% of
 * the canvas and run to the edge. Each ring gets its own random alpha, which is
 * what stops 200 evenly-spaced circles from reading as a machined grid: the
 * variation is what the eye picks up as a groove rather than as a pattern.
 */
export const grooveTexture = function () {
    const size = 1024;
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const mid = size / 2;

    ctx.fillStyle = '#0a0b10';
    ctx.fillRect(0, 0, size, size);

    const inner = size * 0.17;
    const outer = size * 0.5;

    for (let radius = inner; radius < outer; radius += 1.7) {
        const t = (radius - inner) / (outer - inner);
        // Denser and brighter towards the outside, where a real record packs
        // the most music per millimetre.
        const alpha = 0.02 + Math.random() * 0.055 * (0.4 + t);
        ctx.beginPath();
        ctx.arc(mid, mid, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // Track gaps: four slightly brighter bands, spaced unevenly like side A.
    [0.3, 0.46, 0.63, 0.82].forEach((t) => {
        const radius = inner + (outer - inner) * t;
        ctx.beginPath();
        ctx.arc(mid, mid, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.11)';
        ctx.lineWidth = 2.4;
        ctx.stroke();
    });

    // A single broad sheen across the disc, so the surface is not perfectly
    // uniform even where no light is hitting it.
    const sheen = ctx.createLinearGradient(0, 0, size, size);
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
    sheen.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
    sheen.addColorStop(1, 'rgba(255, 255, 255, 0.035)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
};

/**
 * One soft dot, for the dust. `PointsMaterial` multiplies the point sprite by
 * this, so a radial falloff is what turns a square of white into a speck of
 * light. The default `PointsMaterial` dot is a hard-edged square, which at
 * additive blending reads as a field of tiny boxes.
 */
export const dotTexture = function () {
    const size = 64;
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
};

/**
 * The room the vinyl reflects, as an equirectangular strip.
 *
 * A `MeshStandardMaterial` with any metalness at all is black without an
 * environment — it has nothing to reflect — and a black disc is the one thing
 * this scene cannot afford, because the record *is* the scene. So the page
 * builds its own tiny room: a dark gradient with two soft light sources, fed
 * through `PMREMGenerator` so the roughness blur is physically plausible.
 *
 * The two blobs are placed high and to either side, and one of them is the
 * accent colour: that is where the pink highlight sliding across the grooves
 * comes from when the camera orbits.
 */
export const envTexture = function () {
    const width = 512;
    const height = 256;
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const base = ctx.createLinearGradient(0, 0, 0, height);
    base.addColorStop(0, '#1b2130');
    base.addColorStop(0.48, '#0a0d14');
    base.addColorStop(1, '#04050a');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);

    const blob = function (x, y, radius, color) {
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    };

    blob(width * 0.22, height * 0.22, 130, 'rgba(255, 255, 255, 0.85)');
    blob(width * 0.68, height * 0.3, 150, 'rgba(250, 35, 59, 0.5)');
    blob(width * 0.9, height * 0.62, 120, 'rgba(90, 130, 255, 0.28)');

    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
};

/**
 * The pool of light the turntable stands in.
 *
 * Opaque black at the rim, transparent in the middle, laid flat over the
 * mirrored copy of the record. Without it the reflection runs to a hard circle
 * of visible geometry; with it the record appears to be standing on something
 * infinite, which is the whole point of putting it in a void.
 */
export const poolTexture = function () {
    const size = 512;
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(4, 5, 10, 0)');
    gradient.addColorStop(0.34, 'rgba(4, 5, 10, 0.15)');
    gradient.addColorStop(0.62, 'rgba(4, 5, 10, 0.72)');
    gradient.addColorStop(1, 'rgba(4, 5, 10, 1)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
};

/**
 * A soft coloured halo, for the glow that sits under the record and pulses on
 * the beat. Same construction as the pool but transparent at the rim, so it can
 * be blended additively on top of it.
 */
export const haloTexture = function () {
    const size = 256;
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    gradient.addColorStop(0.24, 'rgba(255, 255, 255, 0.34)');
    gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.07)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
};

const loadImage = function (url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        // `anonymous` on purpose: without it the image loads but *taints* the
        // canvas, and uploading a tainted canvas to WebGL throws. Asking for
        // CORS turns "no headers on the bucket" into a plain failed load, which
        // the caller answers with the gradient instead of a black record.
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`cover failed: ${url}`));
        image.src = url;
    });
};

/**
 * The cover, as a square texture for the record's label.
 *
 * `TextureLoader` would be one line, but it gives no way to say "and if this
 * fails, use that instead" — and a missing cover is the normal case here, not
 * an error: the library's covers are sidecar files that may not exist, a Drive
 * thumbnail expires, and the bucket may not send CORS headers at all. So the
 * image goes through a canvas like everything else in this file, centre-cropped
 * to a square, and a failure returns `null` for the caller to answer.
 *
 * `fallback` is a data URL from the shared `makeArtwork` helper — the same
 * gradient-and-note tile the wide-screen layout shows behind a coverless song,
 * so the two pages fall back to the same thing. It is tried *after* the real
 * cover, not only instead of it: a cover that exists and fails to load (an
 * expired Drive thumbnail, a bucket with no CORS headers) has to land on the
 * same gradient as a song that never had one, or the record shows a black
 * label for reasons the visitor cannot see.
 */
export const coverTexture = async function (url, { fallback = '', size = 512 } = {}) {
    const attempts = url && fallback && url !== fallback ? [url, fallback] : [url || fallback];

    for (let i = 0; i < attempts.length; i += 1) {
        if (!attempts[i]) continue;
        try {
            const image = await loadImage(attempts[i]);
            const canvas = makeCanvas(size, size);
            const ctx = canvas.getContext('2d');
            const side = Math.min(image.width, image.height);
            ctx.drawImage(
                image,
                (image.width - side) / 2,
                (image.height - side) / 2,
                side,
                side,
                0,
                0,
                size,
                size,
            );
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 8;
            return texture;
        } catch (error) {
            // Fall through to the gradient. A coverless song is the normal
            // case here, not an error.
        }
    }

    return null;
};
