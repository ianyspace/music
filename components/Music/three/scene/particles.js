import * as THREE from 'three';

import { dotTexture } from './textures';

/**
 * The dust in the air.
 *
 * A single `Points` cloud in a column around the turntable — the thing that
 * turns an object on a black background into an object in a *room*. It is
 * deliberately not a "music visualiser": there is no spectrum, no waveform and
 * no geometry that rearranges itself on a kick. It is dust, lit from somewhere
 * off-screen, drifting up; the beat only makes it brighter and slightly faster.
 * That reads as depth at every moment, including the quiet ones, which a
 * beat-only effect does not.
 *
 * Each particle carries its own rise speed and its own phase, so the field
 * never pulses in unison and needs no per-frame sorting.
 */

const COUNT = 1500;
const INNER = 1.24;
const OUTER = 4.4;
const CEILING = 2.9;
const FLOOR = -0.12;

/** How much of the field's motion the beat is allowed to add. */
const BEAT_SPEED = 0.55;

export const createParticles = function () {
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const speeds = new Float32Array(COUNT);
    const angles = new Float32Array(COUNT);
    const radii = new Float32Array(COUNT);

    // Two ends of a colour ramp rather than one flat tint: the dust close to
    // the record picks up its accent, the dust at the edge of the room stays
    // cold. Additive blending then does the rest.
    const near = new THREE.Color(0xff5a72);
    const far = new THREE.Color(0x7f9bd6);
    const scratch = new THREE.Color();

    const seed = function (index, initial) {
        const angle = Math.random() * Math.PI * 2;
        // Square-root distribution: a uniform radius would crowd the inner ring
        // and leave the outer one nearly empty, because area grows with r².
        const radius = Math.sqrt(THREE.MathUtils.lerp(INNER * INNER, OUTER * OUTER, Math.random()));
        angles[index] = angle;
        radii[index] = radius;
        speeds[index] = 0.03 + Math.random() * 0.085;
        positions[index * 3] = Math.cos(angle) * radius;
        positions[index * 3 + 1] = initial
            ? THREE.MathUtils.lerp(FLOOR, CEILING, Math.random())
            : FLOOR;
        positions[index * 3 + 2] = Math.sin(angle) * radius;

        const t = THREE.MathUtils.clamp((radius - INNER) / (OUTER - INNER), 0, 1);
        scratch.copy(near).lerp(far, Math.pow(t, 0.6));
        colors[index * 3] = scratch.r;
        colors[index * 3 + 1] = scratch.g;
        colors[index * 3 + 2] = scratch.b;
    };

    for (let i = 0; i < COUNT; i += 1) seed(i, true);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 0.03,
        map: dotTexture(),
        vertexColors: true,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;

    const attribute = geometry.getAttribute('position');

    return {
        points,

        /**
         * `level` is 0..1 from the analyser, `playing` gates the motion — dust
         * that keeps rising while the music is paused says the song is still
         * going, which is the one thing a paused player must not say.
         */
        update(delta, level, playing) {
            const drift = playing ? 1 + level * BEAT_SPEED : 0.12;
            for (let i = 0; i < COUNT; i += 1) {
                let y = positions[i * 3 + 1] + speeds[i] * delta * drift;
                if (y > CEILING) {
                    // Re-seed rather than wrap: a wrapped particle would keep its
                    // radius and angle for the whole session, and after a few
                    // minutes every column would look like a dotted line.
                    seed(i, false);
                    y = FLOOR;
                }
                positions[i * 3 + 1] = y;
            }
            attribute.needsUpdate = true;

            material.size = 0.026 + level * 0.026;
            material.opacity = 0.4 + level * 0.45;
        },

        dispose() {
            geometry.dispose();
            material.map.dispose();
            material.dispose();
        },
    };
};
