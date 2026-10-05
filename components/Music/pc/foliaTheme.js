/**
 * folia's `Theme` object, built from **our** cover palette.
 *
 * folia ships a theme *park* — user themes, AI-generated themes, light/dark
 * pairs — and its visualizers read colours out of a `Theme` record. This page
 * has none of that: the one honest source of colour here is the artwork of the
 * song that is playing, which the immersive layout already samples through
 * `core/coverPalette`.
 *
 * So the palette (0–1 float triples) is converted into the hex strings folia
 * expects, and the fixed fields — dark stage, sans font, "normal" animation
 * intensity — are chosen to match what folia's own default themes use, so a
 * theme does not read as an outlier in brightness or motion.
 */

const channel = function (value) {
    const clamped = Math.min(1, Math.max(0, Number(value) || 0));
    return Math.round(clamped * 255).toString(16).padStart(2, '0');
};

const toHex = function (triple) {
    if (!Array.isArray(triple) || triple.length < 3) return '#ffffff';
    return `#${channel(triple[0])}${channel(triple[1])}${channel(triple[2])}`;
};

// The stage is a dark room in every folia mode; the artwork only supplies the
// light. Keeping this constant (rather than sampling the cover's average) is
// what stops a bright cover from washing the lyrics out.
const STAGE_BACKGROUND = '#05060a';

/**
 * @param {{ primary: number[], secondary: number[], accent: number[] } | null} palette
 * @param {{ name?: string }} [options]
 */
export const buildFoliaTheme = function (palette, options = {}) {
    const safe = palette && !palette.monochrome ? palette : null;
    return {
        name: options.name || 'pc',
        backgroundColor: STAGE_BACKGROUND,
        primaryColor: toHex(safe ? safe.primary : [0.96, 0.98, 1]),
        accentColor: toHex(safe ? safe.accent : [1, 0.6, 0.72]),
        secondaryColor: toHex(safe ? safe.secondary : [0.62, 1, 0.87]),
        fontStyle: 'sans',
        animationIntensity: 'normal',
    };
};

export default buildFoliaTheme;
