import * as THREE from 'three';

/**
 * The tonearm.
 *
 * A real one, in the sense that matters: it is *solved*, not posed. The arm is
 * a fixed length hanging off a pivot that sits outside the record, so the
 * stylus's distance from the centre is a function of one angle — which means
 * the page can play the record properly. When a track starts the arm swings in
 * from its rest position to the outer groove, and for the rest of the song it
 * creeps inward exactly as far as `progress.time / duration` says, the way a
 * real arm crosses a side. Nothing else in this scene communicates "this song
 * is 40% over" that quietly.
 *
 * The geometry is the classic two-point solve: pivot at `(0.9, -0.9)` in the
 * XZ plane, 1.273 units from the centre; effective length 0.78. Then
 *
 *     |stylus|² = 1.273² + 0.78² − 2 · 1.273 · 0.78 · cos θ
 *
 * where θ is the arm's angle away from the line pointing at the centre. At
 * θ = 55° the stylus is at 1.043 — just clear of the record, which is the rest
 * position. At θ = 42° it is at 0.86 (the lead-in groove) and at θ = 16° it is
 * at 0.52 (the run-out). Those three numbers are the only tuning in this file.
 */

/** Where the pivot stands, in the record's own units. */
const PIVOT = { x: 0.9, z: -0.9 };

/** Effective length: pivot to stylus. */
const LENGTH = 0.78;

/** Yaw that points the arm's local +X at the record's centre. */
const BASE_YAW = -Math.PI * 0.75;

/** Arm angle, in radians, at the three positions that matter. See above. */
export const ARM_REST = (55 * Math.PI) / 180;
export const ARM_LEAD_IN = (42 * Math.PI) / 180;
export const ARM_RUN_OUT = (16 * Math.PI) / 180;

const metal = function (color, roughness) {
    return new THREE.MeshStandardMaterial({ color, metalness: 0.94, roughness });
};

export const createTonearm = function () {
    const group = new THREE.Group();
    group.position.set(PIVOT.x, 0, PIVOT.z);
    group.rotation.y = BASE_YAW + ARM_REST;

    // --- the pivot ----------------------------------------------------------
    // A post wide enough to read as a bearing housing rather than a pin, with
    // a collar on top where the arm actually hangs.
    const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.072, 0.088, 0.2, 28),
        metal(0x2b3040, 0.36),
    );
    post.position.y = 0.04;
    group.add(post);

    const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.052, 0.052, 0.052, 24),
        metal(0xc7cedd, 0.24),
    );
    collar.position.y = 0.166;
    group.add(collar);

    // --- the tube -----------------------------------------------------------
    // A `TubeGeometry` over four control points, not a cylinder: the gentle bow
    // is what makes it read as a machined arm instead of a stick, and it costs
    // one extra curve. The bow is in Z, so it is visible from the side.
    const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.02, 0.158, 0),
        new THREE.Vector3(0.26, 0.154, 0.016),
        new THREE.Vector3(0.52, 0.144, 0.014),
        new THREE.Vector3(LENGTH, 0.116, 0),
    ]);
    const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 48, 0.0135, 10, false),
        metal(0xd2d8e6, 0.22),
    );
    group.add(tube);

    // Counterweight behind the pivot, opposite the headshell. Small, but its
    // absence is the first thing that makes a drawn arm look wrong.
    const weight = new THREE.Mesh(
        new THREE.CylinderGeometry(0.038, 0.038, 0.075, 20),
        metal(0x3a4050, 0.45),
    );
    weight.rotation.z = Math.PI / 2;
    weight.position.set(-0.07, 0.158, 0);
    group.add(weight);

    // --- the headshell ------------------------------------------------------
    // Yawed a few degrees off the arm's axis, which is how a real headshell is
    // mounted: the offset angle is what keeps the stylus tangent to the groove.
    const head = new THREE.Group();
    head.position.set(LENGTH, 0.108, 0);
    head.rotation.y = -0.24;
    group.add(head);

    const shell = new THREE.Mesh(
        new THREE.BoxGeometry(0.17, 0.032, 0.082),
        metal(0xe2e7f2, 0.2),
    );
    shell.position.x = 0.055;
    head.add(shell);

    // The cartridge, and under it the stylus — the only part of the arm that
    // has to reach the record, so it is the only part that is allowed to be
    // lower than the tube.
    const cartridge = new THREE.Mesh(
        new THREE.BoxGeometry(0.062, 0.044, 0.058),
        metal(0x1d212b, 0.5),
    );
    cartridge.position.set(0.088, -0.03, 0);
    head.add(cartridge);

    const stylus = new THREE.Mesh(
        new THREE.ConeGeometry(0.009, 0.03, 10),
        metal(0x8f97a8, 0.3),
    );
    stylus.position.set(0.098, -0.064, 0);
    stylus.rotation.z = Math.PI;
    head.add(stylus);

    return {
        group,

        /**
         * `angle` is the arm's angle from the centre line, `lift` raises the
         * whole assembly off the record while it travels. Both are damped by
         * the caller, so this is a pure assignment.
         */
        update(angle, lift) {
            group.rotation.y = BASE_YAW + angle;
            group.position.y = lift;
        },

        dispose() {
            group.traverse((node) => {
                if (!node.isMesh) return;
                node.geometry.dispose();
                node.material.dispose();
            });
        },
    };
};
