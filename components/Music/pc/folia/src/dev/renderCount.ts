// src/dev/renderCount.ts
// Counts component body executions so a refactor's effect on re-renders can be measured instead of
// argued about. React DevTools' profiler is not reachable from a headless Playwright run, and the
// Performance panel measures frames rather than which subtree committed.
//
// Armed by the harness (`window.__renderCounts = {}`), never by the app: an unarmed probe is a
// single property read, and the whole module folds away in a production build.

type CountedWindow = Window & { __renderCounts?: Record<string, number> };

/**
 * Records one execution of the named component's body. No-op unless a harness armed the probe.
 *
 * Upstream tests `import.meta.env.DEV`, which is Vite's own define and does not exist here: under
 * webpack `import.meta.env` is `undefined`, and the *read* of `.DEV` throws before the module even
 * finishes evaluating — the whole route dies while Next collects page data. `process.env.NODE_ENV`
 * is the same question ("is this a dev build?") asked in the bundler this project actually uses,
 * and Next inlines it at compile time, so the module still folds away in a production build.
 */
export const countRender: (name: string) => void = process.env.NODE_ENV !== 'production'
    ? (name) => {
        const counts = (window as CountedWindow).__renderCounts;
        if (!counts) {
            return;
        }
        counts[name] = (counts[name] ?? 0) + 1;
    }
    : () => { };
