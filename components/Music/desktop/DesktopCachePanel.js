import React from 'react';

import { IconRefresh } from '../icons';
import CacheContent from '../core/CacheContent';

import DesktopSheetChrome from './DesktopSheetChrome';

/**
 * Cache manager, desktop flavour — the chrome is a glass card
 * (`DesktopSheetChrome`), the body is the shared `core/CacheContent`.
 *
 * Same body the phone layout's bottom sheet renders, so the two cannot disagree
 * about what is cached or what deleting it does; only the frame differs.
 */
const DesktopCachePanel = function ({
    entries,
    tracks,
    loading,
    busyId,
    caching,
    cacheProgress,
    closing,
    onClosed,
    onCancelClose,
    onClose,
    onRefresh,
    onDelete,
    onCacheAll,
}) {
    return (
        <DesktopSheetChrome
            title="缓存管理"
            closing={closing}
            onClosed={onClosed}
            onCancelClose={onCancelClose}
            onClose={onClose}
            /* Re-reads the store. */
            action={{
                onClick: onRefresh,
                disabled: loading || caching,
                title: '刷新',
                icon: <IconRefresh />,
            }}
        >
            <CacheContent
                entries={entries}
                tracks={tracks}
                loading={loading}
                busyId={busyId}
                caching={caching}
                cacheProgress={cacheProgress}
                onDelete={onDelete}
                onCacheAll={onCacheAll}
            />
        </DesktopSheetChrome>
    );
};

export default DesktopCachePanel;
