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
 *
 * `crossOrigin` is a prop rather than a constant because it is a *risk*, not a
 * feature. Setting it asks the server for CORS and refuses the audio if the
 * answer is no — which is right for the R2 library (the bucket echoes the
 * request's `Origin`, so the answer is yes) and wrong for a visitor's own
 * Google Drive files, which are served without it. `anonymous` is what lets
 * Web Audio read the samples; without it a connected analyser receives pure
 * silence and there is no way to tell that apart from a quiet track.
 *
 * So only the layout that actually analyses audio passes it. The phone player
 * leaves it off, and Drive playback there keeps working exactly as before.
 */
const PlayerAudio = function ({
    audioRef,
    crossOrigin,
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
            crossOrigin={crossOrigin}
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
