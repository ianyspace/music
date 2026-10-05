import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { foliaAssetActions } from './foliaAssets';
import { colorWithAlpha } from './folia/src/components/visualizer/colorMix';
import {
    getVisualizerBackgroundModeLabel,
    getVisualizerBackgroundRegistryEntry,
    VISUALIZER_BACKGROUND_REGISTRY,
} from './folia/src/components/visualizer/backgrounds/registry';
import {
    getVisualizerModeLabel,
    getVisualizerRegistryEntry,
} from './folia/src/components/visualizer/registry';
import { useVisualizerTunings } from './folia/src/components/visualizer/useVisualizerTunings';
import { useThemeSettingsStore } from './folia/src/stores/useThemeSettingsStore';
import { useVisualizerAssetStore } from './folia/src/stores/useVisualizerAssetStore';
import { useVisualizerSettingsStore } from './folia/src/stores/useVisualizerSettingsStore';
import { VISUALIZER_FRAME_RATE_OPTIONS } from './folia/src/utils/frameRateLimiter';

import styles from './PcSettings.module.scss';

// Imported for its side effect: folia's panels translate their own labels, and
// this is what puts the dictionaries in place before the first render.
import './folia/src/i18n/config';

/**
 * The tuning drawer for `/pc`.
 *
 * Almost none of this is a control *this page* owns. folia's per-mode panels
 * (`settingsPanels.tsx` plus the five mode-local ones) are vendored verbatim and
 * rendered through `entry.renderSettingsPanel` — the same registry indirection
 * folia uses, so a mode that grows a slider grows it here with no edit. What
 * this file supplies is the three things those panels cannot know about:
 *
 * 1. **The `t` they call.** folia's i18n bundle, not ours.
 * 2. **The `VisualizerSettingsPanelProps` shape.** The panels read
 *    `classicTuning` / `onClassicTuningChange`; the store publishes the bundle
 *    under `classic` and the setter under `handleSetClassicTuning`.
 *    `MODE_TUNING` is that mapping, spelled out rather than derived from a
 *    naming convention, so a rename in folia fails at the call site.
 * 3. **Persistence.** Every setter writes straight to folia's own store, which
 *    persists to `localStorage` under folia's keys. Nothing is re-implemented.
 *
 * `isDaylight` is hardcoded `false`: `/pc` is a dark stage by design (the theme
 * `foliaTheme.js` builds is always dark), so the panels must not be told to
 * paint light surfaces.
 */

// mode → the bundle key it reads and the two store actions that write it.
const MODE_TUNING = {
    classic: { key: 'classic', set: 'handleSetClassicTuning', reset: 'handleResetClassicTuning' },
    cadenza: { key: 'cadenza', set: 'handleSetCadenzaTuning', reset: 'handleResetCadenzaTuning' },
    partita: { key: 'partita', set: 'handleSetPartitaTuning', reset: 'handleResetPartitaTuning' },
    fume: { key: 'fume', set: 'handleSetFumeTuning', reset: 'handleResetFumeTuning' },
    claddagh: { key: 'claddagh', set: 'handleSetCladdaghTuning', reset: 'handleResetCladdaghTuning' },
    cappella: { key: 'cappella', set: 'handleSetCappellaTuning', reset: 'handleResetCappellaTuning' },
    tilt: { key: 'tilt', set: 'handleSetTiltTuning', reset: 'handleResetTiltTuning' },
    diorama: { key: 'diorama', set: 'handleSetDioramaTuning', reset: 'handleResetDioramaTuning' },
    monet: { key: 'monet', set: 'handleSetMonetTuning', reset: 'handleResetMonetTuning' },
    pendolo: { key: 'pendolo', set: 'handleSetPendoloTuning', reset: 'handleResetPendoloTuning' },
    sonnet: { key: 'sonnet', set: 'handleSetSonnetTuning', reset: 'handleResetSonnetTuning' },
    tempera: { key: 'tempera', set: 'handleSetTemperaTuning', reset: 'handleResetTemperaTuning' },
    lumiere: { key: 'lumiere', set: 'handleSetLumiereTuning', reset: 'handleResetLumiereTuning' },
};

// The `rangeInputClass` folia's own playground hands its panels. Kept as a
// literal copy: it is a Tailwind class string, and the scanner picks it up from
// this file (see `styles/tailwind.css`'s `@source`).
const RANGE_INPUT_CLASS = [
    'w-full h-1.5 rounded-full appearance-none cursor-pointer',
    '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:transition-transform',
    '[&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:transition-transform',
    'bg-white/10 [&::-webkit-slider-thumb]:bg-white [&::-moz-range-thumb]:bg-white',
].join(' ');

// Store actions are defined once and never replaced, so reading them off the
// store is a stable call — no subscription, no re-render on write.
const callStore = function (name, ...args) {
    const action = useVisualizerSettingsStore.getState()[name];
    if (typeof action === 'function') action(...args);
};

const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1);

const PcSettings = function ({ mode, theme, onClose }) {
    const { t } = useTranslation();

    const bundle = useVisualizerTunings();

    const settings = useVisualizerSettingsStore(useShallow((state) => ({
        backgroundMode: state.visualizerBackgroundMode,
        backgroundOpacity: state.backgroundOpacity,
        disableGeometricBackground: state.disableVisualizerGeometricBackground,
        disableVignette: state.disableVisualizerVignette,
        monetBackgroundTuning: state.monetBackgroundTuning,
        nomandBackgroundTuning: state.nomandBackgroundTuning,
        latentBackgroundTuning: state.latentBackgroundTuning,
        soraBackgroundTuning: state.soraBackgroundTuning,
        urlBackgroundList: state.urlBackgroundList,
        urlBackgroundSelectedId: state.urlBackgroundSelectedId,
        visualizerOpacity: state.visualizerOpacity,
        frameRate: state.visualizerFrameRate,
    })));

    const useCoverColorBg = useThemeSettingsStore((state) => state.useCoverColorBg);

    const assets = useVisualizerAssetStore(useShallow((state) => ({
        emojiImages: state.cappellaCustomEmojiImages,
        avatarImages: state.cappellaCustomAvatarImages,
        isLoadingEmoji: state.isLoadingCappellaCustomEmojiPack,
        isLoadingAvatar: state.isLoadingCappellaCustomAvatarPack,
        monetBackgroundImage: state.monetBackgroundImage,
        isLoadingMonetBackground: state.isLoadingMonetBackgroundImage,
        monetPortraitImage: state.monetPortraitImage,
        isLoadingMonetPortrait: state.isLoadingMonetPortraitImage,
    })));

    const entry = getVisualizerRegistryEntry(mode);
    const modeLabel = getVisualizerModeLabel(mode, t);
    const controlCardBg = colorWithAlpha(theme.backgroundColor, 0.52);

    /* --- the props folia's per-mode panel expects ------------------------- */

    const tuningPanelProps = useMemo(() => {
        const props = {
            t,
            isDaylight: false,
            theme,
            controlCardBg,
            rangeInputClass: RANGE_INPUT_CLASS,
        };

        Object.values(MODE_TUNING).forEach((spec) => {
            const value = bundle[spec.key];
            if (value === undefined) return;
            props[`${spec.key}Tuning`] = value;
            props[`on${capitalize(spec.key)}TuningChange`] = (patch) => callStore(spec.set, patch);
        });

        // The three panels that also own artwork. Without these the cappella and
        // monet panels render their "no image yet" state and the upload buttons
        // do nothing, because every one of these props is optional in the type.
        props.cappellaCustomEmojiImages = assets.emojiImages;
        props.cappellaCustomAvatarImages = assets.avatarImages;
        props.cappellaCustomEmojiCount = assets.emojiImages.length;
        props.hasCappellaCustomEmojiPack = assets.emojiImages.length > 0;
        props.hasCappellaCustomAvatar = assets.avatarImages.length > 0;
        props.isCappellaCustomEmojiPackLoading = assets.isLoadingEmoji;
        props.isCappellaCustomAvatarLoading = assets.isLoadingAvatar;
        props.onImportCappellaCustomEmojiPack = foliaAssetActions.importCappellaEmojiPack;
        props.onClearCappellaCustomEmojiPack = foliaAssetActions.clearCappellaEmojiPack;
        props.onImportCappellaCustomAvatar = foliaAssetActions.importCappellaAvatar;
        props.onClearCappellaCustomAvatar = foliaAssetActions.clearCappellaAvatar;
        props.monetPortraitImage = assets.monetPortraitImage;
        props.onUploadMonetPortraitImage = foliaAssetActions.importMonetPortrait;
        props.onClearMonetPortraitImage = foliaAssetActions.clearMonetPortrait;
        props.isLoadingMonetPortraitImage = assets.isLoadingMonetPortrait;

        return props;
    }, [t, theme, controlCardBg, bundle, assets]);

    /* --- the background half --------------------------------------------- */

    const backgroundConfig = useMemo(() => ({
        mode: settings.backgroundMode,
        common: {
            useCoverColorBg,
            opacity: settings.backgroundOpacity,
            disableGeometricBackground: settings.disableGeometricBackground,
            disableVignette: settings.disableVignette,
        },
        customImage: assets.monetBackgroundImage,
        monet: { tuning: settings.monetBackgroundTuning },
        nomand: { tuning: settings.nomandBackgroundTuning },
        latent: { tuning: settings.latentBackgroundTuning },
        sora: { tuning: settings.soraBackgroundTuning },
        url: {
            items: settings.urlBackgroundList,
            selectedId: settings.urlBackgroundSelectedId,
        },
    }), [settings, useCoverColorBg, assets.monetBackgroundImage]);

    const backgroundActions = useMemo(() => ({
        onModeChange: (next) => callStore('handleSetVisualizerBackgroundMode', next),
        common: {
            onCoverColorChange: (enabled) => useThemeSettingsStore.getState().handleToggleCoverColorBg(enabled),
            onOpacityChange: (opacity) => callStore('handleSetBackgroundOpacity', opacity),
            onDisableGeometricChange: (disabled) => callStore('handleToggleDisableVisualizerGeometricBackground', disabled),
            onDisableVignetteChange: (disabled) => callStore('handleToggleDisableVisualizerVignette', disabled),
        },
        customImage: {
            onUpload: foliaAssetActions.importMonetBackground,
            onClear: foliaAssetActions.clearMonetBackground,
            isLoading: assets.isLoadingMonetBackground,
        },
        monet: {
            onTuningChange: (patch) => callStore('handleSetMonetBackgroundTuning', patch),
            onResetTuning: () => callStore('handleResetMonetBackgroundTuning'),
        },
        nomand: {
            onTuningChange: (patch) => callStore('handleSetNomandBackgroundTuning', patch),
            onResetTuning: () => callStore('handleResetNomandBackgroundTuning'),
        },
        latent: {
            onTuningChange: (patch) => callStore('handleSetLatentBackgroundTuning', patch),
            onResetTuning: () => callStore('handleResetLatentBackgroundTuning'),
        },
        sora: {
            onTuningChange: (patch) => callStore('handleSetSoraBackgroundTuning', patch),
            onResetTuning: () => callStore('handleResetSoraBackgroundTuning'),
        },
        url: {
            onAdd: (item) => callStore('handleAddUrlBackgroundItem', item),
            onUpdate: (id, patch) => callStore('handleUpdateUrlBackgroundItem', id, patch),
            onDelete: (id) => callStore('handleDeleteUrlBackgroundItem', id),
            onSelect: (id) => callStore('handleSetUrlBackgroundSelectedId', id),
        },
    }), [assets.isLoadingMonetBackground]);

    const backgroundEntry = getVisualizerBackgroundRegistryEntry(
        settings.backgroundMode || VISUALIZER_BACKGROUND_REGISTRY[0].mode,
    );

    const backgroundPanelProps = useMemo(() => ({
        config: backgroundConfig,
        actions: backgroundActions,
        t,
        isDaylight: false,
        theme,
        controlCardBg,
        rangeInputClass: RANGE_INPUT_CLASS,
    }), [backgroundConfig, backgroundActions, t, theme, controlCardBg]);

    /* --- actions ---------------------------------------------------------- */

    const resetMode = useCallback(() => {
        const resets = {};
        Object.values(MODE_TUNING).forEach((spec) => {
            resets[`reset${capitalize(spec.key)}Tuning`] = () => callStore(spec.reset);
        });
        if (typeof entry.resetSettings === 'function') entry.resetSettings(resets);
        else {
            const spec = MODE_TUNING[mode];
            if (spec) callStore(spec.reset);
        }
    }, [entry, mode]);

    const hasPanel = typeof entry.renderSettingsPanel === 'function';
    const hasBackgroundPanel = typeof backgroundEntry.renderSettingsPanel === 'function';

    return (
        <aside className={styles.drawer} aria-label="歌词动画设置">
            <header className={styles.head}>
                <div className={styles['head-text']}>
                    <p className={styles['head-kicker']}>歌词动画设置</p>
                    <h2 className={styles['head-title']}>{modeLabel}</h2>
                </div>
                <button type="button" className={styles.close} onClick={onClose} aria-label="关闭设置">
                    ×
                </button>
            </header>

            <div className={styles.body}>
                <section className={styles.section}>
                    <h3 className={styles['section-title']}>动画参数</h3>
                    {hasPanel ? (
                        <div className={styles.panel}>{entry.renderSettingsPanel(tuningPanelProps)}</div>
                    ) : (
                        <p className={styles.empty}>这个模式没有可调参数。</p>
                    )}
                    <button type="button" className={styles.reset} onClick={resetMode}>
                        恢复该模式默认值
                    </button>
                </section>

                <section className={styles.section}>
                    <h3 className={styles['section-title']}>背景</h3>
                    <div className={styles.chips}>
                        {VISUALIZER_BACKGROUND_REGISTRY.map((bg) => {
                            const active = settings.backgroundMode === bg.mode;
                            return (
                                <button
                                    key={bg.mode}
                                    type="button"
                                    className={`${styles.chip}${active ? ` ${styles['chip-on']}` : ''}`}
                                    onClick={() => callStore('handleSetVisualizerBackgroundMode', bg.mode)}
                                >
                                    {getVisualizerBackgroundModeLabel(bg.mode, t)}
                                </button>
                            );
                        })}
                    </div>
                    {hasBackgroundPanel && (
                        <div className={styles.panel}>
                            {backgroundEntry.renderSettingsPanel(backgroundPanelProps)}
                        </div>
                    )}
                </section>

                <section className={styles.section}>
                    <h3 className={styles['section-title']}>画面</h3>

                    <div className={styles.row}>
                        <span className={styles['row-label']}>歌词动画整体透明度</span>
                        <span className={styles['row-value']}>
                            {Math.round(settings.visualizerOpacity * 100)}%
                        </span>
                    </div>
                    <input
                        type="range"
                        min="0.2"
                        max="1"
                        step="0.05"
                        value={settings.visualizerOpacity}
                        onChange={(event) => callStore('handleSetVisualizerOpacity', Number(event.target.value))}
                        className={RANGE_INPUT_CLASS}
                        aria-label="歌词动画整体透明度"
                    />

                    <div className={styles.row}>
                        <span className={styles['row-label']}>实验性帧率上限</span>
                        <span className={styles['row-value']}>
                            {settings.frameRate === 'off' ? '不限制' : `${settings.frameRate} fps`}
                        </span>
                    </div>
                    <div className={styles.chips}>
                        {['off', ...VISUALIZER_FRAME_RATE_OPTIONS].map((rate) => (
                            <button
                                key={String(rate)}
                                type="button"
                                className={`${styles.chip}${settings.frameRate === rate ? ` ${styles['chip-on']}` : ''}`}
                                onClick={() => callStore('handleSetVisualizerFrameRate', rate)}
                            >
                                {rate === 'off' ? '不限制' : `${rate} fps`}
                            </button>
                        ))}
                    </div>
                    <p className={styles.hint}>
                        限制 requestAnimationFrame 的帧率可以省电，但可能让动画出现意外跳动。
                    </p>
                </section>
            </div>
        </aside>
    );
};

export default PcSettings;
