import React from 'react';

import PcApp from 'components/Music/pc/PcApp';

/**
 * `/pc` — wide-screen layout that renders the visitor's own library through
 * folia's lyric visualizer.
 *
 * A third tree beside `/h5` and `/desktop`, added rather than swapped in: it
 * imports `components/Music/core` (the shared state machine and data layer) and
 * its own vendored copy of folia under `components/Music/pc/folia`, and it
 * shares nothing with either existing layout. Reach it directly at `/pc`.
 */
const MusicPc = function () {
    return <PcApp />;
};

export default MusicPc;
