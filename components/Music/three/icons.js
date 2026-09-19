/* The 3D version's own icon set.
 *
 * Deliberately not `components/Music/icons.js`. The 3D page is a separate
 * thing — a dark room with a turntable in it, not the wide-screen workspace
 * with the lights off — and the icons are the cheapest place to say so: these
 * are drawn on a 1.7 stroke where the shared set uses 2, and the transport
 * glyphs are outlines rather than solids. Importing the shared set would have
 * made the new page look like a re-skin of the old one for free, which is
 * exactly what it must not be.
 *
 * There are thirteen of them, and that is the whole icon budget of this
 * layout: the 3D page plays music and shows the words, it does not manage a
 * library, so the cache manager, the disliked list and the Drive sheet are all
 * still on `/desktop` where they belong.
 */

const Stroke = function ({ children, size = 18, width = 1.7 }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {children}
        </svg>
    );
};

/* The transport is the one place outlines would hurt: at 16px an outlined
   triangle reads as a smudge, so these four are solid and heavier than the
   rest of the set. */
export const IconPlay = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8 5.2a1.1 1.1 0 0 1 1.68-.94l9.6 6.06a1.1 1.1 0 0 1 0 1.87l-9.6 6.06A1.1 1.1 0 0 1 8 17.31z" />
    </svg>
);

export const IconPause = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="7" y="5" width="3.6" height="14" rx="1.4" />
        <rect x="13.4" y="5" width="3.6" height="14" rx="1.4" />
    </svg>
);

export const IconPrev = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="5" y="5.6" width="2.2" height="12.8" rx="1.1" />
        <path d="M19.4 7.2v9.6a1 1 0 0 1-1.55.83l-7-4.8a1 1 0 0 1 0-1.66l7-4.8a1 1 0 0 1 1.55.83z" />
    </svg>
);

export const IconNext = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="16.8" y="5.6" width="2.2" height="12.8" rx="1.1" />
        <path d="M4.6 7.2v9.6a1 1 0 0 0 1.55.83l7-4.8a1 1 0 0 0 0-1.66l-7-4.8a1 1 0 0 0-1.55.83z" />
    </svg>
);

/* Same idea as the shared `IconRepeat` — two arrows chasing each other — but
   drawn as one open loop with a single arrowhead, which survives 16px better
   than four separate strokes. */
export const IconRepeat = ({ size = 17 }) => (
    <Stroke size={size}>
        <path d="M4 9.5A4.5 4.5 0 0 1 8.5 5H19" />
        <path d="M16.2 2.4 19 5l-2.8 2.6" />
        <path d="M20 14.5A4.5 4.5 0 0 1 15.5 19H5" />
        <path d="M7.8 21.6 5 19l2.8-2.6" />
    </Stroke>
);

export const IconRepeatOne = ({ size = 17 }) => (
    <Stroke size={size}>
        <path d="M4 9.5A4.5 4.5 0 0 1 8.5 5H19" />
        <path d="M16.2 2.4 19 5l-2.8 2.6" />
        <path d="M20 14.5A4.5 4.5 0 0 1 15.5 19H5" />
        <path d="M7.8 21.6 5 19l2.8-2.6" />
        <path d="M11.4 10.6l1.5-.9v5" strokeWidth="1.5" />
    </Stroke>
);

export const IconShuffle = ({ size = 17 }) => (
    <Stroke size={size}>
        <path d="M4 6.5h3.2c1 0 1.9.4 2.5 1.2l4.6 6.1c.6.8 1.5 1.2 2.5 1.2H20" />
        <path d="M17.4 12 20 14.9l-2.6 2.9" />
        <path d="M4 17.5h3.2c1 0 1.9-.4 2.5-1.2" />
        <path d="M13.4 7.7c.6-.8 1.5-1.2 2.5-1.2H20" />
        <path d="M17.4 3.6 20 6.5l-2.6 2.9" />
    </Stroke>
);

/* Lyrics: a quotation mark with the following line under it — the standard
   "words" mark, and it does not look like the list button beside it. */
export const IconLyrics = ({ size = 18 }) => (
    <Stroke size={size}>
        <path d="M5 8.5h4.5v4.2c0 2-1.2 3.3-3.2 3.8" />
        <path d="M14 8.5h4.5v4.2c0 2-1.2 3.3-3.2 3.8" />
        <path d="M5 5.5h14" />
    </Stroke>
);

/* The track list: three lines, the first one marked as playing. */
export const IconList = ({ size = 18 }) => (
    <Stroke size={size}>
        <path d="M4 6.5h11M4 12h11M4 17.5h7" />
        <circle cx="19.4" cy="6.5" r="1.6" fill="currentColor" stroke="none" />
    </Stroke>
);

export const IconClose = ({ size = 16 }) => (
    <Stroke size={size}>
        <path d="M6 6l12 12M18 6L6 18" />
    </Stroke>
);

/* Leaving the 3D room: an arrow crossing a threshold. */
export const IconExit = ({ size = 16 }) => (
    <Stroke size={size}>
        <path d="M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5" />
        <path d="M10 8 6 12l4 4" />
        <path d="M6 12h8" />
    </Stroke>
);

/* The badge in the top-left corner. A wireframe box, because that is what the
   page is. */
export const IconCube = ({ size = 15 }) => (
    <Stroke size={size} width={1.5}>
        <path d="M12 2.6 20.4 7v10L12 21.4 3.6 17V7z" />
        <path d="M3.6 7 12 11.6 20.4 7" />
        <path d="M12 11.6v9.8" />
    </Stroke>
);

/* Shown in a row while its track is being fetched — the 3D page has no other
   spinner, and a row that silently does nothing for four seconds reads as a
   broken click. */
export const IconSpinner = ({ size = 15 }) => (
    <Stroke size={size} width={1.9}>
        <path d="M12 3.4a8.6 8.6 0 1 1-6.1 2.5" />
    </Stroke>
);
