/**
 * PostCSS runs for every stylesheet Next compiles — the project's own Sass
 * modules included — so this file exists **only** to add Tailwind for the
 * vendored folia tree on `/pc`.
 *
 * See `styles/tailwind.css`: the import there deliberately leaves out Tailwind's
 * preflight, so none of the existing site's base styling is reset. Tailwind v4
 * needs no `tailwind.config.js`; sources are declared with `@source` in that
 * same file.
 */

module.exports = {
    plugins: {
        '@tailwindcss/postcss': {},
    },
};
