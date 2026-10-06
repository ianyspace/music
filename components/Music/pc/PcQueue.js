import React, { useCallback, useMemo, useRef } from 'react';
import { Heart, LayoutGrid, List as ListIcon, PanelsTopLeft, Pin } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import Carousel3D from './folia/src/components/Carousel3D';
import QueueTab from './folia/src/components/panelTab/QueueTab';
import { coverUrlOf } from '../librarySource';
import { parseTrackName } from '../shared';
import { songIdOf, toQueueSongs, trackOfSong } from './foliaQueue';

import styles from './PcQueue.module.scss';

/**
 * The left column of `/pc` — folia's library views, fed by **our** library.
 *
 * Two views, one list. `QueueTab` is the flat queue; `Carousel3D` is the 3D
 * cover flow. Both are vendored verbatim; this file is the whole adaptation.
 *
 * Three things are ours, and each is a deliberate substitution rather than an
 * omission:
 *
 * 1. **The data.** `visibleTracks` from `usePlayer` *is* the play queue on this
 *    site: `playNext` and `playPrev` walk it, and a search or 只看喜欢 narrows
 *    it. So it maps onto `playQueue` exactly, and the row folia marks as current
 *    is the song our player is on. `foliaQueue` does the shape translation.
 *
 * 2. **Clicking a song** calls `toggleTrack`, not folia's `onPlaySong`. That is
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
 *
 * The view switch lives in the panel header in both directions: `QueueTab`
 * takes it through its `headerActions` slot, and the carousel branch renders a
 * header row with the *same* class string, so the two read as one control that
 * happens to swap the body underneath it.
 *
 * A second header button opens the **queue collage** (folia's Lattice). It is
 * not a third view of this column: the collage is a whole-page surface — an
 * infinitely pannable wall of covers — so it takes over the viewport instead of
 * replacing the panel body. It sits next to the view switch because it is the
 * same kind of thing to the visitor ("show me the queue a different way"), and
 * it keeps the same class string so the two read as one control strip.
 */
const PcQueue = function ({
    tracks,
    current,
    onPick,
    isPinned,
    togglePin,
    isLiked,
    toggleLike,
    view,
    onViewChange,
    onOpenLattice,
}) {
    const { t } = useTranslation();
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

    /* --- the cover flow --------------------------------------------------- */

    // One card per **song**, which is what `/pc` asked for. folia's own carousel
    // shows albums, and this library has no album metadata — only filenames
    // (`{ id, key, name, url, coverUrl }` out of the R2 Worker). Grouping would
    // have to be invented; showing the songs themselves invents nothing.
    //
    // `trackCount` is left off on purpose so a card's second line carries the
    // artist alone — see the meta-line note in `Carousel3D`.
    const carouselItems = useMemo(() => tracks.map((track) => {
        const meta = parseTrackName(track.name);
        return {
            id: songIdOf(track),
            name: meta.title,
            coverUrl: coverUrlOf(track) || undefined,
            description: meta.artist || undefined,
        };
    }), [tracks]);

    // Opens on the song that is playing, the same thing the list does when it
    // scrolls to the current row.
    const focusedIndex = useMemo(() => {
        if (!current) return 0;
        const id = songIdOf(current.track);
        const found = tracks.findIndex((track) => songIdOf(track) === id);
        return found >= 0 ? found : 0;
    }, [current, tracks]);

    const handleCarouselSelect = useCallback((item) => {
        const track = trackOfSong(item, tracks);
        if (track) onPick(track);
    }, [onPick, tracks]);

    /* --- the view switch, identical in both headers ----------------------- */

    const inCarousel = view === 'carousel';
    const toggle = (
        <button
            type="button"
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors opacity-60 hover:opacity-100"
            title={inCarousel ? '列表' : '封面轮播'}
            aria-label={inCarousel ? '切换到列表' : '切换到封面轮播'}
            aria-pressed={inCarousel}
            onClick={() => onViewChange(inCarousel ? 'list' : 'carousel')}
        >
            {inCarousel ? <ListIcon size={14} /> : <LayoutGrid size={14} />}
        </button>
    );

    // folia's own icon for the wall (`PanelsTopLeft`, the one its 歌曲墙 player
    // slot uses), at the same 14px as the view switch. No `aria-pressed`: it
    // navigates, it does not toggle a state that stays on screen.
    const latticeButton = (
        <button
            type="button"
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors opacity-60 hover:opacity-100"
            title="队列拼贴"
            aria-label="打开队列拼贴"
            onClick={onOpenLattice}
        >
            <PanelsTopLeft size={14} />
        </button>
    );

    // Byte-for-byte the header row `QueueTab` renders, so switching views does
    // not move the title or the buttons.
    const header = (
        <div className="flex items-center justify-between px-2 pb-2 shrink-0">
            <span className="text-xs font-medium opacity-60">
                {t('queue.title')} ({tracks.length})
            </span>
            <div className="flex items-center gap-1">{toggle}{latticeButton}</div>
        </div>
    );

    if (inCarousel) {
        return (
            <div className={styles.queue}>
                {header}
                <div className={styles.carousel}>
                    <Carousel3D
                        items={carouselItems}
                        onSelect={handleCarouselSelect}
                        // Deliberately `false`. `PcApp` mounts this panel only
                        // once the library has resolved — it renders its own
                        // 「正在载入曲库…」 instead — so there is no loading state
                        // to report here. And `Carousel3D` puts `isLoading`
                        // *above* its `items.length > 0` branch, so a flag that
                        // was still true would hide a perfectly good set of
                        // covers behind a spinner.
                        isLoading={false}
                        emptyMessage={t('queue.empty')}
                        initialFocusedIndex={focusedIndex}
                        // `hasFloatingPlayer` is true because `/pc` does have
                        // one: the play bar sits over the stage, and folia uses
                        // the flag to reserve room for it.
                        hasFloatingPlayer
                        // The panel is widened for this view (`.page-carousel
                        // .list`), because the focus ring behind the active
                        // cover is a fixed 340px and `.carousel` clips: at the
                        // list view's 300px column the ring would be cut down to
                        // a sliver. Widened, it fits with room to spare, and
                        // folia's own size ladder is left alone — the container
                        // stays under its 768px desktop threshold, so covers
                        // render at its narrow size (224px), which is the size it
                        // uses on a phone and the right one for a 538px column.
                        //
                        // `compactLayout` stays `false` so the *compact* branch
                        // — which also shrinks the stage and the gaps — is never
                        // taken; the size ladder above is what picks the metrics.
                        compactLayout={false}
                    />
                </div>
            </div>
        );
    }

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
                headerActions={<>{toggle}{latticeButton}</>}
                // Fills the sidebar. Folia's own 250px / max-h-[300px] pair is for
                // a panel that sits under a header inside a 300px box.
                listHeight="100%"
                maxHeightClass=""
            />
        </div>
    );
};

export default PcQueue;
