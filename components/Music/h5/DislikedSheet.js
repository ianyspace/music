import React from 'react';

import DislikedContent from '../core/DislikedContent';

import SheetChrome from './SheetChrome';

/**
 * 不喜欢歌曲, phone flavour — the chrome is a bottom sheet (`SheetChrome`), the
 * body is the shared `core/DislikedContent`.
 *
 * No trailing action in the top bar: this list is state, not a store read, so
 * there is nothing to refresh and the chrome centres the title with a spacer.
 */
const DislikedSheet = function ({
    keys,
    tracks,
    closing,
    onClosed,
    onCancelClose,
    onClose,
    onRestore,
}) {
    return (
        <SheetChrome
            title="不喜欢歌曲"
            closing={closing}
            onClosed={onClosed}
            onCancelClose={onCancelClose}
            onClose={onClose}
        >
            <DislikedContent keys={keys} tracks={tracks} onRestore={onRestore} />
        </SheetChrome>
    );
};

export default DislikedSheet;
