import * as THREE from 'three';

import { grooveTexture, poolTexture, haloTexture, coverTexture } from './textures';

/**
 * The turntable: a platter, a record on it, and the record's reflection.
 *
 * The record lies *flat*, which is the one thing that separates this page from
 * the wide-screen layout — there the disc stands upright and faces the viewer,
 * because it has a list beside it and a bar under it and the cover has to be
 * readable from the sofa. Here there is nothing else on screen, so the record
 * can be the object it actually is, and the camera can walk around it. The
 * cover is still readable: the camera's resting elevation looks down at about
 * 30°, and the label is a third of the radius.
 *
 * Everything in this file is a mesh. There is no DOM, no CSS and no React —
 * see `scene/index.js` for the assembly and `Stage.js` for the React side.
 */

/** Record radius. The whole scene is scaled off this: 1 unit = one record. */
export const RECORD_RADIUS = 1;

/** The label covers the inner 34%, which is what a 12" single actually does. */
const LABEL_RATIO = 0.34;

/** Height of the platter, and therefore how far the record floats above the
 *  floor. The reflection is mirrored about that plane. */
const PLATTER_HEIGHT = 0.06;

/** How much of the reflection survives. A real polished-black surface is
 *  around 10-20%: enough to place the object, never enough to read the cover
 *  in, which would be confusing rather than impressive. */
const REFLECTION = 0.15;

/**
 * Clone a material for the reflection.
 *
 * `DoubleSide` is not a style choice: the reflection is the group with
 * `scale.y = -1`, which reverses every triangle's winding, so front faces
 * become back faces and the whole thing renders inside-out — you see the
 * inside of the platter and the underside of the label. Flipping the side is
 * the standard fix and is cheaper than reversing the geometry.
 */
const dim = function (material) {
    const copy = material.clone();
    copy.transparent = true;
    copy.opacity = REFLECTION;
    copy.depthWrite = false;
    copy.side = THREE.DoubleSide;
    return copy;
};

const createPlatter = function () {
    const geometry = new THREE.CylinderGeometry(1.07, 1.03, PLATTER_HEIGHT, 96);
    const material = new THREE.MeshStandardMaterial({
        color: 0x171a23,
        metalness: 0.92,
        roughness: 0.3,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -PLATTER_HEIGHT / 2;
    return mesh;
};

/**
 * The record itself: three meshes that all turn together.
 *
 * A `CylinderGeometry` takes a material *array* — one per surface — which is
 * what lets the top cap carry the groove texture while the rim stays plain
 * black. The cap's UVs are the unit square mapped onto the circle, so the
 * square groove canvas lands correctly with no unwrapping.
 */
const createDisc = function (grooves) {
    const group = new THREE.Group();
    group.name = 'spinner';

    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(RECORD_RADIUS, RECORD_RADIUS, 0.022, 128),
        [
            new THREE.MeshStandardMaterial({ color: 0x08090d, metalness: 0.4, roughness: 0.55 }),
            new THREE.MeshStandardMaterial({
                map: grooves,
                color: 0xffffff,
                metalness: 0.55,
                roughness: 0.38,
            }),
            new THREE.MeshStandardMaterial({ color: 0x08090d, metalness: 0.4, roughness: 0.6 }),
        ],
    );
    body.position.y = 0.011;
    group.add(body);

    // The label is a separate disc rather than a texture on the cap: it has to
    // be a different material (the cover is nearly matte, the vinyl is not) and
    // it has to sit a hair above the grooves or it z-fights them.
    const label = new THREE.Mesh(
        new THREE.CircleGeometry(RECORD_RADIUS * LABEL_RATIO, 64),
        new THREE.MeshStandardMaterial({
            color: 0x2a2d38,
            metalness: 0.05,
            roughness: 0.72,
            emissive: 0xffffff,
            emissiveIntensity: 0.08,
        }),
    );
    label.rotation.x = -Math.PI / 2;
    label.position.y = 0.0226;
    label.name = 'label';
    group.add(label);

    // A hairline of accent around the rim, additive so it reads as light
    // rather than as a painted ring. This is the beat's main outlet.
    const rim = new THREE.Mesh(
        new THREE.RingGeometry(RECORD_RADIUS * 0.995, RECORD_RADIUS * 1.014, 128),
        new THREE.MeshBasicMaterial({
            color: 0xfa233b,
            transparent: true,
            opacity: 0.32,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false,
        }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.023;
    rim.name = 'rim';
    group.add(rim);

    return group;
};

const createSpindle = function () {
    const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016, 0.016, 0.13, 12),
        new THREE.MeshStandardMaterial({ color: 0xb9c0d0, metalness: 1, roughness: 0.24 }),
    );
    mesh.position.y = 0.005;
    return mesh;
};

export const createTurntable = function () {
    const group = new THREE.Group();

    const platter = createPlatter();
    const spinner = createDisc(grooveTexture());
    const spindle = createSpindle();
    group.add(platter, spinner, spindle);

    // --- the reflection ------------------------------------------------------
    // A mirrored copy rather than a `Reflector`: the addon re-renders the whole
    // scene into a render target every frame for one surface, and this scene
    // has exactly one thing worth reflecting. A flipped clone is one extra draw
    // call, and the pool of light on top of it is what makes it fade out
    // instead of ending at the edge of a disc.
    const mirror = group.clone(true);
    mirror.traverse((node) => {
        if (!node.isMesh) return;
        node.material = Array.isArray(node.material)
            ? node.material.map(dim)
            : dim(node.material);
    });
    mirror.scale.y = -1;
    // Mirrored about the platter's underside: a point at y is the same
    // distance below `-PLATTER_HEIGHT` as it was above it.
    mirror.position.y = -PLATTER_HEIGHT * 2;
    const mirrorSpinner = mirror.getObjectByName('spinner');
    group.add(mirror);

    // --- the floor -----------------------------------------------------------
    const pool = new THREE.Mesh(
        new THREE.PlaneGeometry(16, 16),
        new THREE.MeshBasicMaterial({
            map: poolTexture(),
            transparent: true,
            depthWrite: false,
        }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = -PLATTER_HEIGHT + 0.001;
    group.add(pool);

    // The light the record appears to be standing in, and the second thing the
    // beat drives. Additive, so it brightens the reflection rather than hiding
    // it, and it never covers the record itself.
    const halo = new THREE.Mesh(
        new THREE.PlaneGeometry(7.5, 7.5),
        new THREE.MeshBasicMaterial({
            map: haloTexture(),
            color: 0xfa233b,
            transparent: true,
            opacity: 0.16,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -PLATTER_HEIGHT + 0.002;
    group.add(halo);

    const rim = spinner.getObjectByName('rim');
    const label = spinner.getObjectByName('label');
    // The reflection cloned the label's material *before* the cover arrived, so
    // it has to be handed the texture separately — otherwise the record has
    // artwork on it and the reflection of the record does not.
    const mirrorLabel = mirror.getObjectByName('label');

    const applyLabel = function (material, texture) {
        if (material.map) material.map.dispose();
        material.map = texture;
        // The label is nearly matte and the scene is nearly black, so without
        // a touch of self-illumination the cover is unreadable from any angle
        // the camera actually takes. `emissiveMap` keeps that glow inside the
        // artwork instead of turning the whole disc into a grey coin.
        material.emissiveMap = texture;
        material.color.set(0xffffff);
        material.needsUpdate = true;
    };

    return {
        group,

        /** One frame of rotation. `rate` is radians per second. */
        spin(rate, delta) {
            spinner.rotation.y += rate * delta;
            mirrorSpinner.rotation.y = spinner.rotation.y;
        },

        /**
         * The cover for the label. `fallback` is what to use when the track has
         * none, or when the cover host will not let a canvas read it.
         */
        async setCover(url, fallback) {
            const texture = await coverTexture(url, { fallback });
            if (!texture) return;
            applyLabel(label.material, texture);
            if (mirrorLabel) applyLabel(mirrorLabel.material, texture);
        },

        /**
         * The beat. `level` is 0..1 from the analyser — or the synthetic
         * stand-in when the analyser could not be attached. The rim takes most
         * of it, the halo a little, so a kick reads as the record's edge
         * catching the light rather than as the whole scene brightening.
         */
        setLevel(level) {
            rim.material.opacity = 0.18 + level * 0.62;
            halo.material.opacity = 0.1 + level * 0.3;
            halo.scale.setScalar(0.94 + level * 0.12);
            label.material.emissiveIntensity = 0.06 + level * 0.12;
        },

        dispose() {
            group.traverse((node) => {
                if (!node.isMesh) return;
                node.geometry.dispose();
                const materials = Array.isArray(node.material) ? node.material : [node.material];
                materials.forEach((material) => {
                    if (material.map) material.map.dispose();
                    material.dispose();
                });
            });
        },
    };
};
