import React from 'react';

import { IconChevronDown } from '../icons';

import styles from './SheetChrome.module.scss';

/**
 * The chrome every phone panel is wrapped in: a centred phone-width column
 * over a blurred scrim, rising and scaling in from below, with the collapse
 * button and the title on top.
 *
 * It owns nothing but the frame — the body is passed in as children. The three
 * panels it serves (`CacheManager`, `DislikedSheet`, `DriveSheet`) supply
 * either a content component from `components/Music/core/` or their own markup,
 * and the desktop layout supplies the same bodies to its own
 * `desktop/DesktopSheetChrome` instead. That split is the whole point: the two
 * layouts share what a panel *says* and not how it *arrives*.
 *
 * Dismissal is the sheet-unmount-via-animation-end trick: `closing` flips the
 * panel to the reverse animation, and the owner unmounts it once that ends.
 * Tapping the scrim mid-exit cancels the close (`onCancelClose`).
 *
 * `action` is the trailing control in the top bar — `{ onClick, disabled,
 * title, label, icon }`, or omitted. It is described rather than passed as a
 * node on purpose: the button's styling belongs to the chrome (this file's
 * stylesheet), so a panel cannot accidentally hand the top bar a control that
 * does not match it. A panel without an action gets a spacer of the same size
 * instead, so the title stays centred either way.
 */
const SheetChrome = function ({
    title,
    action,
    closing,
    onClosed,
    onCancelClose,
    onClose,
    children,
}) {
    return (
        <div
            className={closing ? `${styles.veil} ${styles['veil-out']}` : styles.veil}
            onAnimationEnd={() => { if (closing) onClosed(); }}
            onPointerDown={() => { if (closing) onCancelClose(); }}
        >
            <div className={closing ? `${styles.page} ${styles['page-out']}` : styles.page}>
                <div className={styles.topbar}>
                    <button type="button" className={styles['top-btn']} title="收起" aria-label="收起" onClick={onClose}>
                        <IconChevronDown />
                    </button>
                    <h2 className={styles['top-title']}>{title}</h2>
                    {action ? (
                        <button
                            type="button"
                            className={styles['top-btn']}
                            title={action.title}
                            aria-label={action.label || action.title}
                            onClick={action.onClick}
                            disabled={action.disabled}
                        >
                            {action.icon}
                        </button>
                    ) : (
                        <span className={styles['top-spacer']} aria-hidden="true" />
                    )}
                </div>

                {children}
            </div>
        </div>
    );
};

export default SheetChrome;
