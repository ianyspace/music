import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motionValue } from 'framer-motion';

import { findActiveLineIndex, toFoliaLines, toFoliaLyricData } from './foliaLyrics';
import { toQueueSong, toQueueSongs, trackOfSong } from './foliaQueue';
import Lattice from './folia/src/components/app/lattice/Lattice';
import { PlayerState } from './folia/src/types';

// The wall's four stylesheets. folia imports each from the component that owns
// it, which Next's pages router refuses; this module is where they enter the
// `/pc` bundle instead. See it for the full argument.
import styles from './PcLattice.module.scss';

/**
 * folia's **queue collage** (Lattice, 队列拼贴), driven by **our** player.
 *
 * `folia/src/components/app/lattice/**` is vendored byte-for-byte; this file is
 * the whole adaptation layer, and it exists because `Lattice.tsx` was written
 * against folia's own app shell rather than against a player. Four things are
 * worth knowing before changing anything here:
 *
 * 1. **The queue is `tracks`, and it is the same array the left column shows.**
 *    `visibleTracks` is this site's play queue — `playNext`/`playPrev` walk it
 *    and the search/只看喜欢 filters narrow it — so the wall and the list are
 *    always the same set in the same order. `toQueueSongs` is the one place
 *    that translation happens (see `foliaQueue.js`).
 *
 * 2. **The clock is a `MotionValue`, and it needs its own rAF loop.** folia's
 *    Pixi lyric scene reads `currentTime.get()` inside its own frame loop, so a
 *    React state that ticks 60 times a second would re-render the whole wall
 *    for a value no component renders. The `<audio>` element's `timeupdate`
 *    (~4 Hz) is far too coarse for the sweep, so a rAF loop feeds the motion
 *    value and only the *discrete* value — the active line index — is lifted
 *    into state.
 *
 *    This is deliberately a second clock rather than a shared one: `PcStage`
 *    unmounts while the wall is up (see `PcApp`), so the two never run at the
 *    same time, and this one does not compute the five audio bands the
 *    visualizer needs — the wall draws none of them.
 *
 * 3. **`LatticePlaybackActions` is folia's shape, not ours.** folia's player
 *    has a dedicated 循环 and a dedicated 随机 command; ours folds both into one
 *    cycling button (`usePlayer`'s `cyclePlaybackMode`, the 播放模式 button on
 *    every other layout). So both of folia's slots are wired to that one cycler
 *    and `loopMode` is derived from our two flags. The mapping is lossy in one
 *    direction only — folia cannot express "shuffling" as a loop mode, so
 *    `shuffle` is reported as `'all'`, which is what it is: the whole queue,
 *    in an order drawn for you.
 *
 * 4. **`invokeCommandById` has no meaning here.** It is how folia's player
 *    chrome opens a command palette surface (音量, 队列, 睡眠定时…). This app has
 *    no command palette, so both halves answer "no" and every slot that would
 *    open a surface is greyed out rather than silently dead. `LatticeFocusButton`
 *    still *renders* its 「打开队列命令」 menu item — it calls the vendored
 *    `useAppViewStore`, which nothing on this page reads, so it closes the menu
 *    and does nothing else. That is the honest outcome of having no palette.
 */
const PcLattice = function ({
    tracks,
    current,
    isPlaying,
    progress,
    shuffle,
    repeat,
    lyrics,
    theme,
    audioRef,
    onPrev,
    onNext,
    onCyclePlaybackMode,
    onSeek,
    onTogglePlay,
    onPick,
    isLiked,
    onToggleLike,
    onExit,
}) {
    const duration = progress.duration;

    /* --- the queue, in folia's shape -------------------------------------- */

    // Both of these must be identity-stable: `Lattice` memoises `buildLatticeTiles`
    // on `[currentSong, queue]`, and a fresh array here would rebuild every tile —
    // and therefore every visible poster — on every unrelated render of the page.
    const queue = useMemo(() => toQueueSongs(tracks), [tracks]);
    const currentTrack = current ? current.track : null;
    const currentSong = useMemo(
        () => (currentTrack ? toQueueSong(currentTrack) : null),
        [currentTrack],
    );

    /* --- the clock -------------------------------------------------------- */

    // One motion value for the life of the wall. Recreating it on a song change
    // would strand every scene holding the old reference.
    const currentTime = useMemo(() => motionValue(0), []);
    const lines = useMemo(() => toFoliaLines(lyrics, duration), [lyrics, duration]);
    const [lineIndex, setLineIndex] = useState(-1);

    const linesRef = useRef(lines);
    linesRef.current = lines;
    const lineIndexRef = useRef(-1);

    // Song change: rewind before the next frame reads it, so the wall never
    // paints one song's line over another's audio.
    useEffect(() => {
        currentTime.set(0);
        lineIndexRef.current = -1;
        setLineIndex(-1);
    }, [currentTime, lyrics]);

    useEffect(() => {
        let frame = 0;
        const tick = function () {
            frame = window.requestAnimationFrame(tick);

            const element = audioRef && audioRef.current;
            const time = element && Number.isFinite(element.currentTime) ? element.currentTime : 0;
            currentTime.set(time);

            const next = findActiveLineIndex(linesRef.current, time);
            if (next !== lineIndexRef.current) {
                lineIndexRef.current = next;
                setLineIndex(next);
            }
        };

        frame = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(frame);
    }, [currentTime, audioRef]);

    // A hidden tab stops rAF, so the clock would freeze mid-line and resume with
    // a jump. `timeupdate` keeps it honest at the ~4 Hz the element reports —
    // enough that the right line is up when the visitor comes back.
    useEffect(() => {
        const element = audioRef && audioRef.current;
        if (!element) return undefined;
        const sync = function () {
            currentTime.set(element.currentTime || 0);
        };
        element.addEventListener('timeupdate', sync);
        return () => element.removeEventListener('timeupdate', sync);
    }, [audioRef, currentTime]);

    /* --- what the expanded card's lyric scene reads ----------------------- */

    // The three subtitle flags all say the same thing, and they have to: our
    // library is `.lrc`, which carries one text per line and no translation or
    // romanisation at all. `latticeLyricLayout` only draws a second row when
    // `showSubtitleTranslation !== false && !hideTranslationSubtitle &&
    // subtitleContentMode !== 'none'`, so all three are set to "no" rather than
    // relying on one of them.
    const lyricSource = useMemo(() => ({
        currentTime,
        currentLineIndex: lineIndex,
        lines,
        theme,
        subtitleTheme: theme,
        showSubtitleTranslation: false,
        hideTranslationSubtitle: true,
        subtitleContentMode: 'none',
        paused: !isPlaying,
        staticMode: false,
    }), [currentTime, lineIndex, lines, theme, isPlaying]);

    // `hasLyrics` on the transport, and the timeline modal's own copy.
    const lyricData = useMemo(() => toFoliaLyricData(lyrics, {
        title: currentSong ? currentSong.name : undefined,
        duration,
    }), [lyrics, currentSong, duration]);

    /* --- folia's playback contract, answered by our player ---------------- */

    const controls = useMemo(() => ({
        playback: {
            prev: onPrev,
            next: onNext,
            toggleLoop: onCyclePlaybackMode,
            shuffleQueue: onCyclePlaybackMode,
            toggleSongLike: () => { if (currentTrack) onToggleLike(currentTrack); },
            isSongLiked: Boolean(currentTrack && isLiked(currentTrack)),
            // Personal FM is a folia online-provider feature; every track here is
            // the visitor's own file, so the queue is never owned by a radio.
            isFmMode: false,
        },
        loopMode: shuffle ? 'all' : repeat,
        invokeCommandById: () => {},
        canInvokeCommandById: () => false,
    }), [onPrev, onNext, onCyclePlaybackMode, currentTrack, onToggleLike, isLiked, shuffle, repeat]);

    const onPlaySong = useCallback((song) => {
        const track = trackOfSong(song, tracks);
        if (track) onPick(track);
    }, [tracks, onPick]);

    const playerState = isPlaying
        ? PlayerState.PLAYING
        : (current ? PlayerState.PAUSED : PlayerState.IDLE);

    return (
        /* The one hashed ancestor the wall's stylesheets are scoped under — see
           `PcLattice.module.scss`. It is `position: absolute; inset: 0`, which
           is both what fills the page and what gives `.lattice-root` (itself
           `position: absolute; inset: 0`) a box to fill. */
        <div className={styles.scope}>
            <Lattice
                controls={controls}
                lyrics={lyricData}
                lyricSource={lyricSource}
                lyricKeywordColoringEnabled={false}
                currentSong={currentSong}
                playerState={playerState}
                currentTime={currentTime}
                playbackDuration={duration}
                canTogglePlayback={Boolean(current)}
                queue={queue}
                isDaylight={false}
                onBack={onExit}
                /* folia's 「打开播放器」 goes to its player view. This page *is*
                   the player view, so it comes back here — the same thing the
                   back button does. Kept as its own callback because the markup
                   has two buttons and hiding one would be an edit to vendored
                   code. */
                onOpenPlayer={onExit}
                onPlaySong={onPlaySong}
                onTogglePlayback={onTogglePlay}
                onSeek={onSeek}
            />
        </div>
    );
};

export default PcLattice;
