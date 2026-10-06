import React from 'react';
import { motion } from 'framer-motion';
import { List, useListRef, type RowComponentProps } from 'react-window';
import { ListEnd, ListPlus, PanelsTopLeft, Shuffle, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SongResult } from '../../types';
import TextInputDialog from '../shared/TextInputDialog';
import { getSongUnavailableLabel, isSongUnavailable } from '../../services/onlineMusic/songAvailability';
import { getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';

// src/components/panelTab/QueueTab.tsx

interface QueueTabProps {
    playQueue: SongResult[];
    currentSong: SongResult | null;
    onPlaySong: (song: SongResult, queue: SongResult[]) => void;
    queueScrollRef: React.RefObject<HTMLDivElement | null>;
    shouldScrollToCurrent?: boolean;
    onShuffle?: () => void;
    /**
     * The three queue mutations. Optional because a host that supplies `actions`
     * never builds the default strip — see `actions` below.
     */
    onRemoveSong?: (index: number) => void;
    onMoveSongToEnd?: (index: number) => void;
    onMoveSongToNext?: (index: number) => void;
    canSaveLocalPlaylist?: boolean;
    /** Opens the same queue as a poster wall; absent when the host has no wall to show. */
    onOpenLattice?: () => void;
    onSaveCurrentQueueAsPlaylist?: (name: string) => Promise<void>;
    isDaylight?: boolean;
    /**
     * Replaces the row's hover strip with the host's own actions.
     *
     * Added for `/pc`. Folia's three actions assume the host owns a *mutable*
     * queue; `/pc` owns a *library* — there is no "move to end" to offer, and
     * "remove" would mean deleting the visitor's file. So the host passes the
     * ones it actually has (two), and the defaults are never built.
     *
     * Everything visual is untouched: same strip, same reveal-on-hover, same
     * icon size, same `p-1.5 rounded-md` buttons. Omit this prop and the
     * component behaves exactly as upstream.
     */
    actions?: QueueRowAction[];
    /**
     * Height of the scrolling list.
     *
     * Added for `/pc`, whose sidebar is full height — `'100%'` lets the list
     * fill it. Defaults to folia's own `CONTAINER_HEIGHT` of 250px, so the
     * panel-sized original is unchanged. react-window v2 measures its own box,
     * so a percentage works as long as the parent has a definite height (this
     * component's `flex-1` wrapper does).
     */
    listHeight?: number | string;
    /**
     * Tailwind class capping the panel's height. Defaults to folia's
     * `max-h-[300px]`; pass `''` for no cap.
     *
     * Taken as the whole class rather than appended, because two `max-h-*`
     * utilities on one element resolve by stylesheet order, not by the order
     * they appear in `className` — appending could not reliably win.
     */
    maxHeightClass?: string;
}

/** One button in a row's hover strip. */
export type QueueRowAction = {
    label: string;
    /**
     * `fill` is passed through to the icon so an action that can be *on* (置顶,
     * 喜欢) can render itself filled. lucide-react forwards unknown SVG props, so
     * `fill="currentColor"` is all a filled heart needs.
     */
    icon: React.ComponentType<{ size?: number | string; fill?: string }>;
    run: (index: number) => void;
    /** Whether the action currently applies to this row. Drives `aria-pressed` and the icon's fill. */
    active?: (index: number) => boolean;
};

type QueueRowProps = {
    playQueue: SongResult[];
    currentSongKey: string | null;
    onPlaySong: QueueTabProps['onPlaySong'];
    onMoveSongToNext?: QueueTabProps['onMoveSongToNext'];
    onMoveSongToEnd?: QueueTabProps['onMoveSongToEnd'];
    onRemoveSong?: QueueTabProps['onRemoveSong'];
    actions?: QueueRowAction[];
    isDaylight: boolean;
    labels: {
        unavailable: string;
        playNext: string;
        moveToEnd: string;
        remove: string;
    };
};

// Kept outside QueueTab so track changes update row data without remounting hovered action buttons.
const QueueRow = ({
    index,
    style,
    ariaAttributes,
    playQueue,
    currentSongKey,
    onPlaySong,
    onMoveSongToNext,
    onMoveSongToEnd,
    onRemoveSong,
    actions,
    isDaylight,
    labels,
}: RowComponentProps<QueueRowProps>): React.ReactElement => {
    const song = playQueue[index];
    const isActive = currentSongKey === getPlaybackSongKey(song);
    const isUnavailable = isSongUnavailable(song);
    const unavailableTagText = getSongUnavailableLabel(song, labels.unavailable);
    const activeRowClass = isDaylight ? 'bg-black/[0.08]' : 'bg-white/20';
    const activeMarkerClass = isDaylight ? 'bg-zinc-700' : 'bg-white';
    const hoverRowClass = isDaylight ? 'hover:bg-black/[0.04]' : 'hover:bg-white/5';

    return (
        <div
            style={style}
            onClick={() => onPlaySong(song, playQueue)}
            data-active={isActive}
            {...ariaAttributes}
            className={`group flex items-center gap-3 px-2 py-1 rounded-lg cursor-pointer transition-colors
                ${isActive ? activeRowClass : hoverRowClass} ${isUnavailable ? 'opacity-55' : ''}`}
        >
            <div className={`w-1 h-6 rounded-full ${isActive ? activeMarkerClass : 'bg-transparent'}`} />
            <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate">
                    {song.name}
                    {isUnavailable && (
                        <span className={`ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium align-middle ${isDaylight ? 'border-black/8 bg-black/[0.04] text-zinc-600' : 'border-white/10 bg-white/[0.05] text-zinc-300'}`}>
                            {unavailableTagText}
                        </span>
                    )}
                </div>
                <div className="text-[10px] opacity-40 truncate">{getSongArtistLabel(song)}</div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto">
                {(actions ?? ([
                    { label: labels.playNext, icon: ListPlus, run: onMoveSongToNext },
                    { label: labels.moveToEnd, icon: ListEnd, run: onMoveSongToEnd },
                    { label: labels.remove, icon: Trash2, run: onRemoveSong },
                ] as QueueRowAction[]).filter((entry) => Boolean(entry.run))).map(({ label, icon: Icon, run, active }) => {
                    const isOn = Boolean(active && active(index));
                    return (
                        <button
                            key={label}
                            type="button"
                            title={label}
                            aria-label={label}
                            {...(active ? { 'aria-pressed': isOn } : {})}
                            onClick={(event) => {
                                event.stopPropagation();
                                if (event.detail > 0) {
                                    event.currentTarget.blur();
                                }
                                run(index);
                            }}
                            className={`rounded-md p-1.5 transition-colors ${isDaylight ? 'hover:bg-black/10' : 'hover:bg-white/10'}`}
                        >
                            <Icon size={13} fill={isOn ? 'currentColor' : 'none'} />
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

const QueueTab: React.FC<QueueTabProps> = ({
    playQueue,
    currentSong,
    onPlaySong,
    queueScrollRef,
    shouldScrollToCurrent = false,
    onShuffle,
    onRemoveSong,
    onMoveSongToEnd,
    onMoveSongToNext,
    canSaveLocalPlaylist = false,
    onOpenLattice,
    onSaveCurrentQueueAsPlaylist,
    actions,
    listHeight,
    maxHeightClass,
    isDaylight = false,
}) => {
    const { t } = useTranslation();
    const ITEM_HEIGHT = 50;
    const currentSongKey = currentSong ? getPlaybackSongKey(currentSong) : null;
    // Adjust container height calculation if needed, or rely on flex
    // previously CONTAINER_HEIGHT = 200 was passed to List. 
    // We should make List take available space.
    // However, react-window List needs explicit height.
    // The parent has max-h-[300px]. 
    // If we add a header, we need to subtract its height from the List height or use AutoSizer.
    // For simplicity given the constraints, let's try to fit it.
    // The parent is flex-col. 
    // Let's reduce List height slightly to accommodate header? 
    // Or better, use Autoizer? No, let's stick to simple fixed height for now but slightly reduced: 300 - 32 (header) = 268?
    // User asked for "about 5 songs height". 5 * 50 = 250.
    // Let's set CONTAINER_HEIGHT to 250.
    const CONTAINER_HEIGHT = 250;
    // Folia's panel is a fixed 300px box; `/pc`'s sidebar is not, so both the
    // cap and the list height are overridable. `''` means "emit no max-h class
    // at all", which is why this is a whole class and not an append.
    const panelHeightClass = maxHeightClass === undefined ? 'max-h-[300px]' : maxHeightClass;

    const listRef = useListRef(null);
    const isInitialMountRef = React.useRef(true);
    const lastScrolledIndexRef = React.useRef<number>(-1);
    const wasOpenRef = React.useRef(false);
    const [isSaveDialogOpen, setIsSaveDialogOpen] = React.useState(false);
    const rowProps = React.useMemo<QueueRowProps>(() => ({
        playQueue,
        currentSongKey,
        onPlaySong,
        onMoveSongToNext,
        onMoveSongToEnd,
        onRemoveSong,
        actions,
        isDaylight,
        labels: {
            unavailable: t('status.songUnavailableTag'),
            playNext: t('queue.playNext'),
            moveToEnd: t('queue.moveToEnd'),
            remove: t('queue.remove'),
        },
    }), [
        actions,
        currentSongKey,
        isDaylight,
        onMoveSongToEnd,
        onMoveSongToNext,
        onPlaySong,
        onRemoveSong,
        playQueue,
        t,
    ]);

    // Reset initial mount state when panel is opened
    React.useEffect(() => {
        if (shouldScrollToCurrent && !wasOpenRef.current) {
            isInitialMountRef.current = true;
            wasOpenRef.current = true;
        } else if (!shouldScrollToCurrent) {
            wasOpenRef.current = false;
        }
    }, [shouldScrollToCurrent]);

    // Auto-scroll to current song
    React.useEffect(() => {
        if (shouldScrollToCurrent && currentSongKey && listRef.current) {
            const currentIndex = playQueue.findIndex(song => getPlaybackSongKey(song) === currentSongKey);
            if (currentIndex >= 0) {
                const isInitialMount = isInitialMountRef.current;
                const songChanged = lastScrolledIndexRef.current !== currentIndex && lastScrolledIndexRef.current !== -1;

                const behavior = (isInitialMount || !songChanged) ? 'instant' : 'smooth';
                const delay = isInitialMount ? 0 : 50;

                setTimeout(() => {
                    if (listRef.current) {
                        listRef.current.scrollToRow({
                            index: currentIndex,
                            align: 'center',
                            behavior: behavior as 'instant' | 'smooth'
                        });
                        lastScrolledIndexRef.current = currentIndex;
                        isInitialMountRef.current = false;
                    }
                }, delay);
            }
        }
    }, [shouldScrollToCurrent, currentSongKey, playQueue, listRef]);

    const handleSavePlaylist = async () => {
        if (!onSaveCurrentQueueAsPlaylist) {
            return;
        }
        setIsSaveDialogOpen(true);
    };

    if (playQueue.length === 0) {
        return (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`flex flex-col h-full ${panelHeightClass} select-none`}>
                <div className="flex items-center justify-center h-full text-xs opacity-40">
                    {t('queue.empty')}
                </div>
            </motion.div>
        );
    }

    return (
        <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`flex flex-col h-full ${panelHeightClass} select-none`}>
                <div className="flex items-center justify-between px-2 pb-2 shrink-0">
                    <span className="text-xs font-medium opacity-60">
                        {t('queue.title')} ({playQueue.length})
                    </span>
                    <div className="flex items-center gap-1">
                        {onOpenLattice && (
                            <button
                                onClick={onOpenLattice}
                                className="p-1.5 rounded-md hover:bg-white/10 transition-colors opacity-60 hover:opacity-100"
                                title={t('home.lattice')}
                                aria-label={t('home.lattice')}
                            >
                                <PanelsTopLeft size={14} />
                            </button>
                        )}
                        {canSaveLocalPlaylist && (
                            <button
                                onClick={handleSavePlaylist}
                                className="px-2 py-1 rounded-md hover:bg-white/10 transition-colors opacity-60 hover:opacity-100 text-[10px] font-medium"
                                title={t('localMusic.saveQueueAsPlaylist')}
                            >
                                {t('localMusic.saveQueueAsPlaylist')}
                            </button>
                        )}
                        {onShuffle && (
                            <button
                                onClick={onShuffle}
                                className="p-1.5 rounded-md hover:bg-white/10 transition-colors opacity-60 hover:opacity-100"
                                title={t('queue.shuffle')}
                            >
                                <Shuffle size={14} />
                            </button>
                        )}
                    </div>
                </div>

                <div
                    ref={queueScrollRef}
                    className="flex-1 -mx-2 px-2 overflow-hidden"
                >
                    <List
                        listRef={listRef}
                        rowCount={playQueue.length}
                        rowHeight={ITEM_HEIGHT}
                        rowComponent={QueueRow}
                        rowProps={rowProps}
                        overscanCount={5}
                        className="custom-scrollbar"
                        style={{ height: listHeight ?? CONTAINER_HEIGHT, width: '100%' }}
                    />
                </div>
            </motion.div>

            <TextInputDialog
                isOpen={isSaveDialogOpen}
                onClose={() => setIsSaveDialogOpen(false)}
                isDaylight={isDaylight}
                title={t('localMusic.saveQueueAsPlaylist')}
                description={t('localMusic.enterPlaylistName')}
                placeholder={t('localMusic.enterPlaylistName')}
                confirmLabel={t('localMusic.save')}
                onConfirm={async (playlistName) => {
                    try {
                        await onSaveCurrentQueueAsPlaylist?.(playlistName);
                    } catch (error) {
                        console.error('Failed to save local playlist', error);
                    }
                }}
            />
        </>
    );
};

export default QueueTab;
