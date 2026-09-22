import React, { useEffect, useRef, useState } from 'react';

import styles from './Marquee.module.scss';

// Scroll speed in px/s — slow enough to read while it scrolls.
const MARQUEE_SPEED = 26;

/**
 * Single-line text that scrolls horizontally when it does not fit, with a
 * light fade at both ends to say "there is more text that way". Shared by the
 * mini bar and the now-playing top line so both behave identically.
 *
 * `text` keys the effect, and so decides when to re-measure; `children` is the
 * rendered rich label. The measurement reads the label out of the DOM rather
 * than off `text`, so it sees exactly what the visitor sees — including the
 * separator and any styling the label carries.
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
            // Two different widths, and using one for the other was a bug.
            //
            // `advance` is what one cycle of the run moves: one copy of the
            // label plus the gap at the wrap point. That is the animation's
            // distance, so the padded box is exactly right here.
            const advance = inner.offsetWidth;
            // `ink` is how wide the label itself is, and that is the only thing
            // "does it fit" is a question about. `offsetWidth` also counts the
            // item's own padding — the same wrap gap — which turned the test
            // into `ink + 40 > slot`. Both halves of that were visible: a label
            // with 20px to spare scrolled anyway (童年收（cover：F.Be.I音乐团队）
            // measures 281.7px of ink in a 302px slot and was scrolling), and,
            // from the other side, a label that overflowed by under 40px was
            // treated as fitting — clipped at the edge with no scroll and no
            // fade, which is the worse of the two because nothing on screen
            // says there is more text. The centred variant pads the left too,
            // so it was counting 80.
            //
            // A Range over the contents measures the glyphs and nothing else,
            // the same way the smoke test measures the song line's join.
            const range = document.createRange();
            range.selectNodeContents(inner);
            const ink = range.getBoundingClientRect().width;
            const on = ink > view.clientWidth + 1;
            setState((prev) => {
                const duration = Math.max(8, (advance * 2) / MARQUEE_SPEED);
                if (prev.on === on && Math.abs(prev.duration - duration) < 0.5) return prev;
                return { on, duration };
            });
        };
        measure();
        // The slot width settles one frame later on first mount.
        const raf = window.requestAnimationFrame(measure);
        // ...and it can change later without the label changing: a rotation, a
        // window resize, the bar re-flowing around a longer neighbour. The
        // effect only re-runs for a new label, so without this the decision
        // would stay the one made for the old width — a label that has started
        // to overflow would go on being clipped with no scroll and no fade.
        //
        // Watching the slot is safe from a feedback loop because `measure`
        // never changes its size: what it writes is the class and the duration,
        // and both live inside the box it is measuring.
        const observer = new ResizeObserver(measure);
        observer.observe(view);
        return () => {
            window.cancelAnimationFrame(raf);
            observer.disconnect();
        };
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
