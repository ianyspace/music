// Look at the four lyric styles, on the real built page, at phone size,
// cropped to the words.
//
// The smoke test proves each style *is* the thing it claims to be — the
// animation name, the count of visible lines, the fill advancing. None of that
// says whether it looks right, which is the only question a still frame can
// answer. So this drives the same four taps a visitor makes and grabs the lyric
// box after each one.
//
// The drawer is closed before every shot, and that is not tidiness: the sheet's
// scrim is `position: fixed; inset: 0` at 50% black, so a screenshot taken with
// it open is a picture of the words through smoked glass.
//
// Usage: node scripts/probe-lyric-styles.js [--track=夜曲] [--prefix=fx]
//   (start the static server first:
//    node scripts/serve-static.js /d/tmp/serve 8899)

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const trackArg = process.argv.find((a) => a.startsWith('--track='));
const track = trackArg ? trackArg.split('=')[1] : '夜曲';
const prefixArg = process.argv.find((a) => a.startsWith('--prefix='));
const prefix = prefixArg ? prefixArg.split('=')[1] : 'lyricstyle';
const origin = 'http://127.0.0.1:8899/music';
const port = 9433;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const profile = mkdtempSync(join(tmpdir(), 'lyricstyle-'));
const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--window-size=390,844',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-web-security',
    '--autoplay-policy=no-user-gesture-required',
    `${origin}/h5/`,
], { stdio: 'ignore' });

let wsTarget = '';
for (let i = 0; i < 80 && !wsTarget; i += 1) {
    try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find((t) => t.type === 'page' && t.url.startsWith('http'));
        if (page && page.webSocketDebuggerUrl) wsTarget = page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    if (!wsTarget) await sleep(250);
}
if (!wsTarget) {
    process.stderr.write('no CDP target appeared\n');
    chrome.kill();
    process.exit(1);
}

const socket = new WebSocket(wsTarget);
await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', reject);
});
let nextId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
});
const send = (method, params) => new Promise((resolve) => {
    nextId += 1;
    pending.set(nextId, resolve);
    socket.send(JSON.stringify({ id: nextId, method, params: params || {} }));
});

const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception
            ? result.exceptionDetails.exception.description
            : result.exceptionDetails.text);
    }
    return result.result.value;
};

const shoot = async (name, clip) => {
    const shot = await send('Page.captureScreenshot', {
        format: 'png',
        ...(clip ? { clip: { ...clip, scale: 2 } } : {}),
    });
    const file = `${prefix}-${name}.png`;
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    process.stdout.write(`  wrote ${file}\n`);
};

await sleep(4000);

// Rows arrive over the network; wait for them rather than for a number of
// seconds. The click is repeated because it is easy to land before React has
// hydrated, which looks exactly like "nothing happened".
const clickRow = `(function () {
    const rows = Array.from(document.querySelectorAll('[role="button"][aria-label^="播放 "]'));
    if (!rows.length) return 'no rows';
    const row = rows.find((r) => (r.getAttribute('aria-label') || '').includes(${JSON.stringify(track)})) || rows[0];
    row.click();
    return row.getAttribute('aria-label');
})()`;

let clicked = '';
for (let i = 0; i < 40; i += 1) {
    clicked = await evaluate(clickRow);
    if (!/no rows/.test(String(clicked))) break;
    await sleep(1500);
}
process.stdout.write(`row: ${clicked}\n`);
await sleep(3000);
for (let i = 0; i < 12; i += 1) {
    const there = await evaluate(`!!document.querySelector('[aria-label="打开播放页"]')`);
    if (there) break;
    await evaluate(clickRow);
    await sleep(2000);
}

const click = (selector) => evaluate(
    `(document.querySelector(${JSON.stringify(selector)}) || { click() {} }).click()`,
);

await click('[aria-label="打开播放页"]');
await sleep(1200);
const disc = await evaluate(`(() => {
    const b = document.querySelector('button[aria-label="查看歌词"]');
    return { found: Boolean(b), disabled: b ? b.disabled : false };
})()`);
if (!disc.found || disc.disabled) {
    process.stderr.write(`this track has no lyrics (${JSON.stringify(disc)})\n`);
    chrome.kill();
    process.exit(2);
}
await click('button[aria-label="查看歌词"]');
await sleep(900);

const GROUP = '[role="radiogroup"][aria-labelledby="np-lyric-style"]';
const BOX = '[aria-label="歌词，点击返回唱片"]';

const choose = async (title) => {
    await click('button[aria-label="播放设置"]');
    await sleep(500);
    await evaluate(`(() => {
        const rows = Array.from(document.querySelectorAll(${JSON.stringify(GROUP)} + ' [role="radio"]'));
        const row = rows.find((r) => (r.innerText || '').trim().indexOf(${JSON.stringify(title)}) === 0);
        if (row) row.click();
    })()`);
    await sleep(400);
    // Escape closes the drawer (the page handles it before the player itself),
    // and the scrim only unmounts when its fade ends.
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(700);
};

const clipOf = async () => {
    const rect = await evaluate(`(() => {
        const box = document.querySelector(${JSON.stringify(BOX)});
        if (!box) return null;
        const r = box.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    })()`);
    return rect;
};

const activeText = () => evaluate(
    `(() => {
        const a = document.querySelector(${JSON.stringify(BOX)} + ' [class*="lyric-active"]');
        return a ? (a.innerText || '').trim() : '';
    })()`,
);

// 普通 — the baseline the other style is a departure from.
await choose('普通');
await shoot('plain', await clipOf());

// 沉浸单行 — twice, because the whole point of it is an animation, and one
// frame of a 0.42s animation is indistinguishable from a still line that
// happens to be bigger. So the first shot has to be taken *at* a line change:
// poll for the active line's text and shoot the moment it moves. Wait for the
// animation to finish and there is nothing left to see.
// (`.workbuddy-ai/probe-grow.mjs` is the other half of this: it pins
// `currentTime` so the curve can be read frame by frame.)
await choose('沉浸单行');
{
    const before = await activeText();
    let changed = false;
    for (let i = 0; i < 400 && !changed; i += 1) {
        await sleep(60);
        if ((await activeText()) !== before) changed = true;
    }
    await shoot('solo-grow', await clipOf());
    process.stdout.write(`  solo grow: caught ${changed ? 'at a line change' : 'nothing — no line changed in 24s'}\n`);
}
await sleep(1200);
await shoot('solo', await clipOf());

// And a full-page frame of the drawer itself, so the group's own layout is on
// the record rather than only described.
await click('button[aria-label="播放设置"]');
await sleep(600);
await shoot('drawer', null);

chrome.kill();
