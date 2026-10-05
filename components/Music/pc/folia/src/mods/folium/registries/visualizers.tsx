/**
 * Shim for folia's `src/mods/folium/registries/visualizers.tsx`.
 *
 * Mods may contribute whole visualizer modes. None do here, so the registry is
 * inert and the settings panel's "missing mod selection" list stays empty.
 */

import type { FoliumRegistry } from '../registry';
import { createFoliumRegistry } from '../registry';

export const visualizersRegistry: FoliumRegistry = createFoliumRegistry('visualizers');

export default visualizersRegistry;
