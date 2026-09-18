import React, { useEffect, useRef, useState } from 'react';

import styles from './Marquee.module.scss';

// Scroll speed in px/s — slow enough to read while it scrolls.
const MARQUEE_SPEED = 26;

/**
 * Single-line text that scrolls horizontally when it does not fit, with a
 * light fade at both ends to say "there is more text that way". Shared by the
 * mini bar and the now-playing top line so both behave identically.
 *
 * `text` is the plain string used for overflow measuring (and as the effect
 * dependency); `children` is the rendered rich label.
 */
const Marquee = function ({ text, children, className = '', center = false }) {
    const viewRef = useRef(null);
    const innerRef = useRef(null);
    const [state, setState] = useState({ on: false, duration: 8 });

    useEffect(() => {
        const view = viewRef.current;
        const inner = innerRef.current;
        if (!view || !inner) return undefined;
        const measure = function () {
            const width = inner.offsetWidth;
            const on = width > view.clientWidth + 1;
            setState((prev) => {
                const duration = Math.max(8, (width * 2) / MARQUEE_SPEED);
                if (prev.on === on && Math.abs(prev.duration - duration) < 0.5) return prev;
                return { on, duration };
            });
        };
        measure();
        // The slot width settles one frame later on first mount.
        const raf = window.requestAnimationFrame(measure);
        return () => window.cancelAnimationFrame(raf);
    }, [text]);

    return (
        <span
            ref={viewRef}
            className={`${styles.text}${state.on ? ` ${styles['text-marquee']}` : ''}${center ? ` ${styles.center}` : ''}${className ? ` ${className}` : ''}`}
        >
            <span
                className={styles.run}
                style={state.on ? { animationDuration: `${state.duration}s` } : undefined}
            >
                <span ref={innerRef} className={styles.item}>{children}</span>
                {state.on && (
                    <span className={styles.item} aria-hidden="true">
                        {children}
                    </span>
                )}
            </span>
        </span>
    );
};

export default Marquee;
