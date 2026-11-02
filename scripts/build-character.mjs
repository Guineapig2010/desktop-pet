// Turn a full-body photo into the built-in animated photo character.
//
//   node scripts/build-character.mjs <photo> [--cutout <already-transparent.png>] [--joints joints.json]
//
// 1. Background removal: uses `rembg` (Python) if no --cutout is given.
// 2. Joint placement: automatic guess, optionally overridden by a JSON file of joint
//    positions given as fractions of the cropped image.
// 3. Writes assets/character/photo/{rig.json, *.png} plus debug sheets in assets/character/debug/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
let cutout = opt('--cutout');
const jointsFile = opt('--joints');
const optsFile = opt('--opts');
const outDir = opt('--out') || path.join(root, 'assets/character/photo');
const debugDir = path.join(path.dirname(outDir), 'debug');
const photo = args[0];
if (!photo && !cutout) {
  console.error('usage: node scripts/build-character.mjs <photo> [--cutout cut.png] [--joints joints.json] [--opts opts.json]');
  process.exit(1);
}
if (!cutout) {
  cutout = path.join(path.dirname(outDir), 'cutout.png');
  const py = process.env.REMBG_PYTHON || 'python3';
  console.log('removing background with rembg…');
  execFileSync(py, ['-I', '-c', `
import sys
from rembg import remove, new_session
from PIL import Image
img = Image.open(sys.argv[1]).convert('RGB')
out = remove(img, session=new_session(sys.argv[3]), alpha_matting=True, alpha_matting_foreground_threshold=240, alpha_matting_background_threshold=15)
out.save(sys.argv[2])
`, photo, cutout, process.env.REMBG_MODEL || 'isnet-general-use'], { stdio: 'inherit' });
}
const joints = jointsFile ? JSON.parse(fs.readFileSync(jointsFile, 'utf8')) : null;
const opts = optsFile ? JSON.parse(fs.readFileSync(optsFile, 'utf8')) : {};

const srv = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x');
  const p = u.pathname === '/__cutout' ? path.resolve(cutout) : path.join(root, decodeURIComponent(u.pathname));
  if (!fs.existsSync(p)) return r.writeHead(404), r.end();
  r.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : 'image/png' });
  fs.createReadStream(p).pipe(r);
}).listen(0);
const b = await chromium.launch();
const pg = await b.newPage();
pg.on('pageerror', (e) => console.error('page error:', e.message));
await pg.goto(`http://localhost:${srv.address().port}/scripts/build-character.html`);
await pg.waitForFunction(() => document.title === 'ready');
const res = await pg.evaluate(([j, o]) => window.build('/__cutout', j, o), [joints, opts]).catch((e) => { console.error('build step failed'); throw e; });
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const [n, d] of Object.entries(res.parts)) fs.writeFileSync(path.join(outDir, `${n}.png`), Buffer.from(d.split(',')[1], 'base64'));
fs.writeFileSync(path.join(outDir, 'rig.json'), JSON.stringify(res.rig, null, 2));
fs.mkdirSync(debugDir, { recursive: true });
fs.writeFileSync(path.join(debugDir, 'joints.json'), JSON.stringify(res.jointFractions, null, 2));
const dbg = await pg.evaluate(() => window.debugSheets(['idle', 'walk@0.2', 'walk@0.6', 'run@0.3', 'talk@0.3', 'angry@0.3', 'celebrate@0.3', 'grab@0.6', 'rise', 'fall@0.2', 'climb@0.3', 'sit@0.5', 'held@0.3', 'hang@0.3', 'tantrum@0.3', 'wave@0.3', 'land@0.05', 'sleep@0.5']));
fs.writeFileSync(path.join(debugDir, 'labels.png'), Buffer.from(dbg.labels.split(',')[1], 'base64'));
fs.writeFileSync(path.join(debugDir, 'poses.png'), Buffer.from(dbg.sheet.split(',')[1], 'base64'));
await b.close();
srv.close();
console.log(`wrote ${Object.keys(res.parts).length} parts to ${path.relative(root, outDir)} (${res.size.join('x')}); debug sheets in ${path.relative(root, debugDir)}`);
