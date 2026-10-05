import type { CappellaAvatarSource } from '../../../types';

// src/components/visualizer/cappella/avatarImages.ts
// Loads built-in Cappella avatar images and resolves the active avatar source.
export type CappellaAvatarSide = 'left' | 'right';

export interface CappellaAvatarImage {
    id: string;
    name: string;
    url: string;
}

interface ResolveCappellaAvatarUrlInput {
    avatarSource: CappellaAvatarSource;
    coverUrl?: string | null;
    avatarIndex: number;
    side: CappellaAvatarSide;
    seed?: string | number;
    avatars?: CappellaAvatarImage[];
    customAvatarImages?: CappellaAvatarImage[];
}

// Upstream: Vite's `import.meta.glob('./avatar/*.{png,...}', { eager: true })`,
// where each module's `default` was the asset URL string. Next's webpack turns
// an image import into a `StaticImageData` object instead, so `imageUrl()`
// unwraps either shape and the map keeps the same `{ default: url }` contract
// the rest of this file reads.
import avatar2 from './avatar/avatar2.png';
import avatar3 from './avatar/avatar3.png';
import avatar4 from './avatar/avatar4.png';
import avatar5 from './avatar/avatar5.png';
import avatar6 from './avatar/avatar6.png';
import avatar8 from './avatar/avatar8.png';
import avatar9 from './avatar/avatar9.png';
import avatar10 from './avatar/avatar10.png';
import avatar11 from './avatar/avatar11.png';
import avatar12 from './avatar/avatar12.png';
import avatar13 from './avatar/avatar13.png';
import avatar14 from './avatar/avatar14.png';
import avatar15 from './avatar/avatar15.png';
import avatar16 from './avatar/avatar16.png';
import avatar17 from './avatar/avatar17.png';

const imageUrl = (image: unknown): string => (
    typeof image === 'string' ? image : String((image as { src?: string } | null)?.src ?? '')
);

const avatarModules: Record<string, { default: string }> = {
    './avatar/avatar2.png': { default: imageUrl(avatar2) },
    './avatar/avatar3.png': { default: imageUrl(avatar3) },
    './avatar/avatar4.png': { default: imageUrl(avatar4) },
    './avatar/avatar5.png': { default: imageUrl(avatar5) },
    './avatar/avatar6.png': { default: imageUrl(avatar6) },
    './avatar/avatar8.png': { default: imageUrl(avatar8) },
    './avatar/avatar9.png': { default: imageUrl(avatar9) },
    './avatar/avatar10.png': { default: imageUrl(avatar10) },
    './avatar/avatar11.png': { default: imageUrl(avatar11) },
    './avatar/avatar12.png': { default: imageUrl(avatar12) },
    './avatar/avatar13.png': { default: imageUrl(avatar13) },
    './avatar/avatar14.png': { default: imageUrl(avatar14) },
    './avatar/avatar15.png': { default: imageUrl(avatar15) },
    './avatar/avatar16.png': { default: imageUrl(avatar16) },
    './avatar/avatar17.png': { default: imageUrl(avatar17) },
};

const toStableAvatarImages = (): CappellaAvatarImage[] =>
    Object.entries(avatarModules)
        .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
        .map(([path, mod]) => {
            const filename = path.split('/').pop() ?? '';
            const name = filename.replace(/\.[^.]+$/, '');
            return {
                id: `builtin-avatar-${name}`,
                name,
                url: mod.default,
            };
        });

export const builtinAvatarImages = toStableAvatarImages();

const hashString = (input: string) => {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const getSeededIndex = (seed: string | number, side: CappellaAvatarSide, length: number) =>
    hashString(`${seed}|${side}|${length}`) % length;

export const pickStableBuiltinAvatarImage = (
    avatars: CappellaAvatarImage[],
    avatarIndex: number,
    side: CappellaAvatarSide,
    seed: string | number = 'cappella',
): CappellaAvatarImage | null => {
    if (avatars.length === 0) {
        return null;
    }

    const rightAvatarIndex = getSeededIndex(seed, 'right', avatars.length);
    if (side === 'right') {
        return avatars[rightAvatarIndex] ?? null;
    }

    const leftAvatarPool = avatars.filter((_, index) => index !== rightAvatarIndex);
    if (leftAvatarPool.length === 0) {
        return avatars[rightAvatarIndex] ?? null;
    }

    const leftSeedOffset = getSeededIndex(seed, 'left', leftAvatarPool.length);
    const resolvedLeftIndex = Math.abs(Math.trunc(avatarIndex + leftSeedOffset)) % leftAvatarPool.length;
    return leftAvatarPool[resolvedLeftIndex] ?? null;
};

export const resolveCappellaAvatarUrl = ({
    avatarSource,
    coverUrl,
    avatarIndex,
    side,
    seed,
    avatars = builtinAvatarImages,
    customAvatarImages,
}: ResolveCappellaAvatarUrlInput): string | null => {
    if (avatarSource === 'color') {
        return null;
    }

    if (avatarSource === 'cover' && coverUrl) {
        return coverUrl;
    }

    if (avatarSource === 'custom' && customAvatarImages && customAvatarImages.length > 0) {
        return pickStableBuiltinAvatarImage(customAvatarImages, avatarIndex, side, seed)?.url ?? null;
    }

    return pickStableBuiltinAvatarImage(avatars, avatarIndex, side, seed)?.url ?? null;
};
