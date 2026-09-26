/**
 * 粒子舞台引擎 (three.js r128)。
 *
 * 移植自 Mineradio 的 public/js/modules/02-visual/00-pointer-cover-particles.js
 * + 15-ripples-cover-depth.js + 01-float-skull-backcover.js, 以及
 * 11-main-loop.js 里的频段处理与相机 orbit。上游许可证 GNU GPL v3。
 *
 * 这里只做两处适应性修改:
 *  1. 相机偏航/俯仰相对预设基线做了硬限位 —— 上游允许自由转到侧面,
 *     本项目的沉浸式页要求主体始终基本正面朝向用户。
 *  2. 去掉了歌单架/手势/自由飞行相机等本项目不存在的交互层。
 */

import {
    PARTICLE_VERTEX_SHADER,
    PARTICLE_FRAGMENT_SHADER,
    BLOOM_VERTEX_SHADER,
    BLOOM_FRAGMENT_SHADER,
    STAR_RIVER_VERTEX_SHADER,
    STAR_RIVER_FRAGMENT_SHADER,
    SKULL_VERTEX_SHADER,
    SKULL_FRAGMENT_SHADER,
} from './shaders';
import {
    SKULL_PRESET_INDEX,
    clampRange,
    coverParticleGridForResolution,
    coverTextureSizeForResolution,
    defaultOrbitStateForPreset,
    normalizeCoverResolution,
    normalizeHexColor,
} from './presetData';
import { applyNeutralEdgeCanvas, buildEdgeAndDepth, makeSquareCoverCanvas } from './coverDepth';
import { advanceVinyl } from './vinylSpin';
// 官方 3D 歌词系统: 共享运行时 + 入口 + 每帧调度。
import {
    applyFx as applyLyricFx,
    bindStage,
    setAudioFrame,
    setLyricsPayload,
    setLyricSunEnergy,
} from './lyrics/runtime';
import { stageLyrics as lyricState } from './lyrics/02-state-layout';
// 命名空间引入: 同步兜底要读 runtime 里的活跃绑定 (歌词行/播放状态)。
import * as lyricRuntime from './lyrics/runtime';
import { createLyricsParticles, updateLyricStarRiver } from './lyrics/03-star-river';
import { setStageLyricPalette } from './lyrics/07-palette-utils';
import {
    clearStageLyrics,
    disposeLyricsParticles,
    invalidateStageLyricPayloadForNewLyrics,
    showStageLine,
    tickLyricsParticles,
    updateStageLyrics3D,
    buildStageLyricPlaybackPayload,
    findStageLyricIndexAtTime,
} from './lyrics/14-stage-rendering';

const PLANE_SIZE = 4.8;
const RIPPLE_MAX = 12;
// 指针停多久算"松手", 之后视角开始往基线飘回去。
const POINTER_FOLLOW_IDLE_MS = 700;
const BASE_FOV = 45;
const BACKGROUND_STAR_RIVER_COUNT = 1400;
const SKULL_MODEL_SCALE = 2.34;
const SKULL_MODEL_BASE_ROTATION_X = -0.26;
const SKULL_MODEL_BASE_ROTATION_Y = 0.0;
const SKULL_MODEL_BASE_POSITION = { x: 0, y: 0.22, z: 0.1 };

const clamp01 = (v) => Math.max(0, Math.min(1, v));

const env = (current, target, attack, release, step) => {
    const rate = target > current ? attack : release;
    return current + (target - current) * Math.min(1, rate * step);
};

const PIXEL_RATIO_CAP = { eco: 1, balanced: 1.25, high: 1.5, ultra: 2 };

export default class ParticleStage {
    constructor(THREE, container, options) {
        this.THREE = THREE;
        this.container = container;
        this.options = options || {};
        this.fx = this.options.fx || {};
        this.palette = null;

        this.time = 0;
        this.lastFrame = 0;
        this.raf = 0;
        this.disposed = false;

        // 音频状态 (与 11-main-loop.js 同名同义)
        this.smoothBass = 0;
        this.smoothMid = 0;
        this.smoothTreb = 0;
        this.smoothEnergy = 0;
        this.beatPulse = 0;
        this.bassOnset = 0;
        this.audioEnergy = 0;

        // 涟漪
        this.rippleIdx = 0;
        this.lastRippleAt = 0;
        this.lastBassRising = false;
        this.rippleActiveCount = 0;
        this.ripples = [];
        this.regions = [];
        for (let ry = 0; ry < 3; ry += 1) {
            for (let rx = 0; rx < 3; rx += 1) {
                this.regions.push({
                    x: (rx / 2 - 0.5) * PLANE_SIZE * 0.72,
                    y: (ry / 2 - 0.5) * PLANE_SIZE * 0.72,
                });
            }
        }
        for (let i = 0; i < RIPPLE_MAX; i += 1) this.ripples.push({ x: 0, y: 0, age: -10, str: 0 });

        // 相机 orbit
        const baseline = defaultOrbitStateForPreset(this.fx.preset);
        this.orbit = {
            userTheta: baseline.theta,
            userPhi: baseline.phi,
            userRadius: baseline.radius,
            theta: baseline.theta,
            phi: baseline.phi,
            radius: baseline.radius,
            baselineTheta: baseline.theta,
            baselinePhi: baseline.phi,
            baselineRadius: baseline.radius,
            minPhi: -Math.PI * 0.45,
            maxPhi: Math.PI * 0.45,
            minRadius: 2.4,
            maxRadius: 14.0,
            // 视角跟随指针: 指针一动就把目标角度推出去, 停手 idle 之后
            // 由 tickPointerFollow 慢慢收回来。
            lastMoveAt: 0,
            recentering: false,
        };
        // 相对基线的硬限位: 主体始终保持基本正面
        this.thetaLimit = 0.42;
        this.phiLimit = 0.24;

        this.camPunch = 0;
        this.cinemaT = 0;
        this.beatCam = { thetaKick: 0, phiKick: 0, radiusKick: 0, rollKick: 0, punch: 0 };

        // 预设切换转场
        this.presetTransition = { active: false, start: 0, duration: 0.24, from: 0, to: 0 };
        this.colorMixTween = null;

        // 指针推力 (emily/SILK): 指针射线打到粒子平面, 换算成粒子局部坐标
        // 喂给 uMouseXY —— 上游同款算法 (00-pointer-cover-particles.js)。
        this.pointer = { ndcX: 0, ndcY: 0, dirty: false, overUi: false };

        // 入场聚拢 (uLoading): 换封面时短暂切到雾态, 就绪后收回。上游
        // showLoading/hideLoading 的时长与阈值 (15-ripples-cover-depth.js)。
        this.loadingTween = null;
        this.loadingHideTimer = 0;
        this.loadingShownAt = 0;

        // 安魂
        this.skullGroup = null;
        this.skullAsset = { data: null, promise: null, failed: false };
        this.skullOpacity = 0;
        this.skullFlash = 0;
        this.skullJaw = 0;
        this.skullAmpPulse = 0;
        this.skullCameraBlend = 0;
        this.skullWheelZoom = 0;
        this.skullWheelZoomTarget = 0;

        this.coverProcessToken = 0;
        this.coverCache = { seed: '', edgeCanvas: null };

        this.build();
    }

    build() {
        const THREE = this.THREE;
        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({
            antialias: false,
            alpha: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.setSize(width, height, false);
        this.applyPixelRatio();
        this.canvas = this.renderer.domElement;
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.display = 'block';
        this.container.appendChild(this.canvas);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(BASE_FOV, width / height, 0.1, 100);
        this.applyCamera(0);

        // 指针射线求交用的临时对象, 每帧复用。
        this.pointerRay = new THREE.Raycaster();
        this.pointerPlane = new THREE.Plane();
        this.pointerNdc = new THREE.Vector2();
        this.pointerHit = new THREE.Vector3();
        this.pointerWorldHit = new THREE.Vector3();
        this.pointerPlanePoint = new THREE.Vector3();
        this.pointerNormal = new THREE.Vector3();
        this.pointerQuat = new THREE.Quaternion();

        this.dotTexture = this.makeDotTexture();
        this.coverTex = new THREE.Texture();
        this.coverTex.minFilter = THREE.LinearFilter;
        this.coverTex.magFilter = THREE.LinearFilter;
        this.coverTex.wrapS = THREE.ClampToEdgeWrapping;
        this.coverTex.wrapT = THREE.ClampToEdgeWrapping;
        this.prevCoverTex = new THREE.Texture();
        this.prevCoverTex.minFilter = THREE.LinearFilter;
        this.prevCoverTex.magFilter = THREE.LinearFilter;
        this.coverEdgeTex = new THREE.Texture();
        this.coverEdgeTex.minFilter = THREE.LinearFilter;
        this.coverEdgeTex.magFilter = THREE.LinearFilter;

        const blank = document.createElement('canvas');
        blank.width = 4;
        blank.height = 4;
        const bctx = blank.getContext('2d');
        bctx.fillStyle = '#1c1c28';
        bctx.fillRect(0, 0, 4, 4);
        this.coverTex.image = blank;
        this.coverTex.needsUpdate = true;
        this.prevCoverTex.image = blank;
        this.prevCoverTex.needsUpdate = true;
        this.coverEdgeTex.image = applyNeutralEdgeCanvas();
        this.coverEdgeTex.needsUpdate = true;

        // 涟漪数据纹理 (1×N, RGBA: x, y, age, str)
        this.rippleData = new Float32Array(RIPPLE_MAX * 4);
        this.rippleTex = new THREE.DataTexture(
            this.rippleData, 1, RIPPLE_MAX, THREE.RGBAFormat, THREE.FloatType
        );
        this.rippleTex.magFilter = THREE.NearestFilter;
        this.rippleTex.minFilter = THREE.NearestFilter;

        this.uniforms = {
            uTime: { value: 0 },
            uBass: { value: 0 },
            uMid: { value: 0 },
            uTreble: { value: 0 },
            uBeat: { value: 0 },
            uEnergy: { value: 0 },
            uBurstAmt: { value: 0 },
            uVinylSpin: { value: 0 },
            uPreset: { value: Number(this.fx.preset) || 0 },
            uIntensity: { value: 0.85 },
            uDepth: { value: 1.0 },
            uPointScale: { value: 1.0 },
            uSpeed: { value: 1.0 },
            uTwist: { value: 0 },
            uColorBoost: { value: 1.1 },
            uScatter: { value: 0 },
            uCoverRes: { value: normalizeCoverResolution(this.fx.coverResolution) },
            uBgFade: { value: 0.2 },
            uBloomStrength: { value: 0.62 },
            uBloomSize: { value: 2.65 },
            uTintColor: { value: new THREE.Color('#9db8cf') },
            uTintStrength: { value: 0 },
            uCoverTex: { value: this.coverTex },
            uPrevCoverTex: { value: this.prevCoverTex },
            uColorMixT: { value: 1.0 },
            uEdgeTex: { value: this.coverEdgeTex },
            uRippleTex: { value: this.rippleTex },
            uRippleCount: { value: 0 },
            uDotTex: { value: this.dotTexture },
            uHasCover: { value: 0 },
            uHasDepth: { value: 0 },
            uEdgeEnabled: { value: 1 },
            uAiBoost: { value: 0 },
            uMouseXY: { value: new THREE.Vector2(-999, -999) },
            uMouseActive: { value: 0 },
            uHandXY: { value: new THREE.Vector2(-999, -999) },
            uHandActive: { value: 0 },
            uGestureGrip: { value: 0 },
            uPixel: { value: this.renderer.getPixelRatio() },
            uAlpha: { value: 0 },
            uParticleDim: { value: 1 },
            uBackdropAdapt: { value: 0.72 },
            uFloatAlpha: { value: 0 },
            uLoading: { value: 0 },
        };

        const grid = coverParticleGridForResolution(this.fx.coverResolution);
        this.grid = grid;
        this.geometry = this.buildCoverParticleGeometry(grid);

        this.material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: PARTICLE_VERTEX_SHADER,
            fragmentShader: PARTICLE_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            blending: THREE.NormalBlending,
        });
        this.bloomMaterial = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: BLOOM_VERTEX_SHADER,
            fragmentShader: BLOOM_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending,
        });
        this.bloomParticles = new THREE.Points(this.geometry, this.bloomMaterial);
        this.bloomParticles.frustumCulled = false;
        this.bloomParticles.renderOrder = 0;
        this.scene.add(this.bloomParticles);
        this.particles = new THREE.Points(this.geometry, this.material);
        this.particles.frustumCulled = false;
        this.particles.renderOrder = 1;
        this.scene.add(this.particles);

        this.buildStarRiver();
        this.bindPointer();

        // 官方 3D 歌词系统的所有模块都从 runtime 里取 scene/camera/renderer/
        // THREE, 这里把本引擎的这几个对象交给它 —— 歌词因此和粒子在同一个
        // 场景、同一个相机里, 才有原版那种透视与居中。
        bindStage(THREE, this.scene, this.camera, this.renderer, this.uniforms);
        applyLyricFx(this.fx);
        createLyricsParticles();

        this.syncFxUniforms();
        this.setPreset(Number(this.fx.preset) || 0, { silent: true, preserveCamera: true });

        this.resizeObserver = typeof ResizeObserver === 'function'
            ? new ResizeObserver(() => this.resize())
            : null;
        if (this.resizeObserver) this.resizeObserver.observe(this.container);
        window.addEventListener('resize', this.onWindowResize);

        this.lastFrame = performance.now();
        this.loop = this.loop.bind(this);
        this.raf = requestAnimationFrame(this.loop);
    }

    makeDotTexture() {
        const THREE = this.THREE;
        const cv = document.createElement('canvas');
        cv.width = 64;
        cv.height = 64;
        const ctx = cv.getContext('2d');
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
        g.addColorStop(0.0, 'rgba(255,255,255,0.96)');
        g.addColorStop(0.42, 'rgba(255,255,255,0.78)');
        g.addColorStop(0.72, 'rgba(255,255,255,0.22)');
        g.addColorStop(1.0, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        const tex = new THREE.CanvasTexture(cv);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        return tex;
    }

    buildCoverParticleGeometry(gridInput) {
        const THREE = this.THREE;
        const grid = coverParticleGridForResolution(gridInput / 118);
        const count = grid * grid;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const uvs = new Float32Array(count * 2);
        const rand = new Float32Array(count);
        const texelStep = 1 / grid;
        for (let i = 0; i < count; i += 1) {
            const gx = i % grid;
            const gy = Math.floor(i / grid);
            const u = (gx + 0.5) * texelStep;
            const v = (gy + 0.5) * texelStep;
            const px = gx / (grid - 1);
            const py = gy / (grid - 1);
            positions[i * 3] = (px - 0.5) * PLANE_SIZE;
            positions[i * 3 + 1] = (py - 0.5) * PLANE_SIZE;
            positions[i * 3 + 2] = 0;
            uvs[i * 2] = u;
            uvs[i * 2 + 1] = v;
            rand[i] = Math.random();
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2));
        geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
        geo.userData.grid = grid;
        geo.userData.count = count;
        return geo;
    }

    buildStarRiver() {
        const THREE = this.THREE;
        const count = BACKGROUND_STAR_RIVER_COUNT;
        const bgGeo = new THREE.BufferGeometry();
        const seeds = new Float32Array(count);
        const lanes = new Float32Array(count);
        const depths = new Float32Array(count);
        for (let i = 0; i < count; i += 1) {
            seeds[i] = Math.random() * 1000 + i * 0.37;
            lanes[i] = Math.random();
            depths[i] = Math.random();
        }
        bgGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
        bgGeo.setAttribute('aLane', new THREE.BufferAttribute(lanes, 1));
        bgGeo.setAttribute('aDepthSeed', new THREE.BufferAttribute(depths, 1));

        this.starRiverUniforms = {
            uDotTex: this.uniforms.uDotTex,
            uTime: this.uniforms.uTime,
            uBass: this.uniforms.uBass,
            uTreble: this.uniforms.uTreble,
            uBeat: this.uniforms.uBeat,
            uEnergy: this.uniforms.uEnergy,
            uPixel: this.uniforms.uPixel,
            uPointScale: this.uniforms.uPointScale,
            uParticleDim: this.uniforms.uParticleDim,
            uTintColor: this.uniforms.uTintColor,
            uAlpha: { value: 0 },
        };
        this.starRiverMaterial = new THREE.ShaderMaterial({
            uniforms: this.starRiverUniforms,
            vertexShader: STAR_RIVER_VERTEX_SHADER,
            fragmentShader: STAR_RIVER_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending,
        });
        this.starRiver = new THREE.Points(bgGeo, this.starRiverMaterial);
        this.starRiver.frustumCulled = false;
        this.starRiver.renderOrder = -2;
        this.scene.add(this.starRiver);
    }

    applyPixelRatio() {
        const cap = PIXEL_RATIO_CAP[this.fx.performanceQuality] || 1;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    }

    // ---------------------------------------------------------------- 指针

    bindPointer() {
        this.onPointerTrack = (e) => {
            // 指针推力只在指针真的落在画布上时生效: 播放栏/歌单/控制台浮在
            // canvas 之上, 鼠标在它们上面时不该推粒子 (上游 isPointerOverUi)。
            const overCanvas = !e.target || e.target === this.canvas
                || (this.container && this.container.contains(e.target));
            this.pointer.overUi = !overCanvas;
            if (overCanvas) {
                this.pointer.ndcX = (e.clientX / window.innerWidth) * 2 - 1;
                this.pointer.ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
                // 视角跟着指针走, 不用按住: 指针离画面中心越远, 相对基线的
                // 偏航/俯仰越大, 硬限位之内封顶。方向沿用原来拖动时的手感
                // (右移 → 偏航减小, 下移 → 俯仰增大)。
                const orbit = this.orbit;
                orbit.userTheta = clampRange(
                    orbit.baselineTheta - this.pointer.ndcX * this.thetaLimit * 0.9,
                    orbit.baselineTheta - this.thetaLimit,
                    orbit.baselineTheta + this.thetaLimit
                );
                orbit.userPhi = clampRange(
                    orbit.baselinePhi - this.pointer.ndcY * this.phiLimit * 0.9,
                    orbit.baselinePhi - this.phiLimit,
                    orbit.baselinePhi + this.phiLimit
                );
                orbit.lastMoveAt = performance.now();
            }
            this.pointer.dirty = true;
        };
        this.onPointerLeave = () => {
            this.pointer.overUi = true;
            this.pointer.dirty = true;
        };
        this.onWheel = (e) => {
            e.preventDefault();
            if (Number(this.fx.preset) === SKULL_PRESET_INDEX) {
                this.skullWheelZoomTarget = clampRange(this.skullWheelZoomTarget + e.deltaY * 0.00155, -0.95, 1.28);
                return;
            }
            this.orbit.userRadius = clampRange(
                this.orbit.userRadius + e.deltaY * 0.005,
                this.orbit.minRadius,
                this.orbit.maxRadius
            );
        };
        this.onDblClick = () => {
            this.orbit.recentering = true;
            if (Number(this.fx.preset) === SKULL_PRESET_INDEX) this.skullWheelZoomTarget = 0;
        };
        window.addEventListener('mousemove', this.onPointerTrack);
        document.addEventListener('mouseleave', this.onPointerLeave);
        this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
        this.canvas.addEventListener('dblclick', this.onDblClick);
    }

    // ---------------------------------------------------------------- 相机

    /**
     * 指针停手之后把视角慢慢收回基线。跟随本身是在 mousemove 里直接改
     * userTheta/userPhi 完成的, 这里只负责"没人动就归位": 速率故意比
     * 双击回正慢一个量级 (0.9 vs 6), 回正要看得出来是飘回去的。
     */
    tickPointerFollow(dt, now) {
        const orbit = this.orbit;
        if (orbit.recentering) return;
        if (now - orbit.lastMoveAt < POINTER_FOLLOW_IDLE_MS) return;
        const k = Math.min(1, dt * 0.9);
        orbit.userTheta += (orbit.baselineTheta - orbit.userTheta) * k;
        orbit.userPhi += (orbit.baselinePhi - orbit.userPhi) * k;
    }

    applyCamera(dt) {
        const orbit = this.orbit;
        if (orbit.recentering) {
            orbit.userTheta += (orbit.baselineTheta - orbit.userTheta) * Math.min(1, dt * 6);
            orbit.userPhi += (orbit.baselinePhi - orbit.userPhi) * Math.min(1, dt * 6);
            orbit.userRadius += (orbit.baselineRadius - orbit.userRadius) * Math.min(1, dt * 6);
            if (Math.abs(orbit.userTheta - orbit.baselineTheta) < 0.002
                && Math.abs(orbit.userPhi - orbit.baselinePhi) < 0.002) {
                orbit.recentering = false;
            }
        }
        orbit.theta += (orbit.userTheta - orbit.theta) * Math.min(1, dt * 8);
        orbit.phi += (orbit.userPhi - orbit.phi) * Math.min(1, dt * 8);
        orbit.radius += (orbit.userRadius - orbit.radius) * Math.min(1, dt * 8);

        const shake = clampRange(Number(this.fx.cinemaShake) || 0, 0, 1.8) * (this.fx.cinema ? 1 : 0);
        const theta = orbit.theta + this.beatCam.thetaKick * shake
            + Math.sin(this.cinemaT * 0.08) * 0.012 * shake;
        const phi = clampRange(
            orbit.phi + this.beatCam.phiKick * shake + Math.sin(this.cinemaT * 0.06 + 1) * 0.010 * shake,
            orbit.minPhi,
            orbit.maxPhi
        );
        const radius = orbit.radius - this.beatCam.radiusKick * shake * 0.4
            - Math.sin(this.cinemaT * 0.04 + 2) * 0.05 * shake;

        const cy = Math.cos(phi);
        this.camera.position.set(
            radius * cy * Math.sin(theta),
            radius * Math.sin(phi),
            radius * cy * Math.cos(theta)
        );
        this.camera.lookAt(0, 0, 0);
        this.camera.rotation.z += this.beatCam.rollKick * shake * 0.7;

        const targetFov = clampRange(BASE_FOV - this.camPunch * 1.75, 26, 72);
        if (Math.abs(this.camera.fov - targetFov) > 0.01) {
            this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 8);
            this.camera.updateProjectionMatrix();
        }
    }

    // ---------------------------------------------------------------- 预设

    setPreset(p, opts) {
        opts = opts || {};
        const prev = this.uniforms.uPreset.value;
        const index = clampRange(Math.round(Number(p) || 0), 0, 12);
        this.uniforms.uPreset.value = index;
        if (prev === index) return;
        if (index === SKULL_PRESET_INDEX) this.ensureSkullLayer();
        else this.clearSkullResidue();

        if (!opts.silent) this.triggerPresetTransition(prev, index);

        if (!opts.preserveCamera && index !== 5) {
            const base = defaultOrbitStateForPreset(index);
            this.orbit.baselineTheta = base.theta;
            this.orbit.baselinePhi = clampRange(base.phi, this.orbit.minPhi, this.orbit.maxPhi);
            this.orbit.baselineRadius = clampRange(base.radius, this.orbit.minRadius, this.orbit.maxRadius);
            this.orbit.userTheta = this.orbit.baselineTheta;
            this.orbit.userPhi = this.orbit.baselinePhi;
            this.orbit.userRadius = this.orbit.baselineRadius;
        }
    }

    triggerPresetTransition(from, to) {
        const t = this.presetTransition;
        t.active = true;
        t.start = this.uniforms.uTime.value;
        t.duration = to === 5 ? 0.3 : 0.24;
        t.from = from;
        t.to = to;
        const newVisual = to >= 4;
        const wallpaperFlow = to === 5;
        this.uniforms.uScatter.value = Math.max(
            this.uniforms.uScatter.value,
            this.fx.scatter + (newVisual ? (wallpaperFlow ? 0.008 : 0.024) : 0.12)
        );
        this.uniforms.uBurstAmt.value = Math.max(this.uniforms.uBurstAmt.value, wallpaperFlow ? 0.05 : 0.15);
        this.camPunch = Math.max(this.camPunch, wallpaperFlow ? 0.04 : 0.12);
        for (let i = 0; i < 3; i += 1) {
            this.triggerRipple(
                (Math.random() - 0.5) * 3.4,
                (Math.random() - 0.5) * 3.4,
                0.58 + Math.random() * 0.32
            );
        }
    }

    tickPresetTransition() {
        const t = this.presetTransition;
        if (!t.active) return;
        const raw = (this.uniforms.uTime.value - t.start) / t.duration;
        const clamped = Math.max(0, Math.min(1, raw));
        const wave = Math.sin(clamped * Math.PI);
        const newVisual = t.to >= 4;
        const wallpaperFlow = t.to === 5;
        this.uniforms.uScatter.value = Math.max(
            this.uniforms.uScatter.value,
            this.fx.scatter + wave * (newVisual ? (wallpaperFlow ? 0.008 : 0.026) : 0.16)
        );
        this.uniforms.uBurstAmt.value = Math.max(
            this.uniforms.uBurstAmt.value,
            wave * (wallpaperFlow ? 0.045 : (newVisual ? 0.12 : 0.15))
        );
        this.uniforms.uPointScale.value = (Number(this.fx.point) || 1) * (1 + wave * (wallpaperFlow ? 0.016 : 0.048));
        if (raw >= 1) {
            t.active = false;
            this.syncFxUniforms();
        }
    }

    /**
     * 指针推力: 把指针射线打到粒子所在的平面, 换算成粒子局部坐标。
     *
     * 粒子对象可能被相机/预设旋转过, 所以平面法线要跟着它的世界四元数转,
     * 命中点再 worldToLocal —— 否则 uMouseXY 和着色器里的 pos 不在同一空间,
     * 推力会偏。上游同样的两段式(先粒子平面, 失败退回 z=0 平面)。
     */
    updatePointerFrame() {
        const p = this.pointer;
        if (!p.dirty) return;
        p.dirty = false;
        const u = this.uniforms;
        if (p.overUi) {
            u.uMouseXY.value.set(-999, -999);
            u.uMouseActive.value = 0;
            return;
        }
        this.pointerNdc.set(p.ndcX, p.ndcY);
        this.pointerRay.setFromCamera(this.pointerNdc, this.camera);
        const out = this.pointerHit;
        let hit = false;
        const obj = this.particles;
        if (obj) {
            obj.updateMatrixWorld(true);
            obj.getWorldPosition(this.pointerPlanePoint);
            obj.getWorldQuaternion(this.pointerQuat);
            this.pointerNormal.set(0, 0, 1).applyQuaternion(this.pointerQuat).normalize();
            if (Math.abs(this.pointerNormal.dot(this.pointerRay.ray.direction)) >= 0.16) {
                this.pointerPlane.setFromNormalAndCoplanarPoint(this.pointerNormal, this.pointerPlanePoint);
                if (this.pointerRay.ray.intersectPlane(this.pointerPlane, this.pointerWorldHit)) {
                    out.copy(this.pointerWorldHit);
                    obj.worldToLocal(out);
                    hit = true;
                }
            }
        }
        if (!hit) {
            this.pointerPlane.set(this.pointerNormal.set(0, 0, 1), 0);
            if (!this.pointerRay.ray.intersectPlane(this.pointerPlane, this.pointerWorldHit)) {
                u.uMouseXY.value.set(-999, -999);
                u.uMouseActive.value = 0;
                return;
            }
            out.copy(this.pointerWorldHit);
        }
        const inside = isFinite(out.x) && isFinite(out.y)
            && Math.abs(out.x) < 8.5 && Math.abs(out.y) < 8.5;
        if (inside) {
            u.uMouseXY.value.set(out.x, out.y);
            u.uMouseActive.value = 1;
        } else {
            u.uMouseXY.value.set(-999, -999);
            u.uMouseActive.value = 0;
        }
    }

    /**
     * 入场聚拢 (uLoading)。
     *
     * 着色器里 uLoading 越大越"雾"(粒子散开成雾团), 0 才是最终形态。所以
     * 换封面时先快速推到 0.56, 封面就绪后再收回 0 —— 这就是 emily 那一下
     * "散开 → 聚成封面"。时长沿用上游: 进 118ms / 96ms, 出 96~126ms。
     */
    tweenLoading(to, durationMs) {
        const u = this.uniforms;
        const from = Number(u.uLoading.value) || 0;
        const duration = Math.max(1, durationMs || 1) / 1000;
        this.loadingTween = { from, to, t: 0, duration };
    }

    showLoading() {
        if (this.loadingHideTimer) {
            window.clearTimeout(this.loadingHideTimer);
            this.loadingHideTimer = 0;
        }
        this.loadingShownAt = performance.now();
        const current = Number(this.uniforms.uLoading.value) || 0;
        this.tweenLoading(Math.max(current, 0.56), current > 0.04 ? 86 : 118);
    }

    hideLoading() {
        if (this.loadingHideTimer) window.clearTimeout(this.loadingHideTimer);
        const elapsed = this.loadingShownAt ? performance.now() - this.loadingShownAt : 999;
        this.loadingHideTimer = window.setTimeout(() => {
            this.loadingHideTimer = 0;
            const current = Number(this.uniforms.uLoading.value) || 0;
            if (current <= 0.015) {
                this.loadingTween = null;
                this.uniforms.uLoading.value = 0;
                return;
            }
            this.tweenLoading(0, current > 0.38 ? 126 : 96);
        }, Math.max(0, 72 - elapsed));
    }

    // 直接把雾态归零 (没有封面可聚, 或组件要卸载时)。
    forceLoadingSettled() {
        if (this.loadingHideTimer) {
            window.clearTimeout(this.loadingHideTimer);
            this.loadingHideTimer = 0;
        }
        this.loadingTween = null;
        this.uniforms.uLoading.value = 0;
        this.loadingShownAt = 0;
    }

    tickLoading(dt) {
        const tw = this.loadingTween;
        if (!tw) return;
        tw.t += dt;
        const t = Math.min(1, tw.t / tw.duration);
        const eased = t * t * (3 - 2 * t);
        this.uniforms.uLoading.value = tw.from + (tw.to - tw.from) * eased;
        if (t >= 1) {
            this.uniforms.uLoading.value = tw.to;
            this.loadingTween = null;
        }
    }

    syncFxUniforms() {
        const fx = this.fx;
        const u = this.uniforms;
        u.uPreset.value = Number(fx.preset) || 0;
        u.uIntensity.value = Number(fx.intensity) || 0;
        u.uDepth.value = Number(fx.depth) || 0;
        u.uPointScale.value = Number(fx.point) || 0;
        u.uSpeed.value = Number(fx.speed) || 0;
        u.uTwist.value = Number(fx.twist) || 0;
        u.uColorBoost.value = Number(fx.color) || 0;
        u.uScatter.value = Number(fx.scatter) || 0;
        u.uCoverRes.value = normalizeCoverResolution(fx.coverResolution);
        u.uBgFade.value = Number(fx.bgFade) || 0;
        u.uBloomStrength.value = fx.bloom ? (Number(fx.bloomStrength) || 0) : 0;
        u.uBackdropAdapt.value = fx.coverBackdropAdapt !== false
            ? clampRange(Number(fx.lyricBackgroundAdapt) || 0, 0, 1)
            : 0;
        u.uEdgeEnabled.value = fx.edge ? 1 : 0;
        const tintOn = fx.visualTintMode === 'custom';
        u.uTintColor.value.set(normalizeHexColor(
            tintOn ? fx.visualTintColor : (this.palette && (this.palette.secondary || this.palette.primary)) || fx.visualTintColor,
            '#9db8cf'
        ));
        u.uTintStrength.value = tintOn ? 0.42 : (this.palette && (this.palette.secondary || this.palette.primary) ? 0.3 : 0.14);
        this.bloomParticles.visible = !!fx.bloom && (Number(fx.bloomStrength) || 0) > 0.01;
        this.syncSkullColors();
    }

    setFx(fx, palette) {
        const prevResolution = normalizeCoverResolution(this.fx.coverResolution);
        const prevPreset = Number(this.fx.preset) || 0;
        this.fx = fx;
        // 歌词系统读的是 runtime 里那份 fx 对象, 控制台改参数要同步过去。
        applyLyricFx(fx);
        if (palette !== undefined) {
            this.palette = palette;
            this.applyLyricPalette(palette);
        }
        const nextResolution = normalizeCoverResolution(fx.coverResolution);
        if (nextResolution !== prevResolution) this.applyCoverResolution();
        this.applyPixelRatio();
        this.uniforms.uPixel.value = this.renderer.getPixelRatio();
        if ((Number(fx.preset) || 0) !== prevPreset) this.setPreset(fx.preset);
        this.syncFxUniforms();
    }

    /**
     * 歌词数据入口。本项目的行是 { time, text }, 上游是 { t, text }, 这里
     * 换算一次。数组就地改写 —— 移植过来的模块 import 的是同一个引用。
     */
    setLyrics(lyrics, fallbackText) {
        const timed = lyrics && lyrics.timed ? lyrics.timed : false;
        const raw = (lyrics && lyrics.lines) || [];
        const lines = raw.map((line) => ({
            t: Number(line.time) || 0,
            text: String(line.text || ''),
            source: 'lrc',
            charCount: String(line.text || '').length,
        }));
        // 无时间轴的歌词 (纯文本) 交给上游的逐行兜底: 让它按时间平铺。
        if (!timed && lines.length) {
            const span = Math.max(1, lines.length) * 4;
            lines.forEach((line, i) => {
                line.t = (i * span) / lines.length;
            });
        }
        setLyricsPayload(lines, [], false, lines.length > 0, String(fallbackText || ''));
        invalidateStageLyricPayloadForNewLyrics('track-switch');
    }

    /** 封面取色同步到歌词。本项目的调色板是 0..1 浮点数组, 上游要 CSS 串。 */
    applyLyricPalette(palette) {
        if (!palette) return;
        const css = (rgb, alpha) => {
            if (!Array.isArray(rgb)) return null;
            const c = rgb.map((v) => Math.round(clamp01(Number(v) || 0) * 255));
            return alpha == null ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
        };
        const primary = css(palette.primary);
        if (!primary) return;
        setStageLyricPalette({
            primary,
            secondary: css(palette.secondary) || primary,
            highlight: css(palette.accent) || 'rgb(238, 247, 255)',
            glow: css(palette.primary, 0.3),
            shadow: 'rgba(2, 8, 12, 0.42)',
        }, { durationMs: 520 });
    }

    applyCoverResolution() {
        const grid = coverParticleGridForResolution(this.fx.coverResolution);
        if (grid === this.grid && this.geometry && this.geometry.userData.grid === grid) return;
        const oldGeo = this.geometry;
        this.geometry = this.buildCoverParticleGeometry(grid);
        this.grid = grid;
        this.particles.geometry = this.geometry;
        this.bloomParticles.geometry = this.geometry;
        if (oldGeo && oldGeo !== this.geometry) oldGeo.dispose();
        this.uniforms.uBurstAmt.value = Math.max(this.uniforms.uBurstAmt.value, 0.18);
    }

    // ---------------------------------------------------------------- 封面

    setCoverImage(image) {
        if (!image) {
            this.coverProcessToken += 1;
            this.uniforms.uHasCover.value = 0;
            this.uniforms.uHasDepth.value = 0;
            this.uniforms.uAiBoost.value = 0;
            this.forceLoadingSettled();
            return;
        }
        const token = this.coverProcessToken + 1;
        this.coverProcessToken = token;
        const size = coverTextureSizeForResolution(this.fx.coverResolution);
        const cv = makeSquareCoverCanvas(image, size);
        if (this.uniforms.uHasCover.value > 0.5 && this.coverTex.image) {
            try {
                const prevW = this.coverTex.image.width || 256;
                const prevH = this.coverTex.image.height || 256;
                const prevScale = Math.min(1, 256 / Math.max(prevW, prevH, 1));
                const prevCv = document.createElement('canvas');
                prevCv.width = Math.max(1, Math.round(prevW * prevScale));
                prevCv.height = Math.max(1, Math.round(prevH * prevScale));
                prevCv.getContext('2d').drawImage(this.coverTex.image, 0, 0, prevCv.width, prevCv.height);
                this.prevCoverTex.image = prevCv;
                this.prevCoverTex.needsUpdate = true;
            } catch (err) { /* 上一张封面不可用就跳过渐变 */ }
        }
        this.coverTex.image = cv;
        this.coverTex.needsUpdate = true;
        this.uniforms.uHasCover.value = 1;
        this.startColorMixTween(Number(this.fx.preset) === 0 ? 520 : 960);
        // 新封面已经上纹理: 收掉雾态, 让粒子聚回封面形态。
        this.hideLoading();

        const runHeavy = () => {
            if (token !== this.coverProcessToken) return;
            const edgeCv = buildEdgeAndDepth(cv);
            if (token !== this.coverProcessToken) return;
            this.coverCache = { seed: '', edgeCanvas: edgeCv };
            this.coverEdgeTex.image = edgeCv;
            this.coverEdgeTex.needsUpdate = true;
            this.setCoverDepthState(1, 0.55, 180);
        };
        window.setTimeout(runHeavy, 120);
    }

    setCoverDepthState(depthTo, aiTo, durationMs) {
        const from = this.uniforms.uHasDepth.value || 0;
        const aiFrom = this.uniforms.uAiBoost.value || 0;
        if (!durationMs) {
            this.uniforms.uHasDepth.value = depthTo;
            this.uniforms.uAiBoost.value = aiTo;
            return;
        }
        const start = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - start) / durationMs);
            const eased = 1 - Math.pow(1 - t, 3);
            this.uniforms.uHasDepth.value = from + (depthTo - from) * eased;
            this.uniforms.uAiBoost.value = aiFrom + (aiTo - aiFrom) * eased;
            if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    startColorMixTween(durationMs) {
        this.uniforms.uColorMixT.value = 0;
        const start = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - start) / durationMs);
            this.uniforms.uColorMixT.value = 1 - Math.pow(1 - t, 3);
            if (t < 1) this.colorMixTween = requestAnimationFrame(step);
            else this.colorMixTween = null;
        };
        this.colorMixTween = requestAnimationFrame(step);
    }

    // ---------------------------------------------------------------- 涟漪

    triggerRipple(x, y, strength) {
        const r = this.ripples[this.rippleIdx];
        r.x = x;
        r.y = y;
        r.age = 0;
        r.str = strength;
        this.rippleIdx = (this.rippleIdx + 1) % RIPPLE_MAX;
    }

    updateRipples(dt, bass) {
        const BASS_THRESHOLD = 0.3;
        const RIPPLE_COOLDOWN = 0.32;
        const isBassHit = bass > BASS_THRESHOLD && !this.lastBassRising;
        this.lastBassRising = bass > BASS_THRESHOLD * 0.75;
        const now = this.uniforms.uTime.value;
        const hadActive = this.rippleActiveCount > 0;
        if (!hadActive && !isBassHit) {
            if (this.uniforms.uRippleCount.value !== 0) this.uniforms.uRippleCount.value = 0;
            return;
        }
        if (isBassHit && (now - this.lastRippleAt) > RIPPLE_COOLDOWN) {
            this.lastRippleAt = now;
            const count = 2 + (Math.random() < 0.5 ? 0 : 1);
            const used = {};
            for (let k = 0; k < count; k += 1) {
                let idx = 0;
                let tries = 0;
                do { idx = Math.floor(Math.random() * 9); tries += 1; } while (used[idx] && tries < 12);
                used[idx] = true;
                const reg = this.regions[idx];
                this.triggerRipple(
                    reg.x + (Math.random() - 0.5) * 0.7,
                    reg.y + (Math.random() - 0.5) * 0.7,
                    0.65 + bass * 1.4 + Math.random() * 0.25
                );
            }
        }
        for (let i = 0; i < RIPPLE_MAX; i += 1) {
            const r = this.ripples[i];
            if (r.str > 0.005) {
                r.age += dt;
                if (r.age > 2.0) { r.str = 0; r.age = -10; }
            }
            const off = i * 4;
            this.rippleData[off] = r.x;
            this.rippleData[off + 1] = r.y;
            this.rippleData[off + 2] = r.age;
            this.rippleData[off + 3] = r.str;
        }
        let active = 0;
        for (let i = 0; i < RIPPLE_MAX; i += 1) if (this.ripples[i].str > 0.005) active += 1;
        this.rippleActiveCount = active;
        if (active || hadActive || isBassHit) this.rippleTex.needsUpdate = true;
        this.uniforms.uRippleCount.value = active;
    }

    // ---------------------------------------------------------------- 安魂

    loadSkullAsset() {
        if (this.skullAsset.data || this.skullAsset.promise || this.skullAsset.failed) {
            return this.skullAsset.promise || Promise.resolve(this.skullAsset.data);
        }
        const base = (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_BASE_PATH) || '';
        this.skullAsset.promise = fetch(`${base}/assets/skull-decimation-points.bin?v=regular-surface-teeth-soften-20260621`, { cache: 'reload' })
            .then((res) => {
                if (!res.ok) throw new Error('skull asset ' + res.status);
                return res.arrayBuffer();
            })
            .then((buf) => {
                if (!buf || buf.byteLength < 20 || buf.byteLength % 20 !== 0) throw new Error('invalid skull asset');
                this.skullAsset.data = new Float32Array(buf);
                this.skullAsset.promise = null;
                return this.skullAsset.data;
            })
            .catch(() => {
                this.skullAsset.failed = true;
                this.skullAsset.promise = null;
                return null;
            });
        return this.skullAsset.promise;
    }

    ensureSkullLayer() {
        if (this.skullGroup) return;
        if (!this.skullAsset.data) {
            if (!this.skullAsset.failed) this.loadSkullAsset();
            return;
        }
        const THREE = this.THREE;
        const asset = this.skullAsset.data;
        const count = Math.floor((asset.length || 0) / 5);
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const seeds = new Float32Array(count);
        const kinds = new Float32Array(count);
        for (let i = 0; i < count; i += 1) {
            positions[i * 3] = asset[i * 5];
            positions[i * 3 + 1] = asset[i * 5 + 1];
            positions[i * 3 + 2] = asset[i * 5 + 2];
            kinds[i] = asset[i * 5 + 3];
            seeds[i] = asset[i * 5 + 4];
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
        geo.setAttribute('kind', new THREE.BufferAttribute(kinds, 1));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uMap: { value: this.dotTexture },
                uTime: this.uniforms.uTime,
                uPixel: this.uniforms.uPixel,
                uBass: this.uniforms.uBass,
                uMid: this.uniforms.uMid,
                uTreble: this.uniforms.uTreble,
                uBeat: this.uniforms.uBeat,
                uJawOpen: { value: 0 },
                uSkullFlash: { value: 0 },
                uPointScale: this.uniforms.uPointScale,
                uBloomStrength: this.uniforms.uBloomStrength,
                uColorBoost: this.uniforms.uColorBoost,
                uOpacity: { value: 0 },
                uColorA: { value: new THREE.Color('#b8ae98') },
                uColorB: { value: new THREE.Color('#fff4d8') },
                uShadow: { value: new THREE.Color('#100d0d') },
                uLight: { value: new THREE.Color('#ffe3a0') },
            },
            vertexShader: SKULL_VERTEX_SHADER,
            fragmentShader: SKULL_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.NormalBlending,
        });
        this.skullGroup = new THREE.Points(geo, mat);
        this.skullGroup.frustumCulled = false;
        this.skullGroup.visible = false;
        this.skullGroup.position.set(SKULL_MODEL_BASE_POSITION.x, SKULL_MODEL_BASE_POSITION.y, SKULL_MODEL_BASE_POSITION.z);
        this.skullGroup.scale.setScalar(SKULL_MODEL_SCALE);
        this.skullGroup.rotation.x = SKULL_MODEL_BASE_ROTATION_X;
        this.skullGroup.rotation.y = SKULL_MODEL_BASE_ROTATION_Y;
        this.skullGroup.renderOrder = 32;
        this.scene.add(this.skullGroup);
        this.syncSkullColors();
    }

    clearSkullResidue() {
        this.skullOpacity = 0;
        this.skullFlash = 0;
        this.skullJaw = 0;
        this.skullAmpPulse = 0;
        this.skullCameraBlend = 0;
        if (!this.skullGroup) return;
        this.skullGroup.visible = false;
        const u = this.skullGroup.material.uniforms;
        u.uOpacity.value = 0;
        u.uJawOpen.value = 0;
        u.uSkullFlash.value = 0;
    }

    syncSkullColors() {
        if (!this.skullGroup || !this.skullGroup.material) return;
        const THREE = this.THREE;
        const u = this.skullGroup.material.uniforms;
        const custom = this.fx.visualTintMode === 'custom';
        const color = normalizeHexColor(
            custom
                ? this.fx.visualTintColor
                : (this.palette && (this.palette.secondary || this.palette.primary)) || this.fx.visualTintColor,
            '#9db8cf'
        );
        const strength = clampRange(custom ? 0.98 : (this.palette && (this.palette.secondary || this.palette.primary) ? 0.3 : 0.14), 0, custom ? 0.99 : 0.78);
        const tint = new THREE.Color(color);
        const soft = tint.clone().lerp(new THREE.Color('#e8f5ff'), custom ? 0.05 : 0.28);
        const bright = tint.clone().lerp(new THREE.Color(custom ? '#f6fbff' : '#fff7d6'), custom ? 0.14 : 0.46);
        const dark = tint.clone().lerp(new THREE.Color('#05070c'), custom ? 0.74 : 0.72);
        u.uColorA.value.copy(
            new THREE.Color(custom ? '#9fb7c8' : '#b8ae98').lerp(soft, strength * (custom ? 0.99 : 0.64))
        );
        u.uColorB.value.copy(
            new THREE.Color(custom ? '#eef9ff' : '#fff4d8').lerp(bright, strength * (custom ? 0.94 : 0.46))
        );
        u.uShadow.value.copy(
            new THREE.Color(custom ? '#070b12' : '#100d0d').lerp(dark, strength * (custom ? 0.72 : 0.42))
        );
        u.uLight.value.copy(
            new THREE.Color(custom ? '#d6f3ff' : '#ffe3a0').lerp(bright, strength * (custom ? 0.98 : 0.76))
        );
    }

    updateSkull(dt, bass, mid) {
        const active = Number(this.fx.preset) === SKULL_PRESET_INDEX;
        if (active && !this.skullAsset.data && !this.skullAsset.failed) {
            this.loadSkullAsset();
            return;
        }
        if (active && !this.skullAsset.data) return;
        if (active) this.ensureSkullLayer();
        if (!this.skullGroup) return;
        const target = active ? 1 : 0;
        this.skullOpacity += (target - this.skullOpacity) * Math.min(1, dt * (active ? 3.2 : 2.4));
        if (this.skullOpacity < 0.006 && !active) {
            this.skullGroup.visible = false;
            return;
        }
        this.skullGroup.visible = true;
        const u = this.skullGroup.material.uniforms;
        u.uOpacity.value = this.skullOpacity * clampRange(0.78 + (Number(this.fx.intensity) || 0.85) * 0.18, 0.56, 1.0);

        const beatTransient = clampRange(Math.max(0, this.beatPulse - 0.16) / 0.84, 0, 1.35);
        const flashTarget = clampRange(
            Math.pow(beatTransient, 1.34) * 1.08 + Math.max(0, bass - 0.6) * 0.18 * beatTransient, 0, 1
        );
        this.skullFlash += (flashTarget - this.skullFlash) * Math.min(1, dt * (flashTarget > this.skullFlash ? 24 : 6.2));
        u.uSkullFlash.value = this.skullFlash;

        const jawTarget = clampRange(
            0.6 + (0.5 + 0.5 * Math.sin(this.uniforms.uTime.value * 0.5)) * 0.05 + bass * 0.06 + this.skullFlash * 0.09,
            0.52, 0.88
        );
        this.skullJaw += (jawTarget - this.skullJaw) * Math.min(1, dt * (jawTarget > this.skullJaw ? 7.8 : 3.4));
        u.uJawOpen.value = this.skullJaw;

        const drift = {
            x: Math.sin(this.uniforms.uTime.value * 0.33 + 1.7) * 0.028 + Math.sin(this.uniforms.uTime.value * 0.61 + 0.4) * 0.010,
            y: Math.sin(this.uniforms.uTime.value * 0.38 + 0.2) * 0.036 + Math.sin(this.uniforms.uTime.value * 0.83 + 2.1) * 0.012,
            z: Math.sin(this.uniforms.uTime.value * 0.24 + 2.6) * 0.026,
        };
        const ampTarget = clampRange(bass * 0.006 + mid * 0.004 + this.skullFlash * 0.07, 0, 0.09);
        this.skullAmpPulse += (ampTarget - this.skullAmpPulse) * Math.min(1, dt * (ampTarget > this.skullAmpPulse ? 11 : 4));
        this.skullWheelZoom += (this.skullWheelZoomTarget - this.skullWheelZoom) * Math.min(1, dt * 8);
        const targetScale = SKULL_MODEL_SCALE * (1 + this.skullAmpPulse)
            * clampRange(1 - this.skullWheelZoom * 0.055, 0.92, 1.08);
        this.skullGroup.position.x += (SKULL_MODEL_BASE_POSITION.x + drift.x - this.skullGroup.position.x) * Math.min(1, dt * 4.2);
        this.skullGroup.position.y += (SKULL_MODEL_BASE_POSITION.y + drift.y - this.skullGroup.position.y) * Math.min(1, dt * 4.8);
        this.skullGroup.position.z += (SKULL_MODEL_BASE_POSITION.z + drift.z - this.skullGroup.position.z) * Math.min(1, dt * 4.2);
        this.skullGroup.scale.x += (targetScale - this.skullGroup.scale.x) * Math.min(1, dt * 4.6);
        this.skullGroup.scale.y = this.skullGroup.scale.x;
        this.skullGroup.scale.z = this.skullGroup.scale.x;

        // 安魂预设自带固定机位 (与上游 setSkullCameraTargetVectors 一致)
        this.skullCameraBlend += ((active ? 1 : 0) - this.skullCameraBlend) * Math.min(1, dt * (active ? 4.8 : 7.2));
        if (this.skullCameraBlend > 0.002) {
            const portrait = window.innerHeight > window.innerWidth * 1.08;
            this.camera.position.lerp(
                new this.THREE.Vector3(0, portrait ? -2.38 : -2.52, (portrait ? 4.92 : 4.98) + this.skullWheelZoom),
                this.skullCameraBlend
            );
            this.camera.lookAt(0, portrait ? -0.28 : -0.2, 0.02);
        }
    }

    // ---------------------------------------------------------------- 音频

    stepAudio(dt, raw, playing) {
        const step = Math.max(1, dt * 60);
        const intensity = Number(this.fx.intensity) || 0.85;
        if (playing) {
            this.smoothBass = env(this.smoothBass, Math.min(0.82, raw.low * 0.78 + raw.level * 0.025), 0.28, 0.075, step);
            this.smoothMid = env(this.smoothMid, Math.min(0.68, raw.mid * 0.64 + raw.level * 0.025), 0.18, 0.06, step);
            this.smoothTreb = env(this.smoothTreb, Math.min(0.56, raw.high * 0.54), 0.18, 0.055, step);
            this.smoothEnergy = env(this.smoothEnergy, Math.min(0.72, raw.level), 0.16, 0.055, step);
            this.bassOnset = Math.max(0, this.smoothBass - this.lastSmoothBass || 0);
            this.lastSmoothBass = this.smoothBass;
            this.beatPulse *= Math.pow(0.36, dt);
            if (raw.beat) this.beatPulse = Math.max(this.beatPulse, clampRange(raw.beatAmp || 0.8, 0, 1.25));
            this.beatPulse = Math.max(this.beatPulse, Math.min(0.12, this.bassOnset * 0.18));
        } else {
            this.smoothBass *= Math.pow(0.91, step);
            this.smoothMid *= Math.pow(0.91, step);
            this.smoothTreb *= Math.pow(0.91, step);
            this.smoothEnergy *= Math.pow(0.91, step);
            this.beatPulse *= Math.pow(0.82, step);
        }
        this.audioEnergy = Math.max(this.smoothEnergy, this.beatPulse * 0.3);

        let bass = Math.min(0.9, this.smoothBass * 1.05 + this.beatPulse * 0.18) * intensity;
        let mid = Math.min(0.72, this.smoothMid * 1.12) * intensity;
        let treble = Math.min(0.62, this.smoothTreb * 1.2) * intensity;
        const preset = Number(this.fx.preset) || 0;
        if (preset >= 4) {
            const wallpaperAudio = preset === 5;
            const authored = preset >= 9 && preset <= 12;
            const ringBassGain = wallpaperAudio ? 1.1 : (authored ? 1.32 : 1.58);
            const ringMidGain = wallpaperAudio ? 1.16 : (authored ? 1.48 : 1.82);
            const ringTrebleGain = wallpaperAudio ? 1.34 : (authored ? 1.72 : 2.28);
            const ringBeatGain = wallpaperAudio ? 0.18 : (authored ? 0.31 : 0.42);
            const ringBass = this.smoothBass * ringBassGain + this.beatPulse * ringBeatGain
                - this.smoothMid * 0.16 - this.smoothTreb * 0.06;
            const ringMid = this.smoothMid * ringMidGain - this.smoothBass * 0.14 - this.smoothTreb * 0.07;
            const ringTreble = this.smoothTreb * ringTrebleGain - this.smoothMid * 0.1 - this.smoothBass * 0.05;
            bass = Math.pow(clamp01((ringBass - 0.05) / 0.58), 0.72) * intensity;
            mid = Math.pow(clamp01((ringMid - 0.045) / 0.46), 0.78) * intensity;
            treble = Math.pow(clamp01((ringTreble - 0.03) / 0.34), 0.84) * intensity;
            if (wallpaperAudio) {
                bass = Math.min(bass, 0.46 * intensity);
                mid = Math.min(mid, 0.4 * intensity);
                treble = Math.min(treble, 0.36 * intensity);
                this.beatPulse *= 0.34;
            } else if (authored) {
                bass = Math.min(bass, 0.72 * intensity);
                mid = Math.min(mid, 0.62 * intensity);
                treble = Math.min(treble, 0.58 * intensity);
                this.beatPulse *= 0.72;
            }
        }
        return { bass, mid, treble, beat: this.beatPulse };
    }

    // ---------------------------------------------------------------- 主循环

    loop(now) {
        if (this.disposed) return;
        this.raf = requestAnimationFrame(this.loop);
        const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000));
        this.lastFrame = now;

        const mode = String(this.fx.foregroundFpsMode || 'vsync');
        if (mode !== 'vsync' && mode !== 'adaptive') {
            const target = Number(mode) || 60;
            if (now - (this.lastDrawAt || 0) < 1000 / target - 0.5) return;
        }
        this.lastDrawAt = now;

        const audio = (this.options.readAudio && this.options.readAudio()) || { low: 0, mid: 0, high: 0, level: 0, beat: false, beatAmp: 0, playing: false };
        const bands = this.stepAudio(dt, audio, !!audio.playing);

        // 把这一帧的分析结果交给歌词系统的共享运行时。上游在 11-main-loop.js
        // 里写的是同一批全局变量 (audio.currentTime / bass / beatPulse ...)。
        const playback = (this.options.readPlayback && this.options.readPlayback()) || null;
        setAudioFrame({
            currentTime: playback ? playback.currentTime : 0,
            duration: playback ? playback.duration : 0,
            paused: playback ? !playback.playing : true,
            ended: false,
            src: playback ? playback.src : '',
            playing: !!audio.playing,
            bass: bands.bass,
            mid: bands.mid,
            high: bands.treble,
            beatPulse: bands.beat,
            camPunch: this.camPunch,
            radiusKick: this.beatCam.radiusKick,
            thetaKick: this.beatCam.thetaKick,
            phiKick: this.beatCam.phiKick,
            rollKick: this.beatCam.rollKick,
        });
        setLyricSunEnergy(bands.bass * 0.7 + bands.treble * 0.3);

        this.cinemaT += dt * 60;
        this.camPunch *= 0.9;
        this.beatCam.thetaKick *= 0.86;
        this.beatCam.phiKick *= 0.86;
        this.beatCam.radiusKick *= 0.86;
        this.beatCam.rollKick *= 0.86;
        if (audio.beat) {
            const kick = clampRange((audio.beatAmp || 0.8) * 0.02, 0, 0.06);
            this.beatCam.thetaKick += (Math.random() - 0.5) * kick;
            this.beatCam.phiKick += (Math.random() - 0.5) * kick * 0.7;
            this.beatCam.radiusKick += kick * 2.2;
            this.beatCam.rollKick += (Math.random() - 0.5) * kick * 0.5;
        }

        const speedMul = isFinite(Number(this.fx.speed)) ? Math.max(0.05, Number(this.fx.speed)) : 1;
        this.uniforms.uTime.value += dt * speedMul;
        // 唱片预设的转角与播放栏唱盘共用同一个角度源 (见 vinylSpin.js):
        // 匀速一圈 14 秒, 不在播放时原地停住。以前这里还叠了一层低频加速,
        // 但那样就和播放栏那个匀速唱盘对不上了。
        this.uniforms.uVinylSpin.value = advanceVinyl(dt, !!audio.playing);
        this.uniforms.uBass.value = bands.bass;
        this.uniforms.uMid.value = bands.mid;
        this.uniforms.uTreble.value = bands.treble;
        this.uniforms.uBeat.value = bands.beat;
        this.uniforms.uEnergy.value = this.audioEnergy;
        this.uniforms.uBurstAmt.value *= 0.9;

        const alphaTarget = this.uniforms.uHasCover.value > 0.5 ? 1 : 0.85;
        this.uniforms.uAlpha.value += (alphaTarget - this.uniforms.uAlpha.value) * Math.min(1, dt * 2.4);

        this.tickPresetTransition();
        this.tickPointerFollow(dt, now);
        this.updatePointerFrame();
        this.tickLoading(dt);
        this.updateRipples(dt, bands.bass);
        this.updateSkull(dt, bands.bass, bands.mid);
        this.applyCamera(dt);
        this.updateStarRiver(dt);

        // 官方歌词: 先按播放时间决定该显示哪一行 (tick), 再跑这一帧的
        // 进出场/呼吸/glitch 动画 (update)。顺序与上游 main-loop 一致。
        if (this.fx.particleLyrics !== false) {
            tickLyricsParticles();
            updateStageLyrics3D(dt);
            updateLyricStarRiver(dt);
            this.tickLyricSyncFallback(dt);
        }

        this.renderer.render(this.scene, this.camera);
    }

    /**
     * 同步构建兜底。
     *
     * 上游歌词靠「预热 → 协作构建 → 就绪换装」的让位式状态机出字, 它默认
     * 渲染循环由桌面客户端驱动、预热定时器不会被 playback tick 抢占。本项目
     * 的 tick 在 rAF 里跑, 空闲让位状态机有概率一直等不到执行窗口 (表现为
     * 有词但不出字)。这里做保险: 歌词就绪、正在播放、1.5s 仍无当前行 mesh
     * 时, 直接同步构建并上屏 —— 走的是上游自带的同步路径, 不改它的状态机。
     */
    tickLyricSyncFallback(dt) {
        const st = lyricState;
        const hasLines = Array.isArray(lyricRuntime.lyricsLines) && lyricRuntime.lyricsLines.length > 0;
        const busy = Boolean(st.current) || (Array.isArray(st.outgoing) && st.outgoing.length > 0);
        if (!hasLines || !lyricRuntime.playing || busy) {
            this.lyricVoidMs = 0;
            return;
        }
        this.lyricVoidMs = (this.lyricVoidMs || 0) + dt;
        if (this.lyricVoidMs < 1.5) return;
        this.lyricVoidMs = 0;
        try {
            const t = lyricRuntime.audio && isFinite(lyricRuntime.audio.currentTime)
                ? Math.max(0, Number(lyricRuntime.audio.currentTime))
                : 0;
            const idx = findStageLyricIndexAtTime(t);
            if (idx < 0) return;
            const payload = buildStageLyricPlaybackPayload(idx);
            if (payload) showStageLine(payload, true);
        } catch (e) {
            /* 兜底失败不致命, 下个周期重试 */
        }
    }

    updateStarRiver(dt) {
        if (!this.starRiverUniforms) return;
        let target = 0.34;
        const preset = Number(this.fx.preset) || 0;
        if (this.fx.backgroundStarRiver === false) target = 0;
        else if (preset === 5) target = 0;
        else if (preset === SKULL_PRESET_INDEX) target = 0.38;
        else if (preset === 9) target = 0.12;
        else if (preset === 10) target = 0.18;
        else if (preset === 11) target = 0.1;
        else if (preset === 12) target = 0.16;
        const current = this.starRiverUniforms.uAlpha.value;
        const ease = target > current ? 0.085 : 0.16;
        this.starRiverUniforms.uAlpha.value = current + (target - current) * Math.min(1, ease * Math.max(1, dt * 60));
        this.starRiver.visible = this.starRiverUniforms.uAlpha.value > 0.006;
    }

    // ---------------------------------------------------------------- 生命周期

    onWindowResize = () => this.resize();

    resize() {
        if (this.disposed) return;
        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;
        if (!width || !height) return;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
    }

    dispose() {
        this.disposed = true;
        if (this.raf) cancelAnimationFrame(this.raf);
        if (this.colorMixTween) cancelAnimationFrame(this.colorMixTween);
        window.removeEventListener('resize', this.onWindowResize);
        if (this.resizeObserver) this.resizeObserver.disconnect();
        window.removeEventListener('mousemove', this.onPointerTrack);
        document.removeEventListener('mouseleave', this.onPointerLeave);
        if (this.loadingHideTimer) {
            window.clearTimeout(this.loadingHideTimer);
            this.loadingHideTimer = 0;
        }
        this.canvas.removeEventListener('wheel', this.onWheel);
        this.canvas.removeEventListener('dblclick', this.onDblClick);
        // 歌词层的纹理/几何不在 scene.traverse 的常规回收里 (有大量自建
        // canvas 纹理与协作构建队列), 走上游自己的释放入口。
        try {
            clearStageLyrics();
            disposeLyricsParticles();
        } catch (err) {
            /* 释放失败不影响卸载 */
        }
        this.scene.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        });
        this.dotTexture.dispose();
        this.rippleTex.dispose();
        this.renderer.dispose();
        if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    }
}
