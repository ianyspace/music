/* Shared inline icon set for the music app. */

const SvgStroke = function ({ children, size = 20 }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {children}
        </svg>
    );
};

export const IconPlay = () => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8.2 5.6a1.2 1.2 0 0 1 1.83-1.02l10.1 6.4a1.2 1.2 0 0 1 0 2.03l-10.1 6.4A1.2 1.2 0 0 1 8.2 18.4z" />
    </svg>
);

export const IconPause = () => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="6" y="4.5" width="4.2" height="15" rx="1.6" />
        <rect x="13.8" y="4.5" width="4.2" height="15" rx="1.6" />
    </svg>
);

export const IconPrev = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="4" y="5.4" width="2.4" height="13.2" rx="1.2" />
        <path d="M20 7v10a1.1 1.1 0 0 1-1.7.92l-7.6-5a1.1 1.1 0 0 1 0-1.84l7.6-5A1.1 1.1 0 0 1 20 7z" />
    </svg>
);

export const IconNext = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="17.6" y="5.4" width="2.4" height="13.2" rx="1.2" />
        <path d="M4 7v10a1.1 1.1 0 0 0 1.7.92l7.6-5a1.1 1.1 0 0 0 0-1.84l-7.6-5A1.1 1.1 0 0 0 4 7z" />
    </svg>
);

export const IconShuffle = () => (
    <SvgStroke size={18}>
        <path d="M16 3h5v5" />
        <path d="M4 20L21 3" />
        <path d="M21 16v5h-5" />
        <path d="M15 15l6 6" />
        <path d="M4 4l5 5" />
    </SvgStroke>
);

export const IconRepeat = () => (
    <SvgStroke size={18}>
        <path d="M17 2l4 4-4 4" />
        <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
        <path d="M7 22l-4-4 4-4" />
        <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </SvgStroke>
);

export const IconRepeatOne = () => (
    <SvgStroke size={18}>
        <path d="M17 2l4 4-4 4" />
        <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
        <path d="M7 22l-4-4 4-4" />
        <path d="M21 13v1a4 4 0 0 1-4 4H3" />
        <path d="M11.5 10.2l1.6-1v5.6" strokeWidth="1.8" />
    </SvgStroke>
);

export const IconSearch = () => (
    <SvgStroke size={16}>
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
    </SvgStroke>
);

export const IconSun = ({ size = 17 }) => (
    <SvgStroke size={size}>
        <circle cx="12" cy="12" r="4.4" />
        <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4L19 19M19 5l-1.6 1.6M6.6 17.4L5 19" />
    </SvgStroke>
);

export const IconMoon = ({ size = 17 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M21 12.8A8.6 8.6 0 1 1 11.2 3a6.8 6.8 0 0 0 9.8 9.8z" />
    </svg>
);

export const IconFolder = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.6a2 2 0 0 1 1.56.75l1 1.25h6.84A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
    </svg>
);

export const IconRefresh = () => (
    <SvgStroke size={16}>
        <path d="M21.5 4v5h-5" />
        <path d="M2.5 20v-5h5" />
        <path d="M4.6 9a8 8 0 0 1 13.3-3.2L21.5 9M2.5 15l3.6 3.2A8 8 0 0 0 19.4 15" />
    </SvgStroke>
);

export const IconNote = () => (
    <SvgStroke size={18}>
        <path d="M9 18V5l11-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="17" cy="16" r="3" />
    </SvgStroke>
);

// Three beamed notes — the app's / list tab's mark, closer to the reference.
export const IconNoteList = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="8.6" y="2.6" width="2.3" height="13.4" rx="1.15" />
        <rect x="15.6" y="4.6" width="2.3" height="11.4" rx="1.15" />
        <ellipse cx="6.6" cy="17.2" rx="3.5" ry="3.1" transform="rotate(-18 6.6 17.2)" />
        <ellipse cx="13.6" cy="19.2" rx="3.5" ry="3.1" transform="rotate(-18 13.6 19.2)" />
        <ellipse cx="20.6" cy="20.4" rx="3.5" ry="3.1" transform="rotate(-18 20.6 20.4)" />
    </svg>
);

// "Jump to the playing track": a downward chevron into a tray.
//
// A crosshair was the first attempt, but two concentric rings read as "target"
// (focus / aim) and look like a camera mark at a glance — this button is
// literally "scroll the list down to the row that is playing", and the chevron
// says that with no explanation. It also survives 15px, where the crosshair's
// rings started to blur together.
//
// Geometry tuned for a 24 viewBox: the chevron spans x 7.5→16.5 with its apex
// at y=15, and the tray sits at y=18.5 — a 3.5-unit drop, so the two strokes
// stay clearly separate at 15px. Widths stay under the frame (1.5 → 22.5) so
// nothing clips.
export const IconLocate = ({ size = 15 }) => (
    <SvgStroke size={size}>
        <path d="M7.5 9.5 12 14l4.5-4.5" />
        <path d="M5.5 18.5h13" strokeWidth="1.7" />
    </SvgStroke>
);

export const IconPerson = () => (
    <SvgStroke size={22}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 20.5c1.4-3.3 4.1-5 7.5-5s6.1 1.7 7.5 5" />
    </SvgStroke>
);

// Download-into-a-box — the cache manager's mark.
export const IconArchive = ({ size = 20 }) => (
    <SvgStroke size={size}>
        <path d="M3.5 7.5h17A1.5 1.5 0 0 1 22 9v1.5a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 10.5V9a1.5 1.5 0 0 1 1.5-1.5Z" />
        <path d="M4.5 12v7A2 2 0 0 0 6.5 21h11a2 2 0 0 0 2-2v-7" />
        <path d="M9.5 16h5" />
    </SvgStroke>
);

export const IconChevronDown = ({ size = 22 }) => (
    <SvgStroke size={size}>
        <path d="M6 9l6 6 6-6" />
    </SvgStroke>
);

export const IconChevronRight = () => (
    <SvgStroke size={14}>
        <path d="M9 6l6 6-6 6" />
    </SvgStroke>
);

// Three stacked dots — the phone list's entry into the profile tab.
export const IconMoreVertical = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="5" r="1.9" />
        <circle cx="12" cy="12" r="1.9" />
        <circle cx="12" cy="19" r="1.9" />
    </svg>
);

// Playlist icon used at the right end of the full-screen player controls.
export const IconQueue = () => (
    <SvgStroke size={20}>
        <path d="M4 6h10" />
        <path d="M4 12h10" />
        <path d="M4 18h7" />
        <circle cx="17.5" cy="15.6" r="2.4" strokeWidth="1.8" />
        <path d="M19.9 15.6V8.4l-2.2 1.2" strokeWidth="1.8" fill="none" />
    </SvgStroke>
);

export const IconHeart = () => (
    <SvgStroke size={22}>
        <path d="M12 20.5S3.8 15 3.8 9.2a4.4 4.4 0 0 1 8.2-2.3 4.4 4.4 0 0 1 8.2 2.3c0 5.8-8.2 11.3-8.2 11.3z" />
    </SvgStroke>
);

export const IconCloud = () => (
    <SvgStroke size={20}>
        <path d="M7 18a4.6 4.6 0 0 1-.6-9.15A6 6 0 0 1 17.8 9.5 4.2 4.2 0 0 1 17 18z" />
    </SvgStroke>
);

export const IconLogout = () => (
    <SvgStroke size={15}>
        <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
        <path d="M16 17l5-5-5-5" />
        <path d="M21 12H9" />
    </SvgStroke>
);

// Fold-away song list: a panel with a divider rail on its left, with the
// chevron pointing at the edge the panel actually collapses towards (left).
export const IconPanel = ({ size = 18 }) => (
    <SvgStroke size={size}>
        <rect x="3" y="4.5" width="18" height="15" rx="3" />
        <path d="M9.2 4.5v15" />
        <path d="M5.6 10.2 7.4 12l-1.8 1.8" strokeWidth="1.6" />
    </SvgStroke>
);

// Settings entry of the wide-screen layout (top-right glass button).
export const IconGear = ({ size = 20 }) => (
    <SvgStroke size={size}>
        <circle cx="12" cy="12" r="3.2" />
        <path d="M19.4 14.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.11a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.11a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.11a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.11a1.7 1.7 0 0 0-1.49 1.03z" />
    </SvgStroke>
);

export const IconClose = ({ size = 18 }) => (
    <SvgStroke size={size}>
        <path d="M6 6l12 12M18 6L6 18" />
    </SvgStroke>
);

// Music Space wordmark badge: the app's red→pink gradient tile with a clean
// beamed double note, so the header reads as a brand rather than a section
// title. Stems sit on the noteheads' right edge and the beam joins their tops,
// so nothing overlaps the wrong side.
export const IconMusicSpace = ({ size = 26 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <defs>
            <linearGradient id="music-space-tile" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#fb5c74" />
                <stop offset="1" stopColor="#fa233b" />
            </linearGradient>
        </defs>
        <rect x="1" y="1" width="22" height="22" rx="6.5" fill="url(#music-space-tile)" />
        <g fill="#fff">
            <ellipse cx="8.2" cy="16.2" rx="3" ry="2.3" transform="rotate(-18 8.2 16.2)" />
            <ellipse cx="14.6" cy="15" rx="3" ry="2.3" transform="rotate(-18 14.6 15)" />
            <rect x="10.2" y="6.5" width="1.7" height="9.8" rx="0.85" />
            <rect x="16.6" y="5" width="1.7" height="10.1" rx="0.85" />
            <path d="M10.2 6.5 18.3 5v2.4L10.2 8.9z" />
        </g>
    </svg>
);

// Google Drive: the triangle folded from its three brand colours, drawn flat
// so it sits inside the app's own icon language.
export const IconGoogleDrive = ({ size = 22 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4 2.5 20 12 15z" fill="#4285f4" />
        <path d="M12 4 21.5 20 12 15z" fill="#34a853" />
        <path d="M2.5 20h19L12 15z" fill="#fbbc05" />
    </svg>
);
