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
        // 我喜欢 — the one feature this file exercises in full, because it is
        // the only one with state that has to survive a reload. See
        // `exerciseLike`.
        like: {
            filter: 'header button[aria-label="只看喜欢的歌曲"], header button[aria-label="显示全部歌曲"]',
            // A row's own three-dots button. The label is `<title> 的更多操作`,
            // so the suffix is what identifies it — the row's own play target
            // is a `div[role=button]`, not a `<button>`, and carries 播放.
            rowMenu: 'button[aria-label$="的更多操作"]',
            drawer: '[role="dialog"][aria-label="歌曲操作"]',
            // A `div[role=button]`, not a `<button>`: the bar wraps the
            // transport buttons and a button inside a button is invalid HTML —
            // the same reason the rows are `div[role=button]` too. Matched on
            // the label alone so the element type stays out of it.
            player: '[aria-label="打开播放页"]',
            heart: 'button[aria-label="喜欢"], button[aria-label="取消喜欢"]',
        },
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
    // Set by the 我喜欢 stage to answer the Drive files API with a canned list.
    // Null means "do not intercept anything". See `stubDriveFiles`.
    let driveStub = null;

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
        if (msg.method === 'Fetch.requestPaused') {
            const { requestId, request } = msg.params;
            // A preflight has to be answered as a preflight, not as the list —
            // fulfilling an OPTIONS with a JSON body and a 200 is a response
            // the browser will reject, and the real request never follows.
            const cors = [
                { name: 'Access-Control-Allow-Origin', value: '*' },
                { name: 'Access-Control-Allow-Headers', value: '*' },
                { name: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS' },
            ];
            const reply = request.method === 'OPTIONS'
                ? { responseCode: 204, responseHeaders: cors }
                : {
                    responseCode: 200,
                    responseHeaders: cors.concat([{ name: 'Content-Type', value: 'application/json' }]),
                    body: Buffer.from(JSON.stringify(driveStub)).toString('base64'),
                };
            send('Fetch.fulfillRequest', { requestId, ...reply }).catch(() => {});
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
     * The library the page says it is showing. The phone header names it —
     * 「Music Space」 for the public library, 「Google Drive」 once the visitor's
     * own drive is connected — which makes it the one place a source *switch*
     * is observable, as opposed to the list, which keeps showing the previous
     * library until the new one arrives.
     */
    const SOURCE_TITLE = `(() => {
        const head = document.querySelector('h1');
        return head ? (head.innerText || '').trim() : '';
    })()`;

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
     * Answer the Drive files API with a canned list, at the network layer.
     *
     * The Drive library is the one path this file cannot otherwise reach: its
     * list comes from a live `files.list` call that needs a real Google
     * account, and the per-source list cache is written but never read, so
     * there is nothing in localStorage to fake it with.
     *
     * Intercepting the request is the honest alternative to not testing the
     * path at all. The app makes its real call through its real token handling
     * and gets back an answer it can use — the stub is the *server*, not the
     * app's own code replayed at it.
     *
     * Only requests matching the pattern are paused, so nothing else on the
     * page is disturbed.
     */
    const stubDriveFiles = async (files) => {
        driveStub = { files };
        await send('Fetch.enable', {
            patterns: [{
                urlPattern: 'https://www.googleapis.com/drive/v3/files*',
                requestStage: 'Request',
            }],
        });
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

    /* --- 我喜欢, end to end ------------------------------------------------
     *
     * The one stage that reloads the page, and that is the whole point of it:
     * every other check here can be satisfied by React state that was never
     * written anywhere. "永不过期" is a claim about storage, so the only way to
     * test it is to throw the page away and come back.
     *
     * It runs last because the reload resets the page the earlier checks were
     * measuring. Everything it does is a tap a visitor could make — no
     * reaching into localStorage, because a test that writes the store itself
     * would pass even if nothing ever wrote it.
     */
    if (target.like) {
        const spec = target.like;
        const filterState = async () => {
            const read = await evaluate(toggleState(spec.filter));
            return read && read.found ? read.state : null;
        };

        const filterStart = await filterState();
        check('the liked filter is there', filterStart !== null, `state=${filterStart}`);
        check('the liked filter starts off', filterStart === 'false', `state=${filterStart}`);

        // Open the drawer of whichever row this run is about. Returns that
        // row's title, so the caller can compare it with what the filter later
        // leaves behind.
        //
        // `|| rows[0]` matters: the Drive stage below has a library where
        // `--track` matches nothing, and without the fallback it would open no
        // drawer at all — which would make "no 喜欢 item in the Drive drawer"
        // pass by measuring an empty string.
        const openRowDrawer = async () => evaluate(`(() => {
            const rows = [...document.querySelectorAll(${JSON.stringify(target.rows)})];
            const row = ${pick} || rows[0];
            if (!row) return '';
            const li = row.closest('li');
            const more = li && li.querySelector(${JSON.stringify(spec.rowMenu)});
            if (!more) return '';
            more.click();
            return (row.getAttribute('aria-label') || '').replace(/^播放\\s*/, '');
        })()`);

        // Picked by its visible label, not by a class name or an index: the
        // drawer is a list of actions and the label is what the visitor chooses
        // by. `accept` is a set because the like item's label carries its state,
        // so which of 喜欢 / 取消喜欢 is correct depends on the row.
        const clickDrawerItem = async (accept) => evaluate(`(() => {
            const drawer = document.querySelector(${JSON.stringify(spec.drawer)});
            if (!drawer) return 'no drawer';
            const items = [...drawer.querySelectorAll('[role="menuitem"]')];
            const titles = items.map((b) => ((b.innerText || '').split('\\n')[0] || '').trim());
            const index = titles.findIndex((t) => ${JSON.stringify(accept)}.includes(t));
            if (index === -1) return 'none of ' + ${JSON.stringify(accept.join('/'))} + ' in: ' + titles.join('/');
            items[index].click();
            return titles[index];
        })()`);

        const likedTitle = await openRowDrawer();
        check('the row drawer opened', Boolean(likedTitle), likedTitle || '(no three-dots button)');
        await sleep(900);
        await shot('like-drawer');

        const itemLabel = await clickDrawerItem(['喜欢', '取消喜欢']);
        check('the drawer offers 喜欢', itemLabel === '喜欢', String(itemLabel));
        await sleep(1600);
        await shot('liked');

        // The filter is the observable. One song liked, so turning it on has to
        // leave exactly one row — and it has to be that song.
        await clickToggle(spec.filter);
        await sleep(1600);
        await shot('liked-filter');
        const narrowed = await evaluate(rowCount);
        check('只看喜欢 leaves only the liked song', narrowed === 1, `${narrowed} rows`);
        const only = await evaluate(`(() => {
            const row = document.querySelector(${JSON.stringify(target.rows)});
            return row ? (row.getAttribute('aria-label') || '').replace(/^播放\\s*/, '') : '';
        })()`);
        check('...and it is the song that was liked', Boolean(only) && only === likedTitle, `${only} vs ${likedTitle}`);

        // --- the reload ------------------------------------------------------
        await send('Page.reload', {});
        await sleep(3000);
        const reloaded = await waitFor(rowCount, (n) => n > 0, 30000);
        check('the list comes back after a reload', reloaded.value > 0, `${reloaded.value} rows in ${(reloaded.ms / 1000).toFixed(1)}s`);
        const filterAfter = await filterState();
        check('the filter itself is not remembered', filterAfter === 'false', `state=${filterAfter}`);
        await clickToggle(spec.filter);
        await sleep(1600);
        const persisted = await evaluate(rowCount);
        check('the like survived a reload', persisted === 1, `${persisted} rows`);

        // --- the heart on the player -----------------------------------------
        await evaluate(`(() => {
            const row = document.querySelector(${JSON.stringify(target.rows)});
            if (row) row.click();
        })()`);
        await sleep(5000);
        const playerOpened = await evaluate(`(() => {
            const button = document.querySelector(${JSON.stringify(spec.player)});
            if (!button) return false;
            button.click();
            return true;
        })()`);
        check('the player page opens', playerOpened === true, 'mini bar tapped');
        await sleep(1800);
        await shot('player-heart');

        const heartBefore = await evaluate(toggleState(spec.heart));
        check(
            'the player shows a liked heart',
            Boolean(heartBefore && heartBefore.found && heartBefore.state === 'true'),
            `state=${heartBefore && heartBefore.state}`,
        );
        await clickToggle(spec.heart);
        await sleep(1400);
        const heartAfter = await evaluate(toggleState(spec.heart));
        check(
            'tapping the heart unlikes',
            Boolean(heartAfter && heartAfter.found && heartAfter.state === 'false'),
            `state=${heartAfter && heartAfter.state}`,
        );

        // The filter is still on and the song just left the list it was
        // filtering, so the list is now empty. This is the one emptiness that
        // must not be diagnosed as "there are no audio files here" — the copy
        // for it is part of the feature.
        await evaluate(`(() => {
            const button = document.querySelector('button[aria-label="收起"]');
            if (button) button.click();
        })()`);
        await sleep(1600);
        await shot('liked-empty');
        const emptied = await evaluate(`(() => {
            const note = document.querySelector('#ms-track-list + p');
            return note ? (note.innerText || '').trim() : '';
        })()`);
        check('an empty 我喜欢 explains itself', emptied.includes('还没有喜欢的歌曲'), emptied || '(no message)');

        /* --- the two lists disagree, and 不喜欢 wins -----------------------
         *
         * 移入不喜欢 is the stronger statement, which is why `visibleTracks`
         * applies it *before* the liked filter: a song that is both liked and
         * disliked has to stay hidden, or a button somewhere else would undo
         * the one the visitor pressed to get rid of it.
         *
         * That ordering is a judgement call rather than a reading of the
         * request, and this is its only observable — so it is the one thing
         * here most likely to regress silently if someone reshuffles the
         * filters. Both taps below are ones a visitor could make; nothing
         * writes the store directly.
         */
        await clickToggle(spec.filter);
        await sleep(1400);
        await openRowDrawer();
        await sleep(900);
        const reliked = await clickDrawerItem(['喜欢', '取消喜欢']);
        await sleep(1400);
        await openRowDrawer();
        await sleep(900);
        const hidden = await clickDrawerItem(['移入不喜欢']);
        await sleep(1400);
        await clickToggle(spec.filter);
        await sleep(1400);
        const both = await evaluate(rowCount);
        check(
            'a liked song that was 移入不喜欢 stays hidden',
            reliked === '喜欢' && hidden === '移入不喜欢' && both === 0,
            `${reliked} then ${hidden} -> ${both} rows`,
        );
        await shot('liked-vs-disliked');

        /* --- and it is the public library's feature only -------------------
         *
         * 喜欢 targets the public library, so with the visitor's own Drive
         * connected the affordances have to be *gone* rather than present and
         * permanently empty — an entry that can only ever come back empty is
         * worse than no entry.
         *
         * This needs a Drive library with rows in it, which is why the files
         * API is stubbed (see `stubDriveFiles`). Anything less would be
         * measuring the wrong thing: an unstubbed session fails its fetch and
         * leaves the *previous* library on screen, so the rows would still be
         * public-library tracks and the drawer would legitimately still offer
         * 喜欢 — a check that looks like it covers this path and does not.
         *
         * The session itself is restored from two localStorage values, which
         * is exactly what a returning visitor's browser already holds.
         */
        await stubDriveFiles([
            { id: 'drive-a1', name: '01. 云盘歌手 - 云盘里的歌.mp3', mimeType: 'audio/mpeg', size: '1024' },
            { id: 'drive-a2', name: '02. 云盘歌手 - 另一首云盘歌.mp3', mimeType: 'audio/mpeg', size: '1024' },
        ]);
        await evaluate(`(() => {
            const clientId = 'drive-like-check';
            localStorage.setItem('music:googleClientId', clientId);
            localStorage.setItem('music:googleToken', JSON.stringify({
                clientId, accessToken: 'stubbed-token', expiresAt: Date.now() + 3600000,
            }));
        })()`);
        await send('Page.reload', {});
        await sleep(2500);
        // Settle on the *source*, not on "some rows exist".
        //
        // On mount the public library paints from its permanent list cache
        // before anything else happens, so `rows > 0` is already satisfied by
        // the very library this stage is trying to leave — waiting on it reads
        // the previous state and calls it the new one. (It did exactly that
        // here: this stage passed when run alone and failed inside `--all`,
        // purely on which of the two landed first.)
        //
        // The header is the switch itself: it names the library the app thinks
        // it is showing.
        const switched = await waitFor(SOURCE_TITLE, (v) => String(v).includes('Google Drive'), 30000);
        check(
            'a Drive session takes over the library',
            String(switched.value).includes('Google Drive'),
            String(switched.value) || '(no header)',
        );
        const driveRows = await waitFor(rowCount, (n) => n === 2, 30000);
        check('...and lists the Drive files', driveRows.value === 2, `${driveRows.value} rows`);
        await shot('drive-list');

        const driveTitles = await evaluate(`(() => {
            return [...document.querySelectorAll(${JSON.stringify(target.rows)})]
                .map((r) => (r.getAttribute('aria-label') || '').replace(/^播放\\s*/, ''))
                .join('/');
        })()`);
        check('...and the rows are the Drive files', String(driveTitles).includes('云盘里的歌'), String(driveTitles));

        const driveFilter = await evaluate(
            `Boolean(document.querySelector(${JSON.stringify(spec.filter)}))`,
        );
        check('no 我喜欢 filter over a Drive library', driveFilter === false, driveFilter ? 'present' : 'absent');

        const driveTitle = await openRowDrawer();
        await sleep(900);
        await shot('drive-drawer');
        // The titles come back as an array, and the check compares them whole.
        // Searching the joined string for 喜欢 would pass on 移入不喜欢 — the
        // one label in this drawer that *contains* it — so the substring form
        // of this check is worse than useless: it fails on a correct drawer and
        // would pass on one that offered 喜欢 by accident.
        const driveItems = await evaluate(`(() => {
            const drawer = document.querySelector(${JSON.stringify(spec.drawer)});
            if (!drawer) return null;
            return [...drawer.querySelectorAll('[role="menuitem"]')]
                .map((b) => ((b.innerText || '').split('\\n')[0] || '').trim());
        })()`);
        check(
            'the Drive row drawer opened',
            Array.isArray(driveItems),
            driveItems ? `${driveTitle}: ${driveItems.join('/')}` : 'no drawer',
        );
        check(
            'no 喜欢 in a Drive row drawer',
            Array.isArray(driveItems) && !driveItems.some((t) => t === '喜欢' || t === '取消喜欢'),
            Array.isArray(driveItems) ? driveItems.join('/') : String(driveItems),
        );
    }

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
