import React from 'react';

import ThreeApp from 'components/Music/three/ThreeApp';
import ThreeBoundary from 'components/Music/three/ThreeBoundary';

/**
 * The 3D room. Reached from the settings sheet on `/desktop`, and nowhere else
 * — there is no link to it from the phone layout, because a WebGL scene with a
 * draggable camera is not a phone experience.
 *
 * It is the third independent tree beside `h5/` and `desktop/`: same `core/`
 * state machine, none of their components. `three/ThreeApp.module.scss` owns
 * this page's palette, which is dark and only dark.
 *
 * The boundary is here, at the route, rather than inside `ThreeApp`: it has to
 * sit *outside* everything it protects, and the failure it exists for is the
 * one that leaves a blank white page with nothing on it to click.
 */
const MusicThree = function () {
    return (
        <ThreeBoundary>
            <ThreeApp />
        </ThreeBoundary>
    );
};

export default MusicThree;
