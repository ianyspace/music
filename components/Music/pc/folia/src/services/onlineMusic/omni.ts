/**
 * Shim for folia's `src/services/onlineMusic/omni.ts`.
 *
 * Upstream `omni` is the single façade over every online music provider —
 * search, playback, likes, FM, playlists… roughly 700 lines. The `/pc` page
 * plays the visitor's own library only, so the two questions the visualizer
 * actually asks are answered without any provider at all:
 *
 *   - `canLikeSong` — "is 喜爱 allowed for this song?" Our songs are local
 *     files, and likes are owned by `components/Music/likes.js`, so yes.
 *   - `getProviderLabel` — a human name for a source id, used in the
 *     "provider does not support likes" message that can no longer fire.
 */

import type { SongResult } from '../../types';
import type { OnlineProviderId } from '../../types/onlineMusic';

export const omni = {
    /** Local-library songs are always likeable; see `components/Music/likes.js`. */
    canLikeSong: (_song?: SongResult | null): boolean => true,

    getProviderLabel: (providerId?: OnlineProviderId | null): string => (providerId ? String(providerId) : ''),
};

export type OmniService = typeof omni;

export default omni;
