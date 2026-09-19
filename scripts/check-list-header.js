#!/usr/bin/env node
/**
 * Checks for the phone list's sticky top bar.
 *
 * The bar is deliberately undecorated: square, full-bleed, and with a shadow
 * faint enough to only separate the rows from the title as they scroll under.
 * It used to be a rounded card with a soft drop shadow, sitting on a sticky
 * radial-gradient wash (`.head-glow`) that gave its backdrop-filter something
 * colourful to refract. That wash is gone — the bar is the top edge of the list,
 * not a card floating over it — and a stray `radial-gradient` or a re-added
 * `border-radius` would quietly undo the change without failing anything.
 *
 * The other half is a handshake that no compiler checks: the bar is full-bleed
 * by *cancelling* the page's horizontal padding with a negative margin of the
 * same size, in two places (the base rule and the narrow-viewport override).
 * Change one number without the other and the bar stops reaching the edges, or
 * overhangs them — a one-line mistake with a visible result and no error.
 *
 * Run: node scripts/check-list-header.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const scss = read('components/Music/TrackList.module.scss');
const js = read('components/Music/TrackList.js');

/**
 * Pulls a rule's whole body out, stopping at the rule's own closing brace rather
 * than at the first `}` — which is what a plain `\{([^}]*)\}` does, and would cut
 * the block off at the first nested `@media`/`&:hover`.
 *
 * Leading whitespace is allowed before the selector so the same helper works on
 * rules nested inside a media query.
 */
const blockOf = function (text, selector) {
    const found = new RegExp(`\\n[ \\t]*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{`).exec(text);
    if (!found) return '';
    const start = found.index;
    let depth = 0;
    for (let i = text.indexOf('{', start); i < text.length; i += 1) {
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}') {
            depth -= 1;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return '';
};

const results = [];
const check = function (name, condition, detail) {
    results.push({ name, pass: Boolean(condition), detail });
};

const head = blockOf(scss, '.head');
check('.head exists in TrackList.module.scss', head !== '', head ? 'found' : 'not found');

/* --- square ------------------------------------------------------------- */

const radius = (head.match(/border-radius:\s*([^;]+);/) || [])[1];
check('.head declares a border-radius', Boolean(radius), radius || 'none');
check('.head is square (no rounded bottom corners)',
    Boolean(radius) && /^0$/.test(radius.trim()), radius ? radius.trim() : 'none');
check('...and no corner is rounded through a shorthand either',
    !/border-(top|bottom)-(left|right)-radius/.test(head), 'no per-corner radius');

/* --- no gradient -------------------------------------------------------- */

// Scoped to the bar's own rules: the file legitimately uses the accent gradient
// on its buttons, and this check is about the chrome, not about gradients.
const headerRules = [head, blockOf(scss, '.head-row')].join('\n');
check('the bar paints no gradient of its own',
    !/gradient/.test(headerRules), 'solid/glass background only');
check('the gradient wash element is gone from the markup',
    !/head-glow/.test(js), 'no styles[\'head-glow\']');
check('...and from the stylesheet',
    !/head-glow/.test(scss), 'no .head-glow rule or override');
check('...including its narrow-viewport override',
    !/\.head-glow\s*\{/.test(scss), 'no leftover margin fix-up');

/* --- a faint shadow ----------------------------------------------------- */

const shadow = (head.match(/box-shadow:\s*([^;]+);/) || [])[1];
check('.head still declares a shadow', Boolean(shadow), shadow || 'none');
check('the shadow is not `none` (rows must not collide with the title)',
    Boolean(shadow) && !/^\s*none/.test(shadow), 'a real shadow');
const alphas = [...(shadow || '').matchAll(/rgba\([^)]*?,\s*([0-9.]+)\s*\)/g)].map((m) => Number(m[1]));
check('every shadow layer is a translucent rgba', alphas.length > 0, `${alphas.length} layers`);
const darkest = alphas.length ? Math.max(...alphas) : 1;
// 0.2 is the budget the 「阴影再淡点」 pass settled on: past that the bar starts
// reading as a card again, which is exactly what it was changed away from.
check('no shadow layer is darker than 0.2 alpha', darkest <= 0.2,
    `darkest ${darkest} (budget 0.2)`);
check('the shadow is not so faint it is pointless', darkest >= 0.05,
    `darkest ${darkest}`);

/* --- still the list's chrome -------------------------------------------- */

check('.head is still sticky', /position:\s*sticky/.test(head), 'position: sticky');
check('.head still pins to the top', /top:\s*0;/.test(head), 'top: 0');
const zIndex = (head.match(/z-index:\s*(\d+)/) || [])[1];
check('.head still paints above the rows', Number(zIndex) >= 10, `z-index: ${zIndex}`);
check('the glass recipe is unchanged',
    /background:\s*var\(--glass\)/.test(head)
    && /backdrop-filter:\s*blur\(24px\) saturate\(1\.8\)/.test(head),
    'var(--glass) + blur(24px) saturate(1.8)');

/* --- the full-bleed handshake ------------------------------------------- */

// `.head` cancels `.page`'s horizontal padding with an equal negative margin, so
// the bar reaches both edges. The two numbers are declared in two rules, twice.
const pagePad = (blockOf(scss, '.page').match(/padding:\s*0\s+(\d+)px/) || [])[1];
const headMargin = (head.match(/margin:\s*0\s+-(\d+)px/) || [])[1];
const headPadX = (head.match(/padding:\s*\d+px\s+(\d+)px/) || [])[1];
check('.page declares its horizontal padding', Boolean(pagePad), `${pagePad}px`);
check('.head cancels exactly that padding',
    Boolean(pagePad) && pagePad === headMargin,
    `page ${pagePad}px vs margin -${headMargin}px`);
check('.head restores the same inset as its own padding',
    Boolean(pagePad) && pagePad === headPadX,
    `page ${pagePad}px vs padding ${headPadX}px`);

// The narrow-viewport override repeats the pair with a smaller number; both
// halves have to move together or the bar overhangs (or falls short of) the edge.
const narrow = blockOf(scss, '@media (max-width: 520px)');
check('there is a narrow-viewport override', narrow !== '', '@media (max-width: 520px)');
const narrowPad = (blockOf(narrow, '.page').match(/padding:\s*0\s+(\d+)px/) || [])[1];
const narrowMargin = (blockOf(narrow, '.head').match(/margin:\s*0\s+-(\d+)px/) || [])[1];
const narrowPadX = [...blockOf(narrow, '.head').matchAll(/padding-(?:left|right):\s*(\d+)px/g)].map((m) => m[1]);
check('the override narrows the page padding', Boolean(narrowPad), `${narrowPad}px`);
check('the override cancels it by the same amount',
    Boolean(narrowPad) && narrowPad === narrowMargin,
    `page ${narrowPad}px vs margin -${narrowMargin}px`);
check('the override insets the bar by the same amount',
    narrowPadX.length === 2 && narrowPadX.every((n) => n === narrowPad),
    `left/right ${narrowPadX.join('/')}px vs page ${narrowPad}px`);
check('the override does not touch the radius',
    !/border-radius/.test(blockOf(narrow, '.head')), 'square at every width');

/* --- report ------------------------------------------------------------- */

let failed = 0;
results.forEach((r) => {
    if (!r.pass) failed += 1;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
});
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
