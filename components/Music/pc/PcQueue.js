import React, { useCallback, useMemo, useRef } from 'react';
import { Heart, Pin } from 'lucide-react';

import QueueTab from './folia/src/components/panelTab/QueueTab';
import { songIdOf, toQueueSongs, trackOfSong } from './foliaQueue';

import styles from './PcQueue.module.scss';

/**
 * The left column of `/pc` — folia's queue list, fed by **our** library.
 *
 * `QueueTab` is vendored verbatim; this file is the whole adaptation, and it is
 * deliberately thin. Everything below the header — the 50px rows, the vertical
 * marker on the current song, the title/artist pair, the hover-revealed action
 * strip, the `react-window` virtualisation — is folia's, unmodified.
 *
 * Three things are ours, and each is a deliberate substitution rather than an
 * omission:
 *
 * 1. **The data.** `visibleTracks` from `usePlayer` *is* the play queue on this
 *    site: `playNext` and `playPrev` walk it, and a search or 只看喜欢 narrows
 *    it. So it maps onto `playQueue` exactly, and the row folia marks as current
 *    is the song our player is on. `foliaQueue` does the shape translation.
 *
 * 2. **Clicking a row** calls `toggleTrack`, not folia's `onPlaySong`. That is
 *    this site's list-row behaviour everywhere else (`/h5`, `/desktop`): tapping
 *    the song that is already playing pauses it instead of restarting it. folia
 *    always restarts; adopting that would make `/pc` the one page where tapping
 *    a row behaves differently.
 *
 * 3. **The action strip.** folia's three are 下一首播放 / 移到队尾 / 从队列中删除,
 *    and all three assume a queue the host may rewrite. `/pc` has no queue of its
 *    own — the list is the library — so "move to end" has no meaning and
 *    "remove" would mean deleting the visitor's file. What this site *does* offer
 *    per song is 置顶 and 喜欢 (the two items in `/h5`'s row drawer), so those are
 *    the two buttons. The strip is otherwise untouched: same placement, same
 *    reveal-on-hover, same icon size.
 *
 * `onShuffle` is not passed. folia's is a one-shot "shuffle the queue order",
 * and this player's shuffle is a *mode* (`shuffle` + `repeat`, cycled by the
 * button on the play bar). Wiring the header button to the mode would put a
 * second, differently-behaving shuffle control on the same page.
 */
const PcQueue = function ({
    tracks,
    current,
    onPick,
    isPinned,
    togglePin,
    isLiked,
    toggleLike,
}) {
    const queueScrollRef = useRef(null);

    // The translation is memoised on `tracks` because `QueueTab` re-measures and
    // re-scrolls whenever `playQueue` changes identity — a fresh array per render
    // would keep yanking the list back to the current song.
    const songs = useMemo(() => toQueueSongs(tracks), [tracks]);

    // Built by looking the current track up *inside* `songs` rather than
    // translating it separately: `getPlaybackSongKey` compares by identity
    // string, and a second translation would be a second chance to disagree.
    const currentSong = useMemo(() => {
        if (!current) return null;
        const id = songIdOf(current.track);
        return songs.find((song) => song.id === id) || null;
    }, [current, songs]);

    const handlePlaySong = useCallback((song) => {
        const track = trackOfSong(song, tracks);
        if (track) onPick(track);
    }, [onPick, tracks]);

    const actions = useMemo(() => {
        const at = function (index) {
            return index >= 0 && index < tracks.length ? tracks[index] : null;
        };
        return [
            {
                label: '置顶',
                icon: Pin,
                active: (index) => {
                    const track = at(index);
                    return Boolean(track && isPinned(track));
                },
                run: (index) => {
                    const track = at(index);
                    if (track) togglePin(track);
                },
            },
            {
                label: '喜欢',
                icon: Heart,
                active: (index) => {
                    const track = at(index);
                    return Boolean(track && isLiked(track));
                },
                run: (index) => {
                    const track = at(index);
                    if (track) toggleLike(track);
                },
            },
        ];
    }, [tracks, isPinned, togglePin, isLiked, toggleLike]);

    return (
        <div className={styles.queue}>
            <QueueTab
                playQueue={songs}
                currentSong={currentSong}
                onPlaySong={handlePlaySong}
                queueScrollRef={queueScrollRef}
                // The list is always on screen here, so "follow the current song"
                // is always true. Folia only enables it while its queue panel is
                // open, which is the same condition seen from the other side.
                shouldScrollToCurrent
                actions={actions}
                // Fills the sidebar. Folia's own 250px / max-h-[300px] pair is for
                // a panel that sits under a header inside a 300px box.
                listHeight="100%"
                maxHeightClass=""
            />
        </div>
    );
};

export default PcQueue;
