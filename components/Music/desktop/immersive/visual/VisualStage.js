import React, { useEffect, useRef } from 'react';

import { createBandReader, readBands } from '../../../core/audioAnalyser';
import { createBeatDetector } from '../../../core/beat';
import { loadCoverResilient } from '../../../core/coverImage';
import ParticleStage from './stageEngine';
import styles from './VisualStage.module.scss';

// basePath 下部署 (GitHub Pages /music/) 时 public 资源要手动带前缀。
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';
const THREE_SRC = `${BASE}/vendor/three.r128.min.js`;

let threePromise = null;

/**
 * three.js r128 以 script 标签加载 (与上游一致)。
 * 走 npm 包会让 Next 把 600KB 的 r128 打进 bundle, 而这个页面只在桌面端
 * 进入沉浸式时才需要它 —— 按需注入更划算。
 */
const ensureThree = function () {
    if (typeof window === 'undefined') return Promise.resolve(null);
    if (window.THREE) return Promise.resolve(window.THREE);
    if (threePromise) return threePromise;
    threePromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = THREE_SRC;
        script.async = true;
        script.onload = () => resolve(window.THREE || null);
        script.onerror = () => reject(new Error('three.js failed to load'));
        document.head.appendChild(script);
    });
    return threePromise;
};

/**
 * 粒子舞台: 13 个视觉预设的 three.js 宿主。
 *
 * 歌曲来源、播放、音量全部沿用上层现有的逻辑, 这里只接收「封面图」和
 * 「当前频段」两个输入 —— 换可视化引擎不影响任何播放行为。
 */
const VisualStage = function ({ fx, palette, coverUrl, analyser, isPlaying, className }) {
    const hostRef = useRef(null);
    const stageRef = useRef(null);
    const audioRef = useRef({ analyser, isPlaying });
    const fxRef = useRef(fx);

    audioRef.current = { analyser, isPlaying };
    fxRef.current = fx;

    // 每帧读一次频谱, 顺便跑节拍检测。放在这里而不是引擎里, 是为了让
    // 频谱读取和本项目现有的 analyser / beat 模块保持唯一来源。
    const audioSamplerRef = useRef(null);
    if (!audioSamplerRef.current) {
        const detector = createBeatDetector();
        let reader = null;
        audioSamplerRef.current = () => {
            const live = audioRef.current;
            if (!live.analyser) {
                return { low: 0, mid: 0, high: 0, level: 0, beat: false, beatAmp: 0, playing: false };
            }
            if (!reader || reader.analyser !== live.analyser) reader = createBandReader(live.analyser);
            const sample = readBands(reader);
            const beat = detector.update(performance.now(), sample.low, Boolean(live.isPlaying));
            return {
                low: sample.low,
                mid: sample.mid,
                high: sample.high,
                level: sample.level,
                beat: beat.fired,
                beatAmp: beat.amp,
                playing: Boolean(live.isPlaying),
            };
        };
    }

    useEffect(() => {
        let cancelled = false;

        ensureThree()
            .then((THREE) => {
                if (!THREE || cancelled || !hostRef.current) return;
                const stage = new ParticleStage(THREE, hostRef.current, {
                    fx: fxRef.current,
                    readAudio: () => audioSamplerRef.current(),
                });
                stageRef.current = stage;
                if (palette) {
                    stage.palette = palette;
                    stage.syncFxUniforms();
                }
            })
            .catch((err) => {
                console.warn('[VisualStage] three.js unavailable:', err);
            });

        return () => {
            cancelled = true;
            if (stageRef.current) {
                stageRef.current.dispose();
                stageRef.current = null;
            }
        };
        // 只在挂载时建一次场景; 后续变化走下面的同步 effect。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;
        stage.setFx(fx, palette);
    }, [fx, palette]);

    useEffect(() => {
        const stage = stageRef.current;
        if (!stage || !coverUrl) {
            if (stage) stage.setCoverImage(null);
            return undefined;
        }
        let cancelled = false;
        // 等场景就绪(按需加载 three 会有几十毫秒空窗)
        const timer = window.setInterval(() => {
            if (cancelled) return;
            if (!stageRef.current) return;
            window.clearInterval(timer);
            loadCoverResilient(coverUrl).then((image) => {
                if (cancelled || !stageRef.current) return;
                stageRef.current.setCoverImage(image);
            });
        }, 120);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [coverUrl]);

    return <div ref={hostRef} className={[styles.stage, className].filter(Boolean).join(' ')} />;
};

export default VisualStage;
