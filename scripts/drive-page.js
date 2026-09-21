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
 *   7. **The row actions work, in both layouts.** 置顶 / 取消置顶 and 我喜欢 are
 *      driven by the labels the visitor reads, on the phone page and the
 *      desktop page alike, because those two are separate component trees and
 *      a feature wired into only one of them looks finished until a person
 *      notices. 取消置顶 is checked by the *whole row order* coming back, not
 *      by the first row — see the stage.
 *   8. **The phone's navigation is what it says it is.** The ⋮ drawer holds the
 *      three entries it should, 音乐库 / 账号 / 听歌排行 all arrive as *sheets*
 *      (no page header, a collapse button), and a like made before a QQ number
 *      is confirmed stays in this browser — then goes with the number when one
 *      is confirmed, which the 数据同步 row is read to prove. The panel pair is
 *      checked for the thing it used to be: 听歌排行's 收起 button puts the
 *      visitor back on the list with no sheet left standing, instead of the
 *      two-screen loop it used to be. See `target.shell`.
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
/**
 * The row drawer's two handles, and the reason they are not copied into each
 * page's spec.
 *
 * Both trees label them identically — a row's ⋮ is `<title> 的更多操作` and the
 * drawer is `role=dialog aria-label=歌曲操作` — which is what lets *one* stage
 * cover both layouts. If one of the two ever renames its drawer, this file
 * should stop matching for both rather than quietly keep testing the one that
 * did not change.
 *
 * The ⋮ is matched on the suffix because the label starts with the song's
 * title, and the row's own play target is a `div[role=button]` (a `<button>`
 * inside a `<button>` is invalid HTML), so the suffix is what tells the two
 * apart.
 */
const ROW_DRAWER = {
    rowMenu: 'button[aria-label$="的更多操作"]',
    drawer: '[role="dialog"][aria-label="歌曲操作"]',
};

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
        // 置顶 / 取消置顶. The row drawer is the one action both layouts have,
        // and this is the reason it is driven on *both* pages: it was wired
        // into the phone alone once, and only a person noticed.
        pin: ROW_DRAWER,
    },
    {
        name: 'h5',
        path: '/h5/',
        // The phone's rows are `div[role=button]`, not `<button>`.
        rows: '[role="button"][aria-label^="播放 "]',
        // The app's mark, at the leading end of the bar: it raises 账号, and it
        // is also the thing the note is drawn on. It sits here rather than on
        // one of the stages below because two of them need it — the shell stage
        // opens 账号 through it, and the last stage reads the note off it.
        mark: 'header button[aria-label^="账号"]',
        // No lyrics or list toggle: the phone opens the now-playing sheet by
        // tapping the mini player, which is a different interaction.
        keys: [{ key: 'Escape', paused: false }],
        // 置顶 / 取消置顶, same stage as the desktop's — see `pin` above.
        pin: ROW_DRAWER,
        // 我喜欢 — the one feature this file exercises in full, because it is
        // the only one with state that has to survive a reload. See
        // `exerciseLike`.
        like: {
            filter: 'header button[aria-label="只看喜欢的歌曲"], header button[aria-label="显示全部歌曲"]',
            ...ROW_DRAWER,
            // A `div[role=button]`, not a `<button>`: the bar wraps the
            // transport buttons and a button inside a button is invalid HTML —
            // the same reason the rows are `div[role=button]` too. Matched on
            // the label alone so the element type stays out of it.
            player: '[aria-label="打开播放页"]',
            heart: 'button[aria-label="喜欢"], button[aria-label="取消喜欢"]',
        },
        // The shell's own structure: the ⋮ and the drawer it opens, and the row
        // drawer this stage likes a song through. See `the phone's shell` below.
        shell: {
            more: 'header button[aria-label="更多功能"]',
            rowDrawer: ROW_DRAWER,
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
    // The bytes that answer a Drive track's *download*. See `pulseWav`.
    let driveAudio = null;
    // How many requests the stub actually answered. Counted rather than assumed:
    // "the list is right" and "the stub never fired and the list is right
    // anyway" look identical from the outside, and only one of them means the
    // Drive path was tested.
    let driveStubHits = 0;
    // Downloads of a Drive track's audio, counted separately from the listing:
    // they share a URL prefix, and only one of them means a Drive song reached
    // the player.
    let driveMediaHits = 0;
    // How many requests to the likes API were stopped. Same reason as above —
    // and it is the only evidence that the write never reached the database.
    let likesStubHits = 0;
    // And the play-reporting endpoint, stopped for the same reason and counted
    // for the opposite one: 0 is the expected number, and it is what makes "a
    // Drive play is not counted" an assertion rather than a hope.
    let playsStubHits = 0;
    // Milliseconds to hold the public library's answer for, once. The load race
    // in `loadTracks` is otherwise a matter of which answer happens to arrive
    // last, and a check that only fails when the network is slow is not a check.
    let cloudDelayMs = 0;

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

            // The public library's list. Continued straight away in the ordinary
            // case — which is invisible to the page — and held when a test has
            // asked for it to be slow (`cloudDelayMs`), so that "the slower
            // answer must not win" can be asserted instead of waited for.
            if (request.url.includes('/tracks')) {
                const wait = cloudDelayMs;
                cloudDelayMs = 0;
                if (wait > 0) {
                    (async () => {
                        await sleep(wait);
                        send('Fetch.continueRequest', { requestId }).catch(() => {});
                    })();
                } else {
                    send('Fetch.continueRequest', { requestId }).catch(() => {});
                }
                return;
            }

            // A preflight has to be answered as a preflight, not as the body —
            // fulfilling an OPTIONS with a JSON body and a 200 is a response
            // the browser will reject, and the real request never follows.
            const cors = [
                { name: 'Access-Control-Allow-Origin', value: '*' },
                { name: 'Access-Control-Allow-Headers', value: '*' },
                { name: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS,POST' },
            ];
            const preflight = request.method === 'OPTIONS';

            // The two endpoints that write to D1, answered here and always with
            // a failure. Two reasons, and the second is the important one: this
            // file must never write a row into the real database, and a queue
            // that *can* drain says nothing, because "已全部上传" is what an
            // empty queue says as well. See `stopWrites`.
            if (request.url.includes('/likes') || request.url.includes('/plays')) {
                const likes = request.url.includes('/likes');
                if (!preflight) {
                    if (likes) likesStubHits += 1;
                    else playsStubHits += 1;
                }
                send('Fetch.fulfillRequest', {
                    requestId,
                    responseCode: preflight ? 204 : 503,
                    responseHeaders: cors,
                    ...(preflight
                        ? {}
                        : { body: Buffer.from('{"error":"stubbed"}').toString('base64') }),
                }).catch(() => {});
                return;
            }

            // A Drive track's *audio* comes from `files/<id>?alt=media` — the
            // same prefix as the listing, so the two are told apart by the
            // query rather than by a second pattern. Answering the download
            // with the listing (which is what a stub that only knows about
            // `files*` does) hands the element a JSON body: it never fires
            // `play`, and every check built on "was a play recorded?" passes
            // without anything having played.
            const media = request.url.includes('alt=media');
            const reply = preflight
                ? { responseCode: 204, responseHeaders: cors }
                : media
                    ? {
                        responseCode: 200,
                        responseHeaders: cors.concat([{ name: 'Content-Type', value: 'audio/wav' }]),
                        body: (driveAudio || Buffer.alloc(0)).toString('base64'),
                    }
                    : {
                        responseCode: 200,
                        responseHeaders: cors.concat([{ name: 'Content-Type', value: 'application/json' }]),
                        body: Buffer.from(JSON.stringify(driveStub)).toString('base64'),
                    };
            if (!preflight) {
                if (media) driveMediaHits += 1;
                else driveStubHits += 1;
            }
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
     *
     * It is the header's `<h1>`, and that heading is off screen (`.sr-only`) now
     * that the avatar has the pixels — but `innerText` reads a clipped element
     * all the same. `display: none` would not, which is why the heading is
     * hidden the way it is: this lookup is the only observable a source switch
     * has.
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
        // Every distinct value seen, in order, capped. "gave up" on its own is
        // not a diagnosis: `[62]` means it never changed, `[62,2]` means the
        // state arrived and was then put back, and those are different bugs.
        const seen = [];
        for (;;) {
            last = await evaluate(expression);
            const stamp = JSON.stringify(last);
            if (!seen.includes(stamp)) seen.push(stamp);
            if (ok(last)) {
                return { value: last, ms: Date.now() - started, timedOut: false, seen };
            }
            if (Date.now() - started >= timeoutMs) {
                return { value: last, ms: Date.now() - started, timedOut: true, seen };
            }
            await sleep(400);
        }
    };

    /** The `seen` trace as a short string, for a check's detail. */
    const trace = (waited) => (waited.seen || []).slice(0, 6).join(' -> ');

    /**
     * Every request this run answers itself, in one place.
     *
     * `Fetch.enable` **replaces** the pattern set rather than adding to it, so a
     * stage that enabled only its own pattern would silently un-stub the ones
     * before it. That is why this list is sent whole by both `stopWrites` and
     * `stubDriveFiles`.
     */
    const STUB_PATTERNS = [
        // The Drive library's listing *and* its audio: the media URL is
        // `files/<id>?alt=media`, so one pattern covers both and the handler
        // tells them apart by the query.
        { urlPattern: 'https://www.googleapis.com/drive/v3/files*', requestStage: 'Request' },
        // The two endpoints that write to the real database.
        { urlPattern: '*://*/likes*', requestStage: 'Request' },
        { urlPattern: '*://*/plays*', requestStage: 'Request' },
        // The public library's list, so that a test can hold it. Continued
        // immediately unless one asks — see `cloudDelayMs`.
        { urlPattern: '*://*/tracks*', requestStage: 'Request' },
    ];
    const enableStubs = () => send('Fetch.enable', { patterns: STUB_PATTERNS });

    /**
     * Catch the beat's `AudioContext` — and its `AnalyserNode` — as they are
     * made, so that the things that decide whether a tapped song is audible at
     * all can be looked at.
     *
     * `h5/useBeat` reads `window.AudioContext` when the first track starts, so
     * replacing the global before any tap captures every context the page
     * creates. Registered twice on purpose: once for the document that is
     * already loaded, and once for every document after it — the h5 stage
     * reloads — because the hook has to be in place before the page's own
     * scripts are.
     *
     * The analyser is worth catching for the same reason the context is: it is
     * the path the sound itself takes (element → source node → analyser →
     * destination), so an energy reading off it is the closest a headless
     * browser gets to hearing the song, and it is what reads zero when the tap
     * has gone wrong.
     */
    const captureAudioContexts = async () => {
        const hook = `(() => {
            if (window.__musicContexts) return;
            const Orig = window.AudioContext || window.webkitAudioContext;
            if (!Orig) return;
            const contexts = [];
            const analysers = [];
            const Wrapped = function (...args) {
                const ctx = new Orig(...args);
                contexts.push(ctx);
                return ctx;
            };
            Wrapped.prototype = Orig.prototype;
            const origCreateAnalyser = Orig.prototype.createAnalyser;
            Orig.prototype.createAnalyser = function (...args) {
                const node = origCreateAnalyser.apply(this, args);
                analysers.push(node);
                return node;
            };
            window.__musicContexts = contexts;
            window.__musicAnalysers = analysers;
            window.AudioContext = Wrapped;
        })()`;
        await send('Page.addScriptToEvaluateOnNewDocument', { source: hook });
        await evaluate(hook);
    };

    /**
     * Thirty seconds of a pulsing tone, as a real WAV file.
     *
     * The Drive library's audio is served from the same host as its listing, so
     * a stub for the listing has to answer the download as well — with
     * something an `<audio>` element will actually play. Long enough not to run
     * out mid-check, so playback does not advance to the next track while the
     * assertions are still reading.
     *
     * It used to be silence, and silence is no longer enough: the note on the
     * app's mark is driven by a real `AnalyserNode` on the audio element (see
     * `h5/useBeat`), and an analyser reading silence reports a level of zero,
     * which is exactly what it reports when it is broken. A tone that swells
     * and fades is a signal the note has to move for, so "the note moves" can
     * be asserted instead of assumed. 220 Hz sits in the band that hook reads
     * (bins 1–4 of a 512-point FFT), and the 1.5 Hz swell keeps the level
     * *changing*, which is what the check looks for.
     *
     * Amplitude is deliberately modest — about -12 dBFS at the peak of the
     * swell. Louder and the level would sit pinned at the top, where a moving
     * note and a stuck one look the same.
     */
    const pulseWav = function (seconds) {
        const rate = 8000;
        const samples = rate * seconds;
        const wav = Buffer.alloc(44 + samples);
        wav.write('RIFF', 0);
        wav.writeUInt32LE(36 + samples, 4);
        wav.write('WAVE', 8);
        wav.write('fmt ', 12);
        wav.writeUInt32LE(16, 16); // PCM header size
        wav.writeUInt16LE(1, 20); // format: PCM
        wav.writeUInt16LE(1, 22); // channels: mono
        wav.writeUInt32LE(rate, 24);
        wav.writeUInt32LE(rate, 28); // byte rate: 8-bit mono
        wav.writeUInt16LE(1, 32); // block align
        wav.writeUInt16LE(8, 34); // bits per sample
        wav.write('data', 36);
        wav.writeUInt32LE(samples, 40);
        for (let i = 0; i < samples; i += 1) {
            const t = i / rate;
            const swell = 0.06 + 0.2 * (0.5 + 0.5 * Math.sin(Math.PI * 2 * 1.5 * t));
            // 8-bit PCM is unsigned: 128 is silence, not 0.
            const v = 128 + Math.round(Math.sin(Math.PI * 2 * 220 * t) * swell * 127);
            wav[i + 44] = Math.max(0, Math.min(255, v));
        }
        return wav;
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
     * Only requests matching the patterns are paused, so nothing else on the
     * page is disturbed.
     */
    const stubDriveFiles = async (files) => {
        driveStub = { files };
        driveAudio = pulseWav(30);
        await enableStubs();
    };

    /**
     * Stop the two endpoints that write to the database, at the network layer —
     * see the branch in the `Fetch.requestPaused` handler. `/plays` gets the
     * same treatment as `/likes` because it writes rows for the same number.
     *
     * Two jobs. The first is safety: both endpoints write to a real D1
     * database, and a test run must not leave rows behind under a number nobody
     * owns. The second is that the failure is the state worth testing: 数据同步's
     * whole subject is a queue that has *not* arrived, and a queue that drains
     * instantly looks exactly like an empty one.
     */
    const stopWrites = async () => {
        await enableStubs();
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

        // Two waits, because there are two kinds of toggle here.
        //
        // Where the state mirrors the click (`cycle: true`) there is no hurry:
        // 2.5s lets whatever the click set in motion finish before the picture
        // is taken. Where the state is *derived* it can move on its own, and
        // the desktop list button is the case in point — it publishes
        // `listOpen && !autoHidden`, and the auto-fold fires three seconds
        // after playback starts. That one is read at 1.2s, and it is read
        // *before* the screenshot rather than after: a CDP screenshot is a
        // round trip whose duration depends on how busy the machine is, and
        // with the shot in between, this check passed on its own and failed
        // inside `--all`, reading false at 3.0s+ for a page that had already
        // done the right thing. At 1.2s the click is still the only reason the
        // value changed, and there is 1.8s of headroom for the shot.
        const settle = cycle ? 2500 : 1200;

        await clickToggle(selector);
        await sleep(settle);
        const on = await evaluate(toggleState(selector));
        await shot(`${step}-a`);

        await clickToggle(selector);
        await sleep(settle);
        const off = await evaluate(toggleState(selector));
        await shot(`${step}-b`);

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
    // Before the first tap: the beat's context is created on the first play.
    await captureAudioContexts();

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

    /* --- the row drawer, shared by 置顶 and 我喜欢 -------------------------
     *
     * A drawer action is picked by its **visible label**, never by its index:
     * the drawer is a list of actions and the label is what the visitor chooses
     * by, while an index silently starts pointing at a different action the
     * next time a row is inserted above it. `accept` is a set because 置顶 and
     * 喜欢 both carry their state in their label — which of the two is correct
     * depends on the song, and a one-state selector would stop matching the
     * moment the click it just made took effect.
     */

    /** The drawer's actions as `{title, sub, disabled}`, or null if it is shut. */
    const drawerItems = (spec) => evaluate(`(() => {
        const drawer = document.querySelector(${JSON.stringify(spec.drawer)});
        if (!drawer) return null;
        return [...drawer.querySelectorAll('[role="menuitem"]')].map((b) => {
            const lines = (b.innerText || '').split('\\n').map((s) => s.trim()).filter(Boolean);
            return { title: lines[0] || '', sub: lines[1] || '', disabled: b.disabled === true };
        });
    })()`);

    /** The one action whose label is in `accept`. Returns its label, or why not. */
    const clickDrawerItem = (spec, accept) => evaluate(`(() => {
        const drawer = document.querySelector(${JSON.stringify(spec.drawer)});
        if (!drawer) return 'no drawer';
        const items = [...drawer.querySelectorAll('[role="menuitem"]')];
        const titles = items.map((b) => ((b.innerText || '').split('\\n')[0] || '').trim());
        const index = titles.findIndex((t) => ${JSON.stringify(accept)}.includes(t));
        if (index === -1) return 'none of ' + ${JSON.stringify(accept.join('/'))} + ' in: ' + titles.join('/');
        items[index].click();
        return titles[index];
    })()`);

    /**
     * Open one row's drawer and return that row's title.
     *
     * `picker` is a JS expression over `rows`, so a caller chooses by index or
     * by name. `closest('li')` because in both trees the ⋮ is the row's sibling
     * rather than its child: the row itself is the play target, and one button
     * inside another is invalid HTML.
     *
     * The title is read from `aria-label` (phone: `播放 <title>`) or `title`
     * (desktop: `<title> - <artist>`), whichever the layout publishes.
     */
    const openRowDrawer = async (spec, picker) => evaluate(`(() => {
        const rows = [...document.querySelectorAll(${JSON.stringify(target.rows)})];
        const row = ${picker};
        if (!row) return '';
        const li = row.closest('li');
        const more = li && li.querySelector(${JSON.stringify(spec.rowMenu)});
        if (!more) return '';
        more.click();
        return (row.getAttribute('aria-label') || row.getAttribute('title') || '')
            .replace(/^播放\\s*/, '').replace(/\\s+/g, ' ').trim();
    })()`);

    /** Shut the drawer without clicking anything in it. */
    const closeDrawer = async () => {
        await evaluate(
            `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
        );
        await sleep(600);
    };

    /**
     * Every row's title, in the order they are on screen.
     *
     * The list's *order* is the only witness for 取消置顶. "The song went back
     * where it was" and "the song went back to the top" are the same thing
     * until you look past the first row, and only one of them is the feature —
     * so the checks below compare whole arrays rather than the head of one.
     */
    const rowTitles = `(() => [...document.querySelectorAll(${JSON.stringify(target.rows)})]
        .map((r) => (r.getAttribute('aria-label') || r.getAttribute('title') || '')
            .replace(/^播放\\s*/, '').replace(/\\s+/g, ' ').trim()))()`;

    /* --- 置顶 / 取消置顶 ---------------------------------------------------
     *
     * 置顶 used to be one-way: the drawer greyed its item out as soon as the
     * song reached the first row, so a visitor could pin a song and never take
     * it back. The claim now is that 取消置顶 returns it to the *default*
     * order, and that is what the whole-array comparisons are for.
     *
     * The song to pin is deliberately not the first row, and the run says so
     * out loud: pinning the song that is already on top moves nothing, and
     * every check here would pass on a page where 置顶 did nothing at all.
     *
     * This stage reloads the page once — to prove the pin was stored, and to
     * get into the one state that matters, where the pinned song really is the
     * first row. That is why it runs *before* the 我喜欢 stage, which reloads
     * for its own reasons and expects to find the list in its default order.
     */
    if (target.pin) {
        const spec = target.pin;
        const before = await evaluate(rowTitles);
        const matched = track ? before.findIndex((t) => t.includes(track)) : -1;
        // `--track` is honoured only when it lands somewhere other than the
        // first row: this stage is about moving a song, and a run that pins the
        // song already on top measures nothing.
        const index = matched > 0 ? matched : 1;
        check(
            'there is a non-first row to pin',
            before.length > 1 && index < before.length,
            `${before.length} rows, pinning #${index + 1} (${before[index] || 'none'})`,
        );

        const pinTitle = before[index];
        const rest = before.filter((_, i) => i !== index);

        const opened = await openRowDrawer(spec, `rows[${index}]`);
        check('the row drawer opened', Boolean(opened) && opened === pinTitle, opened || '(no three-dots button)');
        await sleep(900);
        await shot('pin-drawer');

        // Read the whole item, not just its label: the old version published
        // 「已经在列表第一位」 on a `disabled` row, and the state a drawer
        // believes it is in is exactly what this is checking.
        const pinItem = (items) => (items || []).find((i) => i.title === '置顶' || i.title === '取消置顶') || null;
        const unpinned = pinItem(await drawerItems(spec));
        check(
            'a song that is not pinned offers 置顶',
            Boolean(unpinned) && unpinned.title === '置顶' && unpinned.disabled === false,
            unpinned ? `${unpinned.title}${unpinned.disabled ? ' (disabled)' : ''}` : '(no pin item)',
        );

        const pinnedLabel = await clickDrawerItem(spec, ['置顶', '取消置顶']);
        check('...and clicking it pins the song', pinnedLabel === '置顶', String(pinnedLabel));
        await sleep(1600);
        await shot('pinned');

        const afterPin = await evaluate(rowTitles);
        const expectedPinned = [pinTitle, ...rest];
        check(
            '置顶 moves the song to the head and leaves the rest alone',
            JSON.stringify(afterPin) === JSON.stringify(expectedPinned),
            `head=${afterPin[0]} want=${pinTitle}`,
        );

        // --- the reload ------------------------------------------------------
        await send('Page.reload', {});
        await sleep(3000);
        const back = await waitFor(rowTitles, (v) => Array.isArray(v) && v.length > 1, 30000);
        check('the list comes back after a reload', back.value.length > 1, `${back.value.length} rows`);
        // Settle before reading the order: the public library paints from its
        // permanent list cache before the live list lands, and this file has
        // already been caught once reading the first of those as the second.
        await sleep(1500);
        const afterReload = await evaluate(rowTitles);
        // Compared whole, and that is doing two jobs. It is the persistence
        // claim — the pin was written, not just rendered — and it is also what
        // lets the check at the end compare against `before`: it shows the
        // library's own order came back unchanged, so `before` is still the
        // default order the visitor is owed.
        check(
            'the pin survived a reload',
            JSON.stringify(afterReload) === JSON.stringify(expectedPinned),
            `head=${afterReload[0]} want=${pinTitle}, ${afterReload.length} rows`,
        );

        // The pinned song is the first row now, which is exactly the state the
        // old version refused to let go of. Nothing about "is it on top?" can
        // be used to decide the label here.
        const reopened = await openRowDrawer(spec, 'rows[0]');
        await sleep(900);
        await shot('pinned-drawer');
        const pinnedItem = pinItem(await drawerItems(spec));
        check(
            'the first row of a pinned list can still be unpinned',
            Boolean(pinnedItem) && pinnedItem.title === '取消置顶' && pinnedItem.disabled === false,
            pinnedItem ? `${pinnedItem.title}${pinnedItem.disabled ? ' (disabled)' : ''}` : `(no drawer: ${reopened})`,
        );

        const unpinnedLabel = await clickDrawerItem(spec, ['取消置顶', '置顶']);
        check('...and that item says 取消置顶', unpinnedLabel === '取消置顶', String(unpinnedLabel));
        await sleep(1600);
        const afterUnpin = await evaluate(rowTitles);
        // Against `before`, not against "the list without the pinned song".
        // Those are different orders and only one of them is the feature: the
        // song has to come back *to its own place*, not merely stop being
        // first. An expectation built by deleting the song passes for an
        // implementation that drops it to the end of the list.
        const drift = afterUnpin.findIndex((t, i) => t !== before[i]);
        check(
            '取消置顶 puts the list back to its default order',
            drift === -1 && afterUnpin.length === before.length,
            drift === -1
                ? `${afterUnpin.length} rows, same order as before the pin`
                : `first difference at #${drift + 1}: ${afterUnpin[drift]} vs ${before[drift]}`,
        );
        await shot('unpinned');

        // And the song is pinnable again — the point of a toggle rather than
        // two one-way actions that could disagree about which one applies.
        const again = await openRowDrawer(spec, `rows[${Math.max(0, afterUnpin.indexOf(pinTitle))}]`);
        await sleep(900);
        const againItem = pinItem(await drawerItems(spec));
        check(
            'the same song can be pinned again afterwards',
            Boolean(againItem) && againItem.title === '置顶',
            againItem ? againItem.title : `(no drawer: ${again})`,
        );
        // Leave the page as the next stage expects to find it: no drawer open.
        await closeDrawer();
    }

    /* --- the phone's shell: the ⋮ drawer, the sheets, a guest's likes --------
     *
     * The phone has no tab bar. Its navigation is three taps: the app's mark
     * (leading end of the list's bar) raises 账号, the ⋮ raises a drawer holding
     * 音乐库 / 缓存管理 / 切换外观, and 听歌排行 is a row inside 账号. This stage
     * is here because all of that is *structure*, and structure is the one
     * thing a build and a screenshot both pass over: a sheet that quietly grew a
     * page header back, or a drawer that lost an entry, looks fine.
     *
     * It also guards the shape of the panel pair. 听歌排行 used to be a page
     * whose only entry was a 账号 capsule in its own header, while 账号's only
     * way to it was the row that opened it — a loop with no exit. As a sheet it
     * closes, and closing it has to land on the list: that is what the check
     * below presses the 收起 button to see.
     *
     * The guest half is the other reason. 喜欢 works without a confirmed QQ
     * number now, and the likes made that way are *only* local — which is a
     * claim about where a write did **not** go. So the API is stopped
     * (`stopWrites`), the number is confirmed on the sheet, and what is checked
     * is what the sheet then says about its own queue.
     */
    if (target.shell) {
        const spec = target.shell;
        const menu = '[role="menu"][aria-label="更多功能"]';
        const sheetOf = (title) => `[role="dialog"][aria-label=${JSON.stringify(title)}]`;
        const sheetState = (title) => evaluate(`(() => {
            const s = document.querySelector(${JSON.stringify(sheetOf(title))});
            if (!s) return null;
            return {
                header: Boolean(s.querySelector('header')),
                collapse: Boolean(s.querySelector('button[title="收起"]')),
                form: Boolean(s.querySelector('form')),
                // 账号's identity card, and the only structural thing that is
                // about *the card* rather than about the sheet: 清除 lives on
                // the card and nowhere else. It is the card's fingerprint
                // because the card's other half — the verdict — was a 已确认
                // badge that has since been removed, and a test that reads a
                // label the product no longer prints is a test that quietly
                // stops asking anything.
                card: [...s.querySelectorAll('button')]
                    .some((b) => (b.innerText || '').trim() === '清除'),
                text: (s.innerText || '').replace(/\\s+/g, ' ').trim(),
            };
        })()`);
        const shut = async (title) => {
            await evaluate(`(() => {
                const s = document.querySelector(${JSON.stringify(sheetOf(title))});
                const b = s && s.querySelector('button[title="收起"]');
                if (b) b.click();
            })()`);
        };

        // --- the ⋮ and its drawer -------------------------------------------
        const moreClicked = await evaluate(`(() => {
            const b = document.querySelector(${JSON.stringify(spec.more)});
            if (!b) return 'missing';
            b.click();
            return 'clicked';
        })()`);
        check('the ⋮ is on the bar', moreClicked === 'clicked', String(moreClicked));
        await sleep(800);
        await shot('drawer');
        const menuTitles = await evaluate(`(() => {
            const m = document.querySelector(${JSON.stringify(menu)});
            if (!m) return null;
            return [...m.querySelectorAll('[role="menuitem"]')]
                .map((b) => ((b.innerText || '').split('\\n')[0] || '').trim());
        })()`);
        check(
            'the drawer holds the library, the cache and the appearance',
            Array.isArray(menuTitles) && menuTitles.join('/') === '音乐库/缓存管理/切换外观',
            Array.isArray(menuTitles) ? menuTitles.join('/') : 'no drawer',
        );

        // --- 音乐库 is a sheet, not a page ----------------------------------
        const libraryPicked = await evaluate(`(() => {
            const m = document.querySelector(${JSON.stringify(menu)});
            if (!m) return 'no drawer';
            const item = [...m.querySelectorAll('[role="menuitem"]')]
                .find((b) => ((b.innerText || '').split('\\n')[0] || '').trim() === '音乐库');
            if (!item) return 'no 音乐库 entry';
            item.click();
            return 'clicked';
        })()`);
        check('音乐库 is one of them', libraryPicked === 'clicked', String(libraryPicked));
        await sleep(900);
        await shot('library-sheet');
        const library = await sheetState('音乐库');
        check('the library sheet opened', Boolean(library), library ? 'open' : '(not found)');
        check(
            '...as a sheet, not a page with a header',
            Boolean(library) && library.header === false && library.collapse === true,
            library ? `header=${library.header} collapse=${library.collapse}` : '',
        );
        check(
            '...and the drawer got out of the way',
            (await evaluate(`!document.querySelector(${JSON.stringify(menu)})`)) === true,
            'drawer closed',
        );
        // The merge: 谷歌云盘链接 is a row *in here* now, not a drawer entry
        // beside this panel. Reading the row's own label is the only way to see
        // the two halves arrive as one screen.
        check(
            '...and it carries the way to a Drive library',
            Boolean(library) && library.text.includes('连接 Google 云盘'),
            library ? library.text.slice(0, 120) : '',
        );

        await shut('音乐库');
        await sleep(800);
        check(
            'its collapse button shuts it',
            (await evaluate(`!document.querySelector(${JSON.stringify(sheetOf('音乐库'))})`)) === true,
            'gone',
        );

        // Escape is the drawer's only other way out — it has a scrim, but a
        // keyboard is what a wide-screen visitor reaches for.
        await evaluate(`(() => {
            const b = document.querySelector(${JSON.stringify(spec.more)});
            if (b) b.click();
        })()`);
        await sleep(700);
        await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
        await sleep(800);
        check(
            'Escape shuts the drawer',
            (await evaluate(`!document.querySelector(${JSON.stringify(menu)})`)) === true,
            'closed',
        );

        // --- a guest likes a song, and nothing leaves the device -------------
        await stopWrites();
        const likedId = await evaluate(`(() => {
            const rows = [...document.querySelectorAll(${JSON.stringify(target.rows)})];
            const row = ${pick};
            if (!row) return '';
            const li = row.closest('li');
            return li ? (li.getAttribute('data-track-id') || '') : '';
        })()`);
        const likedTitle = await openRowDrawer(spec.rowDrawer, `${pick} || rows[0]`);
        await sleep(900);
        await shot('guest-drawer');
        const guestLabel = await clickDrawerItem(spec.rowDrawer, ['喜欢', '取消喜欢']);
        check('a guest is offered 喜欢', guestLabel === '喜欢', String(guestLabel));
        await sleep(900);

        const stored = await evaluate(`(() => ({
            guest: JSON.parse(localStorage.getItem('music:likes:guest') || '[]').map((e) => e.id),
            queued: JSON.parse(localStorage.getItem('music:likesPending') || '{}'),
        }))()`);
        check(
            '...and it lands in this browser',
            Array.isArray(stored.guest) && stored.guest.includes(likedId),
            `${likedId} in [${(stored.guest || []).join(',')}]`,
        );
        check(
            '...and is queued for nobody',
            Object.keys(stored.queued || {}).length === 0,
            JSON.stringify(stored.queued),
        );

        // --- the mark raises 账号, and confirming a number adopts those likes --
        const markClicked = await evaluate(`(() => {
            const b = document.querySelector(${JSON.stringify(target.mark)});
            if (!b) return 'missing';
            b.click();
            return 'clicked';
        })()`);
        check('the mark is on the bar', markClicked === 'clicked', String(markClicked));
        await sleep(900);
        await shot('account-sheet');
        const account = await sheetState('账号');
        check('the mark opens 账号', Boolean(account), account ? 'open' : '(not found)');
        check(
            '...as a sheet, not a page with a header',
            Boolean(account) && account.header === false && account.collapse === true,
            account ? `header=${account.header} collapse=${account.collapse}` : '',
        );
        check(
            '...and it asks for a number instead of showing one',
            Boolean(account) && account.form === true && account.card === false,
            account ? `form=${account.form} card=${account.card} ${account.text.slice(0, 80)}` : '',
        );

        const saved = await evaluate(`(() => {
            const s = document.querySelector(${JSON.stringify(sheetOf('账号'))});
            if (!s) return 'no sheet';
            const input = s.querySelector('input[aria-label="QQ 号"]');
            const form = s.querySelector('form');
            if (!input || !form) return 'no field';
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, '10001');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            form.requestSubmit();
            return 'submitted';
        })()`);
        check('the number can be confirmed on the sheet', saved === 'submitted', String(saved));
        await sleep(1600);
        await shot('account-confirmed');
        const confirmed = await sheetState('账号');
        check(
            '...and the card replaces the form it was typed into',
            Boolean(confirmed) && confirmed.form === false && confirmed.card === true
                && confirmed.text.includes('QQ 10001'),
            confirmed ? `form=${confirmed.form} card=${confirmed.card} ${confirmed.text.slice(0, 90)}` : '',
        );
        // The claim under test: the likes made as a guest went *with* the number,
        // and they are still waiting because the API was stopped. Read from the
        // sheet, not from localStorage — the row is the visitor's evidence.
        check(
            '...and the guest likes are now queued for it',
            Boolean(confirmed) && /本地还有 \d+ 条数据没上传/.test(confirmed.text),
            confirmed ? confirmed.text.slice(0, 140) : '',
        );
        const handedOver = await evaluate(`(() => ({
            guest: JSON.parse(localStorage.getItem('music:likes:guest') || '[]').length,
            queued: Object.keys(JSON.parse(localStorage.getItem('music:likesPending') || '{}')[10001] || {}),
        }))()`);
        check(
            '...and this browser no longer holds them as a guest',
            handedOver.guest === 0 && handedOver.queued.includes(likedId),
            `guest=${handedOver.guest} queued=[${handedOver.queued.join(',')}]`,
        );
        check(
            'the likes API was stopped, not called',
            likesStubHits > 0,
            `${likesStubHits} request(s)`,
        );

        // --- 听歌排行 is a sheet, and closing it lands on the list -----------
        const toStats = await evaluate(`(() => {
            const s = document.querySelector(${JSON.stringify(sheetOf('账号'))});
            if (!s) return 'no sheet';
            const row = [...s.querySelectorAll('button')]
                .find((b) => ((b.innerText || '').split('\\n')[0] || '').trim() === '听歌排行');
            if (!row) return 'no 听歌排行 row';
            row.click();
            return 'clicked';
        })()`);
        check('听歌排行 is a row on 账号', toStats === 'clicked', String(toStats));
        await sleep(1500);
        await shot('stats');
        const ranking = await sheetState('听歌排行');
        check(
            '...and it rises as a sheet, not a page with a header',
            Boolean(ranking) && ranking.header === false && ranking.collapse === true,
            ranking ? `header=${ranking.header} collapse=${ranking.collapse}` : '(not found)',
        );
        check(
            '...with 账号 out of the way underneath',
            (await evaluate(`!document.querySelector(${JSON.stringify(sheetOf('账号'))})`)) === true,
            '账号 down',
        );
        check(
            '...showing the two rankings',
            (await evaluate(`Boolean(document.querySelector('[role="tablist"][aria-label="排行范围"]'))`)) === true,
            '全部 / 最近 7 天',
        );

        // The loop this used to be: 听歌排行's only control was a 账号 capsule in
        // its own header, and 账号's only way here was the row that opened it.
        // A sheet closes instead, so the check is that closing it leaves
        // *nothing* standing — not 账号, not the ranking.
        await shut('听歌排行');
        await sleep(1000);
        check(
            'its 收起 button puts the visitor back on the list',
            (await evaluate(`!document.querySelector(${JSON.stringify(sheetOf('听歌排行'))})`)) === true
                && (await evaluate(`!document.querySelector(${JSON.stringify(sheetOf('账号'))})`)) === true,
            'no sheet left standing',
        );

        // --- the number card and the confirm block are one thing ------------
        await evaluate(`(() => {
            const b = document.querySelector(${JSON.stringify(target.mark)});
            if (b) b.click();
        })()`);
        await sleep(900);
        const cleared = await evaluate(`(() => {
            const s = document.querySelector(${JSON.stringify(sheetOf('账号'))});
            if (!s) return 'no sheet';
            const b = [...s.querySelectorAll('button')]
                .find((x) => (x.innerText || '').trim() === '清除');
            if (!b) return 'no 清除 button';
            b.click();
            return 'clicked';
        })()`);
        check('the number card carries its own 清除 button', cleared === 'clicked', String(cleared));
        await sleep(900);
        await shot('account-cleared');
        const afterClear = await sheetState('账号');
        check(
            '...and clearing it leaves the confirm block, nothing else',
            Boolean(afterClear) && afterClear.form === true && afterClear.card === false,
            afterClear ? `form=${afterClear.form} card=${afterClear.card} ${afterClear.text.slice(0, 80)}` : '',
        );

        // Leave the run clean for the 我喜欢 stage, which expects a public
        // library with no number confirmed and nothing liked. This is the one
        // place this file writes storage itself, and it is undoing its own
        // side effects rather than arranging a state to be tested.
        await evaluate(`(() => {
            ['music:setting:qq', 'music:likes:guest', 'music:likesPending', 'music:likes:10001']
                .forEach((k) => localStorage.removeItem(k));
        })()`);
        await send('Page.reload', {});
        await sleep(3000);
        const restored = await waitFor(rowTitles, (v) => Array.isArray(v) && v.length > 0, 30000);
        check('the list comes back for the next stage', restored.value.length > 0, `${restored.value.length} rows`);
    }

    /* --- 我喜欢, end to end ------------------------------------------------
     *
     * The stage that reloads the page to prove a *preference* was stored, and
     * that is the whole point of it: every other check here can be satisfied by
     * React state that was never written anywhere. "永不过期" is a claim about
     * storage, so the only way to test it is to throw the page away and come
     * back.
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

        // `|| rows[0]` matters: the Drive part of this stage has a library where
        // `--track` matches nothing, and without the fallback it would open no
        // drawer at all — which would make "no 喜欢 item in the Drive drawer"
        // pass by measuring an empty string.
        const likedTitle = await openRowDrawer(spec, `${pick} || rows[0]`);
        check('the row drawer opened', Boolean(likedTitle), likedTitle || '(no three-dots button)');
        await sleep(900);
        await shot('like-drawer');

        const itemLabel = await clickDrawerItem(spec, ['喜欢', '取消喜欢']);
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
            // A number as well, because the last check in this stage is about
            // whether a Drive *play* is reported — and with no number nothing is
            // recorded whatever the source is, so the check would pass for the
            // wrong reason. (This is also why stopWrites has to keep /likes and
            // /plays stubbed from here on: confirming a number adopts the
            // guest's likes, which would otherwise be POSTed to the real
            // database by the reload below.)
            localStorage.setItem('music:setting:qq', '10001');
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
        check('...and lists the Drive files', driveRows.value === 2, `${driveRows.value} rows, saw ${trace(driveRows)}`);
        // Reported separately from the row count, because these two failures
        // have nothing in common: no hits means the request never reached the
        // stub, hits-but-wrong-rows means the list arrived and something put it
        // back. The row count alone cannot tell them apart.
        check('the Drive API request was intercepted', driveStubHits > 0, `${driveStubHits} request(s)`);

        // Settle before believing it.
        //
        // On mount the public library starts a fetch of its own, and `loadTracks`
        // has no staleness guard — whichever source resolves last owns `tracks`.
        // So "the Drive rows are on screen" is only half the claim; the other
        // half is that they are still there a moment later. One run of this
        // stage failed here and never reproduced, and this check is what turns
        // that from a mystery into a finding.
        await sleep(2500);
        const settledRows = await evaluate(rowCount);
        check('...and the public library did not land on top of it', settledRows === 2, `${settledRows} rows`);
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

        const driveTitle = await openRowDrawer(spec, `${pick} || rows[0]`);
        await sleep(900);
        await shot('drive-drawer');
        // The titles come back as an array, and the check compares them whole
        // rather than searching the joined string for 喜欢. Those are two
        // different questions: a substring search is satisfied by any label
        // that merely *contains* the two characters, so a drawer offering
        // nothing a visitor could press to like a song would still pass a check
        // claiming it offered 喜欢. Whole labels are what the visitor chooses
        // between, so whole labels are what is compared.
        const driveItems = await drawerItems(spec);
        const driveLabels = Array.isArray(driveItems) ? driveItems.map((i) => i.title) : null;
        check(
            'the Drive row drawer opened',
            Array.isArray(driveLabels),
            driveLabels ? `${driveTitle}: ${driveLabels.join('/')}` : 'no drawer',
        );
        check(
            'no 喜欢 in a Drive row drawer',
            Array.isArray(driveLabels) && !driveLabels.some((t) => t === '喜欢' || t === '取消喜欢'),
            Array.isArray(driveLabels) ? driveLabels.join('/') : String(driveLabels),
        );

        /* --- and a Drive play is not reported ------------------------------
         *
         * 听歌排行 is the public library's ranking, so `recordPlay` refuses a
         * Drive track — the same line 喜欢 draws. This is the only place the
         * rule can be observed end to end, and it only works because the stub
         * now answers the *download* as well as the listing (see `pulseWav`):
         * with the listing alone, the element gets a JSON body, never fires
         * `play`, and "no play was reported" is true on a page where nothing
         * ever played. So the element's own state is asserted *first* — a
         * check that cannot tell "not counted" from "not played" is not a
         * check.
         *
         * The number is confirmed by the time this runs, which is what makes
         * the refusal the *source* rule rather than the no-number one.
         */
        await closeDrawer();
        const drivePlayed = await evaluate(`(() => {
            const row = document.querySelector(${JSON.stringify(target.rows)});
            if (!row) return 'no row';
            row.click();
            return 'clicked';
        })()`);
        check('a Drive row can be played at all', drivePlayed === 'clicked', String(drivePlayed));
        let driveReady = 0;
        for (let i = 0; i < 30 && driveReady === 0; i += 1) {
            await sleep(1000);
            driveReady = Number(await evaluate(
                "(() => { const a = document.querySelector('audio'); return a && !a.paused ? a.readyState : 0; })()",
            )) || 0;
        }
        check('...and it is really playing', driveReady > 0, `readyState=${driveReady}`);
        check(
            '...and the Drive audio was served by the stub',
            driveMediaHits > 0,
            `${driveMediaHits} media request(s)`,
        );
        check(
            '...and a Drive play is not reported',
            playsStubHits === 0,
            `${playsStubHits} request(s) to /plays`,
        );

        /* --- and the note on the mark moves with the music -----------------
         *
         * The mark is a drawing now: the published artwork's rainbow as a
         * backdrop, and the note that was on it redrawn as a path on top, so
         * that it can be lifted and stretched. Three things can go wrong and
         * all three pass a screenshot — the note can be drawn wrong, the
         * backdrop can be the wrong picture, and the note can simply never
         * move. So the geometry is measured against the icon the trace came
         * from, and the motion is read off the transform the note is given
         * while the tone above is playing.
         *
         * The box is `getBBox`, which is the path's own geometry and so does
         * not move with the animation. The numbers are the published icon's:
         * the note occupies x 147..395, y 109..395 of its 512-unit square.
         */
        const markShape = await evaluate(`(() => {
            const b = document.querySelector(${JSON.stringify(target.mark)});
            if (!b) {
                // Say what *is* on screen instead of just "no mark". A mark
                // that is not found is a header that is not drawn, a label
                // that changed, and a sheet that has taken the screen over —
                // three different faults that want three different fixes, and
                // the bare fact that a selector matched nothing names none of
                // them.
                const header = document.querySelector('header');
                return {
                    why: 'no mark',
                    headers: document.querySelectorAll('header').length,
                    labels: header
                        ? [...header.querySelectorAll('button')]
                            .map((x) => x.getAttribute('aria-label') || (x.innerText || '').trim().slice(0, 12))
                            .join(' | ')
                        : '(no header)',
                    screen: (document.body.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 120),
                };
            }
            const svg = b.querySelector('svg');
            const path = svg && svg.querySelector('path');
            let box = null;
            if (path) {
                const r = path.getBBox();
                box = { x: r.x, y: r.y, w: r.width, h: r.height };
            }
            return {
                viewBox: svg ? svg.getAttribute('viewBox') : '',
                box,
                backdrop: b.style.backgroundImage || '',
            };
        })()`);
        const box = markShape && markShape.box;
        // One description, used by all three checks below: when the mark is not
        // there at all, "no path" and "none" would each hide the one fact that
        // matters.
        const missing = markShape && markShape.why
            ? `${markShape.why} (headers=${markShape.headers} labels=${markShape.labels} screen=${markShape.screen})`
            : '';
        check(
            'the mark draws its note as a path in the 512-unit space of the icon',
            Boolean(markShape) && markShape.viewBox === '0 0 512 512' && Boolean(box),
            !markShape
                ? '(no mark)'
                : (missing || `viewBox=${markShape.viewBox} box=${box ? 'yes' : 'no'}`),
        );
        check(
            '...and the note is the size and place of the one on the published icon',
            Boolean(box)
                && Math.abs(box.x - 147) <= 4
                && Math.abs(box.y - 109) <= 4
                && Math.abs(box.w - 248) <= 4
                && Math.abs(box.h - 286) <= 4,
            box
                ? `x=${box.x.toFixed(0)} y=${box.y.toFixed(0)} w=${box.w.toFixed(0)} h=${box.h.toFixed(0)} (icon: 147 109 248 286)`
                : (missing || '(no path)'),
        );
        check(
            '...and its backdrop is the artwork without the note on it',
            Boolean(markShape) && /mark-bg\.jpg/.test(markShape.backdrop),
            markShape && markShape.backdrop
                ? markShape.backdrop.slice(0, 90)
                : (missing || '(none)'),
        );

        // The sentinel carries the reason, so a run that finds no note says
        // whether the mark itself is gone or only the path on it. The filter
        // below is a prefix test for the same reason.
        const NO_NOTE = '(no note)';
        const noteTransform = () => evaluate(`(() => {
            const b = document.querySelector(${JSON.stringify(target.mark)});
            const p = document.querySelector(${JSON.stringify(`${target.mark} svg path`)});
            if (!p) return ${JSON.stringify(NO_NOTE)} + (b ? ' — mark drawn, no path' : ' — no mark at all');
            return p.style.transform || '';
        })()`);
        const frames = [];
        for (let i = 0; i < 12; i += 1) {
            frames.push(await noteTransform());
            await sleep(180);
        }
        const lifted = frames.filter((t) => t && !t.startsWith(NO_NOTE));
        check(
            'the note on the mark lifts while the music plays',
            lifted.length >= 10,
            `${lifted.length}/${frames.length} frames displaced`,
        );
        check(
            '...and it is moving rather than stuck at one height',
            new Set(lifted).size >= 3,
            `${new Set(lifted).size} distinct transforms over ${lifted.length} frames`,
        );

        /* --- and the graph survives the *next* song -------------------------
         *
         * The report that produced all of this was about the **second** song,
         * and until now nothing in this file had ever played two songs on one
         * element: every earlier playback happens in a fresh document, and a
         * fresh document means a fresh `<audio>` and a fresh graph. So the two
         * things only a second song can show were untested — that a tapped
         * element survives its `src` being replaced (the source node is bound to
         * the *element*, not to the resource it is playing), and that the audio
         * still flows through a live context afterwards.
         *
         * "Still flows" is read off the analyser rather than off the context's
         * state, because the analyser is the path the sound takes. It is also
         * the reading that catches a tap gone wrong: a broken source outputs
         * zeros while the element reports itself as playing.
         */
        const firstSrc = await evaluate("(() => { const a = document.querySelector('audio'); return a ? a.src : ''; })()");
        const secondSong = await evaluate(`(async () => {
            const c = window.__musicContexts && window.__musicContexts[0];
            const rows = [...document.querySelectorAll(${JSON.stringify(target.rows)})];
            if (rows.length < 2) return 'only one row to play';
            // The system takes the context away first — the state iOS leaves
            // behind after a trip to the background — and *then* the next song
            // starts, which is the order the report describes.
            if (c) await c.suspend();
            rows[1].click();
            return 'clicked';
        })()`);
        const secondPlaying = await waitFor(
            `(() => {
                const a = document.querySelector('audio');
                if (!a) return { why: 'no audio' };
                if (a.src === ${JSON.stringify(firstSrc)}) return { why: 'still the first song' };
                return { why: a.paused ? 'paused' : 'playing', t: a.currentTime };
            })()`,
            (v) => Boolean(v) && v.why === 'playing' && v.t > 0.5,
            15000,
        );
        check(
            'the next song starts on the same element',
            Boolean(secondPlaying.value) && secondPlaying.value.why === 'playing',
            `${secondSong}, ${secondPlaying.value && secondPlaying.value.why}`
                + ` in ${(secondPlaying.ms / 1000).toFixed(1)}s`,
        );
        // Sampled over several frames rather than read once: the analyser
        // smooths, so a single reading right after a resume can be the reading
        // from before it.
        let loudest = 0;
        for (let i = 0; i < 6; i += 1) {
            const level = Number(await evaluate(`(() => {
                const an = window.__musicAnalysers && window.__musicAnalysers[0];
                if (!an) return -1;
                const data = new Uint8Array(an.frequencyBinCount);
                an.getByteFrequencyData(data);
                let sum = 0;
                for (let i = 1; i < 5; i += 1) sum += data[i];
                return Math.round(sum / 4);
            })()`)) || 0;
            loudest = Math.max(loudest, level);
            await sleep(200);
        }
        check(
            '...and the analyser still reads the music through the new source',
            loudest > 8,
            `loudest 1-4 bin average over 6 frames: ${loudest}/255`,
        );

        /* --- and the sound survives the system taking the context away -----
         *
         * The regression this stage exists for. A media element source
         * *replaces* the element's own output, so from the moment the element
         * is tapped the song comes out of the `AudioContext` — which makes a
         * context that is not running not a missing animation but a silent
         * player, with the progress bar still moving and no error anywhere.
         * iOS interrupts a context when the page leaves the screen (`state`
         * reads `'interrupted'`, a state no other browser has), and the hook
         * used to check only for `'suspended'`, so nothing ever asked it back:
         * play a song, switch apps, come back, and every later song is silent.
         *
         * A headless browser cannot be backgrounded, so the interruption is
         * done by hand — `suspend()` leaves the context in the state the system
         * leaves it in — and then the page is told it is visible again. Nothing
         * is clicked and no gesture is given: what is checked is that the app
         * gets its own sound back, because nothing else in it can. (On a page
         * that is on screen the frame loop is what notices; the tap, which is
         * what iOS actually insists on, is the check at the very end.)
         */
        const contexts = await evaluate('window.__musicContexts ? window.__musicContexts.length : -1');
        const interrupted = await evaluate(`(async () => {
            const c = window.__musicContexts && window.__musicContexts[0];
            if (!c) return 'no context captured';
            await c.suspend();
            return c.state;
        })()`);
        check(
            'the beat reads a real analyser, on a context of its own',
            contexts >= 1,
            `${contexts} context(s), now ${interrupted}`,
        );
        await evaluate("document.dispatchEvent(new Event('visibilitychange'))");
        const revived = await waitFor(
            `(() => {
                const c = window.__musicContexts && window.__musicContexts[0];
                return c ? c.state : 'gone';
            })()`,
            (v) => v === 'running',
            6000,
        );
        check(
            '...and it comes back by itself when the system interrupts it',
            revived.value === 'running',
            `${interrupted} -> ${trace(revived)} in ${(revived.ms / 1000).toFixed(1)}s`
                + ` (visibility=${await evaluate('document.visibilityState')})`,
        );

        await evaluate("(() => { const a = document.querySelector('audio'); if (a) a.pause(); })()");
        await sleep(900);
        const settled = await noteTransform();
        check(
            '...and it goes back to rest when the music stops',
            settled === '',
            `transform=${JSON.stringify(settled)}`,
        );

        /* The other half of the same recovery, and the half that has to be
         * isolated: a *tap*.
         *
         * On iOS a `resume()` is only honoured from a user gesture, and the tap
         * that presses play arrives before the effect that watches playback has
         * run — so the tap has to be answered by a listener that is already
         * there, not by the effect. Pausing first is what makes this a test of
         * that listener: with the music stopped the frame loop has returned and
         * nothing else in the app is asking for the context at all, so the only
         * thing that can bring it back is the tap itself.
         */
        const tapped = await evaluate(`(async () => {
            const c = window.__musicContexts && window.__musicContexts[0];
            if (!c) return 'no context captured';
            await c.suspend();
            document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            return c.state;
        })()`);
        const afterTap = await waitFor(
            `(() => {
                const c = window.__musicContexts && window.__musicContexts[0];
                return c ? c.state : 'gone';
            })()`,
            (v) => v === 'running',
            4000,
        );
        check(
            '...and a tap on the screen brings it back even while paused',
            afterTap.value === 'running',
            `${tapped} -> ${trace(afterTap)} in ${(afterTap.ms / 1000).toFixed(1)}s`,
        );

        /* --- and the repair the visitor had to do by hand -------------------
         *
         * `state` is not the only way for the graph to go quiet. A context that
         * says `running` while its source node delivers nothing is silence too,
         * with no promise to catch and no state to read — and the report from
         * the device ended with the visitor repairing that themselves: go back
         * to the page, pause, play again. The app now does it for them.
         *
         * The silence is forced rather than waited for: the analyser is
         * overridden to report zeros, which is exactly what a dead source node
         * reports, and within a few seconds the element must have been paused
         * and started again. Nothing else in the app pauses it, so a pause event
         * here is the nudge and cannot be anything else.
         */
        await evaluate(`(() => {
            const a = document.querySelector('audio');
            if (!a) return 'no audio';
            window.__nudgePauses = 0;
            a.addEventListener('pause', () => { window.__nudgePauses += 1; });
            a.play();
            return 'playing';
        })()`);
        // Long enough for playback to be under way and the loop to be reading
        // the real analyser, so that what follows is the override's doing.
        await sleep(1500);
        const zeroed = await evaluate(`(() => {
            const proto = window.AnalyserNode && window.AnalyserNode.prototype;
            if (!proto || !proto.getByteFrequencyData) return 'no analyser to override';
            if (!window.__realGetByteFrequencyData) {
                window.__realGetByteFrequencyData = proto.getByteFrequencyData;
            }
            proto.getByteFrequencyData = function (array) { array.fill(0); };
            return 'zeroed';
        })()`);
        const nudged = await waitFor(
            '(() => (window.__nudgePauses || 0))()',
            (v) => Number(v) > 0,
            12000,
        );
        check(
            '...and a graph that reads nothing while the element plays gets a nudge',
            Number(nudged.value) > 0,
            `${zeroed}, ${nudged.value} pause(s) in ${(nudged.ms / 1000).toFixed(1)}s`,
        );
        const afterNudge = await evaluate(`(() => {
            const a = document.querySelector('audio');
            return a ? (a.paused ? 'paused' : 'playing') : 'gone';
        })()`);
        check(
            '...and the nudge leaves the music playing',
            afterNudge === 'playing',
            `${afterNudge}`,
        );
        await evaluate(`(() => {
            const proto = window.AnalyserNode && window.AnalyserNode.prototype;
            if (proto && window.__realGetByteFrequencyData) {
                proto.getByteFrequencyData = window.__realGetByteFrequencyData;
            }
            return 'restored';
        })()`);

        /* --- and the readout the next report will be made of ---------------
         *
         * Everything above is checked from a machine that can see the page from
         * the inside. A phone cannot be looked into at all, and the whole
         * subject of this stage is invisible from the outside — a silent player
         * reports itself as playing, draws a moving progress bar, and logs
         * nothing. So the page can be asked to say what it knows:
         * `?beatdebug=1`. That makes it worth a check of its own, in both
         * directions: the box must not exist for a visitor who did not ask for
         * it, and it must be there — reading a context state — for one who did.
         */
        const optIn = await evaluate("document.getElementById('beat-debug') ? 'present' : 'absent'");
        check(
            'the beat readout is opt-in — no ?beatdebug=1, no box',
            optIn === 'absent',
            String(optIn),
        );
        await send('Page.navigate', { url: `${target.url}?beatdebug=1` });
        await sleep(2500);
        const asked = await evaluate(`(() => {
            const rows = [...document.querySelectorAll(${JSON.stringify(target.rows)})];
            if (!rows.length) return 'no rows';
            rows[0].click();
            return 'clicked';
        })()`);
        const readout = await waitFor(
            `(() => {
                const box = document.getElementById('beat-debug');
                return box ? box.textContent : '';
            })()`,
            (v) => typeof v === 'string' && v.indexOf('state=') !== -1,
            25000,
        );
        check(
            '...and ?beatdebug=1 draws one, reporting the context it found',
            typeof readout.value === 'string' && readout.value.indexOf('state=') !== -1,
            `${asked}, ${JSON.stringify(String(readout.value).split('\\n')[0].slice(0, 110))}`,
        );

        /* --- and a slow public library cannot land on top of the Drive list --
         *
         * The race the Drive stage's "the public library did not land on top of
         * it" check catches only sometimes, made certain instead of hoped for.
         *
         * A *restored* Drive session asks for the public library first:
         * `librarySource` starts as `cloud`, and it is the effect that reads the
         * saved token which switches it to `drive`. So two loads are in flight
         * at once, and without a sequence in `loadTracks` whichever answers last
         * is the list on screen — and the one written to the list cache, which
         * is the half that outlives the tab.
         *
         * Here the public library's answer is held for four seconds, so it is
         * still in flight when the Drive list lands. Four seconds is longer than
         * the Drive stub takes and well under the list's own timeout, so the
         * late answer really does arrive; the check is that it is dropped.
         *
         * Last, and on purpose: it reloads the page, which stops the music the
         * mark stage above reads its motion from.
         */
        cloudDelayMs = 4000;
        await send('Page.navigate', { url: target.url });
        await sleep(2500);
        const driveAgain = await waitFor(rowTitles, (v) => Array.isArray(v) && v.length === 2, 30000);
        check(
            'a restored Drive session lists the Drive files again',
            Array.isArray(driveAgain.value) && driveAgain.value.length === 2,
            `${driveAgain.value.length} rows in ${(driveAgain.ms / 1000).toFixed(1)}s`,
        );
        // Past the hold: the public library has answered and had its chance.
        await sleep(3500);
        const late = await evaluate(rowTitles);
        check(
            '...and a late public library cannot land on top of it',
            Array.isArray(late) && late.length === 2,
            `${late.length} rows after the public library answered`,
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
