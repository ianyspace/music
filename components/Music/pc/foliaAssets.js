import {
    buildStoredCappellaAvatar,
    clearCustomCappellaAvatar,
    getCustomCappellaAvatar,
    isSupportedCappellaAvatarFile,
    saveCustomCappellaAvatar,
} from './folia/src/services/cappellaAvatarPack';
import {
    buildStoredCappellaEmojiPack,
    clearCustomCappellaEmojiPack,
    getCustomCappellaEmojiPack,
    isSupportedCappellaEmojiFile,
    saveCustomCappellaEmojiPack,
} from './folia/src/services/cappellaEmojiPack';
import {
    buildStoredMonetBackgroundImage,
    clearMonetBackgroundImage,
    getMonetBackgroundImage,
    isSupportedMonetBackgroundFile,
    saveMonetBackgroundImage,
} from './folia/src/services/monetBackgroundImage';
import {
    buildStoredMonetPortraitImage,
    clearMonetPortraitImage,
    getMonetPortraitImage,
    isSupportedMonetPortraitFile,
    saveMonetPortraitImage,
} from './folia/src/services/monetPortraitImage';
import { useVisualizerAssetStore } from './folia/src/stores/useVisualizerAssetStore';

/**
 * folia's user-supplied artwork, restored into its asset store.
 *
 * folia's own `App.tsx` does this at startup, and it is the only thing standing
 * between a saved emoji pack and the panel that shows it. The store opens every
 * pack with `isLoading…: true` — a panel that reads that flag renders its
 * "loading" state — so a page that never runs the restore does not merely fail
 * to show the artwork, it shows a spinner forever.
 *
 * `App.tsx` was not vendored (it is the whole app shell), so this is that one
 * effect, kept next to the services it calls. The blobs live in IndexedDB under
 * `services/db.ts`, which is a shim, so the storage side is ours while the
 * loading side is folia's, unchanged.
 *
 * Object URLs are minted once per asset and never revoked: they are held by the
 * store for the life of the page, exactly as folia holds them.
 */
const toImageAsset = function (stored) {
    return {
        id: stored.id,
        name: stored.name,
        url: URL.createObjectURL(stored.blob),
    };
};

const toImageAssets = function (stored) {
    return Array.isArray(stored) ? stored.map(toImageAsset) : [];
};

export const restoreFoliaAssets = async function () {
    const [emoji, avatar, monetBackground, monetPortrait] = await Promise.all([
        getCustomCappellaEmojiPack().catch(() => []),
        getCustomCappellaAvatar().catch(() => []),
        getMonetBackgroundImage().catch(() => null),
        getMonetPortraitImage().catch(() => null),
    ]);

    const store = useVisualizerAssetStore.getState();

    store.setStoredCappellaEmojiPack(emoji);
    store.setCappellaCustomEmojiImages(toImageAssets(emoji));
    store.setIsLoadingCappellaCustomEmojiPack(false);

    store.setStoredCappellaAvatarPack(avatar);
    store.setCappellaCustomAvatarImages(toImageAssets(avatar));
    store.setIsLoadingCappellaCustomAvatarPack(false);

    store.setStoredMonetBackgroundImage(monetBackground);
    store.setMonetBackgroundImage(monetBackground ? toImageAsset(monetBackground) : null);
    store.setIsLoadingMonetBackgroundImage(false);

    store.setStoredMonetPortraitImage(monetPortrait);
    store.setMonetPortraitImage(monetPortrait ? toImageAsset(monetPortrait) : null);
    store.setIsLoadingMonetPortraitImage(false);
};

/**
 * The four `onImport…` / `onClear…` pairs folia's settings panels expect,
 * rebuilt against its own services and asset store.
 *
 * Each one returns `{ ok, error }` rather than throwing — that is the contract
 * the panels render feedback from (`CappellaSettingsPanel` prints the string
 * under the upload button), so a rejection here would surface as an unhandled
 * promise instead of a message.
 */
const importPack = async function (files, { isSupported, build, save, key, imagesKey, loadingKey, emptyError }) {
    const accepted = files.filter(isSupported);
    if (accepted.length === 0) return { ok: false, error: emptyError };

    const store = useVisualizerAssetStore.getState();
    const existing = store[key] || [];
    const next = [...existing, ...build(accepted)];

    store[loadingKey](true);
    try {
        await save(next);
        store[key](next);
        store[imagesKey](toImageAssets(next));
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error && error.message ? error.message : '保存失败' };
    } finally {
        store[loadingKey](false);
    }
};

const clearPack = async function ({ clear, key, imagesKey, loadingKey }) {
    const store = useVisualizerAssetStore.getState();
    store[loadingKey](true);
    try {
        await clear();
        store[key]([]);
        store[imagesKey]([]);
    } finally {
        store[loadingKey](false);
    }
};

export const foliaAssetActions = {
    importCappellaEmojiPack: (files) => importPack(files, {
        isSupported: isSupportedCappellaEmojiFile,
        build: buildStoredCappellaEmojiPack,
        save: saveCustomCappellaEmojiPack,
        key: 'storedCappellaEmojiPack',
        imagesKey: 'setCappellaCustomEmojiImages',
        loadingKey: 'setIsLoadingCappellaCustomEmojiPack',
        emptyError: '没有可用的图片文件',
    }),
    clearCappellaEmojiPack: () => clearPack({
        clear: clearCustomCappellaEmojiPack,
        key: 'storedCappellaEmojiPack',
        imagesKey: 'setCappellaCustomEmojiImages',
        loadingKey: 'setIsLoadingCappellaCustomEmojiPack',
    }),
    importCappellaAvatar: (files) => importPack(files, {
        isSupported: isSupportedCappellaAvatarFile,
        build: buildStoredCappellaAvatar,
        save: saveCustomCappellaAvatar,
        key: 'storedCappellaAvatarPack',
        imagesKey: 'setCappellaCustomAvatarImages',
        loadingKey: 'setIsLoadingCappellaCustomAvatarPack',
        emptyError: '没有可用的图片文件',
    }),
    clearCappellaAvatar: () => clearPack({
        clear: clearCustomCappellaAvatar,
        key: 'storedCappellaAvatarPack',
        imagesKey: 'setCappellaCustomAvatarImages',
        loadingKey: 'setIsLoadingCappellaCustomAvatarPack',
    }),
    importMonetBackground: async function (files) {
        const file = files.find(isSupportedMonetBackgroundFile);
        if (!file) return { ok: false, error: '没有可用的图片文件' };
        const store = useVisualizerAssetStore.getState();
        store.setIsLoadingMonetBackgroundImage(true);
        try {
            const stored = buildStoredMonetBackgroundImage(file);
            await saveMonetBackgroundImage(stored);
            store.setStoredMonetBackgroundImage(stored);
            store.setMonetBackgroundImage(toImageAsset(stored));
            return { ok: true };
        } catch (error) {
            return { ok: false, error: error && error.message ? error.message : '保存失败' };
        } finally {
            store.setIsLoadingMonetBackgroundImage(false);
        }
    },
    clearMonetBackground: async function () {
        const store = useVisualizerAssetStore.getState();
        store.setIsLoadingMonetBackgroundImage(true);
        try {
            await clearMonetBackgroundImage();
            store.setStoredMonetBackgroundImage(null);
            store.setMonetBackgroundImage(null);
        } finally {
            store.setIsLoadingMonetBackgroundImage(false);
        }
    },
    importMonetPortrait: async function (files) {
        const file = files.find(isSupportedMonetPortraitFile);
        if (!file) return { ok: false, error: '没有可用的图片文件' };
        const store = useVisualizerAssetStore.getState();
        store.setIsLoadingMonetPortraitImage(true);
        try {
            const stored = buildStoredMonetPortraitImage(file);
            await saveMonetPortraitImage(stored);
            store.setStoredMonetPortraitImage(stored);
            store.setMonetPortraitImage(toImageAsset(stored));
            return { ok: true };
        } catch (error) {
            return { ok: false, error: error && error.message ? error.message : '保存失败' };
        } finally {
            store.setIsLoadingMonetPortraitImage(false);
        }
    },
    clearMonetPortrait: async function () {
        const store = useVisualizerAssetStore.getState();
        store.setIsLoadingMonetPortraitImage(true);
        try {
            await clearMonetPortraitImage();
            store.setStoredMonetPortraitImage(null);
            store.setMonetPortraitImage(null);
        } finally {
            store.setIsLoadingMonetPortraitImage(false);
        }
    },
};
