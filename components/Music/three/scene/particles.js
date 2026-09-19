import * as THREE from 'three';

import { dotTexture } from './textures';

/**
 * The dust: five thousand points, and half the picture.
 *
 * There are two shapes, and every particle holds both, blended by one number:
 *
 *  - **the galaxy** — a flattened disc turning slowly around the record, inner
 *    shells faster than outer ones. It is what makes the room read as a place
 *    with depth rather than a turntable on a black background, and it is where
 *    the beat goes: a hit pushes the whole disc outward and lifts its rim.
 *  - **the ring** — the same dust stood up and opened into a wide, flattened
 *    ellipse in the plane of the words, so the lyrics are being sung *inside*
 *    a ring of light. It turns as one body rather than shearing, and the
 *    middle of it is empty, which is the whole point: the words keep their
 *    background while everything around them moves.
 *
 * Both shapes come out of the *same* two trig values. A particle's angle is
 * `base + ωt`; the disc reads it as `x = cos·r, z = sin·r` (a horizontal
 * circle) and the ring reads it as `x = cos·r, y = RING_Y + sin·r·flat` (a
 * vertical one). So the morph between them is a rotation about the x axis, and
 * it costs one extra multiply pair rather than a second set of positions.
 *
 * Four decisions keep this cheap enough to run every frame:
 *
 *  - **Rotation is done in shells.** `cos(base + ωt)` expands to
 *    `cos(base)cos(ωt) − sin(base)sin(ωt)`, and `ω` only takes `SHELLS`
 *    distinct values — so the two trig calls per frame are per *shell*, not per
 *    particle, and 5000 particles cost 48 trig calls and four multiplies each.
 *    Calling `Math.cos` 10000 times a frame is the difference between a scene
 *    that runs and a scene that stutters.
 *  - **The ring gets a clock of its own.** Sharing the disc's differential
 *    spin would shear the ring into a spiral within a couple of minutes — the
 *    same physics that makes the galaxy look alive is what would destroy the
 *    ring. One common angle for the whole ring costs one multiply pair.
 *  - **Nothing is allocated in the loop.** Every array here is a typed array
 *    built once; `update` writes into the attribute's buffer in place.
 *  - **Brightness is per particle, rewritten per frame.** `PointsMaterial` has
 *    exactly one `size`, so the only way to make some points read as stars and
 *    others as haze is to write `palette × brightness × twinkle` into the
 *    colour buffer each frame. That is cheaper than a second material (a
 *    second draw call) and it is what stops 5000 identical dots reading as
 *    noise.
 *
 * And one decision about how it *looks*, which took a screenshot to learn: the
 * material is `toneMapped: false` and the sizes are large. The first version
 * was 1500 points at 0.03 units with the ACES curve on top, and at that size
 * the curve pulled every additive point down to a grey speck — the field was
 * there and nobody could see it. Unmapped additive colour is what makes a
 * particle read as light.
 */

const COUNT = 5000;

/** Distinct spin rates. Enough that the disc does not look banded. */
const SHELLS = 24;

/* --- the galaxy ---------------------------------------------------------- */
const R_IN = 1.25;
const R_OUT = 6.6;
/**
 * How far off the plane the rim is allowed to sit. Generous on purpose: the
 * home camera looks at the disc from only two and a half units up, and a flat
 * disc seen that shallow is a line — at 0.62 the galaxy was simply not in the
 * picture until the words opened.
 */
const DISC = 0.85;
/** Radians per second at the inner edge and at the rim. */
const SPIN_IN = 0.26;
const SPIN_OUT = 0.05;

/* --- the ring ------------------------------------------------------------ */
/**
 * The height the words are at, and therefore the height of the ring. It is
 * `BASE_Y` in `lyrics.js`, and it is exported because `index.js` needs it too:
 * the cursor's ray is intersected with a plane at this height while the words
 * are up, so the hand parts the dust where the dust actually is.
 */
export const RING_Y = 1.95;
/**
 * A *band*, not a wash — and small enough to sit inside the frame.
 *
 * Three rounds of screenshots and a projection model went into these numbers.
 * At 2.6 to 4.4 the ring is a 1.8-unit-thick annulus barely twice the density
 * of the disc, which is not a ring, it is the same fog with a slightly darker
 * middle. At 2.35 to 3.2 it is dense enough, but the ellipse is wider than the
 * frustum at the lyrics framing, so its rim runs off all four edges and the
 * picture is once again "dust everywhere with a hole in it". A ring only reads
 * as a ring when the whole thing is on screen with dark space around it.
 *
 * `RING_DEPTH` is the other half of it. The band is narrow so the shape has an
 * edge, but it is *deep* — a torus rather than a flat hoop — because the depth
 * is what keeps it from being a solid smear of light: the near side of the
 * torus projects larger and the far side smaller, so the eye gets the shape
 * twice and the density on screen drops by half.
 */
const RING_IN = 1.8;
const RING_OUT = 2.35;
/** The ring is an ellipse: squashed vertically, so it frames a line of text. */
const RING_FLAT = 0.52;
const RING_DEPTH = 1.2;
/** Radians per second, and negative: it turns against the record. */
const RING_SPIN = -0.075;
/**
 * The rest is the outer ring — see below. Not a majority: the inner ring has
 * to outnumber it or there is no shape to look at.
 */
const RING_SHARE = 0.72;

/* --- the outer ring ------------------------------------------------------ */
/**
 * A second, much wider ellipse, a third as bright, running off the sides of
 * the frame. It exists to give the inner ring something to sit *in*: with the
 * dust all in one band the words float in a void with a hoop around them, and
 * the eye has no way to tell how far away the hoop is. A faint outer ring at
 * a different depth is what makes the picture read as a place.
 */
const HALO_IN = 3;
const HALO_OUT = 4.6;
const HALO_Y = 2;
const HALO_FLAT = 0.3;
const HALO_DEPTH = 1.6;

/* --- the beat and the hand ----------------------------------------------- */
/** How much further out the disc is at a full level. */
const PUSH = 0.1;
/** The ring moves less: it is already wide, and it is behind the words. */
const RING_PUSH = 0.055;
const REPEL_RADIUS = 1.25;
const REPEL_FORCE = 0.55;

/**
 * Saturated on purpose. Every point here is drawn additively, so wherever two
 * of them overlap the sum goes up and the hue goes towards white — a field of
 * pale pastel points adds up to grey noise, which is exactly what the first
 * cut looked like. Starting from a deeper pink and a deeper blue is what keeps
 * the near dust warm and the far dust cold once the blending has done its
 * damage.
 */
const NEAR = new THREE.Color('#ff4d6d');
const FAR = new THREE.Color('#5b8cff');
const scratch = new THREE.Color();

export const createParticles = function () {
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    // The palette colour, kept apart from what is uploaded: every frame writes
    // `palette × brightness` into `colors`, which is what makes the field
    // twinkle.
    const palette = new Float32Array(COUNT * 3);
    const bright = new Float32Array(COUNT);
    const twinkle = new Float32Array(COUNT);

    const radius = new Float32Array(COUNT);
    const baseCos = new Float32Array(COUNT);
    const baseSin = new Float32Array(COUNT);
    const shell = new Uint8Array(COUNT);
    const lift = new Float32Array(COUNT);
    const phase = new Float32Array(COUNT);

    const ringR = new Float32Array(COUNT);
    const ringY = new Float32Array(COUNT);
    const ringFlat = new Float32Array(COUNT);
    const ringDepth = new Float32Array(COUNT);

    const shellSpin = new Float32Array(SHELLS);
    const shellCos = new Float32Array(SHELLS);
    const shellSin = new Float32Array(SHELLS);

    for (let s = 0; s < SHELLS; s += 1) {
        shellSpin[s] = SPIN_IN + (SPIN_OUT - SPIN_IN) * (s / (SHELLS - 1));
    }

    /**
     * An angle that is even along the *ellipse* rather than around the circle.
     *
     * A flat ellipse has far more length near its ends than near its top and
     * bottom — `ds/dθ` runs from 1 at the sides down to `flat` at the tips — so
     * a uniform angle piles the dust into two blobs on the left and right and
     * leaves the arcs over and under the words nearly bare. It stops reading as
     * a ring and starts reading as a pair of smudges.
     *
     * Rejection sampling against `ds/dθ` fixes it, and it costs nothing at
     * runtime: this runs once per particle, at mount, and never again. The same
     * angle drives the galaxy too, but a disc's density is set by its radius
     * and it shears into a spiral within a minute anyway, so a mild bias in the
     * angle is invisible there.
     */
    const pickAngle = function () {
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const a = Math.random() * Math.PI * 2;
            const s = Math.sin(a);
            const c = Math.cos(a);
            if (Math.random() < Math.sqrt(RING_FLAT * RING_FLAT * s * s + c * c)) return a;
        }
        return Math.random() * Math.PI * 2;
    };

    for (let i = 0; i < COUNT; i += 1) {
        // `sqrt` over the squared range is what makes the density even: without
        // it every particle piles up near the middle, where the area is small.
        const t = Math.sqrt(Math.random());
        const r = R_IN + (R_OUT - R_IN) * t;
        const angle = pickAngle();

        radius[i] = r;
        baseCos[i] = Math.cos(angle);
        baseSin[i] = Math.sin(angle);
        // The shell a particle belongs to is picked from its radius, so the
        // disc shears smoothly instead of tearing at shell boundaries.
        shell[i] = Math.min(SHELLS - 1, Math.floor(t * SHELLS));
        lift[i] = (Math.random() * 2 - 1) * DISC * t;
        phase[i] = Math.random() * Math.PI * 2;
        twinkle[i] = Math.random() * Math.PI * 2;

        const onRing = Math.random() < RING_SHARE;
        if (onRing) {
            // Triangular across the band rather than uniform, so the ring has
            // a soft edge and a bright middle instead of two hard rims. The
            // square root then pushes the result back outward, which is what
            // corrects for the area growing with `r`.
            const u = Math.sqrt((Math.random() + Math.random()) / 2);
            ringR[i] = RING_IN + (RING_OUT - RING_IN) * u;
            ringY[i] = RING_Y + (Math.random() * 2 - 1) * 0.16;
            // Loose, not drawn with a compass: a perfectly even ellipse reads
            // as a drawn shape, and this has to read as dust that happens to
            // be arranged in a ring.
            ringFlat[i] = RING_FLAT * (0.72 + Math.random() * 0.56);
            ringDepth[i] = (Math.random() + Math.random() - 1) * RING_DEPTH;
        } else {
            const u = Math.random();
            ringR[i] = HALO_IN + (HALO_OUT - HALO_IN) * u;
            // Triangular rather than uniform: a halo is dense in the middle
            // and thin at its edges, and two random numbers summed is that.
            ringY[i] = RING_Y + (Math.random() + Math.random() - 1) * HALO_Y;
            ringFlat[i] = HALO_FLAT;
            ringDepth[i] = (Math.random() + Math.random() - 1) * HALO_DEPTH;
        }
        scratch.copy(NEAR).lerp(FAR, Math.pow(t, 0.6));
        palette[i * 3] = scratch.r;
        palette[i * 3 + 1] = scratch.g;
        palette[i * 3 + 2] = scratch.b;

        // A few are nearly three times brighter than the rest, and the dimmest
        // are almost nothing. A field of identical points reads as noise
        // however many of them there are; a field with a long brightness tail
        // reads as stars, and it is what gives the cloud depth without a single
        // extra draw call. The second factor is what pushes the tail down —
        // without it the spread is too narrow to see.
        //
        // The tail is kept short and rare on purpose. Six per cent at 3.4× was
        // enough bright specks scattered through the empty corners to read as
        // grain, and grain is what the eye finds first — the shape underneath
        // disappears behind it. Fewer, softer outliers and the ring wins.
        const roll = Math.random();
        bright[i] = (roll > 0.965
            ? 2.6
            : (0.3 + roll * 0.85) * (0.45 + roll * 0.55)) * (onRing ? 1 : 0.26);
    }

    // The buffers start filled rather than empty: `update` rewrites them every
    // frame anyway, but the very first render happens after the first `update`
    // only by luck, and a frame of dust piled at the origin is a visible flash.
    for (let i = 0; i < COUNT; i += 1) {
        positions[i * 3] = baseCos[i] * radius[i];
        positions[i * 3 + 1] = lift[i];
        positions[i * 3 + 2] = baseSin[i] * radius[i];
        colors[i * 3] = palette[i * 3] * bright[i];
        colors[i * 3 + 1] = palette[i * 3 + 1] * bright[i];
        colors[i * 3 + 2] = palette[i * 3 + 2] * bright[i];
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 0.058,
        map: dotTexture(),
        vertexColors: true,
        transparent: true,
        opacity: 0.66,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
        // See the note at the top: without this the ACES curve turns every
        // additive point into a grey speck, which is a field nobody can see.
        toneMapped: false,
    });

    const points = new THREE.Points(geometry, material);
    // The disc is wider than any frustum it is ever looked at through, and the
    // bounding sphere would have to be recomputed on every beat anyway.
    points.frustumCulled = false;

    const attribute = geometry.getAttribute('position');
    const colorAttribute = geometry.getAttribute('color');

    let clock = 0;
    let ringClock = 0;
    let formation = 0;

    return {
        points,

        /**
         * One frame.
         *
         * @param {number} delta      seconds since the last frame
         * @param {object} state      `{ level, playing, formation, pointer }`
         *                            — `pointer` is `{x, y, z}` in the world or
         *                            `null`; `formation` is 0 for the galaxy
         *                            and 1 for the ring.
         */
        update(delta, state) {
            // The swirl never stops, but it nearly does: dust that keeps
            // circulating at full speed while the music is paused says the song
            // is still going, which is the one thing a paused player must not
            // say.
            const advance = delta * (state.playing ? 1 : 0.22);
            clock += advance;
            ringClock += advance * RING_SPIN;
            formation = THREE.MathUtils.damp(formation, state.formation, 2.2, delta);

            for (let s = 0; s < SHELLS; s += 1) {
                const w = shellSpin[s] * clock;
                shellCos[s] = Math.cos(w);
                shellSin[s] = Math.sin(w);
            }

            const ringCos = Math.cos(ringClock);
            const ringSin = Math.sin(ringClock);

            const burst = 1 + state.level * PUSH;
            const ringBurst = 1 + state.level * RING_PUSH;
            const bloom = state.level * 0.07;
            const form = formation;
            const pointer = state.pointer;
            const repelR2 = REPEL_RADIUS * REPEL_RADIUS;

            for (let i = 0; i < COUNT; i += 1) {
                const s = shell[i];
                const c = shellCos[s];
                const sn = shellSin[s];
                const bc = baseCos[i];
                const bs = baseSin[i];
                const r = radius[i];

                // cos(base + ωt) and sin(base + ωt), expanded — once for the
                // disc's own rate, once for the ring's single rate.
                const gcx = bc * c - bs * sn;
                const gsy = bs * c + bc * sn;
                const rcx = bc * ringCos - bs * ringSin;
                const rsy = bs * ringCos + bc * ringSin;

                const gx = gcx * r * burst;
                const gz = gsy * r * burst;
                const gy = lift[i]
                    + Math.sin(clock * 0.9 + phase[i]) * 0.06
                    + bloom * (r / R_OUT);

                let x = gx;
                let y = gy;
                let z = gz;

                if (form > 0) {
                    const rr = ringR[i] * ringBurst;
                    const rx = rcx * rr;
                    const ry = ringY[i]
                        + rsy * rr * ringFlat[i]
                        + Math.sin(clock * 0.6 + phase[i]) * 0.09;
                    x += (rx - x) * form;
                    y += (ry - y) * form;
                    z += (ringDepth[i] - z) * form;
                }

                if (pointer) {
                    const dx = x - pointer.x;
                    const dy = y - pointer.y;
                    const dz = z - pointer.z;
                    const d2 = dx * dx + dy * dy + dz * dz;
                    if (d2 < repelR2) {
                        // Parted, not blocked: the cursor pushes the dust out
                        // of the way and it closes behind. The push is a true
                        // 3D vector, so the same code clears a hole in the flat
                        // disc and in the standing ring without knowing which
                        // one it is looking at.
                        const d = Math.sqrt(d2) || 0.0001;
                        const k = (1 - d / REPEL_RADIUS) * REPEL_FORCE;
                        x += (dx / d) * k;
                        y += (dy / d) * k;
                        z += (dz / d) * k;
                    }
                }

                positions[i * 3] = x;
                positions[i * 3 + 1] = y;
                positions[i * 3 + 2] = z;

                // Slow, out-of-phase twinkle, lifted a little by the beat. The
                // buffer is rewritten rather than scaled in a shader because a
                // second material would mean a second draw call, and there is
                // nothing here a shader would do that three multiplies do not.
                const glow = bright[i] * (0.72 + 0.28 * Math.sin(clock * 1.7 + twinkle[i]))
                    * (1 + state.level * 0.5);
                colors[i * 3] = palette[i * 3] * glow;
                colors[i * 3 + 1] = palette[i * 3 + 1] * glow;
                colors[i * 3 + 2] = palette[i * 3 + 2] * glow;
            }

            attribute.needsUpdate = true;
            colorAttribute.needsUpdate = true;

            // The same size and opacity in both formations: the ring is six
            // times denser than the disc, and letting the material brighten it
            // as well made it a solid hoop. Density is what should carry the
            // shape, not gain.
            material.size = 0.052 + state.level * 0.045;
            material.opacity = Math.min(1, 0.5 + state.level * 0.3 + form * 0.04);
        },

        dispose() {
            geometry.dispose();
            material.map.dispose();
            material.dispose();
        },
    };
};
