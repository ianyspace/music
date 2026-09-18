import React from 'react';

import MusicApp from 'components/Music/MusicApp';

/** Wide-screen music experience for tablets and desktop. Reached from `/` at 900px and up. */
const MusicDesktop = function () {
    return <MusicApp variant="desktop" />;
};

export default MusicDesktop;
