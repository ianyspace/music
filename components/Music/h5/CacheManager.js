import React from 'react';

import { IconRefresh } from '../icons';
import CacheContent from '../core/CacheContent';

import SheetChrome from './SheetChrome';

/**
 * Cache manager, phone flavour — the chrome is a bottom sheet
 * (`SheetChrome`), the body is the shared `core/CacheContent`.
 *
 * The desktop layout renders the same body inside `DesktopCachePanel`, so the
 * two cannot disagree about what is cached or what deleting it does; what
 * differs between them is only how the panel arrives on screen.
 */
const CacheManager = function ({
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
        <SheetChrome
            title="缓存管理"
            closing={closing}
            onClosed={onClosed}
            onCancelClose={onCancelClose}
            onClose={onClose}
            /* Equal-width twin of the collapse button keeps the title centred;
               it re-reads the store. */
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
        </SheetChrome>
    );
};

export default CacheManager;
