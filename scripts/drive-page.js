#!/usr/bin/env node
/**
 * Opens a page in a real Chrome, clicks through it, and says whether it worked.
 *
 * The other scripts in here render markup so it can be *looked at*. This one
 * exists for the questions a screenshot cannot answer and a build cannot
 * either: does the page survive a click, does a track actually start playing,
 * does anything throw. A page once shipped with a bug that killed the whole page
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
 *   9. **The song line's join is even, and it scrolls only when it has to.** The
 *      first is because "title - artist" is the one label whose spacing comes
 *      from its own whitespace, and the Marquee's wrapper used to be a flex
 *      container — which blockified each child run and dropped the collapsible
 *      space at the start of a line, so the gap in front of the hyphen vanished
 *      while the one behind it stayed. Two pixels of asymmetry are invisible in
 *      a screenshot and obvious on a phone, so this measures the ink-to-ink gap
 *      on each side of the hyphen with a Range per glyph. The second is the same
 *      Range trick on the same element, and it forces the slot to two widths
 *      either side of the label: the overflow decision used to count the item's
 *      own padding, which is the gap between the two copies at the wrap point,
 *      so a label with 20px to spare scrolled and one overflowing by under 40px
 *      was clipped without a scroll or a fade. Pages with no such label say so
 *      instead of passing.
 *  10. **The two lyric styles are two different things.** Not two skins: 普通
 *      scales the active line and keeps its neighbours, 沉浸单行 hides all but
 *      three lines and grows the line being sung up from its neighbours' size.
 *      Each is read by the mechanism that makes it that style — the animation
 *      name and a count of computed opacities — rather than by a screenshot,
 *      which cannot tell either from a line that happens to be big and bright.
 *      Three more claims come with them: the grow turns *off* under
 *      `prefers-reduced-motion` (emulated, because the override has to beat a
 *      two-class selector and that is the kind of thing that silently does not
 *      apply), the arrow keys move the choice *and* the focus (a roving
 *      `tabIndex` takes the other rows off the Tab order, so a handler that
 *      does not work leaves them unreachable), and the choice is still the
 *      choice after a reload. A fourth is about the styles that are *gone*:
 *      storage may still hold `rise` or `wipe` from a visitor who picked one
 *      before the drawer lost them, and the restore has to land on 普通 rather
 *      than on a name with no CSS behind it. See `the phone's lyric styles`.
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
        name: 'desktop',
        path: '/desktop/',
        // The rows carry `title`; the row menu beside each one carries
        // `aria-label`, so excluding `aria-label` leaves exactly the rows.
        rows: 'ul li button:not([aria-label])',
        // No `aria-label` on this one; the "on" label is 「隐藏歌词」 on the
        // immersive play bar.
        lyrics: {
            selector: 'button[title="显示歌词"], button[title="隐藏歌词"]',
            cycle: true,
        },
        // The playlist panel's fold button (in the panel's header) and the
        // handle that summons the folded panel back. `aria-expanded` here is
        // the panel's visibility, not the visitor's choice — playing folds the
        // panel five seconds in, so a cycle assertion would be reading the
        // auto-fold, not the button.
        list: {
            selector: 'button[aria-label="收起歌单"], button[aria-label="展开歌单"]',
            cycle: false,
        },
        // Escape only — it closes the settings popover, which must not stop
        // the music.
        keys: [{ key: 'Escape', paused: false }],
        // No `pin`: the row drawer retired with the old workspace — the
        // immersive page's rows have exactly one action, playing them.
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
        // The two lyric styles. The phone is the only tree that draws them, so
        // the stage lives here rather than in a shared one. See `the phone's
        // lyric styles` below for what each of the two has to be.
        lyricStyles: {
            player: '[aria-label="打开播放页"]',
            disc: 'button[aria-label="查看歌词"]',
            more: 'button[aria-label="播放设置"]',
            group: '[role="radiogroup"][aria-labelledby="np-lyric-style"]',
            box: '[aria-label="歌词，点击返回唱片"]',
            collapse: 'button[aria-label="收起"]',
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
    // `--base` is named here even though it has a default, because that default
    // is the deployed site: `--all` with no `--base` tests production, and a
    // local run that forgets it silently reports on code that has not been
    // pushed yet. Cost a whole round of debugging a fix that was never deployed.
    process.stderr.write(
        'usage: node scripts/drive-page.js <url>|--all [--insecure] [--base=ORIGIN] [--track=X] [--size=WxH] [--out=name]\n',
    );
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
     * The one reading that means the same thing in both layouts: the
     * single `<audio>` that `core/PlayerAudio` renders. Reading the transport
     * button instead would mean two different selectors and two different
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
     * The fixed wait is what made this file lie once: one page pulled a heavy
     * library before it rendered anything, and on a cold live load that is slower
     * than the others, so 9s expired with the list still empty
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
     * it — `aria-pressed` on the lyric buttons, `aria-expanded` on the desktop
     * list button — so this needs no per-page
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

    /**
     * The lyric styles, driven through the drawer and read off the DOM.
     *
     * The drawer is left open for the measurements. Nothing here reads a pixel:
     * every claim is about computed style, or about a rule in the stylesheet, and
     * a bottom sheet lying over the words changes neither — so the stage never
     * has to pay the drawer's open/close animation, once per style.
     *
     * The grow of 沉浸单行 is checked in two pieces, because neither alone is the
     * claim. `animation-name` on the active line says the animation is *applied*;
     * the `@keyframes` rule, read out of the CSSOM, says what it *does* — that it
     * starts smaller than it ends. Sampling the live transform instead would try
     * to prove both at once and prove neither reliably: it only moves for 0.42s
     * after a line change, and a read that lands after it has finished sees the
     * resting value — which is what a stylesheet with no animation at all would
     * produce too.
     */
    const exerciseLyricStyles = async (spec) => {
        const click = (selector) => evaluate(
            `(document.querySelector(${JSON.stringify(selector)}) || { click() {} }).click()`,
        );

        const rowAt = (title) => `(() => {
            const rows = Array.from(document.querySelectorAll(
                ${JSON.stringify(spec.group)} + ' [role="radio"]',
            ));
            const row = rows.find((r) => (r.innerText || '').trim().indexOf(${JSON.stringify(title)}) === 0);
            return { count: rows.length, found: Boolean(row), checked: row ? row.getAttribute('aria-checked') : null };
        })()`;

        const read = `(() => {
            const box = document.querySelector(${JSON.stringify(spec.box)});
            if (!box) return { error: 'no lyrics box on the page' };
            const lines = Array.from(box.querySelectorAll('p'));
            const active = box.querySelector('[class*="lyric-active"]');
            if (!active) return { error: 'no active line', lines: lines.length };
            const style = getComputedStyle(active);
            return {
                lines: lines.length,
                visible: lines.filter((p) => Number(getComputedStyle(p).opacity) > 0.01).length,
                fontSize: style.fontSize,
                animation: style.animationName,
                transform: style.transform,
                text: (active.innerText || '').trim(),
            };
        })()`;

        // The grow's shape, straight out of the stylesheet: every keyframe of any
        // rule whose name contains `lyric-grow`, wherever it is nested. Read
        // rather than assumed, so a stylesheet that animates the line from big to
        // small — or from nothing to nothing — fails instead of passing on the
        // strength of an `animation-name`.
        const growFrames = `(() => {
            const frames = [];
            const walk = (rules) => Array.from(rules).forEach((rule) => {
                if (rule.name && rule.name.indexOf('lyric-grow') >= 0 && rule.cssRules) {
                    Array.from(rule.cssRules).forEach((frame) => {
                        frames.push({ key: frame.keyText, transform: frame.style.transform });
                    });
                    return;
                }
                if (rule.cssRules) walk(rule.cssRules);
            });
            Array.from(document.styleSheets).forEach((sheet) => {
                try {
                    walk(sheet.cssRules);
                } catch (error) {
                    /* a cross-origin sheet has no cssRules; none of ours is */
                }
            });
            return frames;
        })()`;

        // The player sheet, the lyrics, then the drawer — the three taps a
        // visitor makes to get here.
        await click(spec.player);
        await sleep(700);
        const disc = await evaluate(
            `(() => {
                const button = document.querySelector(${JSON.stringify(spec.disc)});
                return { found: Boolean(button), disabled: button ? button.disabled : false };
            })()`,
        );
        if (!disc.found || disc.disabled) {
            // A track with no lyrics has no lyrics to style. Nothing to assert,
            // and not a failure — the same call `exerciseToggle` makes.
            note('this track has no lyrics — the lyric styles were not exercised');
            await click(spec.collapse);
            return;
        }
        await click(spec.disc);
        await sleep(600);
        await click(spec.more);
        await sleep(500);

        const group = await evaluate(
            `document.querySelectorAll(${JSON.stringify(spec.group)} + ' [role="radio"]').length`,
        );
        check('the drawer offers two lyric styles', group === 2, `${group} rows in the radiogroup`);
        const chosen = await evaluate(
            `Array.from(document.querySelectorAll(${JSON.stringify(spec.group)} + ' [role="radio"]'))
                .filter((r) => r.getAttribute('aria-checked') === 'true').length`,
        );
        check('exactly one of them is the current choice', chosen === 1, `${chosen} rows report checked`);
        await shot('lyric-styles');

        const choose = async (title) => {
            const row = await evaluate(rowAt(title));
            if (!row.found) {
                check(`the ${title} row is there`, false, `${row.count} rows in the group`);
                return false;
            }
            // Clicked by the label the visitor reads, not by index: the rows are
            // in a fixed order, and a reorder that silently moved the check onto
            // a different style is exactly the kind of thing this file is for.
            await evaluate(`(() => {
                const rows = Array.from(document.querySelectorAll(
                    ${JSON.stringify(spec.group)} + ' [role="radio"]',
                ));
                const row = rows.find((r) => (r.innerText || '').trim().indexOf(${JSON.stringify(title)}) === 0);
                if (row) row.click();
            })()`);
            // Wait for the *choice* to land rather than for a fixed number of
            // milliseconds, and then wait again for the fade it starts. Both
            // halves were learned the hard way: `aria-checked` flips in the same
            // commit that puts the style's class on the element, but the far
            // lines of 沉浸单行 then fade out over the stylesheet's 0.35s
            // transition — and `getComputedStyle` during a transition reports the
            // value being passed *through*, so a read taken too early sees every
            // line still visible and reports the style as never applied.
            await waitFor(rowAt(title), (v) => v.found && v.checked === 'true', 4000);
            await sleep(500);
            return true;
        };

        if (!(await choose('普通'))) return;
        const plain = await evaluate(read);
        if (plain.error) {
            check('the lyrics are on screen to style', false, plain.error);
            return;
        }
        check(
            '普通 draws every line and leaves the active one alone',
            plain.animation === 'none' && plain.visible === plain.lines,
            `animation=${plain.animation} ${plain.visible}/${plain.lines} lines visible, ${plain.fontSize}`,
        );

        await choose('沉浸单行');
        const solo = await evaluate(read);
        if (solo.error) {
            check('沉浸单行 has lyrics to hide', false, solo.error);
        } else if (solo.lines <= 3) {
            note(`this track has only ${solo.lines} lyric lines — 沉浸单行 needs four to mean anything`);
        } else {
            // Two or three rather than exactly three: the window is the active
            // line plus one either side, and at the top of a song there is no
            // line before it. The claim that matters is the one the stylesheet
            // makes — that the rest are gone.
            check(
                '沉浸单行 shows the active line and one either side',
                solo.visible >= 2 && solo.visible <= 3 && solo.visible < solo.lines,
                `${solo.visible} of ${solo.lines} lines visible`,
            );
        }

        // The grow, in the two pieces the docstring describes. First that it is
        // applied to the line being sung at all...
        check(
            '沉浸单行 grows the line being sung',
            !solo.error && solo.animation.indexOf('lyric-grow') >= 0,
            solo.error || `animation-name=${solo.animation}, ${solo.fontSize}`,
        );

        // ...and then that what it applies is a *growth*: `from` smaller than
        // `to`, with `to` landing on the line's own size. A stylesheet that
        // shrank the line instead — or that animated only the opacity — passes
        // the check above and fails this one.
        const frames = await evaluate(growFrames);
        const scaleOf = (value) => {
            const hit = /scale\(([\d.]+)\)/.exec(value || '');
            return hit ? Number(hit[1]) : null;
        };
        const from = frames.find((frame) => frame.key === 'from' || frame.key === '0%');
        const to = frames.find((frame) => frame.key === 'to' || frame.key === '100%');
        const fromScale = from ? scaleOf(from.transform) : null;
        const toScale = to ? scaleOf(to.transform) : null;
        check(
            '...and it grows up to its own size rather than down from it',
            fromScale !== null && toScale !== null && fromScale < toScale && toScale === 1,
            `${frames.length} keyframes, from scale(${fromScale}) to scale(${toScale})`,
        );
        await shot('lyric-solo');

        // ...and off again for a visitor who asked for less motion. Worth its own
        // check rather than a line of stylesheet read by eye: the rule that
        // switches the animation on is `.lyrics-solo .lyric-active` — two
        // classes — so an override written as a bare `.lyric-active` loses to it
        // however late in the file it appears, and the media query then does
        // nothing at all while looking perfectly correct.
        await send('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
        });
        await sleep(300);
        const reduced = await evaluate(read);
        await send('Emulation.setEmulatedMedia', { features: [] });
        await sleep(300);
        check(
            '沉浸单行 stops animating when the visitor asked for less motion',
            !reduced.error && reduced.animation === 'none',
            reduced.error || `animation-name=${reduced.animation}`,
        );

        /* --- the arrows, which the roving tabIndex obliges -------------------
         *
         * `role="radio"` is a promise that the arrow keys move the choice, and
         * the roving `tabIndex` is what takes the other row off the Tab order —
         * so without the handler the group is two rows a keyboard cannot get
         * past the first of. The handler lives on the group, so the event is
         * dispatched from the focused row and has to bubble: that is part of
         * what this checks.
         *
         * Read in two steps, with a wait between, because the dispatch and the
         * re-render are not the same turn: a synchronous read straight after the
         * event sees the old DOM and reports the arrow as inert even though the
         * handler ran. Focus is read as well as the selection, because those are
         * two separate statements — a handler that changed the style without
         * moving focus would pass a check on `aria-checked` alone and still
         * leave the next press arriving on the wrong row.
         *
         * Run from the first row on purpose: `ArrowDown` on the last one wraps
         * to the first, which is correct for a radiogroup but reads as "nothing
         * moved" if the expectation is `+1`.
         */
        await choose('普通');
        const arrowFrom = await evaluate(`(() => {
            const rows = Array.from(document.querySelectorAll(
                ${JSON.stringify(spec.group)} + ' [role="radio"]',
            ));
            const at = rows.findIndex((r) => r.getAttribute('aria-checked') === 'true');
            if (at < 0) return -1;
            rows[at].focus();
            rows[at].dispatchEvent(new KeyboardEvent('keydown', {
                key: 'ArrowDown', bubbles: true, cancelable: true,
            }));
            return at;
        })()`);
        await sleep(600);
        const arrowed = await evaluate(`(() => {
            const rows = Array.from(document.querySelectorAll(
                ${JSON.stringify(spec.group)} + ' [role="radio"]',
            ));
            return {
                to: rows.findIndex((r) => r.getAttribute('aria-checked') === 'true'),
                focused: rows.indexOf(document.activeElement),
                titles: rows.map((r) => (r.innerText || '').trim().split('\\n')[0]),
            };
        })()`);
        check(
            'the arrow keys move the lyric style',
            arrowFrom === 0 && arrowed.to === 1,
            `${arrowed.titles[arrowFrom]} -> ${arrowed.titles[arrowed.to]}`,
        );
        check(
            '...and focus goes with it',
            arrowed.focused === arrowed.to,
            `focus is on row ${arrowed.focused}, the choice is row ${arrowed.to}`,
        );

        // Left on a non-default style, on purpose: the reload below is what
        // proves the choice was *stored*, and it needs something to look for
        // that a fresh page would not arrive at by itself.
        await choose('沉浸单行');
        await click(spec.collapse);
        await sleep(600);

        /* --- and it is still there after a reload ---------------------------
         *
         * The half of a preference that is easy to get wrong is the way back:
         * `storageSet` with no matching read is a setting that looks saved and
         * reverts on the next visit, and nothing on screen says so. So the page
         * is reloaded and the drawer reopened, and the check is on the row that
         * reports itself checked — not on the localStorage value, which would
         * pass for a write nobody reads.
         */
        const stored = await evaluate(`localStorage.getItem('music:setting:lyricStyle')`);
        await send('Page.reload', {});
        await sleep(3000);
        const back = await waitFor(rowCount, (n) => n > 0, 30000);
        check('the list comes back after the lyric style reload', back.value > 0, `${back.value} rows`);

        // The mini bar only exists once something has been played, and a reload
        // is a fresh page — so a row has to be clicked again before the player
        // can be opened.
        await evaluate(`(() => {
            const row = document.querySelector(${JSON.stringify(target.rows)});
            if (row) row.click();
        })()`);
        await sleep(4000);
        await click(spec.player);
        await sleep(1000);
        await click(spec.more);
        await sleep(600);
        const restored = await evaluate(`(() => {
            const rows = Array.from(document.querySelectorAll(
                ${JSON.stringify(spec.group)} + ' [role="radio"]',
            ));
            const checked = rows.filter((r) => r.getAttribute('aria-checked') === 'true');
            return {
                count: rows.length,
                titles: checked.map((r) => (r.innerText || '').trim().split('\\n')[0]),
            };
        })()`);
        check(
            'the lyric style survived a reload',
            restored.titles.length === 1 && restored.titles[0] === '沉浸单行',
            `stored=${JSON.stringify(stored)}, checked=${JSON.stringify(restored.titles)} of ${restored.count} rows`,
        );

        /* --- and a style that no longer exists lands on 普通 ------------------
         *
         * Storage outlives the drawer. A visitor who picked 逐行上浮 or 卡拉OK 扫光
         * before those two were removed is still carrying that name, and the
         * membership check in the restore is the only thing between them and a
         * page whose lyric style has no CSS behind it. Seeded rather than
         * clicked, because a deleted style cannot be reached through the UI —
         * that is what deleting it means.
         *
         * The value is written and the page reloaded, so what is read back is
         * the restore and not the write: an assertion on the localStorage value
         * would pass for a name nobody reads.
         */
        await evaluate(`localStorage.setItem('music:setting:lyricStyle', 'wipe')`);
        await send('Page.reload', {});
        await sleep(3000);
        await waitFor(rowCount, (n) => n > 0, 30000);
        await evaluate(`(() => {
            const row = document.querySelector(${JSON.stringify(target.rows)});
            if (row) row.click();
        })()`);
        await sleep(4000);
        await click(spec.player);
        await sleep(1000);
        await click(spec.more);
        await sleep(600);
        const migrated = await evaluate(`(() => {
            const rows = Array.from(document.querySelectorAll(
                ${JSON.stringify(spec.group)} + ' [role="radio"]',
            ));
            const checked = rows.filter((r) => r.getAttribute('aria-checked') === 'true');
            return {
                count: rows.length,
                titles: checked.map((r) => (r.innerText || '').trim().split('\\n')[0]),
            };
        })()`);
        check(
            'a lyric style that no longer exists falls back to 普通',
            migrated.titles.length === 1 && migrated.titles[0] === '普通',
            `stored="wipe", checked=${JSON.stringify(migrated.titles)} of ${migrated.count} rows`,
        );
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    // Before the first tap: the beat's context is created on the first play.

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

    /* --- the song line's join ----------------------------------------------
     *
     * The label is `title` plus a span holding " - artist", and that separator
     * is the only spacing in the app that comes from the markup's own
     * whitespace rather than from a gap. Which is why it went wrong: the
     * Marquee's inner wrapper was `inline-flex`, a flex container blockifies
     * each child run, and CSS drops a collapsible space at the start of a line
     * — so the space in front of the hyphen was thrown away and the label read
     * "歌名- 歌手" with all the air on one side. Nothing about that shows up in
     * a screenshot at 14px, so it is measured instead: one Range per glyph, and
     * the ink-to-ink gap either side of the hyphen. Whitespace is skipped on
     * the way — a collapsed space still has a Range box, a zero-width one, and
     * counting it reports the gap as 0 whatever the rendering does.
     */
    const labelJoin = await evaluate(`(() => {
        const label = document.querySelector(
            '[class*="mini-label"],[class*="bar-label"],[class*="np-marquee"]',
        );
        if (!label) return { found: false };
        const item = label.querySelector('[class*="Marquee_item__"]');
        if (!item) return { found: true, error: 'no Marquee item inside the label' };
        const nodes = [];
        const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) nodes.push(walker.currentNode);
        const ink = [];
        nodes.forEach((node) => {
            for (let i = 0; i < node.data.length; i += 1) {
                if (node.data[i].trim() === '') continue;
                const range = document.createRange();
                range.setStart(node, i);
                range.setEnd(node, i + 1);
                const r = range.getBoundingClientRect();
                ink.push({ ch: node.data[i], left: r.left, right: r.right });
            }
        });
        const at = ink.findIndex((c) => c.ch === '-');
        if (at < 1 || at + 1 >= ink.length) {
            return { found: true, error: 'no hyphen with a glyph on each side' };
        }
        return {
            found: true,
            text: item.innerText,
            before: +(ink[at].left - ink[at - 1].right).toFixed(2),
            after: +(ink[at + 1].left - ink[at].right).toFixed(2),
        };
    })()`);
    if (!labelJoin || !labelJoin.found) {
        note('no title/artist label on this page — the join was not measured');
    } else if (labelJoin.error) {
        check('the song line has a hyphen to measure', false, labelJoin.error);
    } else {
        check(
            'the song line joins its two halves with an even gap',
            Math.abs(labelJoin.before - labelJoin.after) < 0.6,
            `${labelJoin.before}px before the hyphen, ${labelJoin.after}px after — ${JSON.stringify(labelJoin.text)}`,
        );
    }

    /* --- and the label only scrolls when it really does not fit -------------
     *
     * The Marquee used to decide with `inner.offsetWidth`, which includes the
     * item's own padding — the gap between the two copies at the wrap point. So
     * the test was `ink + 40 > slot`, and both halves of that were on screen: a
     * label with 20px to spare scrolled anyway (童年收（cover：F.Be.I音乐团队）,
     * 281.7px of ink in a 302px slot), and, from the other side, a label that
     * overflowed by under 40px was treated as fitting — clipped at the edge with
     * no scroll and no fade, which is the worse one because nothing on screen
     * says there is more text.
     *
     * The reading is the label's own ink, from a Range over the item's contents:
     * the same technique as the join above, and the only way to get at the
     * glyphs when the box around them carries padding. Note that the box's
     * `scrollWidth` is not an answer here — while the marquee runs there are two
     * copies of the label in it, so it always looks like a large overflow.
     *
     * The two decisions only differ in a band one gap wide just under the slot,
     * and which label the visitor happens to be on decides whether an honest
     * reading lands in it. So the slot is *forced* into that band instead — and
     * forced to either side of it, because the two readings catch different
     * halves: 10px narrower than the ink is a label that overflows by less than
     * the gap, which the right answer can only give if the component re-measured
     * after the slot changed (that is what covers the ResizeObserver — take it
     * out and the decision stays where the old width left it); 10px wider is the
     * one band where the old test and the right one disagree.
     *
     * The narrow side is asked *first*, and that order is the whole reason the
     * pair proves anything. `false` is also what a component that never measures
     * at all reports, so asking "does it stop scrolling once it fits" before
     * anything has made it scroll is a reading that can come out right for the
     * wrong reason — it is only a real answer if the component has already been
     * made to scroll and then un-made. Narrow first, and each reading starts
     * from the opposite answer, so neither can be reached without a real
     * re-measure.
     *
     * Forced rather than found by playing a different song, because a song change
     * brings a different label with it and the width would no longer be about the
     * text on screen.
     */
    const marqueeFit = await evaluate(`(() => {
        const label = document.querySelector(
            '[class*="mini-label"],[class*="bar-label"],[class*="np-marquee"]',
        );
        if (!label) return { found: false };
        const item = label.querySelector('[class*="Marquee_item__"]');
        if (!item) return { found: true, error: 'no Marquee item inside the label' };
        const range = document.createRange();
        range.selectNodeContents(item);
        const ink = +range.getBoundingClientRect().width.toFixed(1);
        const gap = parseFloat(getComputedStyle(item).paddingRight) || 0;
        if (!(gap > 0)) return { found: true, error: 'no wrap gap to force the slot against' };
        return { found: true, ink, gap };
    })()`);
    if (!marqueeFit || !marqueeFit.found) {
        note('no title/artist label on this page — the marquee fit was not measured');
    } else if (marqueeFit.error) {
        check('the marquee label has an item to measure', false, marqueeFit.error);
    } else {
        const readSlot = `(() => {
            const label = document.querySelector(
                '[class*="mini-label"],[class*="bar-label"],[class*="np-marquee"]',
            );
            if (!label) return { error: 'the label went away' };
            const item = label.querySelector('[class*="Marquee_item__"]');
            const range = document.createRange();
            range.selectNodeContents(item);
            return {
                ink: +range.getBoundingClientRect().width.toFixed(1),
                slot: label.clientWidth,
                scrolling: /text-marquee/.test(label.className),
            };
        })()`;

        // `expect` is the answer the component should settle on for this width,
        // and this waits for the answer rather than sleeping a fixed 400ms and
        // hoping the page got there. The width change reaches the component
        // through a ResizeObserver, whose callback rides on a rendering
        // opportunity, and a fixed sleep is a bet that the page got one in time.
        // Same rule as the transition checks elsewhere in this file — never
        // gamble on render timing with a sleep. The `seen` trace makes a
        // timeout diagnosable: `[false]` means it never moved, `[true,false]`
        // means it moved and was put back, and those are different bugs.
        const forceSlot = async (width, expect) => {
            await evaluate(`(() => {
                const label = document.querySelector(
                    '[class*="mini-label"],[class*="bar-label"],[class*="np-marquee"]',
                );
                if (!label) return;
                // flex: none comes with the width, because the slot is a flex
                // item with flex: 1 — a fixed basis of zero — and a flex item's
                // width is ignored while the basis is not auto.
                label.style.flex = 'none';
                label.style.width = ${JSON.stringify(`${width}px`)};
            })()`);
            const waited = await waitFor(
                readSlot,
                (reading) => reading && !reading.error && reading.scrolling === expect,
                4000,
            );
            return {
                ...waited.value,
                timedOut: waited.timedOut,
                trace: trace(waited),
            };
        };

        const tight = Math.ceil(marqueeFit.ink) - 10;
        const cramped = await forceSlot(tight, true);
        const tightHeld = !cramped.error && Math.abs(cramped.slot - tight) <= 2;
        check(
            'the song line scrolls once the label no longer fits',
            tightHeld && cramped.scrolling === true,
            cramped.error || `${cramped.ink}px of text in a ${cramped.slot}px slot, forced to ${tight}px `
                + `— scrolling=${cramped.scrolling}`
                + `${cramped.timedOut ? ` after 4s of asking (saw ${cramped.trace})` : ''}`
                + `${tightHeld ? '' : ' — the slot did not take the forced width, so this proves nothing'}`,
        );

        const roomy = Math.ceil(marqueeFit.ink) + 10;
        const fits = await forceSlot(roomy, false);
        const roomyHeld = !fits.error && Math.abs(fits.slot - roomy) <= 2;
        check(
            '...and stops scrolling once it fits again',
            roomyHeld && fits.scrolling === false,
            fits.error || `${fits.ink}px of text in a ${fits.slot}px slot, wrap gap ${marqueeFit.gap}px `
                + `— scrolling=${fits.scrolling}`
                + `${fits.timedOut ? ` after 4s of asking (saw ${fits.trace})` : ''}`
                + `${roomyHeld ? '' : ' — the slot did not take the forced width, so this proves nothing'}`,
        );

        await evaluate(`(() => {
            const label = document.querySelector(
                '[class*="mini-label"],[class*="bar-label"],[class*="np-marquee"]',
            );
            if (!label) return;
            label.style.flex = '';
            label.style.width = '';
        })()`);
        // The inline width is gone synchronously, but what the component decides
        // about the wider slot arrives through the same observer — and the stages
        // after this one read the same bar, so wait for the width to come back
        // rather than sleeping.
        await waitFor(readSlot, (reading) => reading && !reading.error && reading.slot !== roomy, 2000);
    }

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

    // Last of the phone's player-page stages, and after the two checks above on
    // purpose: the persistence half of it reloads the page, which stops the
    // music they read.
    if (target.lyricStyles) await exerciseLyricStyles(target.lyricStyles);

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

        /* The state dot on the mark's corner, read from the *mark* rather than
           from the sheet: it is the list's own answer to "is my number in?",
           which is the whole reason it exists. It is checked twice — grey here,
           green once the number is confirmed below — because a dot that is
           always one colour would pass either half on its own.
           "Grey" and "green" are read as colour *families* (the channels agree
           vs. green dominates) rather than as the two hex values, so a shade
           tweak does not fail the run, and swapping the two states does.
           The last two facts are about it being a badge: round, small next to
           the mark, and sitting on the corner rather than floating inside it.
           Whether that badge is *clipped* by the button's rounded corner is the
           one thing the DOM cannot be asked — the rect is the same either way,
           because clipping does not move a box. That was settled by eye at 6×:
           with the button clipping, the corner's arc cuts a visible bite out of
           the dot; that is why the artwork has a clipping layer of its own and
           the button does not clip. */
        const dotState = `(() => {
            const b = document.querySelector(${JSON.stringify(target.mark)});
            if (!b) return { found: false, why: 'no mark' };
            const dot = [...b.children].find((el) => /MarkNote_dot/.test(el.className || ''));
            if (!dot) return { found: false, why: 'no dot', children: b.children.length };
            const r = dot.getBoundingClientRect();
            const m = b.getBoundingClientRect();
            const rgb = getComputedStyle(dot).backgroundColor.match(/\\d+/g).map(Number);
            return {
                found: true,
                on: /MarkNote_dot-on/.test(dot.className),
                rgb,
                round: Math.abs(r.width - r.height) < 0.6,
                small: r.width <= m.width / 3,
                onCorner: r.right >= m.right - 3 && r.bottom >= m.bottom - 3,
                size: r.width,
                mark: m.width,
            };
        })()`;
        const dotOff = await evaluate(dotState);
        const grey = Boolean(dotOff) && dotOff.found
            && Math.max(...dotOff.rgb) - Math.min(...dotOff.rgb) <= 12;
        check(
            'the mark shows the QQ state as a small grey dot on its corner',
            Boolean(dotOff) && dotOff.found && !dotOff.on && grey
                && dotOff.round && dotOff.small && dotOff.onCorner,
            dotOff && dotOff.found
                ? `${dotOff.size}px of ${dotOff.mark}px, rgb(${dotOff.rgb.join(',')})`
                    + `, round=${dotOff.round} small=${dotOff.small} corner=${dotOff.onCorner}`
                : `${dotOff && dotOff.why} (children=${dotOff && dotOff.children})`,
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
        const dotOn = await evaluate(dotState);
        const green = Boolean(dotOn) && dotOn.found
            && dotOn.rgb[1] > dotOn.rgb[0] + 20 && dotOn.rgb[1] > dotOn.rgb[2] + 20;
        check(
            '...and that dot turns green now that the number is in',
            Boolean(dotOn) && dotOn.found && dotOn.on && green,
            dotOn && dotOn.found
                ? `rgb(${dotOn.rgb.join(',')}) on=${dotOn.on}`
                : `${dotOn && dotOn.why}`,
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

        /* --- and the mark moves only in its fixed playing state -------------
         *
         * The mark is a drawing now: the rainbow is a canvas-drawn backdrop
         * (the bitmap `mark-bg.jpg` is gone), and the note is the same traced
         * path on top. There is deliberately no audio analyser here anymore:
         * playback only toggles the mark's fixed CSS animation class. Three
         * things can still go wrong and all three pass a screenshot — the note
         * can be drawn wrong, the backdrop can be missing or replaced by an
         * image, and the playing class can fail to start the fixed drift. So
         * geometry is measured against the icon trace, the backdrop is checked
         * for a `<canvas>`, and the class / computed animation name are read
         * while the Drive tone above is playing.
         *
         * The box is `getBBox`, which is the path's own geometry. The numbers
         * are the published icon's: x 147..395, y 109..395 of its 512 square.
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
            const canvas = b.querySelector('canvas');
            const pane = [...b.children].find((el) => /MarkNote_pane/.test(el.className || ''));
            let box = null;
            if (path) {
                const r = path.getBBox();
                box = { x: r.x, y: r.y, w: r.width, h: r.height };
            }
            /* The glass. The computed mask comes back as a quoted data URI, so
               it is decoded back to markup and the outline inside it compared
               with the note's own d attribute — that comparison is the point:
               the glass is supposed to be the *same* shape as the note, and a
               second copy of the outline anywhere would be free to drift away
               from it. The spacing is normalised first, because the path is
               written across several lines. */
            const paneStyle = pane ? getComputedStyle(pane) : null;
            const blur = paneStyle ? (paneStyle.backdropFilter || paneStyle.webkitBackdropFilter || '') : '';
            const maskCss = paneStyle ? (paneStyle.maskImage || paneStyle.webkitMaskImage || '') : '';
            const encoded = (maskCss.match(/url\\("?data:[^,]+,([^")]+)"?\\)/) || [])[1] || '';
            let maskedD = '';
            if (encoded) {
                try {
                    maskedD = (decodeURIComponent(encoded).match(/d="([^"]*)"/) || [])[1] || '';
                } catch (err) {
                    maskedD = '';
                }
            }
            const tidy = (d) => String(d || '').replace(/\\s+/g, ' ').trim();
            return {
                viewBox: svg ? svg.getAttribute('viewBox') : '',
                box,
                hasCanvas: Boolean(canvas),
                backdrop: b.style.backgroundImage || '',
                hasPane: Boolean(pane),
                blur,
                blurred: /blur\\((\\d+(?:\\.\\d+)?)px\\)/.test(blur),
                maskIsDataUri: /^url\\("?data:image\\/svg\\+xml/.test(maskCss),
                maskedD: tidy(maskedD),
                noteD: tidy(path && path.getAttribute('d')),
                fill: path ? getComputedStyle(path).fill : '',
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
            '...and its backdrop is drawn on a canvas (not a background image)',
            Boolean(markShape) && markShape.hasCanvas && !markShape.backdrop,
            !markShape
                ? '(no mark)'
                : (missing || `canvas=${markShape.hasCanvas ? 'yes' : 'no'} bg=${markShape.backdrop ? markShape.backdrop.slice(0, 40) : '(none)'}`),
        );
        /* The note is glass, and it is *two* layers: a masked pane that blurs
           the rainbow behind the note, and the note's own translucent body over
           it. The two facts are separate because either alone would pass for
           the wrong thing — a blur with an opaque note looks like nothing
           changed, and a translucent note with no blur is just see-through.

           Both are read as the browser computed them rather than as the
           stylesheet writes them, so a value that never applied fails here. */
        /* Note the single backslash: this line is *outside* the evaluated
           string, so it is a plain regex. The doubled form is only needed for
           the regexes written inside the template literal above, where a single
           backslash would be eaten by the literal itself — and getting the two
           mixed up does not throw, it just quietly matches nothing. */
        const noteAlpha = markShape && markShape.fill
            ? (markShape.fill.match(/[\d.]+/g) || []).map(Number)
            : [];
        const noteFill = noteAlpha.length === 4 ? noteAlpha[3] : 1;
        check(
            'the note is a pane of frosted glass, not a white silhouette',
            Boolean(markShape) && markShape.hasPane && markShape.blurred && noteFill < 1,
            !markShape
                ? '(no mark)'
                : (missing || `backdrop-filter=${markShape.blur || '(none)'} note fill=${markShape.fill || '(none)'}`),
        );
        check(
            "...and the glass is cut to the note's own outline, not a second copy of it",
            Boolean(markShape) && markShape.maskIsDataUri
                && markShape.maskedD.length > 0 && markShape.maskedD === markShape.noteD,
            !markShape
                ? '(no mark)'
                : (missing || `mask=${markShape.maskIsDataUri ? 'data uri' : '(none)'}`
                    + ` masked d ${markShape.maskedD ? `${markShape.maskedD.length} chars` : '(none)'}`
                    + ` vs note d ${markShape.noteD.length} chars`
                    + ` ${markShape.maskedD === markShape.noteD ? 'match' : 'DIFFER'}`),
        );

        const motionState = await evaluate(`(() => {
            const b = document.querySelector(${JSON.stringify(target.mark)});
            const canvas = b && b.querySelector('canvas');
            const path = b && b.querySelector('svg path');
            return {
                playingClass: Boolean(b && [...b.classList].some((name) => /mark-playing/.test(name))),
                animation: canvas ? getComputedStyle(canvas).animationName : '',
                noteTransform: path ? path.style.transform : '',
            };
        })()`);
        check(
            'the mark starts its fixed CSS drift while music plays',
            Boolean(motionState) && motionState.playingClass && motionState.animation !== 'none',
            motionState
                ? `class=${motionState.playingClass} animation=${motionState.animation || '(none)'}`
                : '(no mark)',
        );
        check(
            '...and the note stays static (no breathing transform)',
            Boolean(motionState) && motionState.noteTransform === '',
            motionState ? `transform=${motionState.noteTransform || '(none)'}` : '(no mark)',
        );

        /* --- and pausing holds the score where it is ------------------------
         *
         * `playing` toggles the score's *play state* now, rather than adding and
         * removing the animation. Removing an animation snaps its element back
         * to `translate(0)`, and since one cycle is exactly one wavelength that
         * snap is invisible only when it lands on the cycle boundary — which is
         * not where a listener who just pressed pause happens to be. (The app
         * already does it the right way for the spinning disc and the eq bars:
         * `.disc-paused` / `.eq-paused i` are both `animation-play-state`.)
         *
         * Two halves, both read off the canvas's computed transform: it freezes
         * where it is, and starting again carries on from there. The freeze
         * point is waited for in the first half of a cycle — `tx` between 10 and
         * 24 of the 52px a cycle travels — because near 0 a snap back would be
         * indistinguishable from holding, and near the end the resume sample
         * could wrap past the cycle and read like a restart.
         */
        const scoreState = `(() => {
            const b = document.querySelector(${JSON.stringify(target.mark)});
            const canvas = b && b.querySelector('canvas');
            if (!canvas) return { found: false };
            const cs = getComputedStyle(canvas);
            const m = new DOMMatrixReadOnly(cs.transform === 'none' ? '' : cs.transform);
            return {
                found: true,
                playState: cs.animationPlayState,
                tx: m.m41,
                playing: Boolean(b && [...b.classList].some((name) => /mark-playing/.test(name))),
            };
        })()`;
        const midCycle = await waitFor(
            scoreState,
            (v) => Boolean(v) && v.found && v.playState === 'running' && v.tx > 10 && v.tx < 24,
            8000,
        );
        const audioDo = (method) => evaluate(
            `(() => { const a = document.querySelector('audio'); if (!a) return 'no audio'; a.${method}(); return '${method}'; })()`,
        );
        const wasAt = midCycle.value && midCycle.value.found ? midCycle.value.tx : null;
        await audioDo('pause');
        await sleep(150);
        const frozen = await evaluate(scoreState);
        await sleep(300);
        const stillFrozen = await evaluate(scoreState);
        check(
            'pausing the music holds the score where it is (no snap back to the start)',
            wasAt !== null
                && Boolean(frozen) && frozen.found && frozen.playState === 'paused' && !frozen.playing
                && Boolean(stillFrozen) && stillFrozen.playState === 'paused'
                && Math.abs(stillFrozen.tx - frozen.tx) < 0.5
                && Math.abs(frozen.tx - wasAt) < 6,
            frozen && frozen.found
                ? `froze at ${frozen.tx.toFixed(1)}px (was ${wasAt === null ? '?' : wasAt.toFixed(1)}px),`
                    + ` ${stillFrozen.tx.toFixed(1)}px 300ms later, play-state=${frozen.playState}`
                : '(no mark)',
        );
        await audioDo('play');
        await sleep(300);
        const resumed = await evaluate(scoreState);
        check(
            '...and starting again carries on from there instead of restarting',
            Boolean(resumed) && resumed.found && resumed.playState === 'running'
                && resumed.playing && resumed.tx > 8,
            resumed && resumed.found
                ? `resumed at ${resumed.tx.toFixed(1)}px, play-state=${resumed.playState}`
                    + ` (a restart would read as ~0px)`
                : '(no mark)',
        );

        /* --- and playback still advances to a second song ------------------
         *
         * This check remains intentionally small. The mark no longer owns an
         * AudioContext or an analyser, so the smoke test must not manufacture
         * hidden contexts, zero analyser bins, or background resume paths just
         * to prove a visual effect. The player itself still has to advance a
         * second track on its one audio element, which is the actual playback
         * contract.
         */
        const firstSrc = await evaluate("(() => { const a = document.querySelector('audio'); return a ? a.src : ''; })()");
        const secondSong = await evaluate(`(() => {
            const rows = [...document.querySelectorAll(${JSON.stringify(target.rows)})];
            if (rows.length < 2) return 'only one row to play';
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
        await evaluate("(() => { const a = document.querySelector('audio'); if (a) a.pause(); })()");
        await sleep(500);

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

        /* --- the mark's arrival, caught across the reload above -------------
         *
         * The mark has no size animation any more. It used to enter as a bar
         * the width of the row and shrink into the square, and the check here
         * used to watch that: a wide box, then a square. What it has to prove
         * now is the opposite — that the box is the square from the first
         * paint — plus the one thing that does still arrive, the note's
         * one-second fade.
         *
         * Sampling needs its own loop: `waitFor` polls every 400ms, which is
         * no use against a state that lasts a second. The box is measured
         * against itself (width vs height), so the stylesheet's 40px is never
         * repeated back at it.
         *
         * The note's opacity doubles as "has the stylesheet landed": a mark
         * sampled before its CSS arrives is an unstyled button, and that one
         * reads as a 316x462 box with the note already at 1.
         */
        const markProbe = `(() => {
            const b = document.querySelector(${JSON.stringify(target.mark)});
            if (!b) return { found: false };
            const note = b.querySelector('svg');
            const r = b.getBoundingClientRect();
            const noteStyle = note ? getComputedStyle(note) : null;
            return {
                found: true,
                width: r.width,
                height: r.height,
                noteOpacity: noteStyle ? Number(noteStyle.opacity) : -1,
                noteAnimation: noteStyle ? noteStyle.animationName : '',
                noteDuration: noteStyle ? noteStyle.animationDuration : '',
            };
        })()`;
        // The old page stays on screen for the first samples; its mark is the
        // same square, so it is indistinguishable from the new one and simply
        // contributes to "it was never wide".
        const samples = [];
        for (let i = 0; i < 40; i += 1) {
            const sample = await evaluate(markProbe);
            if (sample && sample.found) samples.push(sample);
            await sleep(50);
        }
        // Only samples whose stylesheet has landed: the note starts its fade
        // from 0, so anything under 1 means the CSS is on.
        const styled = samples.filter((s) => s.noteOpacity < 1);
        const widest = styled.reduce((acc, s) => Math.max(acc, s.width - s.height), 0);
        check(
            'the mark is its square from the first paint (no wide entry)',
            styled.length > 0 && widest < 1,
            styled.length
                ? `${styled.length} styled sample(s), widest ${widest.toFixed(1)}px wider than tall`
                : '(the stylesheet never landed during the samples)',
        );
        const last = samples[samples.length - 1];
        check(
            '...and the note fades in over one second rather than snapping on',
            Boolean(last) && last.noteAnimation !== 'none' && last.noteDuration === '1s',
            last ? `animation=${last.noteAnimation || '(none)'} ${last.noteDuration}` : '(no mark)',
        );

        await sleep(2000);
        const settled = await evaluate(markProbe);
        check(
            '...and the note is fully on once that second is up',
            Boolean(settled) && settled.found
                && Math.abs(settled.width - settled.height) < 1
                && settled.noteOpacity === 1,
            settled && settled.found
                ? `width=${settled.width.toFixed(0)} height=${settled.height.toFixed(0)}`
                    + ` note opacity=${settled.noteOpacity}`
                : '(no mark)',
        );

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
    // phone page does not click the wide screen's selectors and call the result
    // a pass. An unknown path gets the desktop spec.
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
