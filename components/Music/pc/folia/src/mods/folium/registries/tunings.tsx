/**
 * Shim for folia's `src/mods/folium/registries/tunings.tsx`.
 *
 * Upstream a mod can *tune* a builtin mode: it declares numeric keys the mode
 * exposes (`foliumTunables`), and `useFoliumTunings(mode)` hands the renderer
 * the merged multipliers. The renderer treats a missing key as the identity
 * value, so with no mods the object is simply empty.
 *
 * `useFoliumTunings` must return a **stable** reference — it is called during
 * render in `VisualizerSonnet` and other modes, and a fresh `{}` every call
 * would re-render forever. One frozen module-level object does that.
 */

import React from 'react';
import type { Theme } from '@/types';
import type { FoliumRegistry, FoliumRegistryEntry } from '../registry';
import { createFoliumRegistry } from '../registry';

export const tuningsRegistry: FoliumRegistry = createFoliumRegistry('tunings');

const EMPTY_TUNINGS: Readonly<Record<string, number>> = Object.freeze({});

/** Merged multipliers for one mode — none, because no mod is running. */
export const readFoliumTunings = (_target: string): Readonly<Record<string, number>> => EMPTY_TUNINGS;

export const useFoliumTunings = (_target: string): Readonly<Record<string, number>> => EMPTY_TUNINGS;

/** The tuning cards of every mod targeting `mode` — none, so nothing renders. */
export const FoliumTuningCards: React.FC<{
    mode: string;
    theme: Theme;
    isDaylight: boolean;
    controlCardBg: string;
    rangeInputClass: string;
    description: string;
}> = () => null;

export type { FoliumRegistryEntry };
