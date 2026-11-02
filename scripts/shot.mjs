// Render scripts/preview.html with the preinstalled Chromium and save a PNG.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.css': 'text/css' };
const srv = http.createServer((q, r) => {
  const p = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(r);
}).listen(0);
const port = srv.address().port;
const [, , query = '', out = 'preview.png'] = process.argv;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
pg.on('console', (m) => console.log('[page]', m.text()));
pg.on('pageerror', (e) => console.log('[pageerror]', e.message));
await pg.goto(`http://localhost:${port}/scripts/preview.html?${query}`);
await pg.waitForFunction(() => document.title === 'done', null, { timeout: 10000 });
const el = await pg.$('canvas');
await el.screenshot({ path: out, omitBackground: query.includes('bg=none') });
await b.close(); srv.close();
console.log('saved', out);
