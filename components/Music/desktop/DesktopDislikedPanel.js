import React from 'react';

import DislikedContent from '../core/DislikedContent';

import DesktopSheetChrome from './DesktopSheetChrome';

/**
 * 不喜欢歌曲, desktop flavour — the chrome is a glass card
 * (`DesktopSheetChrome`), the body is the shared `core/DislikedContent`.
 *
 * No trailing action in the header: this list is state, not a store read, so
 * there is nothing to refresh.
 */
const DesktopDislikedPanel = function ({
    keys,
    tracks,
    closing,
    onClosed,
    onCancelClose,
    onClose,
    onRestore,
}) {
    return (
        <DesktopSheetChrome
            title="不喜欢歌曲"
            closing={closing}
            onClosed={onClosed}
            onCancelClose={onCancelClose}
            onClose={onClose}
        >
            <DislikedContent keys={keys} tracks={tracks} onRestore={onRestore} />
        </DesktopSheetChrome>
    );
};

export default DesktopDislikedPanel;
