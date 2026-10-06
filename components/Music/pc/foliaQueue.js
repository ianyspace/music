import { audioCacheKey, coverUrlOf } from '../librarySource';
import { parseTrackName } from '../shared';

/**
 * The one place where **our** library meets **folia's** song model.
 *
 * folia's panel components are typed against `SongResult` — a song as an online
 * provider describes it: an id, a name, `artists[]`, an `album`, a duration, and
 * a `sourceRef` that says where the bytes live. Our tracks are the opposite:
 * a flat file entry (`{ id, name, source, url, coverUrl, lyricsUrl }`) whose
 * title and artist are still glued together in the filename.
 *
 * So this module is a pure adapter, and it only ever runs in one direction at
 * the render boundary. Two decisions worth spelling out:
 *
 * 1. **`id` is `audioCacheKey(track)`, not `track.id`.** Our ids are unique per
 *    *source*, not globally — the public library and the Drive library can both
 *    hand out `123`. folia's queue identity is `sourceRef.kind + ':' + mediaId`,
 *    so a bare `track.id` would collapse two different songs into one row and
 *    make the "current row" marker light up twice. `audioCacheKey` is already
 *    `source:id`, which is exactly the granularity needed.
 *
 * 2. **The title and artist are split here, once.** folia's row renders
 *    `song.name` as the title and the joined artist names underneath. Our
 *    filename carries both (`童年收-F.Be.I音乐团队.mp3`), and `parseTrackName` is
 *    the same splitter the `/h5` and `/desktop` rows use — reusing it is what
 *    keeps the three layouts showing the same two lines for the same file.
 *
 * Everything else is deliberately empty rather than invented: `durationMs` is 0
 * because the list does not know it until the file is fetched, and the row does
 * not render a duration.
 */

/**
 * Builds the `SongResult` folia's panel components expect.
 *
 * The original track is *not* attached to the result — callers get back to it
 * through `songIdOf`, which is a string lookup. Attaching it would survive a
 * structuredClone into a worker and quietly become a second source of truth.
 */
export const toQueueSong = function (track) {
    const id = audioCacheKey(track);
    const { title, artist } = parseTrackName(track.name);
    const coverUrl = coverUrlOf(track);

    return {
        id,
        name: title,
        artists: artist ? [{ id: 0, name: artist }] : [],
        album: {
            id: 0,
            name: '',
            ...(coverUrl ? { coverUrl } : {}),
        },
        durationMs: 0,
        // `local` is not one of folia's online provider ids — it is the kind the
        // rest of `appPlaybackGuards` already understands for a local file, and
        // it is what makes `getPlaybackSongKey` return `local:<source>:<id>`.
        sourceRef: { kind: 'local', mediaId: id },
    };
};

/** The `SongResult.id` a given track turns into. */
export const songIdOf = function (track) {
    return audioCacheKey(track);
};

/**
 * Maps a list of tracks to folia's shape, memo-friendly.
 *
 * Returned as a plain array in the same order, so `playQueue[index]` and the
 * host's own index both address the same song.
 */
export const toQueueSongs = function (tracks) {
    return tracks.map(toQueueSong);
};

/** Finds the original track behind a `SongResult` handed back by a folia callback. */
export const trackOfSong = function (song, tracks) {
    if (!song || !Array.isArray(tracks)) return null;
    const id = String(song.id);
    for (let i = 0; i < tracks.length; i += 1) {
        if (songIdOf(tracks[i]) === id) return tracks[i];
    }
    return null;
};
