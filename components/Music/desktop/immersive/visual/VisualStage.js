import React, { useEffect, useRef } from 'react';

import { createBandReader, readBands } from '../../../core/audioAnalyser';
import { createBeatDetector } from '../../../core/beat';
import { loadCoverResilient } from '../../../core/coverImage';
import { FALLBACK_COVER } from '../../../shared';
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
const VisualStage = function ({ fx, palette, coverUrl, analyser, isPlaying, lyrics, getPlayback, className }) {
    const hostRef = useRef(null);
    const stageRef = useRef(null);
    const audioRef = useRef({ analyser, isPlaying });
    const fxRef = useRef(fx);
    const playbackRef = useRef(getPlayback);
    const lyricsRef = useRef(lyrics);

    audioRef.current = { analyser, isPlaying };
    fxRef.current = fx;
    playbackRef.current = getPlayback;
    lyricsRef.current = lyrics;

    // 每帧读一次频谱, 顺便跑节拍检测。放在这里而不是引擎里, 是为了让
    // 频谱读取和本项目现有的 analyser / beat 模块保持唯一来源。
    const audioSamplerRef = useRef(null);
    if (!audioSamplerRef.current) {
        const detector = createBeatDetector();
        let reader = null;
        audioSamplerRef.current = () => {
            const live = audioRef.current;
            if (!live.analyser) {
                // 没接上 Web Audio 图也要把播放状态报上去 —— 歌词系统靠它
                // 区分「暂停保留」和「空闲退场」, 与频谱是否可用无关。
                return { low: 0, mid: 0, high: 0, level: 0, beat: false, beatAmp: 0, playing: Boolean(live.isPlaying) };
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
                    readPlayback: () => (playbackRef.current ? playbackRef.current() : null),
                });
                stageRef.current = stage;
                if (palette) {
                    stage.palette = palette;
                    stage.applyLyricPalette(palette);
                    stage.syncFxUniforms();
                }
                if (lyricsRef.current) stage.setLyrics(lyricsRef.current);
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

    // 换歌时重新灌入歌词。官方歌词是「拉取式」: 只认 runtime 里的行数组
    // 与 audio.currentTime, 所以这里只负责换数据, 不负责推进。
    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;
        stage.setLyrics(lyrics);
    }, [lyrics]);

    useEffect(() => {
        let cancelled = false;
        let timer = 0;
        let waits = 0;
        if (!coverUrl) {
            if (stageRef.current) stageRef.current.setCoverImage(null);
            return undefined;
        }
        const fetchInto = function (url) {
            return loadCoverResilient(url).then(function (image) {
                if (cancelled || !stageRef.current) return;
                if (image) {
                    stageRef.current.setCoverImage(image);
                } else if (url !== FALLBACK_COVER) {
                    // 封面一路失败 (r2 时常抽风): 落到站点图标, 粒子至少
                    // 有个形状, 不至于整场散成雾。
                    return fetchInto(FALLBACK_COVER);
                } else {
                    stageRef.current.setCoverImage(null);
                }
            });
        };
        // 换歌先切雾态 (emily 的「散开 → 聚成封面」入场), 封面纹理就绪后
        // setCoverImage 自己把它收回去。
        const start = function () {
            const stage = stageRef.current;
            if (!stage) return false;
            stage.showLoading();
            fetchInto(coverUrl).catch(function () {
                if (!cancelled && stageRef.current) stageRef.current.setCoverImage(null);
            });
            return true;
        };
        if (!start()) {
            // three.js 是按需注入的, 挂载瞬间 stage 还不存在。带着「上次
            // 选的歌」进入页面时 coverUrl 一开始就非空, 这里若直接放弃,
            // 封面就再也不会灌进场景 (只有换歌才会重跑) —— 首屏粒子空
            // 封面就是这个竞态。轮询等场景就绪, 封顶约 12s: 注入彻底失败
            // 时不再空转。
            timer = window.setInterval(function () {
                waits += 1;
                if (cancelled) return;
                if (start() || waits > 100) window.clearInterval(timer);
            }, 120);
        }
        return function () {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [coverUrl]);

    return <div ref={hostRef} className={[styles.stage, className].filter(Boolean).join(' ')} />;
};

export default VisualStage;
