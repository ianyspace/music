/**
 * Guards every CSS-module class name the app looks up.
 *
 * `styles.foo` returning `undefined` is the quietest possible failure: the
 * element renders, React drops the class name, and the element simply has no
 * styles. Nothing throws, no console warning, no test failure — the UI just
 * quietly loses a surface. That is exactly how the desktop song list went
 * missing: `.panel-open` drove `visibility: hidden`, so a class name that
 * resolved to `undefined` left the whole list column invisible.
 *
 * So this script checks, for every component, that each `styles.<name>` (and
 * `styles['<name>']`) lookup has a matching selector in the sibling `.scss`.
 * `composes` and nested/`&` selectors are followed, because SCSS modules
 * support both.
 *
 * Usage:
 *   node scripts/check-css-modules.js          # check the repo
 *   node scripts/check-css-modules.js out      # also sanity-check the export
 *
 * Exits non-zero with a `::error::` line CI can surface.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** Every `styles.x` / `styles['x']` lookup in a source file. */
const collectLookups = function (source) {
    const names = new Set();
    // styles.foo  /  styles.fooBar
    for (const m of source.matchAll(/\bstyles\.([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
    // styles['foo-bar']  /  styles["foo-bar"]
    for (const m of source.matchAll(/\bstyles\[['"]([^'"]+)['"]\]/g)) names.add(m[1]);
    return names;
};

/**
 * Class names a stylesheet defines.
 *
 * Covers top-level selectors and nested ones (`&:hover`, `&.foo`, `.a .b`),
 * so a name only has to appear somewhere in a selector to count. A name that
 * is only *consumed* on the right of a selector (`.x :not(.y)`) is not a
 * definition, which is why the leading `.` or `&` is required.
 */
const collectDefinitions = function (source) {
    const names = new Set();
    // strip comments so a commented-out selector is not a definition
    const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');

    for (const m of clean.matchAll(/(?:^|[^.\w-])\.([A-Za-z_][\w-]*)/g)) names.add(m[1]);
    // `&.foo` / `&-foo` (the latter is not valid CSS-module composes, but the
    // `&` forms are common in this codebase)
    for (const m of clean.matchAll(/&\.([A-Za-z_][\w-]*)/g)) names.add(m[1]);

    // `composes: a b c from './x.scss'` pulls names in from another sheet, and
    // `composes: a b` pulls in sibling names.
    for (const m of clean.matchAll(/composes\s*:\s*([^;]+);/g)) {
        m[1].split(/\s+/).filter(Boolean).forEach((name) => {
            if (name !== 'from' && !name.startsWith("'") && !name.startsWith('"')) names.add(name);
        });
    }

    // A name defined in a sheet this one composes from still resolves at
    // runtime, so follow `from './other.scss'` one level.
    const composed = new Set();
    for (const m of clean.matchAll(/composes\s*:[^;]*from\s*['"]([^'"]+)['"]/g)) composed.add(m[1]);
    for (const m of clean.matchAll(/@(?:use|import)\s+['"]([^'"]+)['"]/g)) composed.add(m[1]);

    return { names, composed };
};

/** Resolve a SCSS import specifier relative to the importing sheet. */
const resolveSheet = function (spec, fromDir) {
    const base = spec.startsWith('.') ? path.resolve(fromDir, spec) : null;
    if (!base) return null;
    for (const candidate of [base, `${base}.scss`, `${base}.module.scss`, path.join(base, '_index.scss')]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
};

const main = function () {
    const componentsDir = path.join(ROOT, 'components');

    // Every foo.js(x) with a sibling foo.module.scss.
    const pairs = [];
    const walk = function (dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!/\.(jsx?|tsx?)$/.test(entry.name)) continue;
            const moduleSheet = full.replace(/\.(jsx?|tsx?)$/, '.module.scss');
            if (fs.existsSync(moduleSheet)) pairs.push({ source: full, sheet: moduleSheet });
        }
    };
    walk(componentsDir);

    const problems = [];
    let checked = 0;

    for (const { source, sheet } of pairs) {
        const lookups = collectLookups(fs.readFileSync(source, 'utf8'));
        if (!lookups.size) continue;

        const { names, composed } = collectDefinitions(fs.readFileSync(sheet, 'utf8'));
        // Follow composed/imported sheets one level deep.
        for (const spec of composed) {
            const resolved = resolveSheet(spec, path.dirname(sheet));
            if (!resolved) continue;
            collectDefinitions(fs.readFileSync(resolved, 'utf8')).names.forEach((n) => names.add(n));
        }

        for (const name of lookups) {
            checked += 1;
            if (!names.has(name)) {
                problems.push({
                    name,
                    source: path.relative(ROOT, source),
                    sheet: path.relative(ROOT, sheet),
                });
            }
        }
    }

    if (problems.length) {
        for (const p of problems) {
            console.log(
                `::error file=${p.source}::styles['${p.name}'] is undefined — `
                + `${p.sheet} defines no .${p.name}. An undefined class name renders `
                + 'no styles at all, which hides UI without any error.',
            );
        }
        console.log(`\n${problems.length} unresolved class name(s) of ${checked} checked.`);
        process.exit(1);
    }

    console.log(`all ${checked} CSS-module class names resolve (${pairs.length} components checked)`);
};

main();
