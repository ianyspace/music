import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
    IconMusicSpace,
} from '../../icons';
import {
    IMMERSIVE_BG_KEY,
    IMMERSIVE_BGS,
    IMMERSIVE_CUSTOM_KEY,
    IMMERSIVE_FILTER_KEY,
    IMMERSIVE_FX_KEY,
    IMMERSIVE_LYRIC_KEY,
    IMMERSIVE_PANEL_KEY,
    IMMERSIVE_VOLUME_KEY,
    parseTrackName,
    storageGet,
    storageSet,
    trackGradient,
    VISUAL_INTENSITIES,
    VISUAL_INTENSITY_KEY,
} from '../../shared';
import { attachAnalyser, analyserElement, resumeAnalyser, setAnalyserVolume } from '../../core/audioAnalyser';
import { loadCoverPalette, paletteFromGradient } from '../../core/coverPalette';
import { coverUrlOf } from '../../librarySource';
import VisualCanvas from './VisualCanvas';
import ImmersiveLyrics from './ImmersiveLyrics';
import ForegroundParticles from './ForegroundParticles';
import LyricStarRiver from './LyricStarRiver';
import ImmersiveSettings from './ImmersiveSettings';
import PlaylistPanel from './PlaylistPanel';
import PlayerBar from './PlayerBar';
import { DEFAULT_FX, normalizeFx } from './visualPresets';

import styles from './ImmersiveApp.module.scss';

// The built-in preset: a procedurally drawn ambience (slow drifting light),
// not a video file — it ships with the page, weighs nothing and cannot 404.
export const PRESET_ID = 'preset';

// How long a mouse has to be away from the playlist before it folds itself
// away (PRD §5), and how long the mode switch cross-fade runs.
const PANEL_HIDE_MS = 5000;
const LAYER_FADE_MS = 900;

// The id of the row whose actions are open lives with the shell; this page
// only plays the public library, so a track's source check is never false.

/**
 * The immersive page — the desktop layout's only form since the redesign.
 *
 * One idea: **the background is the page.** A full-viewport WebGL nebula (or
 * the visitor's own picture/video) fills the screen; every control floats
 * over it as glass — the playlist hugging the left edge, the play bar pinned
 * to the bottom, the lyrics centred. There is no settings *page*: the bar's
 * gear opens a popover that owns every preference.
 *
 * What is deliberately *not* here: the record and its tonearm, the three
 * column workspace, the corner settings panel, the theme switch. The old
 * desktop page retired with this one's first commit.
 *
 * Playback state still belongs to `usePlayer` (the shell holds it); what this
 * component owns is the page's *stored preferences* — background mode, the
 * custom background library, filter, intensity, volume, the panel's
 * auto-collapse. One sync effect restores them after mount and writes them
 * back on change, the same pattern the shell uses: a static export must not
 * read localStorage in a `useState` initialiser, and one read/write effect
 * cannot race itself the way a read-effect plus a write-effect can.
 */
const ImmersiveApp = function ({
    listLoading,
    visibleTracks,
    search,
    onSearch,
    current,
    loadingId,
    isPlaying,
    onToggleTrack,
    onTogglePlay,
    onPrev,
    onNext,
    onSeek,
    progress,
    shuffle,
    repeat,
    onCycleRepeat,
    lyrics,
    lyricsLoading,
    lyricsVisible,
    onToggleLyrics,
    likedOnly,
    onToggleLikedOnly,
    isLiked,
    onToggleLike,
    qqBound,
    onOpenAccount,
    audioRef,
}) {
    const meta = current ? parseTrackName(current.track.name) : null;
    const title = meta ? meta.title : '还没有播放中的歌曲';
    const artist = meta ? meta.artist : '从左侧列表挑一首开始';
    const gradient = current ? trackGradient(current.track.name) : 'linear-gradient(135deg, #fb5c74, #fa233b)';
    const coverUrl = current ? coverUrlOf(current.track) : '';
    const currentId = current ? current.track.id : '';
    const liked = current ? isLiked(current.track) : false;

    const activeLyric = lyrics && lyrics.timed
        ? lyrics.lines.reduce((index, line, lineIndex) => (line.time <= progress.time ? lineIndex : index), -1)
        : -1;
    const canToggleLyrics = Boolean(lyrics) || lyricsLoading;

    /* --- the page's stored preferences ---------------------------------- */

    const [bgMode, setBgMode] = useState('nebula');
    const [intensity, setIntensity] = useState('standard');
    const [customBg, setCustomBg] = useState({ items: [], selected: PRESET_ID });
    const [filter, setFilter] = useState(40);
    const [autoCollapse, setAutoCollapse] = useState(true);
    const [lyricInNebula, setLyricInNebula] = useState(true);
    const [volume, setVolume] = useState(100);
    // The visual console's state: which preset is on screen, how much of
    // everything, and which layers ride along.
    const [fx, setFx] = useState(DEFAULT_FX);
    // The cover's own colour scheme. Null until it has been sampled — every
    // consumer falls back to the song's gradient until then.
    const [palette, setPalette] = useState(null);

    const prefsSyncedRef = useRef(false);
    useEffect(() => {
        if (!prefsSyncedRef.current) {
            prefsSyncedRef.current = true;
            const savedMode = storageGet(IMMERSIVE_BG_KEY);
            if (IMMERSIVE_BGS.includes(savedMode)) setBgMode(savedMode);
            const savedIntensity = storageGet(VISUAL_INTENSITY_KEY);
            if (VISUAL_INTENSITIES.includes(savedIntensity)) setIntensity(savedIntensity);
            try {
                setFx(normalizeFx(JSON.parse(storageGet(IMMERSIVE_FX_KEY))));
            } catch (error) { /* no console state yet */ }
            try {
                const parsed = JSON.parse(storageGet(IMMERSIVE_CUSTOM_KEY));
                if (parsed && Array.isArray(parsed.items) && typeof parsed.selected === 'string') {
                    setCustomBg({ items: parsed.items, selected: parsed.selected });
                }
            } catch (error) { /* no library yet */ }
            const savedFilter = Number(storageGet(IMMERSIVE_FILTER_KEY));
            if (Number.isFinite(savedFilter) && savedFilter >= 0 && savedFilter <= 100) setFilter(savedFilter);
            if (storageGet(IMMERSIVE_PANEL_KEY) === 'off') setAutoCollapse(false);
            if (storageGet(IMMERSIVE_LYRIC_KEY) === 'off') setLyricInNebula(false);
            // Guard on the raw string, not the number: `Number('')` is 0, and
            // 0 passes a 0–100 range check — a fresh visit with no stored
            // volume used to restore itself to SILENT.
            const savedVolume = storageGet(IMMERSIVE_VOLUME_KEY);
            if (savedVolume !== '') {
                const savedVolumeNumber = Number(savedVolume);
                if (Number.isFinite(savedVolumeNumber) && savedVolumeNumber >= 0 && savedVolumeNumber <= 100) {
                    setVolume(savedVolumeNumber);
                }
            }
            return;
        }
        storageSet(IMMERSIVE_BG_KEY, bgMode);
        storageSet(VISUAL_INTENSITY_KEY, intensity);
        storageSet(IMMERSIVE_CUSTOM_KEY, JSON.stringify(customBg));
        storageSet(IMMERSIVE_FILTER_KEY, String(filter));
        storageSet(IMMERSIVE_PANEL_KEY, autoCollapse ? 'on' : 'off');
        storageSet(IMMERSIVE_LYRIC_KEY, lyricInNebula ? 'on' : 'off');
        storageSet(IMMERSIVE_VOLUME_KEY, String(volume));
        storageSet(IMMERSIVE_FX_KEY, JSON.stringify(fx));
    }, [bgMode, intensity, customBg, filter, autoCollapse, lyricInNebula, volume, fx]);

    // The cover's palette, sampled once per song. It is fetched on its own
    // rather than through the canvas because three layers want it and none of
    // them should own the request.
    useEffect(() => {
        let dead = false;
        setPalette(null);
        if (!coverUrl) return undefined;
        (async () => {
            const found = await loadCoverPalette(coverUrl);
            if (!dead) setPalette(found);
        })();
        return () => { dead = true; };
    }, [coverUrl]);

    // What every layer actually uses: the cover's own colours when the
    // artwork has an opinion and the palette switch is on, the song's
    // gradient otherwise.
    const activePalette = fx.palette && palette && !palette.monochrome
        ? palette
        : paletteFromGradient(gradient);

    // Which custom background is on screen. The selected id always has an
    // answer: a selection that points at a deleted item falls back to the
    // preset rather than to a broken frame.
    const selectedCustom = customBg.items.find((item) => item.id === customBg.selected)
        || { id: PRESET_ID, type: 'preset' };

    /* --- the spectrum ----------------------------------------------------
     *
     * Built on the first play, not on mount: an `AudioContext` created before
     * any gesture starts `suspended`, and routing the element through a
     * suspended context mutes it. `isPlaying` only ever becomes true from a
     * click, so `resume()` runs inside the gesture's sticky activation.
     */
    const [analyser, setAnalyser] = useState(null);
    useEffect(() => {
        if (!isPlaying) return;
        const element = audioRef && audioRef.current;
        if (!element) return;
        const node = attachAnalyser(element);
        if (!node) return;
        resumeAnalyser();
        setAnalyser(node);
    }, [isPlaying, audioRef]);

    // Volume lands on the element directly only while the Web Audio graph
    // hasn't captured it; once captured, the element must stay at full scale
    // (the analyser needs unattenuated samples — see audioAnalyser) and the
    // listening volume moves to the graph's gain node instead.
    useEffect(() => {
        const element = audioRef && audioRef.current;
        const level = Math.min(1, Math.max(0, volume / 100));
        const captured = Boolean(analyser && analyserElement() === element);
        if (element) element.volume = captured ? 1 : level;
        setAnalyserVolume(level);
    }, [volume, audioRef, analyser]);

    /* --- the playlist panel's fold --------------------------------------- */

    const [panelOpen, setPanelOpen] = useState(true);
    const [panelHover, setPanelHover] = useState(false);
    const hideTimerRef = useRef(0);
    const hasCurrent = Boolean(current);

    // Playing + pointer away + auto-collapse on → fold after a grace period.
    // Paused or hovered, it stays. A song change re-arms the timer (the
    // visitor just clicked a row; folding immediately under them is rude).
    useEffect(() => {
        window.clearTimeout(hideTimerRef.current);
        if (!hasCurrent || !isPlaying || !autoCollapse || !panelOpen || panelHover) {
            return undefined;
        }
        hideTimerRef.current = window.setTimeout(() => setPanelOpen(false), PANEL_HIDE_MS);
        return () => window.clearTimeout(hideTimerRef.current);
    }, [hasCurrent, isPlaying, autoCollapse, panelOpen, panelHover, currentId]);

    useEffect(() => () => window.clearTimeout(hideTimerRef.current), []);

    const onPanelHoverChange = useCallback((hovered) => setPanelHover(hovered), []);

    /* --- background switching -------------------------------------------- */

    // Both layers render for the length of the cross-fade: the new one fades
    // in over the old, then the old unmounts. No white frame in between.
    const [shownLayers, setShownLayers] = useState([{ key: 'nebula', mode: 'nebula' }]);
    const fadeTimerRef = useRef(0);
    useEffect(() => {
        window.clearTimeout(fadeTimerRef.current);
        setShownLayers((layers) => {
            const top = layers[layers.length - 1];
            if (top.mode === bgMode) return layers;
            return [...layers, { key: `${bgMode}-${Date.now()}`, mode: bgMode }];
        });
        // If no switch actually stacked a layer, this is a no-op slice.
        fadeTimerRef.current = window.setTimeout(() => {
            setShownLayers((layers) => (layers.length > 1 ? layers.slice(-1) : layers));
        }, LAYER_FADE_MS);
        return () => window.clearTimeout(fadeTimerRef.current);
        // `shownLayers` deliberately not a dep: the effect only reacts to
        // `bgMode`; layer bookkeeping happens through the functional updates.
    }, [bgMode]);

    useEffect(() => () => window.clearTimeout(fadeTimerRef.current), []);

    /* --- the toast -------------------------------------------------------- */

    const [toast, setToast] = useState('');
    const toastTimerRef = useRef(0);
    const announce = useCallback(function (text) {
        setToast(text);
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => setToast(''), 1800);
    }, []);
    useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

    const changeBgMode = useCallback(function (mode) {
        setBgMode(mode);
        announce(mode === 'nebula' ? '星云背景' : '自定义背景');
    }, [announce]);

    /* --- custom background failures --------------------------------------- */

    const [customFailed, setCustomFailed] = useState(false);
    useEffect(() => { setCustomFailed(false); }, [selectedCustom.id, selectedCustom.url]);
    useEffect(() => {
        if (customFailed && bgMode === 'custom') announce('背景加载失败，已回退到封面');
    }, [customFailed, bgMode, announce]);

    /* --- settings popover -------------------------------------------------- */

    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsClosing, setSettingsClosing] = useState(false);
    const closeSettings = useCallback(function () {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setSettingsOpen(false);
            setSettingsClosing(false);
            return;
        }
        setSettingsClosing(true);
    }, []);
    useEffect(() => {
        if (!settingsOpen) return undefined;
        const onKeyDown = (event) => { if (event.key === 'Escape') closeSettings(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [settingsOpen, closeSettings]);

    const addCustom = useCallback(function (item) {
        setCustomBg((prev) => ({ items: [...prev.items, item], selected: item.id }));
        setCustomFailed(false);
    }, []);
    const removeCustom = useCallback(function (id) {
        setCustomBg((prev) => {
            const items = prev.items.filter((item) => item.id !== id);
            return {
                items,
                selected: prev.selected === id
                    ? (items[0] ? items[0].id : PRESET_ID)
                    : prev.selected,
            };
        });
    }, []);
    const selectCustom = useCallback(function (id) {
        setCustomBg((prev) => ({ ...prev, selected: id }));
        setCustomFailed(false);
    }, []);

    /* --- derived view state ------------------------------------------------ */

    const lyricsShown = Boolean(lyricsVisible && canToggleLyrics)
        && (bgMode === 'custom' || lyricInNebula);

    const renderLayer = function (layer) {
        if (layer.mode === 'nebula') {
            return (
                <VisualCanvas
                    coverUrl={coverUrl}
                    gradient={gradient}
                    isPlaying={isPlaying}
                    intensity={intensity}
                    preset={fx.preset}
                    density={fx.density}
                    motion={fx.motion}
                    fx={fx}
                    palette={activePalette}
                    analyser={analyser}
                    onActivate={current ? onTogglePlay : undefined}
                />
            );
        }
        return (
            <CustomBackground
                item={selectedCustom}
                gradient={gradient}
                coverUrl={coverUrl}
                filter={filter}
                onFailed={() => setCustomFailed(true)}
            />
        );
    };

    return (
        <div className={styles.root}>
            {/* The colour field and the blurred cover sit *under* the active
                layer: they are what the glass surfaces sample, and what a
                failed custom background falls back to. */}
            <div className={styles.backdrop} aria-hidden="true" />
            <div className={styles.glow} style={{ background: gradient }} aria-hidden="true" />
            {coverUrl && (
                <div
                    className={styles['cover-bg']}
                    style={{ backgroundImage: `url("${coverUrl}")` }}
                    aria-hidden="true"
                />
            )}

            {/* --- background layers (cross-fading) ------------------------- */}
            {shownLayers.map((layer, index) => (
                <div
                    key={layer.key}
                    className={`${styles.layer}${index === shownLayers.length - 1 ? ` ${styles['layer-top']}` : ''}`}
                    aria-hidden="true"
                >
                    {renderLayer(layer)}
                </div>
            ))}

            {/* --- centered lyrics ------------------------------------------ */}
            {lyricsShown && (
                <ImmersiveLyrics
                    lyrics={lyrics}
                    lyricsLoading={lyricsLoading}
                    activeIndex={activeLyric}
                    progressTime={progress.time}
                    analyser={analyser}
                    isPlaying={isPlaying}
                    intensity={intensity}
                    stage={fx.lyricMode}
                    enterFx={fx.lyricFx}
                    palette={activePalette}
                    onTogglePlay={onTogglePlay}
                />
            )}

            {/* The lyric star river: sparks living in the words' own band of
                the frame. It sits above the lyrics and under the ambient
                veil, so the words read as lit from inside the scene. */}
            {lyricsShown && fx.lyricRiver && (
                <LyricStarRiver
                    analyser={analyser}
                    isPlaying={isPlaying}
                    intensity={intensity}
                    palette={activePalette}
                />
            )}

            {!lyricsShown && current === null && (
                <div className={styles.idle} aria-hidden="true">
                    <IconMusicSpace size={40} />
                    <p>挑一首歌，让页面活起来</p>
                </div>
            )}

            {/* --- foreground: the particle veil ----------------------------- */}
            {/* Sits *above* the lyrics (z 7 > z 6) and below every control:
                a sparse drift of large faint motes passing over the words is
                what makes them read as inside the scene, not printed on it. */}
            <ForegroundParticles analyser={analyser} isPlaying={isPlaying} />

            {/* --- left: the track list panel -------------------------------- */}
            <PlaylistPanel
                expanded={panelOpen}
                onExpand={setPanelOpen}
                onHoverChange={onPanelHoverChange}
                listLoading={listLoading}
                visibleTracks={visibleTracks}
                current={current}
                loadingId={loadingId}
                isPlaying={isPlaying}
                onToggleTrack={onToggleTrack}
                qqBound={qqBound}
                onOpenAccount={onOpenAccount}
            />

            {/* The summon edge: a hairline strip on the viewport's left. The
                handle does most of the work; this is for the habit of just
                throwing the pointer at the edge. */}
            {!panelOpen && (
                <div
                    className={styles.edge}
                    role="button"
                    tabIndex={0}
                    aria-label="展开歌单"
                    onClick={() => setPanelOpen(true)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setPanelOpen(true);
                        }
                    }}
                />
            )}

            {/* --- bottom: the play bar (always visible) --------------------- */}
            <PlayerBar
                current={current}
                title={title}
                artist={artist}
                gradient={gradient}
                isPlaying={isPlaying}
                progress={progress}
                onSeek={onSeek}
                onPrev={onPrev}
                onNext={onNext}
                onTogglePlay={onTogglePlay}
                onCycleRepeat={onCycleRepeat}
                shuffle={shuffle}
                repeat={repeat}
                lyricsShown={lyricsShown}
                canToggleLyrics={canToggleLyrics}
                onToggleLyrics={onToggleLyrics}
                liked={liked}
                onToggleLike={() => { if (current) onToggleLike(current.track); }}
                audioRef={audioRef}
                volume={volume}
                onVolume={setVolume}
                onOpenSettings={() => setSettingsOpen(true)}
            />

            {/* --- settings --------------------------------------------------- */}
            <ImmersiveSettings
                open={settingsOpen}
                closing={settingsClosing}
                onClose={() => setSettingsOpen(false)}
                onAnimationEnd={() => {
                    if (settingsClosing) {
                        setSettingsOpen(false);
                        setSettingsClosing(false);
                    }
                }}
                bgMode={bgMode}
                onBgMode={changeBgMode}
                intensity={intensity}
                onIntensity={setIntensity}
                customItems={customBg.items}
                selectedId={selectedCustom.id}
                onAddCustom={addCustom}
                onRemoveCustom={removeCustom}
                onSelectCustom={selectCustom}
                filter={filter}
                onFilter={setFilter}
                autoCollapse={autoCollapse}
                onAutoCollapse={setAutoCollapse}
                lyricInNebula={lyricInNebula}
                onLyricInNebula={setLyricInNebula}
                preset={fx.preset}
                onPreset={(value) => setFx((prev) => ({ ...prev, preset: value }))}
                density={fx.density}
                onDensity={(value) => setFx((prev) => ({ ...prev, density: value }))}
                motion={fx.motion}
                onMotion={(value) => setFx((prev) => ({ ...prev, motion: value }))}
                fx={fx}
                onFx={(key, value) => setFx((prev) => ({ ...prev, [key]: value }))}
            />

            {toast && (
                <span className={styles.toast} role="status">{toast}</span>
            )}
        </div>
    );
};

/**
 * The custom background: the visitor's own picture or video, or the built-in
 * preset, with the readability veil on top.
 *
 * Video backgrounds are DOM elements with CSS filters rather than WebGL
 * textures: the visual result is identical, the failure modes are fewer, and
 * a `<video>` that cannot autoplay degrades the same way any other missing
 * background does — to the blurred cover beneath it.
 */
const CustomBackground = function ({ item, gradient, coverUrl, filter, onFailed }) {
    if (item.type === 'preset') {
        return (
            <div className={styles.preset} aria-hidden="true">
                <span className={`${styles['preset-blob']} ${styles['preset-blob-a']}`} style={{ background: gradient }} />
                <span className={`${styles['preset-blob']} ${styles['preset-blob-b']}`} style={{ background: gradient }} />
                <span className={`${styles['preset-blob']} ${styles['preset-blob-c']}`} style={{ background: gradient }} />
                <div className={styles.veil} style={{ '--veil': filter / 125 }} />
            </div>
        );
    }

    const veil = <div className={styles.veil} style={{ '--veil': filter / 125 }} />;

    if (item.type === 'video') {
        return (
            <div className={styles.media} aria-hidden="true">
                <video
                    key={item.url}
                    className={styles['media-el']}
                    src={item.url}
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="auto"
                    onError={onFailed}
                />
                {veil}
            </div>
        );
    }

    return (
        <div className={styles.media} aria-hidden="true">
            <img
                key={item.url}
                className={styles['media-el']}
                src={item.url}
                alt=""
                onError={onFailed}
            />
            {veil}
        </div>
    );
};

export default ImmersiveApp;
