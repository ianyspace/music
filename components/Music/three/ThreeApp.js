import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';

import { site } from 'config';

import usePlayer from '../core/usePlayer';
import PlayerAudio from '../core/PlayerAudio';
import { makeArtwork } from '../shared';
import { coverUrlOf } from '../librarySource';

import ThreeStage from './ThreeStage';
import ThreeHud from './ThreeHud';

import styles from './ThreeApp.module.scss';

/**
 * The 3D room, served by `/3d`.
 *
 * It is the third component tree beside `h5/` and `desktop/`, and it is
 * independent of both: it imports `core/` and the pure helpers in `shared.js`
 * and `librarySource.js`, and *nothing* from either of the other two layouts.
 * That is not tidiness — a layout that borrows another's components inherits
 * its assumptions, and the first thing those assumptions would break is the
 * only one this page makes: that the scene owns the whole viewport and the
 * chrome floats over it.
 *
 * What is reused is the state machine. `usePlayer` is the only thing in the
 * app that knows how to play a track, and this page takes the read-only subset
 * of it: playback, the library, the lyrics and the toast. The row drawer, the
 * cache manager, the disliked list and the Drive sheet are all still on
 * `/desktop` — the 3D page has no way to change the library, on purpose.
 *
 * `lyricsAutoOpen: false` is not the same decision it is on the phone. Here the
 * words are a plane standing in the room, and they should come up on their own
 * for a song that has them; what `false` buys is that the *visitor's* off
 * switch sticks. `lyricsWanted` below is that switch, and the effect under it
 * is what turns the words back on for the next song — which the hook cannot do
 * on its own, because it resets `lyricsVisible` on every track change.
 */

/** How far the arrow keys jump. */
const SEEK_STEP = 5;

const ThreeApp = function () {
    const {
        tracks,
        visibleTracks,
        listLoading,
        refreshTracks,
        sourceName,
        search,
        setSearch,
        current,
        loadingId,
        isPlaying,
        progress,
        toggleTrack,
        togglePlay,
        playPrev,
        playNext,
        seek,
        playbackMode,
        cyclePlaybackMode,
        lyrics,
        lyricsLoading,
        lyricsVisible,
        toggleLyrics,
        error,
        notice,
        audioRef,
        onEnded,
        onPlay,
        onPause,
        onTimeUpdate,
        onMetadata,
    } = usePlayer({ lyricsAutoOpen: false });

    // Both are view preferences, and neither is worth persisting: a visitor who
    // leaves the room and comes back gets the room's defaults, which is what
    // "immersive mode" should mean.
    const [listOpen, setListOpen] = useState(true);
    const [lyricsWanted, setLyricsWanted] = useState(true);

    // The switch has to be set from what is *on screen*, not flipped blindly.
    // The words start hidden (`lyricsAutoOpen: false`) while `lyricsWanted`
    // starts true, so a blind flip makes the first click record the opposite
    // of what the visitor asked for: they click to show the words, the words
    // appear, and `lyricsWanted` is left false — so the next song does not
    // open on them, which is exactly the behaviour this flag exists to give.
    const handleToggleLyrics = useCallback(() => {
        setLyricsWanted(!lyricsVisible);
        toggleLyrics();
    }, [toggleLyrics, lyricsVisible]);

    useEffect(() => {
        if (!lyricsWanted || !lyrics || lyricsVisible) return;
        toggleLyrics();
    }, [lyrics, lyricsWanted, lyricsVisible, toggleLyrics]);

    // --- keyboard ------------------------------------------------------------
    // `usePlayer` already binds the Media Session keys; these are the ones a
    // desk listener reaches for with the tab in front. Text fields are excluded
    // or the search box would play and pause on every space.
    //
    // The position is read from a ref rather than from the closure: the effect
    // would otherwise be torn down and re-bound four times a second by
    // `timeupdate`, and a key pressed during the gap between the two would be
    // dropped.
    const progressRef = useRef(progress);
    useEffect(() => {
        progressRef.current = progress;
    });

    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const target = event.target;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
                || target.isContentEditable)) return;

            const { time, duration } = progressRef.current;

            switch (event.key) {
                case ' ':
                    event.preventDefault();
                    togglePlay();
                    break;
                case 'ArrowLeft':
                    event.preventDefault();
                    seek(Math.max(0, time - SEEK_STEP));
                    break;
                case 'ArrowRight':
                    event.preventDefault();
                    // A track whose metadata never arrived has no duration to
                    // clamp to, and `Math.min(0, …)` would rewind to the start.
                    if (duration > 0) seek(Math.min(duration, time + SEEK_STEP));
                    break;
                case 'l':
                case 'L':
                    handleToggleLyrics();
                    break;
                case 'Escape':
                    setListOpen(false);
                    break;
                default:
                    break;
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [togglePlay, seek, handleToggleLyrics]);

    // --- what the scene is told ----------------------------------------------
    // A plain object rebuilt on every render is fine here: `ThreeStage` puts it
    // in a ref and the render loop reads that ref, so nothing re-renders and
    // nothing is torn down when the clock ticks.
    // `current` is `{ track, url, startTime, shouldPlay }`, not a track. Both
    // of these read it as one: `coverUrlOf(current)` always answered `''`
    // because the wrapper has no `coverUrl` field, so the record's label never
    // got the artwork, and `current.name` was `undefined`, so the fallback
    // gradient was always the generic one.
    const coverTrack = current ? current.track : null;
    const coverUrl = coverUrlOf(coverTrack);
    const coverName = coverTrack ? coverTrack.name : '';
    // `makeArtwork` paints a canvas and encodes a data URL, so it is memoised
    // on the song rather than run once per `timeupdate`.
    const coverFallback = useMemo(() => makeArtwork(coverName || '音乐'), [coverName]);

    // Shown on the lyrics plane in place of the lines. Empty whenever there is
    // something better to show — real lines, or the visitor having switched the
    // words off, in which case "this song has no lyrics" is noise about a panel
    // they closed.
    let lyricsNotice = '';
    if (lyricsVisible && !lyrics && current) {
        lyricsNotice = lyricsLoading ? '正在载入歌词' : '这首歌没有歌词';
    }

    const sceneState = {
        playing: isPlaying,
        hasTrack: Boolean(current),
        // `usePlayer` reports position and length separately; the arm wants one
        // number, and a stream that never reported a duration has to read as
        // "at the start" rather than as NaN.
        progress: progress.duration > 0
            ? Math.min(1, Math.max(0, progress.time / progress.duration))
            : 0,
        lyrics,
        lyricsVisible,
        lyricsTime: progress.time,
        notice: lyricsNotice,
        listOpen,
        coverUrl,
        coverFallback,
    };

    return (
        <div className={styles.page}>
            {/* Deliberately not `core/PageHead`: that component also loads the
                Google Identity Services script, and this page has no way to
                connect a Drive account. Loading an auth SDK for a page that
                cannot use it is a request nobody asked for. */}
            <Head>
                <title>{`3D 沉浸模式 | ${site.title}`}</title>
                <meta
                    name="description"
                    content="用 three.js 搭的唱片机沉浸模式：可拖拽的机位、随节拍跳动的唱盘、站在房间里的歌词。"
                />
            </Head>

            <ThreeStage
                state={sceneState}
                audioRef={audioRef}
                onToggleLyrics={handleToggleLyrics}
            />

            <ThreeHud
                listOpen={listOpen}
                onToggleList={() => setListOpen((open) => !open)}
                listLoading={listLoading}
                onRefresh={refreshTracks}
                visibleTracks={visibleTracks}
                libraryCount={tracks.length}
                trackCount={visibleTracks.length}
                sourceName={sourceName}
                search={search}
                onSearch={setSearch}
                current={current}
                loadingId={loadingId}
                isPlaying={isPlaying}
                progress={progress}
                onToggleTrack={toggleTrack}
                onTogglePlay={togglePlay}
                onPrev={playPrev}
                onNext={playNext}
                onSeek={seek}
                playbackMode={playbackMode}
                onCyclePlaybackMode={cyclePlaybackMode}
                lyricsVisible={lyricsVisible}
                onToggleLyrics={handleToggleLyrics}
                notice={notice}
                error={error}
            />

            <PlayerAudio
                audioRef={audioRef}
                onEnded={onEnded}
                onPlay={onPlay}
                onPause={onPause}
                onTimeUpdate={onTimeUpdate}
                onMetadata={onMetadata}
            />
        </div>
    );
};

export default ThreeApp;
