/**
 * Shim for folia's `src/mods/folium/missingEntries.ts`.
 *
 * Upstream this exists to be *honest about a mod that is not running*: a saved
 * selection pointing at `mod:<modid>:<name>` is not rewritten, and the UI says
 * which mod it belongs to. With no mod platform on this page, a saved value can
 * never be a mod entry, so the list is always empty and the restore pass has
 * nothing to do.
 */

import type { FoliumRegistryEntry } from './registry';

export interface MissingFoliumSelection {
    kind: 'visualizer' | 'background';
    mode: string;
    modId: string;
}

const EMPTY_MISSING: readonly MissingFoliumSelection[] = Object.freeze([]);

export const restoreSavedFoliumSelections = (): void => { /* no mods to restore */ };

export const useMissingFoliumSelections = (): MissingFoliumSelection[] => EMPTY_MISSING as MissingFoliumSelection[];

export type { FoliumRegistryEntry };
