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

/** A full turn, for folding an azimuth onto the nearest one. */
const TURN = Math.PI * 2;

/**
 * The aspect the distances below were tuned on. Only the lyrics care.
 *
 * The record and the dust are compact — a narrower window just crops the room
 * around them, which is fine. The lyric plane is 5.6 units *wide*, so its
 * constraint is horizontal, and a `PerspectiveCamera` holds the vertical field
 * fixed: at 16:9 that distance shows 7.8 units across and the plane sits
 * comfortably inside; at 5:4 it shows 5.45 and a long line loses a sliver at
 * each end; a window snapped to half a widescreen is 0.89, where only 3.9
 * units fit and a line loses a character at *both* ends.
 */
const REFERENCE_ASPECT = 16 / 9;

const FRAMING = {
    // Slightly higher than a record-on-a-table angle. The dust disc lies in the
    // floor plane and the record stands on top of it; from 0.5 the camera was
    // almost level with the dust and the whole galaxy collapsed into a line
    // behind the record.
    home: { radius: 4.3, phi: 0.6, targetY: 0.25 },
    playing: { radius: 3.25, phi: 0.72, targetY: 0.18 },
    paused: { radius: 3.6, phi: 0.66, targetY: 0.18 },
    // Low and far, aimed at the middle of the sheet rather than the record.
    // The lyrics plane is 5.6 units wide, so anything closer than this clips
    // the ends of a long line — at `REFERENCE_ASPECT`. Narrower windows get
    // pushed back, see `fitToAspect` below.
    lyrics: { radius: 5.4, phi: 0.34, targetY: 1.82 },
};

/**
 * How much further back a narrow window has to sit for the words to fit.
 *
 * Scales with the shortfall rather than with the plane's exact width, so the
 * plane keeps the same share of the frame it has at 16:9 — the composition is
 * what was tuned, not the number. A *wider* window is left alone: there the
 * extra width is the room showing, which is the point of a wide window.
 */
const fitToAspect = function (distance, aspect) {
    if (!aspect || aspect <= 0) return distance;
    return distance * Math.max(1, REFERENCE_ASPECT / aspect);
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
            if (drifting) {
                theta += DRIFT * delta;
            } else if (state.lyrics && !reduced && performance.now() > handBackAt) {
                // …and then it turns to face them, which stopping the drift does
                // not do on its own. `FRAMING.lyrics` sets the distance, the
                // height and the aim, but not the azimuth — so a visitor who
                // arrives from a drag, or from a minute of unattended drift,
                // reads the song from the side. The words are a flat plane
                // facing `+z`, so the azimuth that faces them is a whole turn,
                // and `Math.round` picks the nearest one: always the short way
                // round, never a spin.
                theta = damp(theta, Math.round(theta / TURN) * TURN, 1.6, delta);
            }

            phi = damp(phi, framing.phi, 2.4, delta);
            radius = damp(radius, framing === FRAMING.lyrics
                ? fitToAspect(framing.radius, camera.aspect)
                : framing.radius, 2.2, delta);
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

            // A breath of zoom on the beat, on top of the push above. It is
            // the cheapest way to make the whole frame feel like it is moving
            // with the music rather than only the objects in it — and it is
            // kept under 1.5°, because a wide-angle FOV pump is a headache.
            const fov = FOV - (reduced ? 0 : state.level * 1.4);
            if (Math.abs(fov - camera.fov) > 0.01) {
                camera.fov = fov;
                camera.updateProjectionMatrix();
            }
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
