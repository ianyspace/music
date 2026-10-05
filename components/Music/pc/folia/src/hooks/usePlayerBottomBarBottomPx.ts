/**
 * Shim for folia's `src/hooks/usePlayerBottomBarBottomPx.ts`.
 *
 * Upstream these hooks turn the player chrome's "lift everything up" offset
 * into a `MotionValue` that bottom-anchored components bind to, so the subtitle
 * layer, the side panels and the control bar all rise together when the user
 * changes the bottom-bar offset in settings.
 *
 * The `/pc` page has no folia chrome settings and no side panels — its own
 * play bar is the existing `components/Music` one. So the only consumer left is
 * `VisualizerSubtitleOverlay`, and all it needs is a number that behaves like
 * a `MotionValue`. These return constant ones computed from the shared layout
 * helper, which keeps the subtitle sitting exactly where upstream puts it at
 * default settings.
 */

import { useMemo } from 'react';
import { motionValue, type MotionValue } from 'framer-motion';
import {
    PLAYER_BOTTOM_BAR_BASE_OFFSET_PX,
    resolvePlayerBottomComponentBottomPx,
    resolvePlayerSubtitleBottomFromPresence,
} from '../utils/playerBottomBarLayout';

export const usePlayerBottomBarBottomPx = (
    componentBaseBottomPx = PLAYER_BOTTOM_BAR_BASE_OFFSET_PX,
): MotionValue<number> => (
    useMemo(
        () => motionValue(resolvePlayerBottomComponentBottomPx(0, componentBaseBottomPx)),
        [componentBaseBottomPx],
    )
);

export const useSidePanelBottomPx = (): MotionValue<number> => (
    usePlayerBottomBarBottomPx(24)
);

export const usePlayerSubtitleBottomPx = (isPlayerChromeHidden: boolean): MotionValue<number> => (
    useMemo(
        () => motionValue(
            resolvePlayerSubtitleBottomFromPresence(
                PLAYER_BOTTOM_BAR_BASE_OFFSET_PX,
                isPlayerChromeHidden ? 0 : 1,
            ),
        ),
        [isPlayerChromeHidden],
    )
);
