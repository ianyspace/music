import * as THREE from 'three';

/**
 * The camera rig.
 *
 * Four framings, and the rig moves between them on its own:
 *
 *  - **home** — nothing playing yet. Wide and low, drifting.
 *  - **playing** — higher and closer, so the label is legible from a real
 *    angle rather than edge-on.
 *  - **paused** — pulled back a little. Not a different place, just a step
 *    away from the record, the way you would step back from something you had
 *    stopped.
 *  - **lyrics** — swings round to face the words head-on and lifts the aim to
 *    the middle of the plane, which is why the lyrics can be a fixed object in
 *    the room instead of a billboard that follows the viewer around.
 *
 * On top of the framing there is a hand on the camera: dragging orbits, the
 * wheel dollies, and after a few idle seconds the drift takes over again. The
 * drag is the reason this page needs a camera rig at all — the record is a
 * three-dimensional object and the visitor is allowed to walk round it.
 */

const FOV = 44;

const FRAMING = {
    home: { radius: 4.3, phi: 0.5, targetY: 0.25 },
    playing: { radius: 3.25, phi: 0.72, targetY: 0.18 },
    paused: { radius: 3.6, phi: 0.66, targetY: 0.18 },
    lyrics: { radius: 3.9, phi: 0.38, targetY: 1.05 },
};

/** Radians per second of unattended drift, and the pause after a drag. */
const DRIFT = 0.055;
const HAND_BACK_MS = 7000;

/** Limits for the manual orbit: never under the floor, never over the top. */
const PHI_MIN = 0.08;
const PHI_MAX = 1.28;
const RADIUS_MIN = 2.1;
const RADIUS_MAX = 7.5;

export const createCameraRig = function (aspect, { reduced = false } = {}) {
    const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 80);

    let theta = 0.6;
    let phi = FRAMING.home.phi;
    let radius = FRAMING.home.radius;
    let targetY = FRAMING.home.targetY;
    // How much the track list is covering the left of the screen, 0..1. The
    // turntable is nudged the other way so it never ends up behind the panel.
    let shift = 0;
    let handBackAt = 0;

    const target = new THREE.Vector3(0, FRAMING.home.targetY, 0);
    const right = new THREE.Vector3();

    const damp = function (current, goal, lambda, delta) {
        // `MathUtils.damp` is frame-rate independent, which matters here: the
        // whole rig is a pile of exponential approach curves, and the naive
        // `lerp(x, y, 0.1)` version moves twice as fast on a 120Hz screen.
        return reduced ? goal : THREE.MathUtils.damp(current, goal, lambda, delta);
    };

    return {
        camera,

        /**
         * @param {number} delta    seconds since the last frame
         * @param {object} state    `{ playing, hasTrack, lyrics, listOpen, level }`
         */
        update(delta, state) {
            const framing = state.lyrics
                ? FRAMING.lyrics
                : (!state.hasTrack ? FRAMING.home : (state.playing ? FRAMING.playing : FRAMING.paused));

            // The drift stops for the lyrics: the words are a fixed plane in the
            // room, so a camera that keeps circling would spend half the song
            // reading them from behind.
            const drifting = !state.lyrics && !reduced && performance.now() > handBackAt;
            if (drifting) theta += DRIFT * delta;

            phi = damp(phi, framing.phi, 2.4, delta);
            radius = damp(radius, framing.radius, 2.2, delta);
            targetY = damp(targetY, framing.targetY, 2.4, delta);
            shift = damp(shift, state.listOpen ? 1 : 0, 3, delta);

            // The beat, as one small push in. `level` already rises and falls
            // with the music, so the camera needs no envelope of its own — it
            // just has to be gentle enough that a four-on-the-floor track does
            // not make the room shake.
            const push = reduced ? 0 : state.level * 0.16;
            const distance = radius - push;

            const horizontal = Math.cos(phi) * distance;
            camera.position.set(
                Math.sin(theta) * horizontal,
                Math.sin(phi) * distance,
                Math.cos(theta) * horizontal,
            );

            target.set(0, targetY, 0);
            // Camera-space right, so the offset is "to the left of the screen"
            // whatever the azimuth happens to be.
            right.set(Math.cos(theta), 0, -Math.sin(theta));
            target.addScaledVector(right, -0.52 * shift);
            camera.lookAt(target);
        },

        /** Pointer drag, in pixels. */
        orbit(dx, dy) {
            theta -= dx * 0.0055;
            phi = THREE.MathUtils.clamp(phi + dy * 0.004, PHI_MIN, PHI_MAX);
            handBackAt = performance.now() + HAND_BACK_MS;
        },

        /** Wheel, in pixels of deltaY. */
        dolly(amount) {
            radius = THREE.MathUtils.clamp(radius + amount * 0.0022, RADIUS_MIN, RADIUS_MAX);
            handBackAt = performance.now() + HAND_BACK_MS;
        },

        /** Called when the visitor drags, so a click can be told from a drag. */
        hold() {
            handBackAt = performance.now() + HAND_BACK_MS;
        },

        resize(nextAspect) {
            camera.aspect = nextAspect;
            camera.updateProjectionMatrix();
        },
    };
};
