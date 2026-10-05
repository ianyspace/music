import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motionValue } from 'framer-motion';

import { createBandReader, readBands } from '../core/audioAnalyser';
import { findActiveLineIndex, toFoliaLines } from './foliaLyrics';
import VisualizerRenderer from './folia/src/components/visualizer/VisualizerRenderer';

/**
 * The folia visualizer, driven by **our** player.
 *
 * folia's own host (`useVisualizerRendererModel`) reads playback out of a set of
 * Zustand stores that this page does not have. Rather than fake those stores,
 * this component builds the one prop object `VisualizerRenderer` actually
 * needs — `VisualizerSharedProps` — straight from the `<audio>` element the
 * existing `usePlayer` owns. Everything below the renderer is folia's code,
 * untouched.
 *
 * Three details are worth knowing before changing anything here:
 *
 * 1. **The clock is a `MotionValue`, not React state.** folia's renderers read
 *    `currentTime.get()` inside their own rAF/Pixi loops, precisely so that
 *    scrubbing 60 times a second never re-renders React. We feed the same
 *    object from our own loop and only lift the *discrete* value — the active
 *    line index — into state.
 * 2. **Bands are 0–255, not 0–1.** Every theme divides by 255
 *    (`DioramaScene`, `monet/AudioOverlay`, `cadenza`…). Our analyser answers in
 *    0–1, so the loop scales on the way in. Feeding 0–1 makes the visuals look
 *    "almost dead" rather than obviously broken.
 * 3. **`paused` is not the same as `!isPlaying` for the whole page.** A theme
 *    keeps animating its idle state while paused; this prop is what lets it.
 * 4. **Tuning is passed as a bundle, never as individual numbers.** folia's
 *    `applyVisualizerTuning` turns `{ classic: … }` into the `classicTuning`
 *    prop the mode reads. Splitting that here would mean this file knowing which
 *    of thirteen modes reads what.
 */
const PcStage = function ({
    mode,
    lyrics,
    duration,
    theme,
    coverUrl,
    analyser,
    isPlaying,
    audioRef,
    tunings,
    background,
    visualizerOpacity,
    songTitle,
    songArtist,
}) {
    const lines = useMemo(() => toFoliaLines(lyrics, duration), [lyrics, duration]);

    // One set of motion values for the life of the page. Recreating them on a
    // song change would strand every renderer holding the old references.
    const clock = useMemo(() => ({
        currentTime: motionValue(0),
        audioPower: motionValue(0),
        audioBands: {
            bass: motionValue(0),
            lowMid: motionValue(0),
            mid: motionValue(0),
            vocal: motionValue(0),
            treble: motionValue(0),
        },
    }), []);

    const [lineIndex, setLineIndex] = useState(-1);
    const lineIndexRef = useRef(-1);
    const linesRef = useRef(lines);
    linesRef.current = lines;

    // Song change: rewind the shared clock and drop the stale line before the
    // next frame reads it, so the stage never renders one song's line over
    // another's audio.
    useEffect(() => {
        clock.currentTime.set(0);
        lineIndexRef.current = -1;
        setLineIndex(-1);
    }, [clock, lyrics]);

    useEffect(() => {
        let frame = 0;
        const reader = analyser ? createBandReader(analyser) : null;
        // `readBands` needs a reader bound to a *live* analyser; when the graph
        // is not up yet the reader is null and the loop simply reports silence.
        const liveReader = reader;

        const tick = function () {
            frame = window.requestAnimationFrame(tick);

            const element = audioRef && audioRef.current;
            const time = element && Number.isFinite(element.currentTime) ? element.currentTime : 0;
            clock.currentTime.set(time);

            if (liveReader) {
                const sample = readBands(liveReader);
                const power = Math.min(255, Math.max(0, sample.level * 255));
                clock.audioPower.set(power);
                // 0–1 → 0–255, and the five named bands folia's themes expect.
                // Our analyser measures three (low/mid/high); the two extras are
                // split out of them so no theme reads an always-zero band.
                const low = Math.min(255, sample.low * 255);
                const mid = Math.min(255, sample.mid * 255);
                const high = Math.min(255, sample.high * 255);
                clock.audioBands.bass.set(low);
                clock.audioBands.lowMid.set(low * 0.6 + mid * 0.4);
                clock.audioBands.mid.set(mid);
                clock.audioBands.vocal.set(mid * 0.5 + high * 0.5);
                clock.audioBands.treble.set(high);
            } else {
                clock.audioPower.set(0);
                clock.audioBands.bass.set(0);
                clock.audioBands.lowMid.set(0);
                clock.audioBands.mid.set(0);
                clock.audioBands.vocal.set(0);
                clock.audioBands.treble.set(0);
            }

            const next = findActiveLineIndex(linesRef.current, time);
            if (next !== lineIndexRef.current) {
                lineIndexRef.current = next;
                setLineIndex(next);
            }
        };

        frame = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(frame);
    }, [clock, analyser, audioRef]);

    // A hidden tab stops rAF, so the clock would freeze mid-line and resume
    // with a jump. `timeupdate` keeps it honest at the ~4 Hz the element
    // reports — enough that the line index is right when the visitor returns.
    useEffect(() => {
        const element = audioRef && audioRef.current;
        if (!element) return undefined;
        const sync = function () {
            clock.currentTime.set(element.currentTime || 0);
        };
        element.addEventListener('timeupdate', sync);
        return () => element.removeEventListener('timeupdate', sync);
    }, [audioRef, clock]);

    return (
        <VisualizerRenderer
            mode={mode}
            currentTime={clock.currentTime}
            currentLineIndex={lineIndex}
            lines={lines}
            theme={theme}
            audioPower={clock.audioPower}
            audioBands={clock.audioBands}
            coverUrl={coverUrl || null}
            paused={!isPlaying}
            showText
            /* folia's own tuning bundle, straight off its settings store. The
               renderer hands it to `applyVisualizerTuning`, which is what turns
               a saved `classicTuning` into the `classicTuning` prop the mode
               reads — this page never touches the individual numbers. */
            visualizerTunings={tunings}
            background={background}
            visualizerOpacity={visualizerOpacity}
            songTitle={songTitle || null}
            songArtist={songArtist || null}
        />
    );
};

export default PcStage;
