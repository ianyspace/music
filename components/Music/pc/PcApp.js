import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { attachAnalyser, resumeAnalyser } from '../core/audioAnalyser';
import { loadCoverPalette, paletteFromGradient } from '../core/coverPalette';
import PageHead from '../core/PageHead';
import PlayerAudio from '../core/PlayerAudio';
import usePlayer from '../core/usePlayer';
import { coverUrlOf } from '../librarySource';
import { FALLBACK_COVER, parseTrackName, storageGet, storageSet, trackGradient } from '../shared';
import {
    IconGear,
    IconHeart,
    IconNext,
    IconPause,
    IconPlay,
    IconPrev,
    IconRepeat,
    IconRepeatOne,
    IconShuffle,
} from '../icons';
import { restoreFoliaAssets } from './foliaAssets';
import buildFoliaTheme from './foliaTheme';
import PcQueue from './PcQueue';
import PcSettings from './PcSettings';
import PcStage from './PcStage';
import {
    getVisualizerModeLabel,
    VISUALIZER_REGISTRY,
} from './folia/src/components/visualizer/registry';
import { useVisualizerBackgroundConfig } from './folia/src/components/visualizer/useVisualizerBackgroundConfig';
import { useVisualizerTunings } from './folia/src/components/visualizer/useVisualizerTunings';
import { useVisualizerSettingsStore } from './folia/src/stores/useVisualizerSettingsStore';

import styles from './PcApp.module.scss';

/**
 * `/pc` — the wide-screen page that plays **our** library through **folia's**
 * visualizer.
 *
 * The split of responsibility is the whole design:
 *
 * - Everything that makes a sound, decides what plays next, or remembers a
 *   like belongs to the existing player (`core/usePlayer`, `librarySource`,
 *   `likes.js`, `playStats.js`). This page passes it through and never
 *   reimplements it.
 * - Everything on screen above the artwork belongs to folia
 *   (`folia/src/components/visualizer`), vendored as TypeScript and driven by
 *   `PcStage`. Its 14 lyric modes are the product here.
 *
 * It deliberately does not touch `/desktop` or `/h5`: no file under
 * `components/Music/{desktop,h5}` is imported, and nothing there imports this.
 */

const MODE_STORAGE_KEY = 'music:setting:pcVisualizerMode';

// The mode folia itself opens on when nothing is stored. Kept as a literal so a
// missing entry in the vendored registry cannot leave the page with no stage.
const DEFAULT_MODE = 'classic';

const isKnownMode = function (mode) {
    return Boolean(mode) && VISUALIZER_REGISTRY.some((entry) => entry.mode === mode);
};

/* Which of `PcQueue`'s two bodies the left column shows. `LIST_VIEWS` is a
   whitelist rather than a pair of equality checks for the same reason
   `isKnownMode` is one: it is the whole migration plan if a view is ever
   dropped, and it is the only thing between a stored value and a view name with
   no branch behind it. */
const LIST_VIEW_STORAGE_KEY = 'music:setting:pcListView';
const DEFAULT_LIST_VIEW = 'list';
const LIST_VIEWS = ['list', 'carousel'];

const PcApp = function () {
    // folia's dictionaries, not ours: every mode name and every label inside the
    // tuning drawer comes from `folia/src/i18n`. `PcSettings` imports the config
    // that installs them, and this page is always rendered under it.
    const { t } = useTranslation();

    const {
        visibleTracks,
        listLoading,
        current,
        isPlaying,
        progress,
        shuffle,
        repeat,
        toggleTrack,
        togglePlay,
        playPrev,
        playNext,
        cycleRepeat,
        seek,
        lyrics,
        isPinned,
        togglePin,
        isLiked,
        toggleLike,
        error,
        notice,
        audioRef,
        onEnded,
        onPlay,
        onPause,
        onTimeUpdate,
        onMetadata,
    } = usePlayer({ lyricsAutoOpen: true, drive: false });

    const meta = current ? parseTrackName(current.track.name) : null;
    const title = meta ? meta.title : '还没有播放中的歌曲';
    const artist = meta ? meta.artist : '从左侧列表挑一首开始';
    const gradient = current ? trackGradient(current.track.name) : 'linear-gradient(135deg, #fb5c74, #fa233b)';
    const coverUrl = current ? (coverUrlOf(current.track) || FALLBACK_COVER) : FALLBACK_COVER;

    /* --- folia's own settings -------------------------------------------- */

    // The tuning bundle and the background config both live in folia's Zustand
    // stores, which persist themselves to localStorage. Subscribing here (rather
    // than copying values into this component) is what makes a slider in the
    // drawer move the stage on the same frame.
    const tunings = useVisualizerTunings();
    const background = useVisualizerBackgroundConfig();
    const visualizerOpacity = useVisualizerSettingsStore((state) => state.visualizerOpacity);

    // folia restores its user artwork in `App.tsx`, which is not vendored; the
    // asset store opens with every `isLoading…` flag true, so the cappella and
    // monet panels would spin forever without this.
    useEffect(() => { restoreFoliaAssets(); }, []);

    /* --- the mode, remembered across visits ------------------------------ */

    // Stored under folia's own key? No — deliberately this page's own key. The
    // mode is the one setting `/pc` owns, and reusing folia's key would make the
    // two pages fight over it if folia's app is ever mounted on this origin.
    const [mode, setMode] = useState(DEFAULT_MODE);
    const [modeSynced, setModeSynced] = useState(false);

    useEffect(() => {
        const saved = storageGet(MODE_STORAGE_KEY);
        if (isKnownMode(saved)) setMode(saved);
        setModeSynced(true);
    }, []);

    useEffect(() => {
        if (modeSynced) storageSet(MODE_STORAGE_KEY, mode);
    }, [mode, modeSynced]);

    /* --- the left column's body, remembered across visits ----------------- */

    // Same two-effect shape as the mode above: read once on mount, write on
    // every change *after* the read, so the first render's default cannot
    // overwrite a stored value before it has been read.
    const [listView, setListView] = useState(DEFAULT_LIST_VIEW);
    const [listViewSynced, setListViewSynced] = useState(false);

    useEffect(() => {
        const saved = storageGet(LIST_VIEW_STORAGE_KEY);
        if (LIST_VIEWS.includes(saved)) setListView(saved);
        setListViewSynced(true);
    }, []);

    useEffect(() => {
        if (listViewSynced) storageSet(LIST_VIEW_STORAGE_KEY, listView);
    }, [listView, listViewSynced]);

    const [settingsOpen, setSettingsOpen] = useState(false);

    /* --- the cover's own colours, sampled once per song ------------------ */

    const [palette, setPalette] = useState(null);

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

    const activePalette = palette && !palette.monochrome ? palette : paletteFromGradient(gradient);
    const theme = useMemo(
        () => buildFoliaTheme(activePalette, { name: title }),
        [activePalette, title],
    );

    /* --- the spectrum ----------------------------------------------------- */

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

    /* --- transport -------------------------------------------------------- */

    const onSeekBar = useCallback(function (event) {
        const value = Number(event.target.value);
        if (Number.isFinite(value)) seek(value);
    }, [seek]);

    const formatTime = function (seconds) {
        const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
        const mm = Math.floor(total / 60);
        const ss = String(total % 60).padStart(2, '0');
        return `${mm}:${ss}`;
    };

    // folia's own resolver: translated name when the dictionary has one, the
    // entry's `labelFallback` otherwise. Calling it rather than reading
    // `labelFallback` directly is what turns "Luminous" back into "流光".
    const modeLabel = function (entry) {
        return getVisualizerModeLabel(entry.mode, t);
    };

    // The two route-level modifiers. Both can be on at once — the tuning drawer
    // opens over the cover flow — and `PcApp.module.scss` carries a compound
    // rule for that case, so the order here does not matter.
    const pageClass = [
        styles.page,
        settingsOpen ? styles['page-drawer'] : null,
        listView === 'carousel' ? styles['page-carousel'] : null,
    ].filter(Boolean).join(' ');

    return (
        <div className={pageClass}>
            <PageHead gsi={false} />

            <div className={styles.stage}>
                <PcStage
                    mode={mode}
                    lyrics={lyrics}
                    duration={progress.duration}
                    theme={theme}
                    coverUrl={coverUrl}
                    analyser={analyser}
                    isPlaying={isPlaying}
                    audioRef={audioRef}
                    tunings={tunings}
                    background={background}
                    visualizerOpacity={visualizerOpacity}
                    songTitle={meta ? meta.title : null}
                    songArtist={meta ? meta.artist : null}
                />
            </div>

            {/* --- the mode rail: folia's 14 lyric modes -------------------- */}
            <div className={styles.modes} role="tablist" aria-label="歌词模式">
                {VISUALIZER_REGISTRY.map((entry) => (
                    <button
                        key={entry.mode}
                        type="button"
                        role="tab"
                        aria-selected={entry.mode === mode}
                        className={`${styles.mode}${entry.mode === mode ? ` ${styles['mode-on']}` : ''}`}
                        onClick={() => setMode(entry.mode)}
                    >
                        {modeLabel(entry)}
                    </button>
                ))}
            </div>

            {/* --- the tuning drawer's handle ------------------------------ */}
            <button
                type="button"
                className={`${styles.gear}${settingsOpen ? ` ${styles['gear-on']}` : ''}`}
                onClick={() => setSettingsOpen((open) => !open)}
                aria-label={settingsOpen ? '收起歌词动画设置' : '打开歌词动画设置'}
                aria-expanded={settingsOpen}
            >
                <IconGear size={19} />
            </button>

            {/* --- the song, centred over the stage ------------------------- */}
            <div className={styles.now} aria-live="polite">
                <span className={styles['now-title']}>{title}</span>
                <span className={styles['now-artist']}>{artist}</span>
            </div>

            {/* --- the play bar -------------------------------------------- */}
            <div className={styles.bar}>
                <span
                    className={styles.cover}
                    style={{ backgroundImage: `url("${coverUrl}")` }}
                    aria-hidden="true"
                />

                <div className={styles.controls}>
                    <button
                        type="button"
                        className={`${styles['icon-btn']}${shuffle ? ` ${styles['icon-on']}` : ''}`}
                        onClick={cycleRepeat}
                        aria-label="播放模式"
                    >
                        {repeat === 'one' ? <IconRepeatOne /> : shuffle ? <IconShuffle /> : <IconRepeat />}
                    </button>
                    <button type="button" className={styles['icon-btn']} onClick={playPrev} aria-label="上一首">
                        <IconPrev />
                    </button>
                    <button
                        type="button"
                        className={`${styles['icon-btn']} ${styles['icon-play']}`}
                        onClick={togglePlay}
                        aria-label={isPlaying ? '暂停' : '播放'}
                    >
                        {isPlaying ? <IconPause /> : <IconPlay />}
                    </button>
                    <button type="button" className={styles['icon-btn']} onClick={playNext} aria-label="下一首">
                        <IconNext />
                    </button>
                    <button
                        type="button"
                        className={`${styles['icon-btn']}${current && isLiked(current.track) ? ` ${styles['icon-on']}` : ''}`}
                        onClick={() => { if (current) toggleLike(current.track); }}
                        aria-label="喜欢"
                    >
                        <IconHeart filled={Boolean(current && isLiked(current.track))} />
                    </button>
                </div>

                <div className={styles.seek}>
                    <span className={styles.time}>{formatTime(progress.time)}</span>
                    <input
                        className={styles.range}
                        type="range"
                        min="0"
                        max={Math.max(1, Math.floor(progress.duration) || 1)}
                        step="1"
                        value={Math.min(Math.floor(progress.time) || 0, Math.floor(progress.duration) || 1)}
                        onChange={onSeekBar}
                        aria-label="播放进度"
                    />
                    <span className={styles.time}>{formatTime(progress.duration)}</span>
                </div>
            </div>

            {/* --- the track list ------------------------------------------- */}
            {/*
              * folia's two library views, unmodified, fed by our library.
              * `visibleTracks` is this site's queue — `playNext`/`playPrev` walk
              * it and the search/只看喜欢 filters narrow it — so it maps onto
              * `playQueue` directly. `PcQueue` owns the adaptation, the two row
              * actions this app actually has (置顶 / 喜欢) and the 列表/轮播
              * switch; see its header for why folia's three did not carry over.
              */}
            <aside className={styles.list}>
                {/*
                  * folia's `QueueTab` renders 「播放列表为空」 for an empty queue,
                  * and an empty queue is exactly what this page has for the first
                  * few hundred milliseconds while the library loads. So the
                  * loading state is ours and it short-circuits the panel rather
                  * than letting that message flash — the same guard the previous
                  * list had, kept because it is a fact about *this* app's data,
                  * not a design choice borrowed from folia.
                  *
                  * It also means `PcQueue` is never mounted while loading, which
                  * is why it passes `isLoading={false}` down to `Carousel3D`.
                  */}
                {listLoading && visibleTracks.length === 0 ? (
                    <p className={styles['list-loading']}>正在载入曲库…</p>
                ) : (
                    <PcQueue
                        tracks={visibleTracks}
                        current={current}
                        onPick={toggleTrack}
                        isPinned={isPinned}
                        togglePin={togglePin}
                        isLiked={isLiked}
                        toggleLike={toggleLike}
                        view={listView}
                        onViewChange={setListView}
                    />
                )}
            </aside>

            {/* --- folia's tuning drawer, one panel per mode --------------- */}
            {settingsOpen && (
                <PcSettings
                    mode={mode}
                    theme={theme}
                    onClose={() => setSettingsOpen(false)}
                />
            )}

            {(error || notice) && (
                <div className={`${styles.toast}${error ? ` ${styles['toast-error']}` : ''}`} role="status">
                    {error || notice}
                </div>
            )}

            <PlayerAudio
                audioRef={audioRef}
                crossOrigin="anonymous"
                onEnded={onEnded}
                onPlay={onPlay}
                onPause={onPause}
                onTimeUpdate={onTimeUpdate}
                onMetadata={onMetadata}
            />
        </div>
    );
};

export default PcApp;
