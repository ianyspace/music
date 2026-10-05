/**
 * Shim for folia's `src/mods/folium/registry.ts`.
 *
 * Folium is folia's desktop-only mod platform: mods register visualizer
 * backgrounds, stage layers, tunings and command-palette entries at runtime.
 * The `/pc` page takes the visualizer and leaves the mod system behind, so the
 * registry is kept as an inert object with the same reading surface.
 *
 * With no mods registered the upstream hooks already return `[]` — this is that
 * state, made permanent.
 */

import { useSyncExternalStore } from 'react';

export interface FoliumRegistryEntry<T = unknown> {
    id: string;
    modId: string;
    def: T;
}

export interface FoliumRegistry<T = unknown> {
    kind: string;
    list: () => readonly FoliumRegistryEntry<T>[];
    subscribe: (listener: () => void) => () => void;
    register: (...args: unknown[]) => boolean;
    unregister: (id: string) => boolean;
}

const EMPTY: readonly FoliumRegistryEntry[] = Object.freeze([]);
const NOOP_UNSUBSCRIBE = () => { /* nothing to unsubscribe from */ };

export const createFoliumRegistry = function <T = unknown>(kind: string): FoliumRegistry<T> {
    return {
        kind,
        list: () => EMPTY as readonly FoliumRegistryEntry<T>[],
        subscribe: () => NOOP_UNSUBSCRIBE,
        register: () => false,
        unregister: () => false,
    };
};

export const useFoliumRegistryEntries = function <T = unknown>(
    _registry: FoliumRegistry<T>,
): readonly FoliumRegistryEntry<T>[] {
    return useSyncExternalStore(
        () => NOOP_UNSUBSCRIBE,
        () => EMPTY as readonly FoliumRegistryEntry<T>[],
        () => EMPTY as readonly FoliumRegistryEntry<T>[],
    );
};
