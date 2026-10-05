/**
 * Shim for folia's `src/mods/folium/registries/stageLayers.tsx`.
 *
 * Upstream this slot is where **Folium mods** mount their own layers onto the
 * player page. Folium is the desktop-only mod platform, and the brief for the
 * `/pc` page is explicit: take the visualizer and its design, leave the mod
 * system behind. So the slot is kept as a component — `VisualizerShell` renders
 * it in three places — but it can never have entries, and therefore always
 * returns `null`, exactly like upstream does for a user with no mods.
 */

import React from 'react';
import type { Theme } from '@/types';

export type FoliumStageSlot = 'player.stage.back' | 'player.stage.front' | 'app.overlay';

export interface FoliumStageLayerDef {
    slot: FoliumStageSlot;
    mount: (...args: unknown[]) => unknown;
}

/** Present for API parity; nothing ever registers into it on this page. */
export const stageLayersRegistry = {
    entries: [] as { def: FoliumStageLayerDef }[],
    register: (_def: FoliumStageLayerDef) => false,
    unregister: (_id: string) => false,
};

export const FoliumStageLayerSlot: React.FC<{
    slot: FoliumStageSlot;
    theme: Theme;
    isDaylight: boolean;
    paused: boolean;
    className?: string;
}> = () => null;

export default FoliumStageLayerSlot;
