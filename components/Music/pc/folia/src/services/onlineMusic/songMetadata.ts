/**
 * Shim for folia's `src/services/onlineMusic/songMetadata.ts`.
 *
 * Upstream resolves metadata through the *provider registry* — each online
 * source (netease / kugou / qq / bodian) can override how a song's artists,
 * album and cover are read. The `/pc` page has no online sources at all: every
 * track comes from the visitor's own library (`components/Music/librarySource`),
 * so there is nothing to dispatch on.
 *
 * What is left is the fallback path the upstream file already had —
 * `createProviderSongMetadata` from `utils/songMetadata` — which reads the
 * plain `artists` / `album` fields the library gives us. Same return shape,
 * same empty-value conventions.
 */

import type { SongResult } from '../../types';
import type { OnlineProviderId, ProviderSongMetadata } from '../../types/onlineMusic';
import { createProviderSongMetadata } from '../../utils/songMetadata';

const EMPTY_METADATA: ProviderSongMetadata = {
    artists: [],
    album: { id: 0, name: '' },
    durationMs: 0,
    aliases: [],
    translatedNames: [],
};

export const getProviderSongMetadata = (
    song: SongResult | null | undefined,
    _providerId?: OnlineProviderId,
): ProviderSongMetadata => (song ? createProviderSongMetadata(song) : EMPTY_METADATA);

export const getSongArtistLabel = (song: SongResult | null | undefined, providerId?: OnlineProviderId): string => (
    song ? getProviderSongMetadata(song, providerId).artists.map((artist) => artist.name).filter(Boolean).join(', ') : ''
);

export const getSongAlbumLabel = (song: SongResult | null | undefined, providerId?: OnlineProviderId): string => (
    song ? getProviderSongMetadata(song, providerId).album?.name || '' : ''
);

export const getSongDurationMs = (song: SongResult | null | undefined, providerId?: OnlineProviderId): number => (
    song ? getProviderSongMetadata(song, providerId).durationMs : 0
);

export const getSongCoverUrl = (song: SongResult | null | undefined, providerId?: OnlineProviderId): string | undefined => (
    song ? getProviderSongMetadata(song, providerId).coverUrl : undefined
);

export const getProviderSongPageUrl = (): string | null => null;
