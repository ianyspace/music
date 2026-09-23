// Does the 卡拉OK fill actually paint two tones?
//
// The screenshot of a live wipe cannot answer that, and this is why: the value
// at any instant is wherever the song happens to be, and a line sampled at 5%
// or at 80% is *supposed* to look almost uniform — the boundary is within one
// glyph of an end. Squinting at that and guessing is how a broken gradient gets
// shipped. So this pauses the song, pins `--wipe` to four known values, and
// shoots the same line at 4× for each: 0% must be all dim, 100% all bright, and
// the two in between must show the edge in two different places.
//
// Usage: node scripts/probe-wipe.js [--track=夜曲]
//   (start the static server first:
//    node scripts/serve-static.js /d/tmp/serve 8899)

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const trackArg = process.argv.find((a) => a.startsWith('--track='));
const track = trackArg ? trackArg.split('=')[1] : '夜曲';
const origin = 'http://127.0.0.1:8899/music';
const port = 9435;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const profile = mkdtempSync(join(tmpdir(), 'wipe-'));
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

await sleep(4000);

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
    if (await evaluate(`!!document.querySelector('[aria-label="打开播放页"]')`)) break;
    await evaluate(clickRow);
    await sleep(2000);
}

const click = (selector) => evaluate(
    `(document.querySelector(${JSON.stringify(selector)}) || { click() {} }).click()`,
);

await click('[aria-label="打开播放页"]');
await sleep(1200);
await click('button[aria-label="查看歌词"]');
await sleep(900);
await click('button[aria-label="播放设置"]');
await sleep(500);
await evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('[role="radiogroup"] [role="radio"]'));
    const row = rows.find((r) => (r.innerText || '').trim().indexOf('卡拉OK') === 0);
    if (row) row.click();
})()`);
await sleep(500);
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(700);

// Into the middle of the song first, so the line under test is a real lyric
// line with lines above it. At the top of a track the active line is the LRC's
// own title line, which sits at scrollTop 0 and *cannot* be centred — and
// shooting it there samples the mask's top fade, where every fill is compressed
// towards invisible and the two tones become indistinguishable. That is a
// picture of the mask, not of the gradient.
await evaluate(`(() => {
    const audio = document.querySelector('audio');
    audio.currentTime = Math.max(40, (audio.duration || 120) * 0.4);
    return audio.currentTime;
})()`);
await sleep(2500);

await evaluate(`document.querySelector('audio').pause()`);
await sleep(600);

const BOX = '[aria-label="歌词，点击返回唱片"]';
const ACTIVE = `${BOX} [class*="lyric-active"]`;

await evaluate(`(() => {
    const box = document.querySelector(${JSON.stringify(BOX)});
    const a = box.querySelector('[class*="lyric-active"]');
    if (!box || !a) return 'missing';
    box.style.scrollBehavior = 'auto';
    box.scrollTop = a.offsetTop - (box.clientHeight - a.offsetHeight) / 2;
    return box.scrollTop;
})()`);
await sleep(600);

process.stdout.write(`active line: ${JSON.stringify(await evaluate(
    `(() => {
        const a = document.querySelector(${JSON.stringify(ACTIVE)});
        return a ? (a.innerText || '').trim() : '';
    })()`,
))}\n`);

for (const value of ['0%', '35%', '65%', '100%']) {
    const clip = await evaluate(`(() => {
        const a = document.querySelector(${JSON.stringify(ACTIVE)});
        if (!a) return null;
        a.style.setProperty('--wipe', ${JSON.stringify(value)});
        const r = a.getBoundingClientRect();
        return {
            x: Math.round(r.left) - 4,
            y: Math.round(r.top) - 4,
            width: Math.round(r.width) + 8,
            height: Math.round(r.height) + 8,
        };
    })()`);
    if (!clip) {
        process.stderr.write('no active line to shoot\n');
        break;
    }
    const painted = await evaluate(`(() => {
        const a = document.querySelector(${JSON.stringify(ACTIVE)});
        const s = getComputedStyle(a);
        return {
            wipe: s.getPropertyValue('--wipe').trim(),
            image: s.backgroundImage,
            fill: s.webkitTextFillColor || s.color,
            width: Math.round(a.getBoundingClientRect().width),
        };
    })()`);
    const shot = await send('Page.captureScreenshot', {
        format: 'png',
        clip: { ...clip, scale: 4 },
    });
    const file = `wipe-${value.replace('%', '')}.png`;
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    process.stdout.write(`  ${value.padStart(4)}  ${JSON.stringify(painted)}\n            -> ${file}\n`);
}

chrome.kill();
