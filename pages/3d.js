import React from 'react';

import ThreeApp from 'components/Music/three/ThreeApp';

/**
 * The 3D room. Reached from the settings sheet on `/desktop`, and nowhere else
 * — there is no link to it from the phone layout, because a WebGL scene with a
 * draggable camera is not a phone experience.
 *
 * It is the third independent tree beside `h5/` and `desktop/`: same `core/`
 * state machine, none of their components. `three/ThreeApp.module.scss` owns
 * this page's palette, which is dark and only dark.
 */
const MusicThree = function () {
    return <ThreeApp />;
};

export default MusicThree;
