#!/usr/bin/env node
/**
 * Checks that the two documents still describe the app that exists.
 *
 * `README.md` and `AGENTS.md` are read by people who then act on them, so a
 * stale line is worse than a missing one. Both have already gone wrong in the
 * same direction twice: they kept describing the service worker's offline shell
 * after it was removed, and AGENTS.md kept insisting the caches are permanent
 * ("不要再引入自动清理或「已过期」状态") for two commits *after* the 30-day
 * TTL shipped — which is the kind of note that gets a working feature deleted.
 *
 * The first half is mechanical: every check script that exists must be
 * registered in AGENTS.md and run by CI, and every script CI names must exist.
 * A new check that nobody runs is a check that does not exist.
 *
 * Run: node scripts/check-docs.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const readme = read('README.md');
const agents = read('AGENTS.md');
const workflow = read('.github/workflows/deploy.yml');
const cacheJs = read('components/Music/audioCache.js');

const results = [];
const check = function (name, condition, detail) {
    results.push({ name, pass: Boolean(condition), detail });
};

/* --- 1. every check script is registered and run ------------------------- */

/**
 * The text of one `## ` section, up to the next one. Asserting against the whole
 * document is too weak here: a script's name also appears in prose elsewhere, so
 * deleting its row from the table would leave the check green. (That is exactly
 * what the first version of this did.)
 */
const sectionOf = function (doc, heading) {
    const start = doc.indexOf(`\n${heading}\n`);
    if (start === -1) return '';
    const rest = doc.slice(start + 1);
    const end = rest.indexOf('\n## ', heading.length);
    return end === -1 ? rest : rest.slice(0, end);
};

const scriptSection = sectionOf(agents, '## 检查脚本');
check('AGENTS.md has a check-script section', scriptSection !== '', '## 检查脚本');

const scripts = fs.readdirSync(path.join(root, 'scripts'))
    .filter((f) => /^check-.*\.js$/.test(f))
    .map((f) => f.replace(/\.js$/, ''))
    .sort();

check('there is more than one check script', scripts.length > 1, `${scripts.length} found`);

scripts.forEach((name) => {
    check(`AGENTS.md's table has a row for ${name}`,
        scriptSection.includes(`| \`${name}\` |`), 'documented in the table');
    check(`CI runs ${name}`, workflow.includes(`node scripts/${name}.js`), 'wired into the workflow');
});

// The other direction: CI must not call a script that was renamed or deleted.
const called = [...workflow.matchAll(/node scripts\/(check-[A-Za-z0-9_-]+)\.js/g)].map((m) => m[1]);
[...new Set(called)].forEach((name) => {
    check(`CI's ${name} exists on disk`, scripts.includes(name), 'found');
});
check('CI runs every check script', scripts.every((n) => called.includes(n)),
    `${called.length} calls for ${scripts.length} scripts`);

/* --- 2. the docs do not describe the removed offline shell --------------- */

// The service worker was removed on purpose (`167dae8`); anything that says it
// caches the page shell, or that the site opens without a network, is wrong.
check('README does not claim the site opens offline',
    !/断网也能打开|离线也能打开|断网可以打开/.test(readme), 'no offline-opening claim');
check('README does not claim a service worker caches the shell',
    !/Service Worker 缓存页面外壳/.test(readme), 'no shell-caching claim');
check('README states that there is no service worker',
    /没有 Service Worker/.test(readme), 'stated');
check('AGENTS.md still forbids re-adding a service worker',
    /不要加回来/.test(agents), 'the ban is intentional, not an omission');

/* --- 3. the docs describe the cache that exists -------------------------- */

// The TTL lives in the code; the docs have to agree with it, in both files.
const ttlDays = (cacheJs.match(/CACHE_TTL_MS = (\d+) \* 24 \* 60 \* 60 \* 1000/) || [])[1];
check('audioCache.js defines the TTL the docs describe', Boolean(ttlDays), `${ttlDays} days`);

check('README gives the audio cache a 30-day expiry',
    /30 天过期/.test(readme) && /续期/.test(readme), '30 days + refresh');
check('README keeps the library list permanent',
    /曲库清单.*永久|永久不过期/.test(readme), 'list is forever');
check('README no longer calls the audio cache permanent',
    !/两者都不设过期时间/.test(readme), 'no blanket permanence');
check('AGENTS.md states the 30-day TTL',
    /CACHE_TTL_MS/.test(agents) && /30 天/.test(agents), 'TTL documented');
check('AGENTS.md no longer forbids a TTL',
    !/不要再引入自动清理/.test(agents), 'the stale instruction is gone');
check('AGENTS.md still explains the read-path-must-not-write rule',
    /读取路径绝对不能写/.test(agents), 'the hard-won lesson is kept');

/* --- 4. the docs do not promise controls that are not there -------------- */

// Cheap spot-checks against the components, for the copy that has drifted
// before. Each one names something a visitor would look for.
const deskJs = read('components/Music/DesktopMusic.js');
const appJs = read('components/Music/MusicApp.js');
check('README does not promise an offline-availability chip',
    !/离线可用/.test(readme), 'no 离线可用');
check('the chip it describes is the one that ships',
    /列表已缓存/.test(deskJs), '列表已缓存');
check('every entry README lists under the ⋮ menu exists in the shell',
    ['谷歌云盘链接', '缓存管理', '不喜欢歌曲', '切换外观'].every((label) => appJs.includes(label)),
    'four entries');

// Scoped to the table, for the same reason as the script table above: the words
// also appear in the feature bullets, so a document-wide test would stay green
// after the row itself was deleted.
const interactions = sectionOf(readme, '## 快捷键 / 交互');
check('README has an interaction table', interactions !== '', '## 快捷键 / 交互');
check('the table documents the row drawer',
    /置顶/.test(interactions) && /移入不喜欢/.test(interactions), 'pin + dislike');
check('the table documents the jump button',
    /回到正在播放|滚出屏幕时出现/.test(interactions), 'locate');
check('the table documents the settings drawer',
    /设置抽屉/.test(interactions), 'settings');

/* --- 5. the numbers the docs quote are the numbers in the code ----------- */

// The Worker's edge cache is the one figure a reader will act on ("why do I not
// see my new upload?"), and it lives in a different directory from the README.
const workerJs = read('cloudflare-worker/src/index.js');
const workerTtl = (workerJs.match(/CACHE_TTL_SECONDS = (\d+)/) || [])[1];
check('the worker defines the index cache TTL', Boolean(workerTtl), `${workerTtl}s`);
check('README quotes that same TTL',
    readme.includes(`清单缓存（${workerTtl} 秒）`), `${workerTtl}s`);
check('README still points at the refresh escape hatch',
    readme.includes('?refresh=1'), '?refresh=1');

/* --- report ------------------------------------------------------------- */

let failed = 0;
results.forEach((r) => {
    if (!r.pass) failed += 1;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
});
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
