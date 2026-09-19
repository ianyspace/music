import * as THREE from 'three';

import { envTexture } from './textures';
import { createTurntable, RECORD_RADIUS } from './record';
import { createTonearm, ARM_REST, ARM_LEAD_IN, ARM_RUN_OUT } from './tonearm';
import { createParticles, RING_Y } from './particles';
import { createLyrics } from './lyrics';
import { createCameraRig } from './camera';
import { createAnalyzer } from './analyzer';

/**
 * The 3D stage: one renderer, one scene, one camera rig, and a `frame()` that
 * advances all of it.
 *
 * This module is deliberately framework-free — it takes a host element and
 * hands back plain functions. React only mounts the host and calls `frame` from
 * a rAF loop, so nothing about the scene depends on a render pass, and nothing
 * about React ends up inside the render loop.
 *
 * The canvas is created *here* rather than rendered by React, for one reason:
 * a failed WebGL context cannot be retried on the same canvas, and a canvas
 * React owns cannot be replaced without a re-render.
 */

/**
 * 33⅓ rpm is 3.49 rad/s, and it is a *lot* faster than it sounds once the
 * cover art is spinning with it. Half speed still reads unmistakably as "the
 * record is turning" without the label turning into a blur.
 */
const SPIN = 1.9;

const LIFT_REST = 0.052;

const damp = function (current, goal, lambda, delta, reduced) {
    return reduced ? goal : THREE.MathUtils.damp(current, goal, lambda, delta);
};

/**
 * Three attempts at a WebGL context, most desirable first.
 *
 * `WebGLRenderer` throws when the browser will not hand over a context, and the
 * page it is thrown from unmounts — a white screen with one line in the
 * console. That is worth a second and third try, because the two most common
 * causes are both avoidable:
 *
 *  - `high-performance` asks for the discrete GPU on a laptop that may not be
 *    able to give it to this process. `default` asks for whatever works.
 *  - `antialias` needs a multisampled buffer, which a weak or emulated adapter
 *    can refuse even though it can draw everything else.
 *
 * Each attempt gets a **fresh canvas**. The spec is not clear on whether a
 * failed `getContext` poisons the canvas for later calls, and every report of
 * this failing says it does — so nothing is reused between attempts, and the
 * canvas is only put in the document once one of them has succeeded.
 */
const RENDERER_ATTEMPTS = [
    { antialias: true, powerPreference: 'high-performance' },
    { antialias: true, powerPreference: 'default' },
    { antialias: false, powerPreference: 'default' },
];

const createRenderer = function (host, canvasClass) {
    let reason = '';

    for (let i = 0; i < RENDERER_ATTEMPTS.length; i += 1) {
        const canvas = document.createElement('canvas');
        if (canvasClass) canvas.className = canvasClass;
        canvas.setAttribute('aria-hidden', 'true');

        try {
            const renderer = new THREE.WebGLRenderer({
                canvas,
                alpha: false,
                ...RENDERER_ATTEMPTS[i],
            });
            host.appendChild(canvas);
            return renderer;
        } catch (err) {
            reason = (err && err.message) || String(err);
        }
    }

    const error = new Error(reason || '这个浏览器没有可用的 WebGL');
    error.code = 'NO_WEBGL';
    throw error;
};

/**
 * @param {HTMLElement} host   the element the canvas is put inside
 * @param {object} options     `{ canvasClass, reduced, onContextLost }`
 */
export const createStage = function (host, {
    canvasClass = '',
    reduced = false,
    onContextLost,
} = {}) {
    const renderer = createRenderer(host, canvasClass);
    const canvas = renderer.domElement;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.setClearColor(0x04050a, 1);

    // A lost context (a driver reset, a laptop switching GPUs, the browser
    // reclaiming memory in a background tab) leaves a canvas that never draws
    // again. `preventDefault` is what allows it to be restored at all, and the
    // caller is told so it can stop the loop and say so on screen.
    const onLost = (event) => {
        event.preventDefault();
        if (onContextLost) onContextLost();
    };
    canvas.addEventListener('webglcontextlost', onLost);

    const scene = new THREE.Scene();
    // Exponential rather than linear: the scene has no back wall to place a
    // linear fog plane against, and the dust should thin out with distance in
    // every direction.
    scene.fog = new THREE.FogExp2(0x04060c, 0.13);

    // --- the environment -----------------------------------------------------
    // A small equirectangular canvas through `PMREMGenerator`. Without it the
    // platter's `metalness: 0.92` has nothing to reflect and renders as flat
    // grey; with it the metal picks up the same red and blue the scene is lit
    // with. Generated once, then the source canvas is thrown away.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envSource = envTexture();
    const envTarget = pmrem.fromEquirectangular(envSource);
    scene.environment = envTarget.texture;
    envSource.dispose();
    pmrem.dispose();

    // --- lights --------------------------------------------------------------
    // Four, and each has one job. No shadows anywhere: the scene is a record on
    // a black floor, and a shadow map would buy one soft ellipse for a
    // per-frame depth pass over every mesh.
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(3.4, 5.2, 2.6);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x8fa6d8, 0.95);
    fill.position.set(-4.5, 2.2, -2.6);
    scene.add(fill);

    // Red, low, and behind: it is what puts an accent on the record's edge.
    // Kept under half the key light on purpose — at 1.5 the vinyl's cap caught
    // enough of it that the disc read as red plastic rather than as black
    // vinyl with a red rim, which is the same mistake the beat light made.
    const rim = new THREE.DirectionalLight(0xfa233b, 0.85);
    rim.position.set(-2.6, 1.2, -4.2);
    scene.add(rim);

    scene.add(new THREE.HemisphereLight(0x39435f, 0x05060a, 0.8));

    // The beat's own light, over the label. It is the only light whose
    // intensity changes at runtime, which is why the record's `setLevel` can
    // stay subtle and the scene still visibly reacts.
    //
    // It used to sit 0.62 units above the record, which with the physical
    // falloff (`decay: 2` means irradiance ∝ 1/d²) made it *brighter than the
    // key light* — the whole disc came out red-washed and the cover art went
    // pink. Twice as far away and a quarter of the intensity puts it back
    // where it belongs: a tint on the metal, not a lamp on the table.
    const beatLight = new THREE.PointLight(0xff3350, 0.7, 11, 2);
    beatLight.position.set(0, 1.35, 0);
    scene.add(beatLight);

    // --- the room ------------------------------------------------------------
    const turntable = createTurntable();
    scene.add(turntable.group);

    const tonearm = createTonearm();
    scene.add(tonearm.group);

    const particles = createParticles();
    scene.add(particles.points);

    const lyrics = createLyrics();
    scene.add(lyrics.glow);
    scene.add(lyrics.mesh);

    // What a click is tested against. The record itself is a bad target: it is
    // three meshes plus a mirrored copy plus a 16-unit floor plane, and the
    // floor alone would swallow every ray in the scene. One transparent disc
    // the size of the vinyl is both cheaper and exactly the hit area a visitor
    // expects. Transparent rather than `visible: false` so that a future three
    // that starts skipping invisible objects in `intersectObject` cannot
    // silently break the click.
    const pickTarget = new THREE.Mesh(
        new THREE.CircleGeometry(RECORD_RADIUS * 1.02, 48),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    pickTarget.rotation.x = -Math.PI / 2;
    pickTarget.position.y = 0.024;
    scene.add(pickTarget);

    const raycaster = new THREE.Raycaster();

    // Where the cursor is, in the world, for the dust to part around. The
    // plane the ray lands on follows the dust: flat on the floor while the
    // record is the subject, and up at the height of the words once the ring
    // has formed — a ray aimed at the lyrics that hit the floor would clear a
    // hole two metres below where the visitor is actually pointing.
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const aimPoint = new THREE.Vector3();
    let aimY = 0;
    let pointer = null;

    const rig = createCameraRig(host.clientWidth / Math.max(1, host.clientHeight), { reduced });
    const analyzer = createAnalyzer();

    // --- the moving parts ----------------------------------------------------
    let spinRate = 0;
    let armAngle = ARM_REST;
    let armLift = LIFT_REST;
    let disposed = false;

    return {
        analyzer,
        scene,
        camera: rig.camera,
        renderer,

        /**
         * One frame.
         *
         * @param {number} delta    seconds since the last frame, already capped
         * @param {object} state    `{ playing, hasTrack, progress, lyrics,
         *                            lyricsVisible, lyricsTime, notice,
         *                            listOpen }`
         */
        frame(delta, state) {
            if (disposed) return;

            const level = analyzer.update(delta, state.playing);

            // The record coasts to a stop instead of stopping dead — a platter
            // is heavy, and the moment the music pauses is the moment the
            // motion should stop being abrupt.
            spinRate = damp(spinRate, state.playing ? SPIN : 0, 1.6, delta, reduced);
            turntable.spin(spinRate, delta);

            // The arm tracks the song. `progress` is 0..1, so the stylus walks
            // from the lead-in groove to the run-out over the length of the
            // track, which is what a real arm does — the alternative, a static
            // arm, is the single detail that makes a 3D turntable look like a
            // prop rather than a machine.
            const engaged = state.hasTrack && (state.playing || state.progress > 0.002);
            const goalAngle = engaged
                ? ARM_LEAD_IN + (ARM_RUN_OUT - ARM_LEAD_IN) * state.progress
                : ARM_REST;
            armAngle = damp(armAngle, goalAngle, 1.7, delta, reduced);
            armLift = damp(armLift, state.playing ? 0 : LIFT_REST, 3, delta, reduced);
            tonearm.update(armAngle, armLift);

            turntable.setLevel(level);
            lyrics.setLevel(level);
            aimY = damp(aimY, state.lyricsVisible ? RING_Y : 0, 2, delta, reduced);
            floor.constant = -aimY;
            particles.update(delta, {
                level,
                playing: state.playing,
                // The galaxy becomes the river the moment the words come up,
                // and turns back into one when they go away.
                formation: state.lyricsVisible ? 1 : 0,
                pointer,
            });
            beatLight.intensity = 0.55 + level * 2.6;

            rig.update(delta, {
                playing: state.playing,
                hasTrack: state.hasTrack,
                lyrics: state.lyricsVisible,
                listOpen: state.listOpen,
                level,
            });

            lyrics.update(
                state.lyricsVisible,
                state.lyrics,
                state.lyricsTime,
                state.notice,
                delta,
            );

            renderer.render(scene, rig.camera);
        },

        /**
         * The cover for the record's label. Guarded on `disposed` because the
         * texture arrives from an `Image` load, and the visitor can leave the
         * route faster than the network answers.
         */
        setCover(url, fallback) {
            if (disposed) return Promise.resolve();
            return turntable.setCover(url, fallback);
        },

        orbit(dx, dy) {
            rig.orbit(dx, dy);
        },

        /**
         * Where the cursor is, for the dust. `x` and `y` are normalised device
         * coordinates; the ray is intersected with the plane the dust is
         * currently in, so the hand works on the whole cloud and not just the
         * disc, and follows the cloud up when it stands into the ring.
         */
        aim(x, y) {
            raycaster.setFromCamera({ x, y }, rig.camera);
            const hit = raycaster.ray.intersectPlane(floor, aimPoint);
            pointer = hit ? { x: aimPoint.x, y: aimPoint.y, z: aimPoint.z } : null;
        },

        aimOff() {
            pointer = null;
        },

        dolly(amount) {
            rig.dolly(amount);
        },

        hold() {
            rig.hold();
        },

        /** The record, for hit-testing a click on it. */
        get disc() {
            return turntable.group;
        },

        /**
         * Is this screen point on the record? `x` and `y` are in normalised
         * device coordinates, which is what `PointerEvent` maths produces.
         */
        pick(x, y) {
            raycaster.setFromCamera({ x, y }, rig.camera);
            return raycaster.intersectObject(pickTarget, false).length > 0;
        },

        resize(width, height) {
            if (width <= 0 || height <= 0) return;
            // `false`: the canvas is sized by CSS, and letting the renderer
            // write inline styles would fight the layout.
            renderer.setSize(width, height, false);
            rig.resize(width / height);
        },

        dispose() {
            disposed = true;
            canvas.removeEventListener('webglcontextlost', onLost);
            analyzer.dispose();
            tonearm.dispose();
            particles.dispose();
            lyrics.dispose();
            turntable.dispose();
            pickTarget.geometry.dispose();
            pickTarget.material.dispose();
            envTarget.dispose();
            scene.environment = null;
            renderer.dispose();
            // The canvas belongs to this module, not to React, so it leaves
            // with it — otherwise a retry after a failure would stack a second
            // canvas on top of the first.
            if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        },
    };
};
