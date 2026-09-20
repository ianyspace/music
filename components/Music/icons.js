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

// "Rings leaving the record" — the ripples-around-the-disc preference. A filled
// centre with two broken arcs on either side reads as "waves spreading" rather
// than as a plain target, and the gaps are what keep it from looking like the
// crosshair that the locate button used to wear.
export const IconRipple = ({ size = 20 }) => (
    <SvgStroke size={size}>
        <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
        <path d="M16.2 7.8a6 6 0 0 1 0 8.4" />
        <path d="M19.4 5a10.4 10.4 0 0 1 0 14" />
        <path d="M7.8 7.8a6 6 0 0 0 0 8.4" />
        <path d="M4.6 5a10.4 10.4 0 0 0 0 14" />
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

// The heart, in its two states.
//
// One component with a `filled` flag rather than two icons, because liked and
// unliked have to be the *same glyph*: two hearts that differ in more than
// their fill read as two different buttons, and the whole point of a toggle is
// that the visitor recognises what they already pressed. `filled` is the state,
// the outline is what it becomes.
//
// No size prop default change beyond what the callers pass — the phone's header
// buttons clamp `svg` to 19px in CSS anyway, and the player asks for the full
// size, so the icon itself stays out of that argument.
export const IconHeart = ({ size = 22, filled = false }) => (
    <SvgStroke size={size}>
        <path
            d="M12 20.5S3.8 15 3.8 9.2a4.4 4.4 0 0 1 8.2-2.3 4.4 4.4 0 0 1 8.2 2.3c0 5.8-8.2 11.3-8.2 11.3z"
            fill={filled ? 'currentColor' : 'none'}
        />
    </SvgStroke>
);

// "Move into disliked" — a thumb turned down, not a cross.
//
// The X was the obvious pick and it is the wrong one: `IconClose` already
// wears it, and in this app an X means *delete* (it is the cache manager's
// remove button). Disliking keeps the song around — it just stops showing it —
// and the thumb is the one glyph that says "I don't want this" without saying
// "destroy it", which is also why the row action reads 移入 (move into) rather
// than 删除 (delete).
//
// Drawn at the same weight as `IconHeart` so the pair can sit together in the
// drawer: a 4px-thick cuff on the left, the plate folding away to the right.
export const IconDislike = ({ size = 20 }) => (
    <SvgStroke size={size}>
        <path d="M8.6 10.2H5.9a1.6 1.6 0 0 0-1.6 1.6v7.6a1.6 1.6 0 0 0 1.6 1.6h2.7z" />
        <path d="M8.6 21h8.2a2.4 2.4 0 0 0 2.34-1.86l1.4-6.2A2.4 2.4 0 0 0 18.2 9.8h-4.3l.94-4.2a2.3 2.3 0 0 0-4.2-1.9L8.6 10.2z" />
    </SvgStroke>
);

// "Pin to the top" — a pin, pushed in at an angle.
//
// An up-arrow was the other candidate; the pin wins because the action moves a
// row to the *first position in this list*, and an arrow would read as
// "previous track" next to the transport icons on the player screen.
//
// Head is the diamond at the top, the flange bars sit under it, and the needle
// runs to the lower-left corner so the glyph still reads as a pin at 18px.
//
// Two states, for the same reason as `IconHeart`: the row drawer is the only
// place that says whether a song is pinned, so the tile has to carry the
// answer. The needle stays a stroke either way — only the head fills.
export const IconPin = ({ size = 20, filled = false }) => (
    <SvgStroke size={size}>
        <path d="M14.4 9.6 20.4 3.6" />
        <path
            d="M9.1 5.4 18.6 14.9a.9.9 0 0 1-.5 1.5l-3.3.7-3.9 3.9-6.9-6.9 3.9-3.9.7-3.3a.9.9 0 0 1 1.5-.5z"
            fill={filled ? 'currentColor' : 'none'}
        />
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

// Fold-away song list: a panel with a divider rail on its left and a chevron
// in the narrow column beside it.
//
// This one's chevron points *right* — out of the rail and into the list — so
// it is the "the list is here, bring it out" half of the pair; `IconPanelFold`
// below is the same glyph mirrored. The toggle used to show this mark in both
// states, which left the one control on the page with no way to say which way
// it was about to go.
export const IconPanel = ({ size = 18 }) => (
    <SvgStroke size={size}>
        <rect x="3" y="4.5" width="18" height="15" rx="3" />
        <path d="M9.2 4.5v15" />
        <path d="M5.6 10.2 7.4 12l-1.8 1.8" strokeWidth="1.6" />
    </SvgStroke>
);

// The same panel, chevron reversed: "fold it away to the left". Deliberately
// the mirror image and nothing else — a different shape would read as a
// different control, and this is one control in two states.
export const IconPanelFold = ({ size = 18 }) => (
    <SvgStroke size={size}>
        <rect x="3" y="4.5" width="18" height="15" rx="3" />
        <path d="M9.2 4.5v15" />
        <path d="M7.4 10.2 5.6 12l1.8 1.8" strokeWidth="1.6" />
    </SvgStroke>
);

// Settings entry of the wide-screen layout (top-right glass button).
//
// The full material-style cog — eight teeth, each with its own chamfer, plus a
// hub — turned into a grey smudge at 20px, and sitting alone in the corner of
// an otherwise empty screen it read as decoration rather than as a door. This
// is the same idea cut down to what survives the size: a hub and six spokes.
export const IconGear = ({ size = 20 }) => (
    <SvgStroke size={size}>
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 3.2V6.2M12 20.8V17.8M16.4 4.4 14.9 7M7.6 4.4 9.1 7M16.4 19.6 14.9 17M7.6 19.6 9.1 17" />
    </SvgStroke>
);

export const IconClose = ({ size = 18 }) => (
    <SvgStroke size={size}>
        <path d="M6 6l12 12M18 6L6 18" />
    </SvgStroke>
);

// A wireframe box: the way into the 3D room from the settings sheet. Drawn as
// the shared set draws everything — a 24-box at stroke 2 — so it sits with the
// rows around it rather than looking imported from somewhere else.
export const IconCube = ({ size = 18 }) => (
    <SvgStroke size={size}>
        <path d="M12 2.8 20.2 7.1v9.8L12 21.2 3.8 16.9V7.1z" />
        <path d="M3.8 7.1 12 11.6l8.2-4.5" />
        <path d="M12 11.6v9.6" />
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
