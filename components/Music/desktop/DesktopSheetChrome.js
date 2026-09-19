import React from 'react';

import { IconClose } from '../icons';

import styles from './DesktopSheetChrome.module.scss';

/**
 * The chrome every desktop panel is wrapped in: a glass card over a dimmed,
 * blurred scrim, with the title on the left and the actions on the right.
 *
 * It owns nothing but the frame — the body is passed in as children, and the
 * two panels that use it hand it a content component from
 * `components/Music/core/`. The phone layout wraps those same bodies in its own
 * bottom sheet (`h5/SheetChrome`); sharing the content and not the chrome is
 * exactly the split the two layouts are built on.
 *
 * Dismissal is the unmount-via-animation-end trick: `closing` flips the card to
 * the reverse animation, and the owner unmounts it once that ends. Clicking the
 * scrim mid-exit cancels the close (`onCancelClose`).
 *
 * `action` is the trailing control — `{ onClick, disabled, title, label, icon }`,
 * or omitted. It is described rather than passed as a node so the button's
 * styling stays in this file's stylesheet and a panel cannot hand the header a
 * control that does not match it.
 */
const DesktopSheetChrome = function ({
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
            className={closing ? `${styles.scrim} ${styles['scrim-out']}` : styles.scrim}
            role="presentation"
            onAnimationEnd={(event) => {
                // Only the scrim's own fade ends the panel; the card and its
                // children animate independently.
                if (closing && event.target === event.currentTarget) onClosed();
            }}
            onPointerDown={() => { if (closing) onCancelClose(); }}
        >
            <div
                className={closing ? `${styles.card} ${styles['card-out']}` : styles.card}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                onClick={(event) => event.stopPropagation()}
            >
                <div className={styles.topbar}>
                    <h2 className={styles['top-title']}>{title}</h2>
                    {action && (
                        <button
                            type="button"
                            className={styles['icon-btn']}
                            title={action.title}
                            aria-label={action.label || action.title}
                            onClick={action.onClick}
                            disabled={action.disabled}
                        >
                            {action.icon}
                        </button>
                    )}
                    <button
                        type="button"
                        className={styles['icon-btn']}
                        title="关闭"
                        aria-label="关闭"
                        onClick={onClose}
                    >
                        <IconClose />
                    </button>
                </div>

                {children}
            </div>
        </div>
    );
};

export default DesktopSheetChrome;
