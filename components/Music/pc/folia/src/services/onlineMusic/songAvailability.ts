/**
 * Shim for folia's `src/services/onlineMusic/songAvailability.ts`.
 *
 * Upstream asks the *provider registry* whether a song is still playable — the
 * Chinese streaming services delist tracks without notice, so folia renders an
 * 「已下架」 tag and greys the row out. `/pc` has no online sources: every track
 * comes out of the visitor's own library (`components/Music/librarySource`),
 * which means every row in it is, by construction, a file we can fetch.
 *
 * So the answer is always `playable`, and the tag never renders. The shape is
 * kept identical to upstream (`{ state, label? }`) so the consumers — folia's
 * `QueueTab` row, the 「已下架」 label lookup — compile and behave unchanged.
 *
 * `getSongReplacement` has no provider to ask, so it resolves to `null`, which
 * upstream already treats as "no replacement offered".
 */

import type { SongResult } from '../../types';
import type { ProviderSongAvailability, ProviderSongReplacement } from '../../types/onlineMusic';

const PLAYABLE: ProviderSongAvailability = { state: 'playable' };

export const getSongAvailability = (_song: SongResult): ProviderSongAvailability => PLAYABLE;

export const isSongUnavailable = (_song: SongResult | null | undefined): boolean => false;

export const getSongUnavailableLabel = (
    _song: SongResult | null | undefined,
    fallbackLabel: string,
): string => fallbackLabel;

export const getSongReplacement = async (
    _song: SongResult,
): Promise<ProviderSongReplacement | null> => null;
