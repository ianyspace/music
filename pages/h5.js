import React from 'react';

import MusicApp from 'components/Music/h5/MusicApp';

/**
 * Phone-width music experience. Reached from `/` when the screen is narrow.
 *
 * `h5/MusicApp` and `desktop/DesktopApp` are two independent trees: they share
 * `components/Music/core` (state machine, data layer, panel bodies) and the
 * pure helpers beside it, and nothing else. Neither imports the other, so a
 * change to one layout cannot reach the other by accident.
 */
const MusicH5 = function () {
    return <MusicApp />;
};

export default MusicH5;
