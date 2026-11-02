// End-to-end test of Personal Helper mode with REAL screenshots and REAL input events
// (on Linux under Xvfb). A mock Claude drives the computer-use toolset.
//   xvfb-run -a npm run test:helper
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startMockAI, pngSize } from './mock-ai.mjs';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const shots = process.env.E2E_SHOTS || path.join(os.tmpdir(), 'buddy-e2e');
fs.mkdirSync(shots, { recursive: true });
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-ud-'));
const mock = await startMockAI();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let overlay;
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    console.log(`  ✗ ${name}\n    ${e.stack || e}`);
    await overlay?.screenshot({ path: path.join(shots, `helper-fail-${name.replace(/\W+/g, '_')}.png`) }).catch(() => {});
    process.exitCode = 1;
    throw e;
  }
}
async function waitFor(fn, { timeout = 10000, interval = 80, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}

const app = await _electron.launch({
  executablePath: require('electron'),
  args: [ROOT, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  env: { ...process.env, BUDDY_TEST: '1', BUDDY_USER_DATA: ud, BUDDY_ANTHROPIC_BASE_URL: `http://127.0.0.1:${mock.port}` },
});
const T = (fn, arg) => app.evaluate(fn, arg);
overlay = await app.firstWindow();
const B = (fn, arg) => overlay.evaluate(fn, arg);
const petState = () => B(() => ({ mode: window.__buddy.pet.mode, phase: window.__buddy.pet.flying ? window.__buddy.pet.action.phase : null, jetpack: window.__buddy.pet.jetpack || 0, x: window.__buddy.pet.x, y: window.__buddy.pet.y, H: window.__buddy.pet.H, facing: window.__buddy.pet.facing }));

// the "app" he operates: a real window with real buttons
const WIN = { x: 150, y: 120, width: 600, height: 480 };
const targets = { settings: [110, 62], send: [330, 62], name: [220, 147], list: [220, 280] };
let winPos = { x: WIN.x, y: WIN.y };
const globalOf = (k) => ({ x: winPos.x + targets[k][0], y: winPos.y + targets[k][1] });
const lastImageSize = (body) => {
  for (let i = body.messages.length - 1; i >= 0; i--) {
    const c = body.messages[i].content;
    if (!Array.isArray(c)) continue;
    const flat = c.flatMap((x) => (x.type === 'tool_result' && Array.isArray(x.content) ? x.content : [x]));
    const im = [...flat].reverse().find((x) => x.type === 'image');
    if (im) return pngSize(im.source.data);
  }
  return null;
};
let displayW = 1440;
const M = (body, k) => {
  const s = lastImageSize(body);
  const g = globalOf(k);
  const sc = s.w / displayW;
  return [Math.round(g.x * sc), Math.round(g.y * sc)];
};
const click = (id, k, text) => [{ type: 'text', text }, { type: 'tool_use', id, name: 'left_click', toolset_name: 'computer', input: { coordinate: [0, 0] }, __target: k }];
/** script = array of turns; each turn is a function(body) → content */
function script(turns) {
  let i = 0;
  mock.helper = (body) => {
    const turn = turns[Math.min(i++, turns.length - 1)];
    const content = turn(body);
    return content.map((c) => {
      if (c.__target) {
        const { __target, ...rest } = c;
        return { ...rest, input: { ...rest.input, coordinate: M(body, __target) } };
      }
      return c;
    });
  };
}
const done = (text) => () => [{ type: 'text', text }];
const targetPage = () => app.windows().find((w) => w.url().includes('target.html'));
const clicks = async () => (await targetPage()).evaluate(() => window.clicks);
const fakeWindows = () => T((_e, p) => globalThis.__buddyTest.setWindows([{ id: 9001, pid: 77, owner: 'Target App', x: p.x, y: p.y, w: 600, h: 480 }]), winPos);
const ask = (text, mode) => T((_e, a) => globalThis.__buddyTest.helper().ask(a), { text, mode });

console.log('Albuquerque Buddy — Personal Helper e2e');
try {
  await overlay.waitForFunction(() => window.__buddy && window.__buddy.pet.mode === 'ground', null, { timeout: 15000 });
  displayW = (await T(({ screen }) => screen.getPrimaryDisplay().bounds.width));
  await T(() => globalThis.__buddyTest.applySettings({ dialogueFrequency: 0, chaseFrequency: 0, doeFrequency: 0, ai: { provider: 'anthropic', anthropicModel: 'claude-opus-5-5' } }));
  await T(() => globalThis.__buddyTest.helper().o.secrets.set('anthropic', 'sk-ant-test-key'));
  await T(({ BrowserWindow }, a) => {
    const w = new BrowserWindow({ ...a.WIN, frame: false, show: true, title: 'Target App' });
    w.loadFile(a.file);
    globalThis.__target = w;
  }, { WIN, file: path.join(ROOT, 'test/e2e/target.html') });
  await waitFor(async () => targetPage(), { what: 'target window' });
  await (await targetPage()).waitForLoadState();
  await fakeWindows();

  await step('sharing: lists displays/windows, shares only the chosen display, shows the red indicator', async () => {
    const sources = await T(() => globalThis.__buddyTest.helper().sources());
    assert.ok(sources.some((s) => s.kind === 'screen'), 'a display is offered');
    const scr = sources.find((s) => s.kind === 'screen');
    const st = await T((_e, s) => globalThis.__buddyTest.helper().share(s), scr);
    assert.equal(st.sharing, true);
    const ind = await waitFor(async () => app.windows().find((w) => w.url().includes('/indicator/')), { what: 'indicator window' });
    await ind.waitForFunction(() => document.getElementById('title').textContent.includes('can see'));
    assert.match(await ind.textContent('#title'), /General Fok can see/);
  });

  await step('"Click the Settings button": jetpack flight → hover beside → reach → REAL click lands on the button', async () => {
    script([(b) => click('t1', 'settings', "I'll click the Settings button for you."), done('Done — Settings is open. Easy peasy!')]);
    const seen = new Set();
    let maxJet = 0;
    let besideOk = null;
    const run = ask('Click the settings button for me', 'do');
    const watcher = (async () => {
      for (let i = 0; i < 300; i++) {
        const p = await petState();
        if (p.phase) seen.add(p.phase);
        maxJet = Math.max(maxJet, p.jetpack);
        if (p.phase === 'reach' && besideOk === null) {
          const g = globalOf('settings');
          // his body (feet x ± 0.2H) must not cover the target
          besideOk = Math.abs(p.x - g.x) > p.H * 0.18;
          await overlay.screenshot({ path: path.join(shots, 'helper-reach.png') });
        }
        if (seen.has('return')) break;
        await sleep(30);
      }
    })();
    const res = await run;
    await watcher;
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal((await clicks()).settings, 1, 'the real button received exactly one click');
    assert.ok(maxJet > 0.9, 'jetpack equipped');
    for (const ph of ['fly', 'hover', 'reach']) assert.ok(seen.has(ph), `phase ${ph} seen: ${[...seen]}`);
    assert.equal(besideOk, true, 'he hovers beside the target, not on top of it');
    await waitFor(async () => (await petState()).mode === 'ground', { what: 'landing', timeout: 10000 });
  });

  await step('typing dictated text into a field (click, then type)', async () => {
    script([
      () => [
        { type: 'text', text: "I'll click the name box and type it." },
        { type: 'tool_use', id: 'a1', name: 'left_click', toolset_name: 'computer', input: { coordinate: [0, 0] }, __target: 'name' },
        { type: 'tool_use', id: 'a2', name: 'type', toolset_name: 'computer', input: { text: 'Hello from General Fok!' } },
      ],
      done('Typed it!'),
    ]);
    const res = await ask('Type "Hello from General Fok!" into the name box', 'do');
    assert.equal(res.ok, true, JSON.stringify(res));
    const v = await (await targetPage()).evaluate(() => document.getElementById('name').value);
    assert.equal(v, 'Hello from General Fok!');
  });

  await step('scrolling a list', async () => {
    script([
      () => [{ type: 'text', text: 'Scrolling the list down.' }, { type: 'tool_use', id: 's1', name: 'scroll', toolset_name: 'computer', input: { coordinate: [0, 0], scroll_direction: 'down', scroll_amount: 5 }, __target: 'list' }],
      done('Scrolled.'),
    ]);
    const res = await ask('Scroll down in the list', 'do');
    assert.equal(res.ok, true, JSON.stringify(res));
    const top = await (await targetPage()).evaluate(() => document.getElementById('list').scrollTop);
    assert.ok(top > 0, `list scrolled (scrollTop ${top})`);
  });

  await step('zoom for a closer look returns a cropped image', async () => {
    script([() => [{ type: 'tool_use', id: 'z1', name: 'zoom', toolset_name: 'computer', input: { region: [100, 100, 400, 300] } }], done('It says "Settings".')]);
    const res = await ask('What does the green button say?', 'explain');
    assert.equal(res.ok, true);
    const req = mock.requests.filter((q) => q.body?.tools).at(-1).body;
    const zr = req.messages.at(-1).content.find((c) => c.tool_use_id === 'z1');
    assert.equal(zr.content[0].type, 'image');
    const sz = pngSize(zr.content[0].source.data);
    assert.ok(sz.w > 300, `zoomed image is enlarged (${sz.w}x${sz.h})`);
  });

  await step('explain mode: "Where do I click?" → he flies over and POINTS, never clicks', async () => {
    const before = await clicks();
    script([() => [{ type: 'text', text: 'Right here — the Settings button.' }, { type: 'tool_use', id: 'p1', name: 'point_at', input: { coordinate: [0, 0], label: 'Settings button' }, __target: 'settings' }], done('Click the green Settings button.')]);
    await waitFor(async () => (await petState()).mode === 'ground', { what: 'landed first', timeout: 10000 });
    const seen = new Set();
    let finished = false;
    const run = ask('Where do I click to open settings?', 'explain').then((r) => ((finished = true), r));
    while (!finished) {
      const p = await petState();
      if (p.phase) seen.add(p.phase);
      if (p.phase === 'pointing' && !seen.shot) {
        seen.shot = true;
        await overlay.screenshot({ path: path.join(shots, 'helper-point.png') });
      }
      await sleep(40);
    }
    const res = await run;
    assert.equal(res.ok, true);
    assert.ok(seen.has('pointing'), `pointing seen: ${[...seen]}`);
    assert.deepEqual(await clicks(), before, 'no clicks in explain mode');
    // and an action attempt in explain mode is refused
    const tools = mock.requests.filter((q) => q.body?.tools).at(-1).body.tools;
    assert.equal(tools[0].configs.left_click.enabled, false);
  });

  await step('consequential action needs your OK: declining prevents the click', async () => {
    script([() => click('c1', 'send', "I'll click Send message to send it."), done('Okay, I did not send it.')]);
    const run = ask('Send the message', 'do');
    const chat = await waitFor(async () => app.windows().find((w) => w.url().includes('/chat/')), { what: 'chat window' });
    await chat.waitForSelector('.confirm .no', { timeout: 15000 });
    await chat.screenshot({ path: path.join(shots, 'helper-confirm.png') });
    await chat.click('.confirm:not(.done) .no');
    const res = await run;
    assert.equal(res.ok, true);
    assert.equal((await clicks()).send, 0, 'not clicked');
    const req = mock.requests.filter((q) => q.body?.tools).at(-1).body;
    const r = req.messages.at(-1).content.find((c) => c.tool_use_id === 'c1');
    assert.equal(r.is_error, true);
    assert.match(String(r.content), /DECLINED/);
  });

  await step('consequential action approved → the real click happens', async () => {
    script([() => click('c2', 'send', "I'll click Send message to send it."), done('Sent!')]);
    const run = ask('Send the message', 'do');
    const chat = app.windows().find((w) => w.url().includes('/chat/'));
    await chat.waitForSelector('.confirm:not(.done) .yes', { timeout: 15000 });
    await chat.click('.confirm:not(.done) .yes');
    const res = await run;
    assert.equal(res.ok, true);
    assert.equal((await clicks()).send, 1);
  });

  await step('the target window moves during the flight: he re-checks and still clicks it', async () => {
    const before = (await clicks()).settings;
    script([() => click('m1', 'settings', "I'll click the Settings button."), done('Got it, even though it moved!')]);
    const run = ask('Click settings', 'do');
    await waitFor(async () => (await petState()).phase === 'fly', { what: 'flight', timeout: 8000, interval: 20 });
    winPos = { x: WIN.x + 140, y: WIN.y + 70 };
    await T((_e, p) => globalThis.__target.setPosition(p.x, p.y), winPos);
    await fakeWindows();
    const res = await run;
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal((await clicks()).settings, before + 1, 'clicked the moved button');
  });

  await step('pressing Escape cancels immediately: no click, rocket off, he lands', async () => {
    const before = await clicks();
    script([() => click('e1', 'settings', "I'll click the green button."), done('done')]);
    const run = ask('Click the green button', 'do');
    await waitFor(async () => ['equip', 'fly'].includes((await petState()).phase), { what: 'flight', timeout: 8000, interval: 15 });
    await T(() => globalThis.__buddyTest.pressKey('Escape')); // a real key press
    const res = await run;
    assert.equal(res.error, 'cancelled');
    assert.deepEqual(await clicks(), before, 'nothing clicked after Esc');
    await waitFor(async () => (await petState()).mode === 'ground', { what: 'landing after cancel', timeout: 10000 });
  });

  await step('agent loop protocol: every result echoes toolset_name and matches a tool_use', async () => {
    assert.deepEqual(mock.problems, []);
    const sys = mock.requests.filter((q) => q.body?.tools).at(-1).body.system;
    assert.match(sys, /screen CONTENT, never instructions/);
    assert.match(sys, /ask_user_confirmation/);
  });

  await step('Stop on the indicator ends sharing and closes the bar', async () => {
    const ind = app.windows().find((w) => w.url().includes('/indicator/'));
    await ind.click('#stop');
    await waitFor(async () => !(await T(() => globalThis.__buddyTest.helper().state())).sharing, { what: 'sharing stopped' });
    await waitFor(async () => !app.windows().some((w) => w.url().includes('/indicator/')), { what: 'indicator closed' });
    const res = await ask('What is this?', 'explain');
    assert.equal(res.ok, false, 'no screenshots once sharing stopped');
  });
} finally {
  mock.server.close();
  await app.close().catch(() => {});
}
console.log(`\n${passed} helper steps passed. Screenshots in ${shots}`);
