// Renders assets/icon.png, assets/avatar.png and the tray icons from the drawn character.
// Usage: node scripts/render-icons.mjs   (needs Playwright's Chromium; see README)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const srv = http.createServer((q, r) => {
  const p = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p)) return r.writeHead(404), r.end();
  r.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(r);
}).listen(0);
const b = await chromium.launch();
async function shot(query, size, out) {
  const pg = await b.newPage({ viewport: { width: size, height: size } });
  await pg.goto(`http://localhost:${srv.address().port}/scripts/icon.html?${query}&size=${size}`);
  await pg.waitForFunction(() => document.title === 'done');
  await (await pg.$('canvas')).screenshot({ path: out, omitBackground: true });
  await pg.close();
}
await shot('mode=icon', 1024, path.join(root, 'assets/icon.png'));
await shot('mode=avatar', 128, path.join(root, 'assets/avatar.png'));
await b.close();
srv.close();
console.log('rendered icon.png and avatar.png');
