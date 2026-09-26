/**
 * 歌词 mesh 组装 —— 把「一句话」变成场景里的一个 Group。
 *
 * 移植自上游 Mineradio public/js/modules/02-visual/13-lyrics-mesh-build.js
 * (491 行, 全文件原样搬入), 上游许可证 GNU GPL v3 (用户已授权原样复制)。
 *
 * 为什么是原样搬运: 这里的 worldW = 6.10、group 的 init 位置
 * (singleLineStartX, 0.20, 1.46 - |enterDir| * 0.055)、group.scale 0.96、
 * 日面 position (0, 0.02, -0.030) 与 scale (0.78, 0.58)、光晕 scale
 * (1.0, 1.06)、火花数量 132 与环形散布系数 (0.78 + pow(random, 1.45) * 0.58)、
 * 点精灵 gl_PointSize 里的 120.0 倍率、入场位移 lineWorldStep 的夹取区间
 * (0.20 ~ 0.94 / 0.20 ~ 0.78)、以及整体不透明度上限 0.72, 全是调过的取景与
 * 观感参数 —— 任何「顺手优化」都会改变最终画面, 因此逐行保留。
 *
 * 另外这里所有材质的 depthWrite / depthTest 都是关闭的, **绘制顺序完全由
 * renderOrder 决定**: group 42 / sun 40 / glow 41 / textMesh 43.4 /
 * sparks 44。这几个数值必须保持原样, 否则叠加关系会立刻错乱。
 *
 * 相对上游的改动仅限:
 *   - 顶层 function 改为 ESM export (`function xxx(` → `export function xxx(`),
 *     缩进统一为 4 空格;
 *   - `clampRange` 改用本仓库 visual/presetData.js 的实现;
 *   - 上游隐式全局改为显式 import: THREE / uniforms / fx / lyricsLines 来自
 *     runtime.js, stageLyrics 来自 02-state-layout.js, disposeLyricMesh 来自
 *     03-star-river.js, lyricLineHeightFactor 来自 05-fonts-texture.js,
 *     颜色助手与 motion profile / payload / mask / row-layer 等分别来自 07 ~
 *     14 号兄弟模块;
 *   - 上游 `typeof xxx === 'function'` 的跨脚本守卫在 ESM 下恒真, 保留调用形状
 *     但直接使用 import 进来的函数 (14-stage-rendering.js 的 persistent track
 *     一组函数仍按顺序守卫调用, 保持与上游一致的分帧行为);
 *   - 火花贴图 `dotTexture` 上游来自未纳入本次移植的
 *     00-pointer-cover-particles.js, 按 03-star-river.js 已有的写法在本文件
 *     惰性创建 (下游 makeLyricDotTexture()), 避免 import 期访问尚未注入的 THREE;
 *   - window.__mineradioLyricBuildStats* 调试导出、书架 (shelf) 分支与依赖
 *     runtimeHardwareProfile 的显存预算分支: 本文件上游本就没有。
 */

import { clampRange } from '../presetData.js';
import { THREE, fx, lyricsLines, uniforms } from './runtime.js';
import { stageLyrics } from './02-state-layout.js';
import { disposeLyricMesh } from './03-star-river.js';
import { lyricLineHeightFactor } from './05-fonts-texture.js';
import { lyricBeatGlowThreeColor, lyricStageGlowThreeColor } from './07-palette-utils.js';
import {
    lyricDisplayLineCountForMode,
    lyricMotionProfile,
    lyricPrimaryVirtualIndex,
    normalizeLyricDisplayMode,
} from './08-display-modes.js';
import {
    activeStageLyricPayload,
    normalizeStageLyricPayload,
    rowBaseStageLyricPayload,
} from './09-payloads.js';
import {
    beginLyricMaskLayoutMetricsBuild,
    finishLyricMaskLayoutMetricsBuild,
    makeLyricGlowTexture,
    makeLyricMask,
    stepLyricMaskLayoutMetricsBuild,
} from './10-mask-textures.js';
import { getLyricSunBloomTexture, makeLyricShaderMaterial } from './11-lyrics-shaders.js';
import {
    beginLyricRowLayerGroupBuild,
    finishLyricRowLayerGroupBuild,
    makeLyricRowLayerGroup,
    setLyricTextureMaterialOpacity,
    stepLyricRowLayerGroupBuild,
} from './12-row-layers.js';
import {
    ensureStageLyricPersistentTrackRows,
    scheduleStageLyricFullTrackWarmup,
    scheduleStageLyricPrewarmForIndex,
    stageLyricPersistentTargetRowsReady,
    trimStageLyricPersistentTrackRows,
} from './14-stage-rendering.js';

// 火花点精灵用的圆形贴图。上游由 00-pointer-cover-particles.js 在加载期创建,
// 这里沿用 03-star-river.js 的做法改成惰性: THREE 是脚本按需注入的运行时值,
// import 期还不能碰。
var dotTexture = null;
var makeLyricDotTexture = function () {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    var ctx = cv.getContext('2d');
    var g = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
    g.addColorStop(0.00, 'rgba(255,255,255,0.96)');
    g.addColorStop(0.42, 'rgba(255,255,255,0.78)');
    g.addColorStop(0.72, 'rgba(255,255,255,0.22)');
    g.addColorStop(1.00, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    var tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
};

export function primeLyricMeshOpacity(mesh, amount) {
    if (!mesh || !mesh.userData || !mesh.userData.lyric) return;
    var data = mesh.userData.lyric;
    amount = clampRange(Number(amount) || 0, 0, 0.72);
    data.globalOpacity = amount;
    if (data.textMat && data.textMat.uniforms && data.textMat.uniforms.uOpacity) data.textMat.uniforms.uOpacity.value = amount;
    if (data.rowLayers) {
        data.rowLayers.forEach(function (row) {
            var rowAmount = amount * (row.isActive ? 1 : row.targetAlpha * 0.62);
            if (row.mat && row.mat.uniforms && row.mat.uniforms.uOpacity) row.mat.uniforms.uOpacity.value = rowAmount;
            else if (!row.isActive && row.mat) row.mat.opacity = rowAmount;
            if (row.readabilityMat) {
                if (typeof setLyricTextureMaterialOpacity === 'function') setLyricTextureMaterialOpacity(row.readabilityMat, amount * row.targetAlpha * 0.38);
                else row.readabilityMat.opacity = amount * row.targetAlpha * 0.38;
            }
        });
    }
}

export function stableStageLyricRowMaskLayout() {
    var fontSize = 128;
    var lineHeightFactor = typeof lyricLineHeightFactor === 'function' ? lyricLineHeightFactor() : 1.08;
    return { fontSize: fontSize, lineHeight: fontSize * lineHeightFactor };
}

export function lyricRowLayerBundleActiveMask(bundle) {
    var rows = bundle && Array.isArray(bundle.rows) ? bundle.rows : [];
    for (var i = 0; i < rows.length; i++) {
        if (rows[i] && rows[i].isActive && rows[i].lineMask) return rows[i].lineMask;
    }
    return null;
}

export function buildLyricMesh(input, preparedRowLayerBundle, preparedMasks) {
    var payload = normalizeStageLyricPayload(input);
    if (!payload) payload = normalizeStageLyricPayload('');
    var text = payload ? payload.combinedText : '';
    preparedMasks = preparedMasks || {};
    var mask = preparedMasks.mask || makeLyricMask(payload || text);
    var maskLayout = { fontSize: mask.fontSize, lineHeight: mask.lineHeight };
    var rowBaseLayout = stableStageLyricRowMaskLayout();
    var activePayload = activeStageLyricPayload(payload || text);
    var activeMask = preparedMasks.activeMask || lyricRowLayerBundleActiveMask(preparedRowLayerBundle) || makeLyricMask(activePayload || payload || text, maskLayout);
    var rowBasePayload = rowBaseStageLyricPayload(payload || text);
    var rowBaseMask = preparedMasks.rowBaseMask || makeLyricMask(rowBasePayload || activePayload || payload || text, rowBaseLayout);
    var contextMask = null;
    var pal = stageLyrics.palette;
    var worldW = 6.10;
    var worldH = worldW * (mask.height / mask.width);
    var rowWorldH = worldW * (((rowBaseMask && rowBaseMask.height) || mask.height) / Math.max(1, (rowBaseMask && rowBaseMask.width) || mask.width));
    var textWorldW = worldW * ((activeMask.activeTextWidth || activeMask.textWidth) / activeMask.width);
    var textWorldH = worldH * ((activeMask.textHeight || activeMask.fontSize) / activeMask.height);
    var group = new THREE.Group();
    group.renderOrder = 42;
    var lineStep = clampRange(Number(stageLyrics.transitionLineStep) || 0, -2, 2);
    var singleLineSwap = payload && normalizeLyricDisplayMode(payload.mode) === 'single';
    var enterDir = singleLineSwap ? 0 : (lineStep > 0 ? -1 : (lineStep < 0 ? 1 : 0));
    var motionProfile = lyricMotionProfile();
    var singleLineStartX = singleLineSwap ? 0 : (Math.random() - 0.5) * 0.045;
    group.position.set(singleLineStartX, 0.20, 1.46 - Math.abs(enterDir) * 0.055);
    group.scale.setScalar(0.96);
    group.userData.age = 0;
    group.userData.state = 'in';
    group.userData.lastLyricProgress = -1;
    group.userData.targetLyricProgress = 0;
    group.userData.shownLyricProgress = 0;
    group.userData.enterDirection = enterDir;
    group.userData.exitDirection = 0;
    group.userData.motionStyle = motionProfile.style;
    group.userData.floatSeed = Math.random() * 100;
    group.userData.glitchSeed = Math.random() * 997;
    group.userData.glitchBurst = 0;
    group.userData.glitchHold = 0;
    group.userData.glitchNextAt = 0;
    group.userData.glitchLastBeatAt = -10;

    var context = null;
    var contextMat = null;
    var readability = null;
    var readabilityMat = null;
    var rowLayerBundle = preparedRowLayerBundle || makeLyricRowLayerGroup(payload || text, rowBaseMask || mask, worldW, rowWorldH || worldH, pal, motionProfile);
    disposeCooperativeLyricBuildMask(rowBaseMask);
    var rowLayerGroup = rowLayerBundle && rowLayerBundle.group;
    var textMat = rowLayerBundle && rowLayerBundle.activeMat;
    var textMesh = rowLayerBundle && rowLayerBundle.activeMesh;
    if (!textMat || !textMesh) {
        textMat = makeLyricShaderMaterial(activeMask, pal, motionProfile);
        textMesh = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldH, 1, 1), textMat);
        textMesh.renderOrder = 43.4;
        if (!rowLayerGroup) rowLayerGroup = new THREE.Group();
        rowLayerGroup.add(textMesh);
    }
    if (rowLayerBundle && rowLayerBundle.activeWorldH) {
        textWorldH = rowLayerBundle.activeWorldH;
    }
    if (rowLayerGroup) group.add(rowLayerGroup);
    var rowLayersActive = !!(rowLayerBundle && rowLayerBundle.rows && rowLayerBundle.rows.length);
    var sun = null;
    var sunMat = null;
    var glow = null;
    var glowMat = null;
    var glowMeta = { matchMask: false };
    if (!rowLayersActive) {
        sunMat = new THREE.MeshBasicMaterial({
            map: getLyricSunBloomTexture(),
            transparent: true,
            opacity: 0,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            color: lyricBeatGlowThreeColor(pal, '#ffe7a6', 0.50)
        });
        var sunWorldW = Math.max(textWorldW + worldH * 1.10, textWorldW * 1.18);
        sunWorldW = Math.min(worldW * 1.16, Math.max(worldH * 1.35, sunWorldW));
        var sunWorldH = Math.max(worldH * 1.02, Math.min(worldH * 1.54, worldH + textWorldW * 0.070));
        sun = new THREE.Mesh(new THREE.PlaneGeometry(sunWorldW, sunWorldH, 1, 1), sunMat);
        sun.renderOrder = 40;
        sun.position.set(0, 0.02, -0.030);
        sun.scale.set(0.78, 0.58, 1);
        group.add(sun);

        var glowTex = makeLyricGlowTexture(payload ? payload.text : text, activeMask.fontSize, activeMask.activeTextWidth || activeMask.textWidth, activeMask.lines, activeMask.lineHeight, activeMask.fitScaleX, activeMask.entries, activeMask.activeLine, null);
        glowMat = new THREE.MeshBasicMaterial({
            map: glowTex,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            color: lyricStageGlowThreeColor(pal, '#9cffdf', 0.36)
        });
        glowMeta = glowTex.userData || {};
        var glowWorldW = textWorldW * ((glowMeta.width || activeMask.width) / Math.max(1, glowMeta.textWidth || activeMask.activeTextWidth || activeMask.textWidth));
        if (!glowMeta.matchMask) glowWorldW = Math.min(worldW * 1.10, Math.max(textWorldW + worldH * 0.38, glowWorldW));
        var glowWorldH = worldH * ((glowMeta.height || activeMask.height) / activeMask.height);
        if (!glowMeta.matchMask) glowWorldH = Math.min(worldH * 1.42, Math.max(worldH * 0.92, glowWorldH));
        var glowGeo = new THREE.PlaneGeometry(glowWorldW, glowWorldH, 1, 1);
        glow = new THREE.Mesh(glowGeo, glowMat);
        glow.renderOrder = 41;
        glow.scale.set(1.0, 1.06, 1);
        group.add(glow);
    }

    var sparkCount = 132;
    var pgeo = new THREE.BufferGeometry();
    var ppos = new Float32Array(sparkCount * 3);
    var pseed = new Float32Array(sparkCount);
    for (var i = 0; i < sparkCount; i++) {
        var angle = Math.random() * Math.PI * 2;
        var ring = 0.78 + Math.pow(Math.random(), 1.45) * 0.58;
        var rx = textWorldW * (0.50 + Math.random() * 0.22) + 0.10;
        var ry = worldH * (0.42 + Math.random() * 0.22) + 0.08;
        ppos[i * 3] = Math.cos(angle) * rx * ring + (Math.random() - 0.5) * textWorldW * 0.12;
        ppos[i * 3 + 1] = Math.sin(angle) * ry * ring + (Math.random() - 0.5) * worldH * 0.14;
        ppos[i * 3 + 2] = (Math.random() - 0.5) * 0.24;
        pseed[i] = Math.random() * 1000;
    }
    pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
    pgeo.setAttribute('seed', new THREE.BufferAttribute(pseed, 1));
    if (!dotTexture) dotTexture = makeLyricDotTexture();
    var pmat = new THREE.ShaderMaterial({
        uniforms: {
            uMap: { value: dotTexture },
            uSize: { value: 0.052 },
            uOpacity: { value: 0 },
            uColor: { value: lyricBeatGlowThreeColor(pal, '#fff7d2', 0.30) },
            uPixel: uniforms.uPixel
        },
        vertexShader: [
            'attribute float seed;',
            'uniform float uSize;',
            'uniform float uPixel;',
            'varying float vSeed;',
            'void main(){',
            '  vSeed = seed;',
            '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
            '  float jitter = 0.58 + fract(sin(seed * 19.17) * 43758.5453) * 1.18;',
            '  float depth = clamp(2.2 / max(0.35, -mv.z), 0.54, 1.55);',
            '  gl_PointSize = uSize * jitter * depth * uPixel * 120.0;',
            '  gl_Position = projectionMatrix * mv;',
            '}'
        ].join('\n'),
        fragmentShader: [
            'precision highp float;',
            'uniform sampler2D uMap;',
            'uniform vec3 uColor;',
            'uniform float uOpacity;',
            'varying float vSeed;',
            'void main(){',
            '  vec4 tex = texture2D(uMap, gl_PointCoord);',
            '  float twinkle = 0.72 + fract(sin(vSeed * 7.31) * 91.7) * 0.28;',
            '  gl_FragColor = vec4(uColor * twinkle, tex.a * uOpacity);',
            '}'
        ].join('\n'),
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending
    });
    var sparks = new THREE.Points(pgeo, pmat);
    sparks.renderOrder = 44;
    sparks.visible = !!fx.lyricGlowParticles;
    group.add(sparks);

    var lineWorldStep = (rowLayerBundle && rowLayerBundle.lineStepWorld)
        ? rowLayerBundle.lineStepWorld
        : worldH * ((mask.lineHeight || mask.fontSize || 1) / Math.max(1, mask.height || 1));
    lineWorldStep = clampRange(lineWorldStep, 0.20, 0.94);
    var translationLineStepWorld = (rowLayerBundle && rowLayerBundle.translationLineStepWorld)
        ? rowLayerBundle.translationLineStepWorld
        : lineWorldStep;
    translationLineStepWorld = clampRange(translationLineStepWorld, 0.20, 0.78);
    if (!singleLineSwap) group.position.y += enterDir * lineWorldStep;
    group.userData.lyric = {
        mask: mask,
        activeMask: activeMask,
        contextMask: contextMask,
        textMesh: null,
        context: context,
        readability: readability,
        glow: glow,
        sparks: sparks,
        sun: sun,
        textMat: textMat,
        contextMat: contextMat,
        readabilityMat: readabilityMat,
        glowMat: glowMat,
        sparkMat: pmat,
        sunMat: sunMat,
        rowLayerGroup: rowLayerGroup,
        rowLayers: rowLayerBundle ? rowLayerBundle.rows : null,
        activeRowMesh: textMesh,
        contextGroup: rowLayerBundle ? rowLayerBundle.contextGroup : null,
        readabilityGroup: rowLayerBundle ? rowLayerBundle.readabilityGroup : null,
        usesTrack: !!(rowLayerBundle && rowLayerBundle.usesTrack),
        displayMode: rowLayerBundle ? rowLayerBundle.displayMode : (payload && payload.mode),
        trackKey: rowLayerBundle ? rowLayerBundle.trackKey : '',
        trackStart: rowLayerBundle ? rowLayerBundle.trackStart : null,
        trackEnd: rowLayerBundle ? rowLayerBundle.trackEnd : null,
        trackLightweight: !!(rowLayerBundle && rowLayerBundle.trackLightweight),
        trackTargetIndex: rowLayerBundle ? rowLayerBundle.trackTargetIndex : (payload && payload.trackIndex),
        trackTargetLineIndex: rowLayerBundle ? rowLayerBundle.trackTargetLineIndex : (payload && payload.trackIndex),
        trackTargetVirtualIndex: rowLayerBundle ? rowLayerBundle.trackTargetVirtualIndex : (payload && payload.trackIndex),
        trackVisibleRadius: rowLayerBundle ? rowLayerBundle.trackVisibleRadius : lyricDisplayLineCountForMode(payload && payload.mode) * 0.50,
        trackScrollOffset: rowLayerBundle ? rowLayerBundle.trackTargetIndex : (payload && payload.trackIndex),
        renderInitialTextReady: !(rowLayerBundle && rowLayerBundle.usesTrack),
        renderInitialTextReadyAt: 0,
        basePositions: ppos.slice ? ppos.slice(0) : new Float32Array(ppos),
        textWorldW: textWorldW,
        textWorldH: textWorldH,
        worldW: worldW,
        worldH: worldH,
        lineWorldStep: lineWorldStep,
        translationLineStepWorld: translationLineStepWorld,
        singleLineSwap: singleLineSwap,
        glowFrameLocked: !!(glowMeta && glowMeta.matchMask),
        suppressStaticGlow: rowLayersActive
    };
    group.userData.displayKey = payload ? payload.key : text;
    group.userData.payload = payload;
    updateLyricMeshProgress(group, 0);
    return group;
}

export function disposeCooperativeLyricBuildMask(mask) {
    if (!mask || !mask.texture) return;
    mask.texture.userData = mask.texture.userData || {};
    if (mask.texture.userData.__mineradioDisposed) return;
    mask.texture.userData.__mineradioDisposed = true;
    mask.texture.dispose();
}

export function beginCooperativeLyricMeshBuild(input) {
    var payload = normalizeStageLyricPayload(input);
    if (!payload) payload = normalizeStageLyricPayload('');
    var text = payload ? payload.combinedText : '';
    var usesTrack = !!(payload && payload.mode !== 'single' && Array.isArray(payload.trackEntries) && payload.trackEntries.length);
    var entries = usesTrack ? payload.trackEntries : ((payload && payload.entries) || []);
    var totalRows = entries.length;
    var layoutState = beginLyricMaskLayoutMetricsBuild(payload || text);
    var layoutPhaseCount = Number(layoutState && layoutState.totalPhases) || 1;
    return {
        payload: payload,
        text: text,
        activePayload: activeStageLyricPayload(payload || text),
        rowBasePayload: null,
        layoutState: layoutState,
        layoutPhaseCount: layoutPhaseCount,
        layoutMask: null,
        activeMask: null,
        rowBaseMask: null,
        rowState: null,
        initPhase: 0,
        totalRows: totalRows,
        totalPhases: layoutPhaseCount + 1 + totalRows * 3 + 1,
        completedPhases: 0,
        lastPhase: '',
        cancelled: false,
        finished: false
    };
}

export function stepCooperativeLyricMeshBuild(state, maxPhases, budgetMs) {
    if (!state || state.cancelled || state.finished) return true;
    if (state.initPhase === 0) {
        var layoutDone = stepLyricMaskLayoutMetricsBuild(state.layoutState, 1);
        state.completedPhases = Number(state.layoutState && state.layoutState.completedPhases) || state.completedPhases;
        state.lastPhase = 'layout-' + ((state.layoutState && state.layoutState.lastPhase) || 'entry');
        if (!layoutDone) return false;
        state.layoutMask = finishLyricMaskLayoutMetricsBuild(state.layoutState);
        state.layoutState = null;
        state.initPhase = 1;
        return false;
    }
    if (state.initPhase === 1) {
        var rowBaseLayout = stableStageLyricRowMaskLayout();
        state.rowBasePayload = rowBaseStageLyricPayload(state.payload || state.text);
        state.rowBaseMask = makeLyricMask(state.rowBasePayload || state.activePayload || state.payload || state.text, rowBaseLayout);
        var worldW = 6.10;
        var worldH = worldW * (state.layoutMask.height / state.layoutMask.width);
        var rowWorldH = worldW * (((state.rowBaseMask && state.rowBaseMask.height) || state.layoutMask.height) / Math.max(1, (state.rowBaseMask && state.rowBaseMask.width) || state.layoutMask.width));
        state.rowState = beginLyricRowLayerGroupBuild(state.payload || state.text, state.rowBaseMask || state.layoutMask, worldW, rowWorldH || worldH, stageLyrics.palette, lyricMotionProfile());
        state.totalPhases = state.layoutPhaseCount + 1 + (Number(state.rowState && state.rowState.totalPhases) || state.totalRows * 3) + 1;
        state.initPhase = 2;
        state.completedPhases += 1;
        state.lastPhase = 'row-base-mask';
        return !!(state.rowState && state.rowState.done);
    }
    if (!state.rowState) return true;
    var done = stepLyricRowLayerGroupBuild(state.rowState, maxPhases, budgetMs);
    state.completedPhases = state.layoutPhaseCount + 1 + (Number(state.rowState.completedPhases) || 0);
    state.lastPhase = state.rowState.lastPhase || 'row-phase';
    return done;
}

export function finishCooperativeLyricMeshBuild(state) {
    if (!state || state.cancelled || state.finished || !state.rowState || !state.rowState.done) return null;
    var rowLayerBundle = finishLyricRowLayerGroupBuild(state.rowState);
    var preparedMasks = {
        mask: state.layoutMask,
        activeMask: state.activeMask,
        rowBaseMask: state.rowBaseMask
    };
    try {
        var mesh = buildLyricMesh(state.payload, rowLayerBundle, preparedMasks);
        state.layoutMask = null;
        state.layoutState = null;
        state.activeMask = null;
        state.rowBaseMask = null;
        state.rowState = null;
        state.completedPhases = state.totalPhases;
        state.lastPhase = 'mesh-finalize';
        state.finished = true;
        return mesh;
    } catch (error) {
        if (rowLayerBundle && rowLayerBundle.group) disposeLyricMesh(rowLayerBundle.group);
        disposeCooperativeLyricBuildMask(state.layoutMask);
        disposeCooperativeLyricBuildMask(state.activeMask);
        disposeCooperativeLyricBuildMask(state.rowBaseMask);
        state.layoutMask = null;
        state.layoutState = null;
        state.activeMask = null;
        state.rowBaseMask = null;
        state.rowState = null;
        state.cancelled = true;
        throw error;
    }
}

export function cancelCooperativeLyricMeshBuild(state) {
    if (!state || state.cancelled || state.finished) return;
    state.cancelled = true;
    disposeCooperativeLyricBuildMask(state.layoutMask);
    disposeCooperativeLyricBuildMask(state.activeMask);
    disposeCooperativeLyricBuildMask(state.rowBaseMask);
    state.layoutMask = null;
    state.layoutState = null;
    state.activeMask = null;
    state.rowBaseMask = null;
    if (state.rowState && state.rowState.root) disposeLyricMesh(state.rowState.root);
    state.rowState = null;
}

export function scheduleLyricTrackBoundaryPrewarm(data, targetLineIndex) {
    if (!data) return;
    if (data.trackPersistent && typeof ensureStageLyricPersistentTrackRows === 'function') {
        ensureStageLyricPersistentTrackRows(stageLyrics && stageLyrics.current, targetLineIndex, { reason: 'persistent-track-ahead' });
        return;
    }
    if (typeof scheduleStageLyricPrewarmForIndex !== 'function') return;
    var start = Number(data.trackStart);
    var end = Number(data.trackEnd);
    if (!isFinite(start) || !isFinite(end)) return;
    var total = lyricsLines && lyricsLines.length ? lyricsLines.length : 0;
    if (!total) return;
    var windowSize = Math.max(1, end - start + 1);
    var margin = Math.max(4, Math.min(18, Math.ceil(windowSize * 0.18)));
    var pageAdvance = Math.max(1, Math.floor(windowSize * 0.50));
    var reasonNext = data.trackLightweight ? 'track-demand-light' : 'track-boundary-next';
    var reasonPrev = data.trackLightweight ? 'track-demand-light' : 'track-boundary-prev';
    if (targetLineIndex >= end - margin && end < total - 1) {
        scheduleStageLyricPrewarmForIndex(Math.min(total - 1, end + pageAdvance), reasonNext, 24);
    } else if (targetLineIndex <= start + margin && start > 0) {
        scheduleStageLyricPrewarmForIndex(Math.max(0, start - pageAdvance), reasonPrev, 24);
    }
    if (data.trackLightweight && typeof scheduleStageLyricFullTrackWarmup === 'function') {
        scheduleStageLyricFullTrackWarmup('lightweight-upgrade', 120);
    }
}

export function shouldSnapLyricTrackScroll(data, targetIndex, targetLineIndex, payload) {
    if (!data) return false;
    var currentOffset = Number(data.trackScrollOffset);
    if (!isFinite(currentOffset)) return true;
    var visibleRadius = Math.max(1.2, Number(data.trackVisibleRadius) || 3);
    var jump = Math.abs(targetIndex - currentOffset);
    if (!data.trackScrollPrimed) return true;
    var payloadWindowKey = lyricTrackScrollWindowKey(payload);
    if (payloadWindowKey && data.trackScrollWindowKey && data.trackScrollWindowKey !== payloadWindowKey) return true;
    if (jump > Math.max(2.75, visibleRadius * 1.55)) return true;
    var prevLine = Number(data.trackTargetLineIndex);
    if (isFinite(prevLine) && Math.abs(targetLineIndex - prevLine) > Math.max(6, visibleRadius * 2.7)) return true;
    return false;
}

export function lyricTrackScrollWindowKey(payload) {
    if (!payload || !payload.trackKey) return '';
    // The visual scroll identity is the song/style track, not the current
    // resident row window.  Resident rows may stream in and out without ever
    // snapping or replacing the root lyric track.
    return payload.trackKey;
}

export function snapLyricTrackScroll(data, targetIndex, payload) {
    if (!data || !isFinite(Number(targetIndex))) return;
    data.trackScrollOffset = Number(targetIndex);
    data.trackScrollPrimed = true;
    data.trackScrollWindowKey = lyricTrackScrollWindowKey(payload) || data.trackScrollWindowKey || '';
    data.trackScrollSnapUntil = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) + 120;
}

export function updateLyricMeshProgress(mesh, progress, opts) {
    if (!mesh || !mesh.userData || !mesh.userData.lyric) return;
    opts = opts || {};
    progress = Math.max(0, Math.min(1, progress || 0));
    var d = mesh.userData.lyric;
    if (d.trackPersistent && d.trackPendingPayload) {
        d.trackPendingProgress = { value: progress, nativeKaraoke: !!opts.nativeKaraoke };
        return;
    }
    mesh.userData.targetLyricProgress = progress;
    mesh.userData.nativeKaraokeProgress = !!opts.nativeKaraoke;
    if (d.textMat && d.textMat.uniforms && d.textMat.uniforms.uProgress && !isFinite(d.textMat.uniforms.uProgress.value)) {
        d.textMat.uniforms.uProgress.value = progress;
    }
    mesh.userData.lastLyricProgress = progress;
}

export function setLyricTrackTarget(mesh, payload) {
    if (!mesh || !mesh.userData || !mesh.userData.lyric || !payload) return false;
    var data = mesh.userData.lyric;
    if (!data.usesTrack || !data.rowLayers || !data.rowLayers.length) return false;
    if (!data.trackPersistent && !payload.trackLightweight && data.trackLightweight) return false;
    if (!payload.trackKey || data.trackKey !== payload.trackKey) return false;
    if (payload.trackIndex == null || !isFinite(Number(payload.trackIndex))) return false;
    var targetLineIndex = Number(payload.trackIndex);
    if (!data.trackPersistent && data.trackStart != null && isFinite(Number(data.trackStart)) && targetLineIndex < Number(data.trackStart)) return false;
    if (!data.trackPersistent && data.trackEnd != null && isFinite(Number(data.trackEnd)) && targetLineIndex > Number(data.trackEnd)) return false;
    var targetIndex = lyricPrimaryVirtualIndex(targetLineIndex);
    var snapTrackScroll = shouldSnapLyricTrackScroll(data, targetIndex, targetLineIndex, payload);
    // Once a whole-song track is primed, every target in that same coordinate
    // system stays continuous.  This also covers the short interval after the
    // pointer is released while a pending target finishes its material commit.
    if (
        data.trackPersistent && data.trackScrollPrimed && isFinite(Number(data.trackScrollOffset)) &&
        (!data.trackScrollWindowKey || data.trackScrollWindowKey === lyricTrackScrollWindowKey(payload))
    ) snapTrackScroll = false;
    var activeRow = null;
    for (var i = 0; i < data.rowLayers.length; i++) {
        var row = data.rowLayers[i];
        var rowLineIndex = (row && row.lineIndex != null && isFinite(Number(row.lineIndex))) ? Number(row.lineIndex) : null;
        if (row && row.isPrimary && (rowLineIndex != null ? rowLineIndex === targetLineIndex : Math.abs((Number(row.virtualIndex) || 0) - targetIndex) < 0.015)) {
            activeRow = row;
            break;
        }
    }
    var persistentTargetReady = !data.trackPersistent || (
        typeof stageLyricPersistentTargetRowsReady === 'function' &&
        stageLyricPersistentTargetRowsReady(mesh, targetLineIndex)
    );
    if (!activeRow || !activeRow.mat || !activeRow.mat.uniforms || !persistentTargetReady) {
        if (data.trackPersistent && typeof ensureStageLyricPersistentTrackRows === 'function') {
            var previousPending = data.trackPendingPayload;
            if (!previousPending || Number(previousPending.trackIndex) !== targetLineIndex || previousPending.key !== payload.key) {
                data.trackPendingProgress = null;
            }
            data.trackPendingPayload = payload;
            ensureStageLyricPersistentTrackRows(mesh, targetLineIndex, { reason: 'persistent-track-demand', urgent: true });
            return true;
        }
        return false;
    }
    var pendingProgress = data.trackPendingProgress;
    data.trackPendingPayload = null;
    data.trackPendingProgress = null;
    data.trackTargetIndex = targetIndex;
    data.trackTargetLineIndex = targetLineIndex;
    data.trackTargetVirtualIndex = targetIndex;
    data.trackTargetCommittedAt = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
    if (snapTrackScroll) snapLyricTrackScroll(data, targetIndex, payload);
    else {
        data.trackScrollPrimed = true;
        data.trackScrollWindowKey = lyricTrackScrollWindowKey(payload) || data.trackScrollWindowKey || '';
    }
    data.textMat = activeRow.mat;
    data.activeRowMesh = activeRow.mesh;
    mesh.userData.payload = payload;
    var committedProgress = pendingProgress ? Math.max(0, Math.min(1, Number(pendingProgress.value) || 0)) : 0;
    mesh.userData.targetLyricProgress = committedProgress;
    mesh.userData.shownLyricProgress = committedProgress;
    mesh.userData.nativeKaraokeProgress = !!(pendingProgress && pendingProgress.nativeKaraoke);
    mesh.userData.lastLyricProgress = committedProgress;
    if (data.textMat.uniforms.uProgress) data.textMat.uniforms.uProgress.value = committedProgress;
    scheduleLyricTrackBoundaryPrewarm(data, targetLineIndex);
    if (data.trackPersistent && typeof trimStageLyricPersistentTrackRows === 'function') {
        trimStageLyricPersistentTrackRows(mesh, targetLineIndex);
    }
    return true;
}
