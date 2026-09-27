/**
 * 唱片预设(3D 粒子) 与 播放栏唱盘 共用的旋转角。
 *
 * 之前两边各转各的: 3D 唱片走 uVinylSpin (基础 0.4 rad/s 再叠一层低频加速),
 * 播放栏唱盘走 CSS `animation: disc-rotate 9s`。速度不一样, 角度也毫不相干,
 * 暂停时 3D 那边还照转。现在两处都读这一个对象 —— 同一个角速度、同一个角度、
 * 同一个暂停行为。
 *
 * 一圈多少秒是用户拍的板: 先 14 秒 (25.7°/s), 反馈还是偏快, 再放到 22 秒
 * (16.4°/s)。真实黑胶是 33⅓ rpm (1.8 秒一圈), 但屏幕上那么快看着发慌 ——
 * 这一档是"看得出在转, 又不晃眼"。要再调只改这一个常量。
 */

export const VINYL_PERIOD_SEC = 22;
export const VINYL_RATE = (Math.PI * 2) / VINYL_PERIOD_SEC;

const state = { angle: 0 };
let lastAdvance = 0;

/**
 * 推进一帧。stageEngine 和 PlayerBar 每帧都会调用, 所以按时间戳去重 ——
 * 两个调用方都推进的话转速会正好翻倍。
 */
export const advanceVinyl = function (dt, playing) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastAdvance < 4) return state.angle;
    lastAdvance = now;
    if (playing) {
        const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
        state.angle = (state.angle + step * VINYL_RATE) % (Math.PI * 2);
    }
    return state.angle;
};

export const vinylAngle = function () {
    return state.angle;
};
