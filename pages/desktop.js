import React from 'react';

import DesktopApp from 'components/Music/desktop/DesktopApp';

/**
 * Wide-screen music experience for tablets and desktop. Reached from `/` at
 * 900px and up.
 *
 * `desktop/DesktopApp` and `h5/MusicApp` are two independent trees: they share
 * `components/Music/core` (state machine, data layer, panel bodies) and the
 * pure helpers beside it, and nothing else. Every surface here is CSS glass —
 * see `DesktopApp.module.scss` for the tokens.
 */
const MusicDesktop = function () {
    return <DesktopApp />;
};

export default MusicDesktop;
