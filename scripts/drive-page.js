#!/usr/bin/env node
/**
 * Opens a page in a real Chrome, clicks through it, and reports what happened.
 *
 * The other scripts in here render markup so it can be *looked at*. This one
 * exists for the questions a screenshot cannot answer and a build cannot
 * either: does the page survive a click, does anything throw, does the thing
 * that is supposed to appear actually appear. `/3d` shipped once with a bug
 * that killed the whole page the moment a track was clicked — every screenshot
 * of it looked fine, because the failure only happened after the click.
 *
 * It talks the DevTools protocol directly, with no dependencies: Node 22 has a
 * global `WebSocket`, and that is the only thing a CDP client needs. Nothing
 * here downloads a browser or an automation stack.
 *
 * Run: node scripts/drive-page.js <url> [--insecure] [--track=夜曲] [--out=dir/name]
 *
 *   --insecure  adds `--disable-web-security` to a throwaway profile, so a
 *               locally served build can read the library worker — whose CORS
 *               allows only `https://ianyspace.github.io`. Without it a local
 *               run sees an empty list, `current` stays `null`, and every
 *               branch that depends on a playing track short-circuits. That is
 *               exactly how the bug above stayed invisible.
 *   --track=X   clicks the row containing X instead of the first row. Worth
 *               using: only some songs have lyrics, and only a song with
 *               lyrics exercises the lyric plane.
 *
 * Exits non-zero if anything was logged as an exception, so it can be used as
 * a check rather than only as a report.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const CHROME = process.env.CHROME_PATH
    || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith('--'));
const flag = (name) => argv.some((a) => a === `--${name}`);
const option = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};

if (!url) {
    process.stderr.write('usage: node scripts/drive-page.js <url> [--insecure] [--track=X] [--out=name]\n');
    process.exit(2);
}

const insecure = flag('insecure');
const track = option('track', '');
const out = option('out', '');
const port = Number(option('port', '9333'));

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'drive-page-'))}`,
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1440,810',
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
    url,
], { stdio: 'ignore' });

const findTarget = async () => {
    for (let i = 0; i < 60; i += 1) {
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
const transcript = [];

const report = (text) => {
    transcript.push(text);
    process.stdout.write(`${text}\n`);
};

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
        problems.push(`exception: ${text}`);
        report(`  [EXCEPTION] ${text}`);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        const text = msg.params.args
            .map((a) => (a.value !== undefined ? a.value : (a.description || a.type)))
            .join(' ');
        problems.push(`console.error: ${text}`);
        report(`  [console.error] ${text}`);
    }
    if (msg.method === 'Network.responseReceived') {
        const { status, url: at } = msg.params.response;
        // A missing cover or lyric sidecar is expected — the library's
        // convention is a same-named file that may simply not be there — so
        // these are printed to be read, not counted as failures.
        if (status >= 400) report(`  [http ${status}] ${at.slice(0, 140)}`);
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

const shot = async (name) => {
    if (!out) return;
    const file = `${out}-${name}.png`;
    mkdirSync(dirname(file), { recursive: true });
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(data, 'base64'));
};

/** What the page looks like from outside: no module internals are reachable. */
const PROBE = `(() => {
    const rows = [...document.querySelectorAll('aside ul li button')];
    const head = [...document.querySelectorAll('header button')];
    const bar = document.querySelector('footer');
    const canvas = document.querySelector('canvas');
    const note = document.querySelector('aside p');
    return {
        title: document.title,
        rows: rows.length,
        activeRow: rows.findIndex((b) => b.getAttribute('aria-current') === 'true'),
        bar: bar ? bar.innerText.replace(/\\n+/g, ' | ') : null,
        lyricsOn: head[0] ? head[0].getAttribute('aria-pressed') : null,
        canvas: canvas ? canvas.width + 'x' + canvas.height : null,
        note: note ? note.innerText : null,
    };
})()`;

const step = async (name, waitMs) => {
    report(`\n-- ${name} --`);
    report(JSON.stringify(await evaluate(PROBE), null, 1));
    await shot(name);
    if (waitMs) await sleep(waitMs);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');

report(`== ${url}${insecure ? '  (web security off)' : ''}`);

// The library is fetched after hydration; 9s covers a cold load plus a slow
// worker. Shorter waits read as "no tracks" rather than as "not yet".
await sleep(9000);
await step('loaded');

const target = track
    ? `rows.find((b) => b.innerText.includes(${JSON.stringify(track)}))`
    : 'rows[0]';
report('\n-- click a track --');
report(String(await evaluate(
    `(() => {
        const rows = [...document.querySelectorAll('aside ul li button')];
        const row = ${target};
        if (!row) return 'no row matched';
        row.click();
        return 'clicked: ' + row.innerText.replace(/\\n+/g, ' / ');
    })()`,
)));
await sleep(14000);
await step('playing');

report('\n-- keyboard: space to pause, ArrowRight to seek --');
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))`);
await sleep(1500);
await step('paused');

await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
await sleep(1500);
await step('seeked');

report('\n-- the lyrics button, twice --');
await evaluate(`document.querySelectorAll('header button')[0].click()`);
await sleep(4000);
await step('lyrics-a');

await evaluate(`document.querySelectorAll('header button')[0].click()`);
await sleep(4000);
await step('lyrics-b');

report('\n-- the list panel, and Escape --');
await evaluate(`document.querySelectorAll('header button')[1].click()`);
await sleep(1000);
await step('list-closed');

await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(1000);
await step('escape');

report(`\n== ${problems.length} problem(s) ==`);
problems.forEach((p) => report(`  ${p}`));

chrome.kill();
process.exit(problems.length > 0 ? 1 : 0);
