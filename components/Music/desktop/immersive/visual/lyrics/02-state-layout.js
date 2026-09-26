/**
 * 移植自上游 Mineradio public/js/modules/02-visual/02-lyrics-state-layout.js。
 * 上游许可证 GNU GPL v3（用户已授权原样复制）。
 * 这里逐行保留状态、布局逻辑与观感参数，仅做 ESM 导入导出和 THREE 惰性初始化适配，
 * 避免重写或优化改变原有效果。
 */

import { SKULL_PRESET_INDEX, clampRange } from '../presetData.js';
import { THREE, camera, fx } from './runtime.js';

// ============================================================
export var stageLyrics = {
    group: null,
    current: null,
    outgoing: [],
    currentIdx: -1,
    currentText: '',
    highBloom: 0,
    beatGlow: 0,
    glowFollowX: 0,
    glowFollowY: 0,
    glowFollowRoll: 0,
    palette: {
        primary: '#d6f8ff',
        secondary: '#9cffdf',
        highlight: '#eef7ff',
        shadow: 'rgba(2,8,12,0.42)',
        glow: 'rgba(143,233,255,0.34)',
    },
    coverPalette: {
        primary: '#d6f8ff',
        secondary: '#9cffdf',
        highlight: '#eef7ff',
        shadow: 'rgba(2,8,12,0.42)',
        glow: 'rgba(143,233,255,0.34)',
    },
    starRiver: null,
    starRiverWidth: 4.2,
    starRiverHeight: 0.58,
    lockFitScale: 1,
    snapCameraLockFrames: 0,
    transitionLineStep: 0,
    currentDisplayKey: '',
    currentPayload: null,
};
export var lyricSunColor = null;
export var lyricSunHotColor = null;
export var lyricCameraDir = null;
export var lyricCameraRight = null;
export var lyricCameraUp = null;
export var lyricCameraTarget = null;
export var lyricLayoutBase = null;
export var lyricLayoutTarget = null;
export var lyricCoverWorldPos = null;
export var lyricCoverWorldQuat = null;
export var lyricBaseEuler = null;
export var lyricTiltEuler = null;
export var lyricBaseQuat = null;
export var lyricTiltQuat = null;
export var lyricTargetQuat = null;
export var LYRIC_CAMERA_LOCK_MAX_SCALE = 0.80;

export function ensureStageLyricLayoutState() {
    if (lyricSunColor) return;
    lyricSunColor = new THREE.Color(0xffe6a4);
    lyricSunHotColor = new THREE.Color(0xfff4cc);
    lyricCameraDir = new THREE.Vector3();
    lyricCameraRight = new THREE.Vector3();
    lyricCameraUp = new THREE.Vector3();
    lyricCameraTarget = new THREE.Vector3();
    lyricLayoutBase = new THREE.Vector3();
    lyricLayoutTarget = new THREE.Vector3();
    lyricCoverWorldPos = new THREE.Vector3();
    lyricCoverWorldQuat = new THREE.Quaternion();
    lyricBaseEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    lyricTiltEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    lyricBaseQuat = new THREE.Quaternion();
    lyricTiltQuat = new THREE.Quaternion();
    lyricTargetQuat = new THREE.Quaternion();
}

export function setStageLyricViewBasisFromCameraOrQuaternion(fallbackQuat) {
    ensureStageLyricLayoutState();
    if (fallbackQuat) {
        lyricCameraDir.set(0, 0, 1).applyQuaternion(fallbackQuat);
        lyricCameraRight.set(1, 0, 0).applyQuaternion(fallbackQuat);
        lyricCameraUp.set(0, 1, 0).applyQuaternion(fallbackQuat);
    } else if (camera) {
        camera.getWorldDirection(lyricCameraDir);
        lyricCameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
        lyricCameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    } else {
        lyricCameraDir.set(0, 0, 1);
        lyricCameraRight.set(1, 0, 0);
        lyricCameraUp.set(0, 1, 0);
    }
    lyricCameraDir.normalize();
    lyricCameraRight.normalize();
    lyricCameraUp.normalize();
}
export function applyStageLyricLayoutOffset(target, x, y, z) {
    ensureStageLyricLayoutState();
    return target
        .addScaledVector(lyricCameraRight, x || 0)
        .addScaledVector(lyricCameraUp, y || 0)
        .addScaledVector(lyricCameraDir, z || 0);
}
export function stageLyricTargetQuaternion(baseQuat, tiltX, tiltY) {
    ensureStageLyricLayoutState();
    lyricTiltEuler.set((tiltX || 0) * Math.PI / 180, (tiltY || 0) * Math.PI / 180, 0, 'YXZ');
    lyricTiltQuat.setFromEuler(lyricTiltEuler);
    return lyricTargetQuat.copy(baseQuat || lyricBaseQuat).multiply(lyricTiltQuat);
}
export function getStageLyricLockBounds() {
    var maxW = 0, maxH = 0;
    function take(mesh) {
        if (!mesh || !mesh.userData || !mesh.userData.lyric) return;
        var d = mesh.userData.lyric;
        var meshScale = Math.max(mesh.scale && isFinite(mesh.scale.x) ? mesh.scale.x : 1, mesh.scale && isFinite(mesh.scale.y) ? mesh.scale.y : 1);
        maxW = Math.max(maxW, (d.textWorldW || d.worldW || 6.1) * meshScale);
        maxH = Math.max(maxH, (d.textWorldH || d.worldH || 1.0) * meshScale);
    }
    take(stageLyrics.current);
    for (var i = 0; i < stageLyrics.outgoing.length; i++) take(stageLyrics.outgoing[i]);
    return { w: maxW || 5.4, h: maxH || 0.78 };
}
export function lyricCameraLockFit(layoutScale, layoutX, layoutY, distance) {
    if (!camera || !camera.isPerspectiveCamera) return 1;
    layoutScale = Math.max(0.1, layoutScale || 1);
    var fov = (camera.fov || 45) * Math.PI / 180;
    var dist = Math.max(1.4, distance || 4.85);
    var visibleH = 2 * Math.tan(fov * 0.5) * dist;
    var visibleW = visibleH * (camera.aspect || (innerWidth / Math.max(1, innerHeight)) || 1.78);
    var bounds = getStageLyricLockBounds();
    var skullSafe = !!(fx && fx.preset === SKULL_PRESET_INDEX);
    var safeW = Math.max(visibleW * (skullSafe ? 0.36 : 0.42), visibleW * (skullSafe ? 0.70 : 0.84) - Math.abs(layoutX || 0) * (skullSafe ? 1.36 : 1.22));
    var safeH = Math.max(visibleH * (skullSafe ? 0.16 : 0.18), visibleH * (skullSafe ? 0.34 : 0.44) - Math.abs(layoutY || 0) * (skullSafe ? 0.98 : 0.82));
    var scaledW = Math.max(0.01, bounds.w * layoutScale);
    var scaledH = Math.max(0.01, bounds.h * layoutScale);
    var viewportFit = Math.min(1, safeW / scaledW, safeH / scaledH);
    var lockScaleCap = Math.min(1, (skullSafe ? 0.94 : LYRIC_CAMERA_LOCK_MAX_SCALE) / layoutScale);
    return clampRange(Math.min(viewportFit, lockScaleCap), skullSafe ? 0.36 : 0.42, 1);
}
// 兼容旧变量名以便其它代码不破坏
