// A zero-dependency static file server for the exported site, so the
// "look at it in a browser" recipe has something to serve. `python3 -m http.server`
// used to do this job; the python on this machine's PATH is a half-installed 3.13
// that cannot import `encodings`, and node is already here for `drive-page.js`.
//
// Serves a directory, with the two conveniences a Next export needs:
// `dir/index.html` for a directory request (the export is `trailingSlash: true`)
// and `dir/<only>.html` when there is exactly one page in it.
//
// Usage: node scripts/serve-static.js <root> [port]

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || 8899);

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.lrc': 'text/plain; charset=utf-8',
};

const resolveFile = function (urlPath) {
    const target = path.join(root, path.normalize(urlPath));
    if (!target.startsWith(root)) return '';
    let stats;
    try {
        stats = fs.statSync(target);
    } catch {
        return '';
    }
    if (!stats.isDirectory()) return target;
    const index = path.join(target, 'index.html');
    if (fs.existsSync(index)) return index;
    const only = fs.readdirSync(target).filter((name) => name.endsWith('.html'));
    return only.length === 1 ? path.join(target, only[0]) : '';
};

http.createServer((request, response) => {
    const urlPath = decodeURIComponent((request.url || '/').split('?')[0]);
    const file = resolveFile(urlPath);
    if (!file) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('not found');
        return;
    }
    fs.readFile(file, (err, data) => {
        if (err) {
            response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            response.end('not found');
            return;
        }
        response.writeHead(200, {
            'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
            'cache-control': 'no-store',
        });
        response.end(data);
    });
}).listen(port, '127.0.0.1', () => {
    process.stdout.write(`serving ${root} on http://127.0.0.1:${port}\n`);
});
