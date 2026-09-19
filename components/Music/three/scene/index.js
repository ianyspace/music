import * as THREE from 'three';

import { envTexture } from './textures';
import { createTurntable, RECORD_RADIUS } from './record';
import { createTonearm, ARM_REST, ARM_LEAD_IN, ARM_RUN_OUT } from './tonearm';
import { createParticles } from './particles';
import { createLyrics } from './lyrics';
import { createCameraRig } from './camera';
import { createAnalyzer } from './analyzer';

/**
 * The 3D stage: one renderer, one scene, one camera rig, and a `frame()` that
 * advances all of it.
 *
 * This module is deliberately framework-free — it takes a `<canvas>` and hands
 * back plain functions. React only mounts the canvas and calls `frame` from a
 * rAF loop, so nothing about the scene depends on a render pass, and nothing
 * about React ends up inside the render loop.
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

export const createStage = function (canvas, { reduced = false } = {}) {
    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.setClearColor(0x04050a, 1);

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

    const rim = new THREE.DirectionalLight(0xfa233b, 1.5);
    rim.position.set(-2.6, 1.2, -4.2);
    scene.add(rim);

    scene.add(new THREE.HemisphereLight(0x39435f, 0x05060a, 0.8));

    // The beat's own light, right over the label. It is the only light whose
    // intensity changes at runtime, which is why the record's `setLevel` can
    // stay subtle and the scene still visibly reacts.
    const beatLight = new THREE.PointLight(0xff3350, 2.6, 9, 2);
    beatLight.position.set(0, 0.62, 0);
    scene.add(beatLight);

    // --- the room ------------------------------------------------------------
    const turntable = createTurntable();
    scene.add(turntable.group);

    const tonearm = createTonearm();
    scene.add(tonearm.group);

    const particles = createParticles();
    scene.add(particles.points);

    const lyrics = createLyrics();
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

    const rig = createCameraRig(canvas.clientWidth / Math.max(1, canvas.clientHeight), { reduced });
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
            particles.update(delta, level, state.playing);
            beatLight.intensity = 1.4 + level * 4.6;

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
        },
    };
};
