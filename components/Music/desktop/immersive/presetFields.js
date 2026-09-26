/**
 * The particle fields behind every preset.
 *
 * ## Why each preset builds its own buffers
 *
 * The first version of this page kept ONE buffer of cover pixels and let the
 * shader move it differently per mode. That was cheap, and it was also why
 * every mode looked like the same cloud: a tunnel, a planet and a rainstorm
 * built from the same rectangle of pixels all read as "the cover, wobbling".
 *
 * So each preset now owns a **builder**: it walks the sampled cover and writes
 * out its own `aUv` / `aExtra` / `aColor` / `aSeed`, which the shader's branch
 * for that preset then turns into a shape. The mapping is what differs —
 * a spiral groove, a sphere shell, a flock of wings, a rose curve — and the
 * cover's own pixels ride along as the colour, so every mode still belongs to
 * the song that is playing.
 *
 * ## The attribute contract
 *
 * - `aUv`    — two numbers, meaning whatever the preset's branch wants;
 * - `aExtra` — two more numbers for the branch (group flags, indices…);
 * - `aColor` — the cover pixel this particle carries;
 * - `aSeed`  — a stable random for scatter and twinkle.
 */

const TAU = Math.PI * 2;

// Sampled cover rows are capped so a 4K artwork cannot ask for a million
// particles; the stride in `sampleCover` thins the grid instead.
const MAX_SAMPLES = 220_000;

const hash = function (n) {
    const s = Math.sin(n * 78.233) * 43758.5453123;
    return s - Math.floor(s);
};

/**
 * Read the cover into a flat list of `[u, v, r, g, b]` samples, opaque pixels
 * only. This is the one expensive pass; every preset rebuild is a cheap walk
 * over the result.
 */
export const sampleCover = function (image, rows) {
    const aspect = image.naturalWidth / image.naturalHeight || 1;
    const cols = Math.max(8, Math.round(rows * aspect));

    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, cols, rows);

    let pixels;
    try {
        pixels = ctx.getImageData(0, 0, cols, rows).data;
    } catch (error) {
        return null; // tainted canvas — the image arrived without CORS
    }

    const cells = rows * cols;
    const stride = cells > MAX_SAMPLES ? Math.ceil(Math.sqrt(cells / MAX_SAMPLES)) : 1;
    const data = new Float32Array(MAX_SAMPLES * 5);

    let written = 0;
    for (let row = 0; row < rows; row += stride) {
        for (let col = 0; col < cols; col += stride) {
            if (written >= MAX_SAMPLES) break;
            const at = (row * cols + col) * 4;
            if (pixels[at + 3] / 255 < 0.08) continue;
            const base = written * 5;
            data[base] = cols > 1 ? col / (cols - 1) : 0.5;
            data[base + 1] = rows > 1 ? row / (rows - 1) : 0.5;
            data[base + 2] = pixels[at] / 255;
            data[base + 3] = pixels[at + 1] / 255;
            data[base + 4] = pixels[at + 2] / 255;
            written += 1;
        }
    }

    if (written === 0) return null;
    return { data: data.subarray(0, written * 5), count: written, aspect };
};

/** A disc of the song's colour, for when there is no cover to sample. */
export const fallbackSamples = function (color) {
    const count = 40_000;
    const data = new Float32Array(count * 5);
    for (let index = 0; index < count; index += 1) {
        const radius = Math.sqrt(Math.random()) * 0.5;
        const angle = Math.random() * TAU;
        const shade = 0.7 + Math.random() * 0.3;
        const base = index * 5;
        data[base] = 0.5 + Math.cos(angle) * radius;
        data[base + 1] = 0.5 + Math.sin(angle) * radius;
        data[base + 2] = color[0] * shade;
        data[base + 3] = color[1] * shade;
        data[base + 4] = color[2] * shade;
    }
    return { data, count, aspect: 1 };
};

/** Ambient dust behind the picture: its uv is (angle, radius). */
export const dustField = function (count) {
    const uvs = new Float32Array(count * 2);
    const extras = new Float32Array(count * 2);
    const colors = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
        uvs[index * 2] = Math.random();
        // sqrt keeps the disc's area uniform: a linear radius would crowd
        // the centre and leave the rim bare.
        uvs[index * 2 + 1] = Math.sqrt(Math.random());
        extras[index * 2] = Math.random();
        seeds[index] = Math.random() * 100;
    }
    return { uvs, extras, colors, seeds, count };
};

// --- per-preset framing ---------------------------------------------------
//
// The presets do not all want the same lens. A vinyl sits closer and larger
// than a tunnel mouth; a flock needs to be pulled back so the migration reads.
export const PRESET_FRAME = {
    emily: { scale: 1.35, pointSize: 5.0, cameraZ: 3.4 },
    tunnel: { scale: 1.0, pointSize: 4.6, cameraZ: 3.4 },
    orbit: { scale: 1.12, pointSize: 4.4, cameraZ: 3.4 },
    void: { scale: 1.0, pointSize: 3.0, cameraZ: 3.4 },
    vinyl: { scale: 1.18, pointSize: 4.2, cameraZ: 3.2 },
    galaxy: { scale: 1.0, pointSize: 3.6, cameraZ: 3.4 },
    requiem: { scale: 1.05, pointSize: 4.6, cameraZ: 3.1 },
    sonic: { scale: 1.0, pointSize: 4.0, cameraZ: 3.4 },
    halo: { scale: 1.15, pointSize: 4.4, cameraZ: 3.4 },
    rain: { scale: 1.0, pointSize: 3.4, cameraZ: 3.4 },
    prism: { scale: 1.0, pointSize: 4.0, cameraZ: 3.6 },
    abyss: { scale: 1.1, pointSize: 4.2, cameraZ: 3.4 },
};

const allocate = function (count) {
    return {
        uvs: new Float32Array(count * 2),
        extras: new Float32Array(count * 2),
        colors: new Float32Array(count * 3),
        seeds: new Float32Array(count),
        count: 0,
    };
};

const write = function (out, u, v, e0, e1, r, g, b) {
    const i = out.count;
    out.uvs[i * 2] = u;
    out.uvs[i * 2 + 1] = v;
    out.extras[i * 2] = e0;
    out.extras[i * 2 + 1] = e1;
    out.colors[i * 3] = r;
    out.colors[i * 3 + 1] = g;
    out.colors[i * 3 + 2] = b;
    out.seeds[i] = Math.random() * 100;
    out.count += 1;
};

// --- the builders ---------------------------------------------------------
//
// Every builder receives the sampled cover and returns a field. `uv` and
// `extra` mean whatever that preset's shader branch says they mean.

/** emily专辑封面 — the cover, taken apart, with a fast entrance. */
const buildEmily = function (samples, out) {
    const { data, count } = samples;
    for (let i = 0; i < count; i += 1) {
        const b = i * 5;
        const lum = data[b + 2] * 0.2126 + data[b + 3] * 0.7152 + data[b + 4] * 0.0722;
        write(out, data[b], data[b + 1], lum, 0, data[b + 2], data[b + 3], data[b + 4]);
    }
};

/** 滚筒 — the cover rolled into the wall of a tube rushing past. */
const buildTunnel = function (samples, out) {
    const { data, count } = samples;
    for (let i = 0; i < count; i += 1) {
        const b = i * 5;
        // A little angular jitter widens each ring into a band, which is what
        // makes the tube read as a surface rather than as concentric wire.
        const jitter = (hash(i + 11.7) - 0.5) * 0.004;
        write(out, data[b] + jitter, data[b + 1], hash(i + 3.1), 0,
            data[b + 2], data[b + 3], data[b + 4]);
    }
};

/** 星球 — the cover gathered onto a shell, with a loose atmosphere. */
const buildOrbit = function (samples, out) {
    const { data, count } = samples;
    for (let i = 0; i < count; i += 1) {
        const b = i * 5;
        const isAtmo = hash(i + 5.3) > 0.86 ? 1 : 0;
        const lum = data[b + 2] * 0.2126 + data[b + 3] * 0.7152 + data[b + 4] * 0.0722;
        // Latitude bias: uv.y is the polar angle, so the poles bunch up
        // unless the rows are spread by the sine of that angle.
        const phi = Math.acos(1 - 2 * ((i / count) * 0.999 + 0.0005)) / Math.PI;
        write(out, data[b], phi, isAtmo, lum, data[b + 2], data[b + 3], data[b + 4]);
    }
};

/** 虚空 — almost nothing, so the artwork behind can breathe. */
const buildVoid = function (samples, out) {
    const { data, count } = samples;
    const keep = Math.max(1, Math.floor(count / 14));
    for (let i = 0; i < count; i += keep) {
        const b = i * 5;
        write(out, data[b], data[b + 1], 0, 0, data[b + 2], data[b + 3], data[b + 4]);
    }
};

/** 唱片 — a grooved disc, plus the cover printed small on its label. */
const buildVinyl = function (samples, out, budget) {
    const { data, count } = samples;
    // Two passes: the grooves carry the cover wrapped into a spiral, and a
    // second, denser pass prints the whole cover onto the centre label —
    // that little disc is what makes the shape read as a record at all.
    const labelCount = Math.min(count, Math.floor(budget * 0.42));
    const grooveCount = budget - labelCount;
    for (let i = 0; i < grooveCount; i += 1) {
        const b = (i % count) * 5;
        write(out, data[b], data[b + 1], 0, hash(i + 1.7),
            data[b + 2], data[b + 3], data[b + 4]);
    }
    for (let i = 0; i < labelCount; i += 1) {
        const b = (i % count) * 5;
        write(out, data[b], data[b + 1], 1, 0, data[b + 2], data[b + 3], data[b + 4]);
    }
};

/** 星河 — aurora ribbons drifting across the frame. */
const buildGalaxy = function (samples, out) {
    const { data, count } = samples;
    for (let i = 0; i < count; i += 1) {
        const b = i * 5;
        const lane = Math.floor(hash(i + 7.3) * 3);
        write(out, data[b], data[b + 1], lane, hash(i + 2.9),
            data[b + 2], data[b + 3], data[b + 4]);
    }
};

/** 音域回响 — a column grid the spectrum pushes up from below. */
const buildSonic = function (samples, out) {
    const { data, count } = samples;
    for (let i = 0; i < count; i += 1) {
        const b = i * 5;
        const lum = data[b + 2] * 0.2126 + data[b + 3] * 0.7152 + data[b + 4] * 0.0722;
        write(out, data[b], data[b + 1], lum, Math.floor(data[b] * 32),
            data[b + 2], data[b + 3], data[b + 4]);
    }
};

/** 月蚀圣环 — an orbit ring and its backlit corona. */
const buildHalo = function (samples, out) {
    const { data, count } = samples;
    for (let i = 0; i < count; i += 1) {
        const b = i * 5;
        const isCorona = hash(i + 4.5) > 0.52 ? 1 : 0;
        write(out, data[b], data[b + 1], isCorona, hash(i + 8.1),
            data[b + 2], data[b + 3], data[b + 4]);
    }
};

/** 雨幕霓虹 — threads of rain, many particles per lane. */
const buildRain = function (samples, out) {
    const { data, count } = samples;
    for (let i = 0; i < count; i += 1) {
        const b = i * 5;
        const lane = Math.floor(data[b] * 220);
        write(out, data[b], data[b + 1], hash(lane + 3.3), hash(lane + 7.7),
            data[b + 2], data[b + 3], data[b + 4]);
    }
};

/** 折光蝶群 — the cover cut into a flock of folded wings. */
const buildPrism = function (samples, out) {
    const { data, count } = samples;
    const butterflies = 150;
    const per = Math.max(40, Math.floor(count / butterflies));
    let index = 0;
    for (let i = 0; i < count; i += 1) {
        const b = i * 5;
        let id = Math.floor(index / per);
        if (id >= butterflies) id = butterflies - 1;
        // Even indices go to the left wing, odd to the right, so every
        // butterfly carries the same picture on both sides.
        const side = index % 2;
        write(out, data[b], data[b + 1], id / butterflies, side,
            data[b + 2], data[b + 3], data[b + 4]);
        index += 1;
    }
};

/** 深海绽放 — a corona of petals on a rose curve. */
const buildAbyss = function (samples, out) {
    const { data, count } = samples;
    for (let i = 0; i < count; i += 1) {
        const b = i * 5;
        const layer = Math.floor(hash(i + 6.1) * 3);
        write(out, data[b], data[b + 1], layer, hash(i + 9.9),
            data[b + 2], data[b + 3], data[b + 4]);
    }
};

const BUILDERS = {
    emily: buildEmily,
    tunnel: buildTunnel,
    orbit: buildOrbit,
    void: buildVoid,
    vinyl: buildVinyl,
    galaxy: buildGalaxy,
    requiem: null, // built separately: it is a model, not the cover
    sonic: buildSonic,
    halo: buildHalo,
    rain: buildRain,
    prism: buildPrism,
    abyss: buildAbyss,
};

/**
 * Build the field for a preset. `requiem` is the exception: it has its own
 * async builder because its points come from a skull, not from the cover.
 */
export const buildField = function (presetId, samples) {
    const builder = BUILDERS[presetId] || buildEmily;
    const count = presetId === 'void'
        ? Math.floor(samples.count / 14) + 2
        : presetId === 'vinyl'
            ? samples.count + Math.floor(samples.count * 0.42) + 2
            : samples.count;
    const out = allocate(count);
    builder(samples, out, samples.count);
    return out;
};

// --- 安魂: the skull ------------------------------------------------------

const SKULL_SOURCES = [
    'models/skull.obj',
    '/music/models/skull.obj',
    '/models/skull.obj',
];

/**
 * Minimal OBJ reader: vertices plus triangular faces, which is all a point
 * cloud needs. Points are sampled area-weighted so dense regions of the mesh
 * stay dense in the cloud.
 */
const sampleObj = function (text, count) {
    const verts = [];
    const faces = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i].trim();
        if (line.startsWith('v ')) {
            const p = line.split(/\s+/);
            verts.push(parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3]));
        } else if (line.startsWith('f ')) {
            const p = line.split(/\s+/);
            for (let k = 3; k < p.length - 1; k += 1) {
                faces.push(
                    parseInt(p[1], 10) - 1,
                    parseInt(p[k], 10) - 1,
                    parseInt(p[k + 1], 10) - 1,
                );
            }
        }
    }
    if (verts.length < 9 || faces.length < 3) return null;

    const areas = new Float32Array(faces.length / 3);
    let total = 0;
    for (let f = 0; f < faces.length; f += 3) {
        const a = faces[f] * 3;
        const b = faces[f + 1] * 3;
        const c = faces[f + 2] * 3;
        const ux = verts[b] - verts[a];
        const uy = verts[b + 1] - verts[a + 1];
        const uz = verts[b + 2] - verts[a + 2];
        const vx = verts[c] - verts[a];
        const vy = verts[c + 1] - verts[a + 1];
        const vz = verts[c + 2] - verts[a + 2];
        const cx = uy * vz - uz * vy;
        const cy = uz * vx - ux * vz;
        const cz = ux * vy - uy * vx;
        const area = Math.sqrt(cx * cx + cy * cy + cz * cz) * 0.5;
        areas[f / 3] = area;
        total += area;
    }
    if (total <= 0) return null;

    // Cumulative areas let one binary search pick a face proportional to size.
    const cumulative = new Float32Array(areas.length);
    let acc = 0;
    for (let i = 0; i < areas.length; i += 1) {
        acc += areas[i];
        cumulative[i] = acc;
    }

    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < verts.length; i += 3) {
        if (verts[i] < minY) minY = verts[i];
        if (verts[i] > maxY) maxY = verts[i];
    }
    const jawLine = minY + (maxY - minY) * 0.42;

    const out = allocate(count);
    for (let i = 0; i < count; i += 1) {
        const target = Math.random() * acc;
        let lo = 0;
        let hi = cumulative.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (cumulative[mid] < target) lo = mid + 1;
            else hi = mid;
        }
        const f = lo * 3;
        const ia = faces[f] * 3;
        const ib = faces[f + 1] * 3;
        const ic = faces[f + 2] * 3;
        let u = Math.random();
        let v = Math.random();
        if (u + v > 1) {
            u = 1 - u;
            v = 1 - v;
        }
        const w = 1 - u - v;
        const x = verts[ia] * w + verts[ib] * u + verts[ic] * v;
        const y = verts[ia + 1] * w + verts[ib + 1] * u + verts[ic + 1] * v;
        const z = verts[ia + 2] * w + verts[ib + 2] * u + verts[ic + 2] * v;
        const isJaw = y < jawLine ? 1 : 0;
        write(out, x, y, z, isJaw, 1, 1, 1);
    }
    return out;
};

// A stylised skull as an implicit solid: a cranium, a maxilla and a mandible,
// with the eye sockets, the nasal aperture and the temples carved out. Points
// land on the surface, which is all a point cloud can show anyway.
const insideSkull = function (x, y, z) {
    const cranium = ((x * x) / 0.36) + (((y - 0.16) * (y - 0.16)) / 0.38)
        + (((z + 0.06) * (z + 0.06)) / 0.34);
    if (cranium <= 1) {
        // carved: eyes, nose, temples
        const eyeL = (x - 0.22) * (x - 0.22) + (y - 0.06) * (y - 0.06) + (z - 0.40) * (z - 0.40);
        const eyeR = (x + 0.22) * (x + 0.22) + (y - 0.06) * (y - 0.06) + (z - 0.40) * (z - 0.40);
        const nose = x * x + (y + 0.08) * (y + 0.08) + (z - 0.44) * (z - 0.44);
        const templeL = (x - 0.60) * (x - 0.60) + (y + 0.04) * (y + 0.04) + z * z;
        const templeR = (x + 0.60) * (x + 0.60) + (y + 0.04) * (y + 0.04) + z * z;
        if (eyeL < 0.036 || eyeR < 0.036) return 0;
        if (nose < 0.016) return 0;
        if (templeL < 0.10 || templeR < 0.10) return 0;
        return 1;
    }
    const maxilla = Math.abs(x) < 0.30 && Math.abs(y + 0.14) < 0.13 && Math.abs(z - 0.26) < 0.24;
    if (maxilla) {
        const nose = x * x + (y + 0.08) * (y + 0.08) + (z - 0.44) * (z - 0.44);
        if (nose < 0.016) return 0;
        return 1;
    }
    const jaw = Math.abs(x) < 0.27 && Math.abs(y + 0.42) < 0.13 && Math.abs(z - 0.10) < 0.26;
    return jaw ? 2 : 0;
};

const proceduralSkull = function (count) {
    const out = allocate(count);
    const step = 0.028;
    let guard = 0;
    while (out.count < count && guard < count * 600) {
        guard += 1;
        const x = (Math.random() - 0.5) * 1.8;
        const y = (Math.random() - 0.5) * 1.8;
        const z = (Math.random() - 0.5) * 1.8;
        const part = insideSkull(x, y, z);
        if (!part) continue;
        // Surface test: keep the point only if a neighbour is outside, which
        // gives a shell a couple of millimetres thick instead of a solid blob.
        const outside = !insideSkull(x + step, y, z) || !insideSkull(x - step, y, z)
            || !insideSkull(x, y + step, z) || !insideSkull(x, y - step, z)
            || !insideSkull(x, y, z + step) || !insideSkull(x, y, z - step);
        if (!outside) continue;
        const eyeL = Math.sqrt((x - 0.22) * (x - 0.22) + (y - 0.06) * (y - 0.06) + (z - 0.40) * (z - 0.40));
        const eyeR = Math.sqrt((x + 0.22) * (x + 0.22) + (y - 0.06) * (y - 0.06) + (z - 0.40) * (z - 0.40));
        const socket = Math.max(0, 1 - Math.min(eyeL, eyeR) / 0.42);
        const shade = 0.94 - socket * 0.62 + (Math.random() - 0.5) * 0.08;
        write(out, x + (Math.random() - 0.5) * 0.008, y + (Math.random() - 0.5) * 0.008,
            z + (Math.random() - 0.5) * 0.008, part === 2 ? 1 : 0, socket,
            shade, shade * 0.985, shade * 0.94);
    }
    if (out.count < 4_000) return null;
    return out;
};

/**
 * Centre a field and scale it to a known size, so a model authored in
 * millimetres and one authored in metres both arrive at the same scale.
 */
const normalizeField = function (field, size) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < field.count; i += 1) {
        const x = field.uvs[i * 2];
        const y = field.uvs[i * 2 + 1];
        const z = field.extras[i * 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    const scale = size / span;
    const midX = (minX + maxX) * 0.5;
    const midY = (minY + maxY) * 0.5;
    const midZ = (minZ + maxZ) * 0.5;
    for (let i = 0; i < field.count; i += 1) {
        field.uvs[i * 2] = (field.uvs[i * 2] - midX) * scale;
        field.uvs[i * 2 + 1] = (field.uvs[i * 2 + 1] - midY) * scale;
        field.extras[i * 2] = (field.extras[i * 2] - midZ) * scale;
    }
    return field;
};

/**
 * The requiem field. A model wins if one is available — drop a `skull.obj`
 * into `public/models/` and it takes over — otherwise the procedural skull
 * stands in. Either way the answer is async, so the caller can keep showing
 * whatever was on screen until it lands.
 */
export const buildRequiemField = async function (count) {
    for (let i = 0; i < SKULL_SOURCES.length; i += 1) {
        try {
            const response = await fetch(SKULL_SOURCES[i]);
            if (!response.ok) continue;
            const text = await response.text();
            if (!text || text[0] === '<') continue; // an HTML 404, not a model
            const field = sampleObj(text, count);
            if (field) return normalizeField(field, 1.7);
        } catch (error) {
            // Try the next candidate path.
        }
    }
    const skull = proceduralSkull(count);
    return skull ? normalizeField(skull, 1.7) : null;
};

/** How many particles a preset wants, before the cover's own size argues. */
export const presetBudget = function (presetId, samples) {
    if (presetId === 'requiem') return 120_000;
    if (presetId === 'void') return Math.floor(samples.count / 14) + 2;
    if (presetId === 'vinyl') return samples.count + Math.floor(samples.count * 0.42) + 2;
    return samples.count;
};
