import React, { useCallback, useEffect, useRef, useState } from 'react';

import { IconClose, IconCube } from '../../icons';

import styles from './VisualSettings.module.scss';

/**
 * The 视觉与 3D entry: a cube at the top-right of the workspace that opens a
 * small panel over that corner.
 *
 * ## No scrim
 *
 * Every other panel on this page dims what is behind it, and this one must
 * not: the panel is adjusting something you can only judge by looking at it.
 * A scrim would put the effect behind a veil at the exact moment you are
 * trying to see whether 浓烈 is too much. So there is none, and the panel
 * closes on any click outside it — which is the other half of that decision,
 * because a floating card with no scrim needs an obvious way out.
 *
 * ## What is in it
 *
 * Two controls and no more. The switch is the one that matters: off means the
 * stage goes back to the flat record *and* no WebGL context is ever created,
 * so "I don't want this" costs nothing. The intensity group only reads while
 * that switch is on, and is hidden rather than disabled when it is off — a
 * row of greyed-out choices is a promise the page is not keeping.
 */

// The intensity steps, in the order the group lists them.
const INTENSITY_OPTIONS = [
    { key: 'calm', title: '克制', sub: '只有一点呼吸，不跟着散开' },
    { key: 'standard', title: '标准', sub: '跟着节拍散开又聚回来' },
    { key: 'strong', title: '浓烈', sub: '整幅画在低音上炸开' },
];

const VisualSettings = function ({
    enabled = false,
    onToggleEnabled,
    intensity = 'standard',
    onChooseIntensity,
}) {
    const [open, setOpen] = useState(false);
    const [closing, setClosing] = useState(false);
    const buttonRef = useRef(null);
    const panelRef = useRef(null);
    const rowRefs = useRef({});

    const reducedMotion = function () {
        return typeof window !== 'undefined'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    };

    const close = useCallback(function () {
        if (reducedMotion()) {
            setOpen(false);
            setClosing(false);
            return;
        }
        setClosing(true);
    }, []);

    const openPanel = useCallback(function () {
        setClosing(false);
        setOpen(true);
    }, []);

    // Escape closes the panel, and only the panel: unlike the phone player's
    // drawer there is nothing underneath for a second Escape to fall through
    // to, so swallowing the key here is the whole behaviour.
    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = function (event) {
            if (event.key === 'Escape') {
                event.stopPropagation();
                close();
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [open, close]);

    // A click anywhere else closes it. `pointerdown` rather than `click`, so
    // the panel is already going by the time the pointer comes up over the
    // stage — otherwise the same gesture that dismissed the panel would also
    // land on whatever is underneath it.
    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = function (event) {
            if (panelRef.current && panelRef.current.contains(event.target)) return;
            if (buttonRef.current && buttonRef.current.contains(event.target)) return;
            close();
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [open, close]);

    // Focus the panel when it opens and hand focus back to the button when it
    // goes: the button is where the visitor was, and a closed panel must not
    // leave focus on a node that no longer exists.
    useEffect(() => {
        if (!open) return;
        const first = rowRefs.current[intensity] || panelRef.current;
        if (first && typeof first.focus === 'function') first.focus();
    }, [open, intensity]);

    const finishClose = function () {
        setOpen(false);
        setClosing(false);
        if (buttonRef.current) buttonRef.current.focus();
    };

    // Arrow keys move within the intensity group, for the same reason every
    // other radio group on this site has them: `role="radio"` is a promise
    // that the arrows work, and the roving `tabIndex` is what makes the group
    // one Tab stop in the first place.
    const handleKeys = function (event) {
        const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const at = INTENSITY_OPTIONS.findIndex((option) => option.key === intensity);
        const next = INTENSITY_OPTIONS[(at + step + INTENSITY_OPTIONS.length) % INTENSITY_OPTIONS.length];
        onChooseIntensity(next.key);
        const row = rowRefs.current[next.key];
        if (row) row.focus();
    };

    return (
        <div className={styles.host}>
            <button
                type="button"
                ref={buttonRef}
                className={open ? `${styles.entry} ${styles['entry-on']}` : styles.entry}
                title="视觉与 3D"
                aria-label="视觉与 3D"
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => (open ? close() : openPanel())}
            >
                <IconCube size={18} />
            </button>

            {open && (
                <div
                    ref={panelRef}
                    className={closing ? `${styles.panel} ${styles['panel-out']}` : styles.panel}
                    role="dialog"
                    aria-label="视觉与 3D"
                    onAnimationEnd={(event) => {
                        // The panel and its rows animate independently, so only
                        // the panel's own exit ends it.
                        if (closing && event.target === event.currentTarget) finishClose();
                    }}
                >
                    <div className={styles['panel-head']}>
                        <span className={styles['panel-title']}>视觉与 3D</span>
                        <button
                            type="button"
                            className={styles['panel-close']}
                            title="关闭"
                            aria-label="关闭"
                            onClick={close}
                        >
                            <IconClose size={16} />
                        </button>
                    </div>

                    {/* `aria-checked` rides on the row, so what the switch
                        looks like and what a screen reader says come from the
                        same boolean. */}
                    <button
                        type="button"
                        className={styles.row}
                        role="switch"
                        aria-checked={enabled}
                        onClick={onToggleEnabled}
                    >
                        <span className={styles['row-text']}>
                            <span className={styles['row-title']}>3D 沉浸</span>
                            <span className={styles['row-sub']}>
                                {enabled ? '封面化作粒子，跟着音乐散开' : '回到平面唱片，不加载任何 3D'}
                            </span>
                        </span>
                        <span
                            className={enabled ? `${styles.switch} ${styles['switch-on']}` : styles.switch}
                            aria-hidden="true"
                        />
                    </button>

                    {/* Hidden, not disabled: while the switch is off there is
                        nothing for these to tune. */}
                    {enabled && (
                        <>
                            <h2 className={styles['group-title']} id="visual-intensity">
                                效果强度
                            </h2>
                            <div
                                role="radiogroup"
                                aria-labelledby="visual-intensity"
                                onKeyDown={handleKeys}
                            >
                                {INTENSITY_OPTIONS.map((option) => (
                                    <button
                                        key={option.key}
                                        type="button"
                                        ref={(node) => { rowRefs.current[option.key] = node; }}
                                        className={intensity === option.key
                                            ? `${styles.row} ${styles['row-choice']} ${styles['row-on']}`
                                            : `${styles.row} ${styles['row-choice']}`}
                                        role="radio"
                                        aria-checked={intensity === option.key}
                                        tabIndex={intensity === option.key ? 0 : -1}
                                        onClick={() => onChooseIntensity(option.key)}
                                    >
                                        <span className={styles['row-text']}>
                                            <span className={styles['row-title']}>{option.title}</span>
                                            <span className={styles['row-sub']}>{option.sub}</span>
                                        </span>
                                        {/* Drawn from `aria-checked` rather
                                            than from a second boolean, so the
                                            dot cannot say something the screen
                                            reader does not. */}
                                        <span className={styles['radio-dot']} aria-hidden="true" />
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default VisualSettings;
