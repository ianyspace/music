import React from 'react';

/**
 * The player's one and only <audio> element.
 *
 * There is exactly one of these per page, which is what lets playback continue
 * while screens change — the element never unmounts, only its `src` does. Both
 * layouts mount it through this component, and every handler it takes comes
 * from `usePlayer`, so neither layout can end up wiring a different set of six
 * (a missing `onTimeUpdate` is a progress bar that simply never moves, and
 * nothing reports it).
 *
 * `<track kind="captions" />` is a childless placeholder that keeps the element
 * from being treated as having no captions track at all; there are no captions
 * to load.
 */
const PlayerAudio = function ({
    audioRef,
    onEnded,
    onPlay,
    onPause,
    onTimeUpdate,
    onMetadata,
}) {
    return (
        <audio
            ref={audioRef}
            preload="auto"
            playsInline
            onEnded={onEnded}
            onPlay={onPlay}
            onPause={onPause}
            onTimeUpdate={onTimeUpdate}
            onLoadedMetadata={onMetadata}
            onDurationChange={onMetadata}
        >
            <track kind="captions" />
        </audio>
    );
};

export default PlayerAudio;
