/**
 * Shim for folia's `src/mods/folium/registries/backgrounds.tsx`.
 *
 * Mods may contribute whole background modes. None do here, so the registry is
 * inert.
 */

import type { FoliumRegistry } from '../registry';
import { createFoliumRegistry } from '../registry';

export const backgroundsRegistry: FoliumRegistry = createFoliumRegistry('backgrounds');

export default backgroundsRegistry;
