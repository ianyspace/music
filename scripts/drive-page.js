#!/usr/bin/env node
/**
 * Opens a page in a real Chrome, clicks through it, and says whether it worked.
 *
 * The other scripts in here render markup so it can be *looked at*. This one
 * exists for the questions a screenshot cannot answer and a build cannot
 * either: does the page survive a click, does a track actually start playing,
 * does anything throw. `/3d` shipped once with a bug that killed the whole page
 * the moment a track was clicked — every screenshot of it looked fine, because
 * the failure only happened *after* the click, and the local dev copy could not
 * see it either (the library worker's CORS allows only the live origin, so a
 * locally served page has an empty list and every `current`-dependent branch
 * short-circuits). Both of those holes are what this closes.
 *
 * It talks the DevTools protocol directly, with no dependencies: Node 22 has a
 * global `WebSocket`, and that is all a CDP client needs. Nothing here
 * downloads a browser or an automation stack.
 *
 * What it asserts, on every page:
 *
 *   1. **Nothing auto-plays.** The list is a library, not a radio; `audio.paused`
 *      has to be true on load.
 *   2. **The list arrives.** Rows > 0. An empty list makes every other check
 *      vacuous, which is exactly how the bug above stayed hidden.
 *   3. **A click plays.** `audio.currentTime` advances and `paused` goes false.
 *   4. **The shortcuts do what they say.** Each entry in `keys` carries the
 *      transport state it should leave behind, so "space paused it" is a pass
 *      and "space did nothing" is not. A bare list of keys cannot tell those
 *      apart — an earlier version pressed space (pause) and then asserted the
 *      track was still playing, which was unsatisfiable by construction.
 *   5. **The toggles flip.** The lyric and list buttons are read through
 *      `aria-pressed` / `aria-expanded` before, between, and after two clicks.
 *      Asserting on the label text instead is how this file once clicked
 *      nothing and reported it as a finding: the desktop button says
 *      「收起歌词」 once it is on, and the selector only knew 「显示歌词」.
 *      Where a control's reported state is *derived* rather than the thing the
 *      click sets — the desktop list button publishes `listOpen && !autoHidden`
 *      — there is no cycle to assert, so the entry says `cycle: false` and the
 *      check is only that the control is not inert.
 *   6. **Nothing throws.** Every `console.error` and uncaught exception, with
 *      its stack, and a non-zero exit code if there was one.
 *
 * Run: node scripts/drive-page.js <url> [options]
 *      node scripts/drive-page.js --all [--insecure]
 *
 *   --all       every page in `PAGES`, in order, each with its own browser.
 *               `--base=ORIGIN` overrides where they are served from
 *               (default `https://ianyspace.github.io/music`).
 *   --size=WxH  window size, default 1440x810. Worth sweeping: the layouts have
 *               been tuned at particular sizes (the wide-screen page had work
 *               done specifically for 1280x600, and the lyric plane only fits
 *               a narrow window because its framing distance follows the
 *               aspect), and a room that is fine at 810 tall can put the panel
 *               on top of the record at 600.
 *   --insecure  adds `--disable-web-security` to a throwaway profile, so a
 *               locally served build can read the library worker. Without it a
 *               local run sees an empty list and asserts nothing useful.
 *   --track=X   click the row containing X instead of the first one. Worth
 *               using: only some songs have lyrics, and only a song with
 *               lyrics exercises the lyric plane.
 *   --out=NAME  write a screenshot per step to `NAME-<page>-<step>.png`.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const CHROME = process.env.CHROME_PATH
    || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/**
 * Per-page knowledge, and the reason this file has a table in it.
 *
 * The selectors are semantic on purpose — `aria-label`, `role`, `title` — not
 * the CSS-module class names, which are hashed per build and would silently
 * match nothing after the next deploy. "Silently" is the dangerous part: a
 * selector that stops matching turns every assertion into a pass.
 *
 * Where a control's label changes with its state, the selector is the *union*
 * of both labels, so it keeps matching after the click. The state itself is
 * then read off `aria-pressed` / `aria-expanded`, never off the text.
 *
 * Toggles are `{ selector, cycle }`. `cycle: true` means the reported state
 * mirrors the click, so two clicks must return it to where it started.
 * `cycle: false` means the state is derived from something else as well, and
 * the only honest check is that clicking is not inert.
 *
 * `keys` entries are `{ key, paused }`: press `key`, and the transport should
 * be left paused (or not) afterwards. Expectation, not just input.
 */
const PAGES = [
    {
        name: '3d',
        path: '/3d/',
        rows: 'aside ul li button',
        lyrics: {
            selector: 'header button[title="显示歌词"], header button[title="隐藏歌词"]',
            cycle: true,
        },
        list: {
            selector: 'header button[title="收起列表"], header button[title="展开列表"]',
            cycle: true,
        },
        // Space is play/pause, so the pass says so out loud: pause, resume,
        // then seek, which must not disturb playback. (Arrows seek here, not
        // skip — the room has no next/previous binding.)
        keys: [
            { key: ' ', paused: true },
            { key: ' ', paused: false },
            { key: 'ArrowRight', paused: false },
        ],
    },
    {
        name: 'desktop',
        path: '/desktop/',
        // The rows carry `title`; the row menu beside each one carries
        // `aria-label`, so excluding `aria-label` leaves exactly the rows.
        rows: 'ul li button:not([aria-label])',
        // No `aria-label` on this one, and the "on" label is 「收起歌词」.
        lyrics: {
            selector: 'button[title="显示歌词"], button[title="收起歌词"]',
            cycle: true,
        },
        // `aria-expanded` here is `listOpen && !autoHidden` — the panel's
        // visibility, not the visitor's choice — and playing folds the panel
        // three seconds in. So the first of two clicks lands on a panel that is
        // already folded and visibly changes nothing, and the second is the one
        // that shows. That is the page working as designed; a cycle assertion
        // would be reading the auto-fold, not the button.
        list: {
            selector: 'button[aria-label="收起列表"], button[aria-label="展开列表"]',
            cycle: false,
        },
        // Escape only — it closes the settings sheet, which must not stop the
        // music.
        keys: [{ key: 'Escape', paused: false }],
    },
    {
        name: 'h5',
        path: '/h5/',
        // The phone's rows are `div[role=button]`, not `<button>`.
        rows: '[role="button"][aria-label^="播放 "]',
        // No lyrics or list toggle: the phone opens the now-playing sheet by
        // tapping the mini player, which is a different interaction.
        keys: [{ key: 'Escape', paused: false }],
    },
];

const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith('--'));
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};

if (!url && !flag('all')) {
    process.stderr.write('usage: node scripts/drive-page.js <url>|--all [--insecure] [--track=X] [--size=WxH] [--out=name]\n');
    process.exit(2);
}

const insecure = flag('insecure');
const track = option('track', '');
const out = option('out', '');
const size = option('size', '1440x810').replace('x', ',');

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * One page, one browser, one pass.
 *
 * @returns {Promise<{name: string, checks: Array, problems: Array}>}
 */
const drive = async (target, index) => {
    const port = 9333 + index;
    const chrome = spawn(CHROME, [
        '--headless=new',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${mkdtempSync(join(tmpdir(), 'drive-page-'))}`,
        '--autoplay-policy=no-user-gesture-required',
        `--window-size=${size}`,
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        ...(insecure ? ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process'] : []),
        // The URL goes on the command line rather than through `Page.navigate`.
        // Driving a blank tab over CDP races: the first probe comes back reading
        // `about:blank` (`title: ""`, no canvas) while the real page loads and
        // throws somewhere else, which reads as "the page is broken" when it is
        // not. Opening with the URL removes the race.
        target.url,
    ], { stdio: 'ignore' });

    const findTarget = async () => {
        for (let i = 0; i < 80; i += 1) {
            try {
                const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
                const page = list.find((t) => t.type === 'page' && t.url.startsWith('http'));
                if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
            } catch {
                // Chrome is not listening yet.
            }
            await sleep(250);
        }
        throw new Error('no CDP target appeared');
    };

    const socket = new WebSocket(await findTarget());
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve);
        socket.addEventListener('error', reject);
    });

    let nextId = 0;
    const pending = new Map();
    const problems = [];
    const checks = [];

    socket.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id) {
            const slot = pending.get(msg.id);
            if (!slot) return;
            pending.delete(msg.id);
            if (msg.error) slot.reject(new Error(JSON.stringify(msg.error)));
            else slot.resolve(msg.result);
            return;
        }

        if (msg.method === 'Runtime.exceptionThrown') {
            const detail = msg.params.exceptionDetails;
            const text = (detail.exception && detail.exception.description) || detail.text;
            problems.push(`exception: ${text.split('\n')[0]}`);
            process.stdout.write(`    [EXCEPTION] ${text.split('\n').slice(0, 3).join('\n    ')}\n`);
        }
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
            const text = msg.params.args
                .map((a) => (a.value !== undefined ? a.value : (a.description || a.type)))
                .join(' ');
            problems.push(`console.error: ${text.split('\n')[0]}`);
            process.stdout.write(`    [console.error] ${text.split('\n').slice(0, 3).join('\n    ')}\n`);
        }
        if (msg.method === 'Network.responseReceived') {
            const { status, url: at } = msg.params.response;
            // A missing cover or lyric sidecar is expected — the library's
            // convention is a same-named file that may simply not be there.
            if (status >= 400) process.stdout.write(`    [http ${status}] ${at.slice(0, 120)}\n`);
        }
    });

    const send = (method, params = {}) => new Promise((resolve, reject) => {
        nextId += 1;
        pending.set(nextId, { resolve, reject });
        socket.send(JSON.stringify({ id: nextId, method, params }));
    });

    const evaluate = async (expression) => {
        const result = await send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
        });
        if (result.exceptionDetails) {
            return `THREW: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`;
        }
        return result.result.value;
    };

    const shot = async (step) => {
        if (!out) return;
        const file = `${out}-${target.name}-${step}.png`;
        mkdirSync(dirname(file), { recursive: true });
        const { data } = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(file, Buffer.from(data, 'base64'));
    };

    const check = (label, ok, detail) => {
        checks.push({ label, ok, detail });
        process.stdout.write(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}\n`);
        if (!ok) problems.push(`check failed: ${label}${detail ? ` (${detail})` : ''}`);
    };

    /** Informational: a thing that could not be exercised, not a failure. */
    const note = (text) => process.stdout.write(`  --   ${text}\n`);

    /**
     * The one reading that means the same thing in all three layouts: the
     * single `<audio>` that `core/PlayerAudio` renders. Reading the transport
     * button instead would mean three different selectors and three different
     * opinions about what "playing" looks like.
     */
    const AUDIO = `(() => {
        const a = document.querySelector('audio');
        if (!a) return null;
        return { time: a.currentTime, paused: a.paused, src: Boolean(a.src), duration: a.duration };
    })()`;

    const rowCount = `document.querySelectorAll(${JSON.stringify(target.rows)}).length`;

    /**
     * Poll for a condition instead of sleeping a fixed number of seconds and
     * hoping.
     *
     * The fixed wait is what made this file lie once: `/3d` pulls three.js
     * before it renders anything, and on a cold live load that is slower than
     * the phone or the desktop page, so 9s expired with the list still empty
     * and the run reported "the list arrived: 0 rows" against a page that was
     * merely slow. Waiting on the condition and reporting how long it took
     * turns "slow" and "broken" into different answers.
     */
    const waitFor = async (expression, ok, timeoutMs) => {
        const started = Date.now();
        let last;
        for (;;) {
            last = await evaluate(expression);
            if (ok(last)) return { value: last, ms: Date.now() - started, timedOut: false };
            if (Date.now() - started >= timeoutMs) {
                return { value: last, ms: Date.now() - started, timedOut: true };
            }
            await sleep(400);
        }
    };

    /**
     * The state a toggle reports to assistive tech. Both trees already publish
     * it — `aria-pressed` on the lyric buttons and on the 3D list button,
     * `aria-expanded` on the desktop list button — so this needs no per-page
     * knowledge beyond the selector, and it survives the label changing.
     */
    const toggleState = (selector) => `(() => {
        const b = document.querySelector(${JSON.stringify(selector)});
        if (!b) return { found: false };
        return {
            found: true,
            disabled: b.disabled === true,
            state: b.getAttribute('aria-pressed') ?? b.getAttribute('aria-expanded'),
        };
    })()`;

    const clickToggle = (selector) => evaluate(
        `(document.querySelector(${JSON.stringify(selector)}) || { click() {} }).click()`,
    );

    /** Read it, click it, read it, click it, read it. Assert the flips. */
    const exerciseToggle = async (label, spec, step) => {
        const { selector, cycle } = spec;
        const before = await evaluate(toggleState(selector));
        if (!before || !before.found) {
            check(`${label} is there`, false, 'selector matched nothing');
            return;
        }
        check(`${label} is there`, true, `state=${before.state}`);
        if (before.disabled) {
            // A track without lyrics disables the button on purpose. Nothing to
            // assert, and not a failure — say so rather than reporting a flip
            // that was never going to happen.
            note(`${label} is disabled on this track — flip not exercised`);
            return;
        }

        await clickToggle(selector);
        await sleep(2500);
        await shot(`${step}-a`);
        const on = await evaluate(toggleState(selector));

        await clickToggle(selector);
        await sleep(2500);
        await shot(`${step}-b`);
        const off = await evaluate(toggleState(selector));

        const trace = `state ${before.state} -> ${on && on.state} -> ${off && off.state}`;

        if (!cycle) {
            // Nothing here is a clean reflection of the click, so the honest
            // claim is the weak one: at least one of the two clicks moved it.
            // A button wired to nothing would not.
            check(
                `${label} is not inert`,
                Boolean(off && off.found) && (on.state !== before.state || off.state !== on.state),
                trace,
            );
            return;
        }

        check(`${label} flips on`, Boolean(on && on.found && on.state !== before.state), trace);
        check(`${label} flips back`, Boolean(off && off.found && off.state === before.state), trace);
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');

    process.stdout.write(`\n=== ${target.name}  ${target.url}\n`);

    // Two waits, because they are two different things: the element has to
    // exist before there is anything to read, and the library arrives over the
    // network afterwards. The first is short and fixed — React needs a tick —
    // and the second polls, because how long a cold load of the library takes
    // is the network's business, not this file's.
    await sleep(2500);
    const audioUp = await waitFor(AUDIO, (v) => v !== null, 20000);
    const loaded = audioUp.value;
    check('nothing auto-plays', loaded !== null && loaded.paused && !loaded.src, 'audio.paused on load');

    const list = await waitFor(rowCount, (n) => n > 0, 30000);
    const rows = list.value;
    check(
        'the list arrived',
        rows > 0,
        `${rows} rows in ${(list.ms / 1000).toFixed(1)}s${list.timedOut ? ' (gave up)' : ''}`,
    );
    await shot('loaded');

    const pick = track
        ? `rows.find((r) => r.innerText.includes(${JSON.stringify(track)}))`
        : 'rows[0]';
    const clicked = await evaluate(
        `(() => {
            const rows = [...document.querySelectorAll(${JSON.stringify(target.rows)})];
            const row = ${pick};
            if (!row) return null;
            row.click();
            return (row.innerText || row.title || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
        })()`,
    );
    check('the row to click exists', Boolean(clicked), String(clicked));
    if (!clicked) {
        chrome.kill();
        return { name: target.name, checks, problems };
    }

    // The click starts a fetch of the audio itself, and how long that takes is
    // the network's business again. One poll covers both checks below rather
    // than a fixed sleep guessing at buffering.
    const started = await waitFor(AUDIO, (v) => v !== null && !v.paused && v.time > 1, 30000);
    const playing = started.value;
    check('the track is playing', Boolean(playing) && !playing.paused, playing ? `paused=${playing.paused}` : 'no <audio>');
    check(
        'the clock is moving',
        Boolean(playing) && playing.time > 1,
        playing ? `t=${playing.time?.toFixed(1)}s in ${(started.ms / 1000).toFixed(1)}s` : '',
    );
    await shot('playing');

    for (const step of target.keys || []) {
        await evaluate(
            `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(step.key)}, bubbles: true }))`,
        );
        await sleep(1400);
        const after = await evaluate(AUDIO);
        check(
            `"${step.key}" leaves it ${step.paused ? 'paused' : 'playing'}`,
            Boolean(after) && after.paused === step.paused,
            after ? `paused=${after.paused}` : 'no <audio>',
        );
    }
    await shot('keys');

    if (target.lyrics) await exerciseToggle('the lyrics toggle', target.lyrics, 'lyrics');
    if (target.list) await exerciseToggle('the list toggle', target.list, 'list');

    const end = await evaluate(AUDIO);
    check('still playing after the interactions', Boolean(end) && !end.paused, end ? `t=${end.time?.toFixed(1)}s` : '');

    // A selector that matches nothing is the failure mode this file exists to
    // catch, so it is worth catching in the file itself: if the rows vanished
    // somewhere along the way, everything above was measured on a dead page.
    const rowsAtEnd = await evaluate(rowCount);
    check('the list survived the interactions', rowsAtEnd > 0, `${rowsAtEnd} rows`);

    chrome.kill();
    return { name: target.name, checks, problems };
};

const targets = flag('all')
    ? PAGES.map((p) => ({ ...p, url: `${option('base', 'https://ianyspace.github.io/music')}${p.path}` }))
    // A single URL picks its own spec from the path, so pointing it at the
    // phone page does not click the 3D page's selectors and call the result a
    // pass. An unknown path gets the 3D spec, which is the strictest.
    : [(() => {
        const spec = PAGES.find((p) => url.includes(p.path.replace(/\/$/, ''))) || PAGES[0];
        return { ...spec, url };
    })()];

const results = [];
for (let i = 0; i < targets.length; i += 1) {
    results.push(await drive(targets[i], i));
}

process.stdout.write('\n=== summary ===\n');
let failed = 0;
results.forEach((r) => {
    const ok = r.checks.filter((c) => c.ok).length;
    process.stdout.write(`  ${r.problems.length ? 'FAIL' : 'ok  '} ${r.name}: ${ok}/${r.checks.length} checks, ${r.problems.length} problem(s)\n`);
    r.problems.forEach((p) => process.stdout.write(`       ${p}\n`));
    if (r.problems.length) failed += 1;
});

process.exit(failed > 0 ? 1 : 0);
