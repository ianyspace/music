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

/**
 * The beamed pair, used as the fallback for a row with no cover — and as the
 * default avatar's glyph.
 *
 * `filled` swaps the outline for a **solid** drawing (stems and beam as filled
 * shapes, heads as slanted ovals), the way SF Symbols' `.fill` variants are
 * drawn: not the same geometry with a fill, but the solid weight of the same
 * mark. The avatar turns it on because it sits behind a blur — a 1.75px stroke
 * does not survive one, and what is left is a smudge with two dots in it. The
 * row thumbnails keep the outline.
 *
 * The solid drawing is nudged down by 0.88 so that its **bounding box** is
 * centred on the viewBox: the beam reaches y 1.4 while the lowest head stops at
 * y 20.84, so the mark is drawn about 0.9 units (most of a pixel at 21px) above
 * the middle. The box is what gets centred, not the ink: the weight sits low
 * (the two heads), so centring the ink would lift the beam and leave the mark
 * riding high.
 */
export const IconNote = ({ filled = false }) => {
    if (filled) {
        return (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <g transform="translate(0 0.88)">
                    <rect x="7.8" y="4" width="2.4" height="14" rx="1.2" />
                    <rect x="18.8" y="2" width="2.4" height="14" rx="1.2" />
                    <path d="M7.8 3.8 21.2 1.4v2.4L7.8 6.2z" />
                    <ellipse cx="6" cy="18" rx="3.2" ry="2.8" transform="rotate(-18 6 18)" />
                    <ellipse cx="17" cy="16" rx="3.2" ry="2.8" transform="rotate(-18 17 16)" />
                </g>
            </svg>
        );
    }
    return (
        <SvgStroke size={18}>
            <path d="M9 18V5l11-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="17" cy="16" r="3" />
        </SvgStroke>
    );
};

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

// "Jump to the playing track": an arrow pointing down at the row that is playing.
//
// Two earlier drawings are worth recording, because each failed for a different
// reason. A crosshair came first — two concentric rings read as "aim / focus",
// like a camera mark. A chevron into a tray replaced it and had the opposite
// problem: a chevron pointing down is this app's *collapse* glyph (the sheets'
// 收起 button wears exactly that shape), and with a tray under it the mark read
// as "download". On a button labelled 回到正在播放, both readings are wrong.
//
// What is drawn now is the smallest thing that cannot be misread: a real arrow
// — shaft and head, so it is a *direction* and not a fold-away — landing on a
// filled dot. The dot is the row that is playing, not the end of the list, and
// it is what keeps the mark from reading as "scroll to bottom". It is also the
// only filled shape in this stroke set that is not a notehead.
//
// Geometry for a 24 box: the shaft runs y 3.8 → 13 with the head's apex on it,
// and the dot sits at cy 18 r 2.2 — 2.8 units of air between the two, so they
// stay separate at 15px instead of fusing into a lollipop. The ink spans y 3.8 →
// 20.2, centred on the box.
export const IconLocate = ({ size = 15 }) => (
    <SvgStroke size={size}>
        <path d="M12 3.8v9.2" />
        <path d="M8.2 9.4 12 13l3.8-3.6" />
        <circle cx="12" cy="18" r="2.2" fill="currentColor" stroke="none" />
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

// Three bars of different heights — 听歌排行's mark, worn by its row on 账号. Bars
// rather than a trophy or a medal: the panel is a list ordered by play count, and
// bars say "counts" without promising a prize. Three strokes survive 16px where a
// bar chart with a baseline or a grid would turn into a smudge.
export const IconChart = ({ size = 20 }) => (
    <SvgStroke size={size}>
        <path d="M4.5 20V14" />
        <path d="M12 20V4.5" />
        <path d="M19.5 20v-8.5" />
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
