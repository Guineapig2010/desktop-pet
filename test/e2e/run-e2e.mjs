// End-to-end test of the real Electron app (Linux CI: run under xvfb-run).
//   npm run test:e2e      (macOS: runs on your desktop; a window appears briefly)
// Uses BUDDY_TEST=1 hooks to inject a fake cursor and fake windows.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startMockAI } from './mock-ai.mjs';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const electronBin = require('electron');
const shots = process.env.E2E_SHOTS || path.join(os.tmpdir(), 'buddy-e2e');
fs.mkdirSync(shots, { recursive: true });
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-ud-'));
const mock = await startMockAI();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    console.log(`  ✗ ${name}\n    ${e.stack || e}`);
    await overlay?.screenshot({ path: path.join(shots, `fail-${name.replace(/\W+/g, '_')}.png`) }).catch(() => {});
    process.exitCode = 1;
    throw e;
  }
}
async function waitFor(fn, { timeout = 10000, interval = 100, what = 'condition' } = {}) {
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
  executablePath: electronBin,
  args: [ROOT, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  env: { ...process.env, BUDDY_TEST: '1', BUDDY_USER_DATA: ud, BUDDY_ANTHROPIC_BASE_URL: `http://127.0.0.1:${mock.port}` },
});
const T = (fn, arg) => app.evaluate(fn, arg);
const overlay = await app.firstWindow();
overlay.on('pageerror', (e) => console.log('    [overlay error]', e.message));
const B = (fn, arg) => overlay.evaluate(fn, arg);
const state = () => T(() => globalThis.__buddyTest.state());
const talk = () =>
  waitFor(
    async () => {
      await T(() => globalThis.__buddyTest.command('talk'));
      await sleep(400);
      return (await B(() => window.__buddy.conv.active)) || null;
    },
    { what: 'conversation to start', timeout: 20000, interval: 600 },
  );
const chase = () =>
  waitFor(
    async () => {
      await T(() => globalThis.__buddyTest.command('chase'));
      await sleep(150);
      return (await B(() => window.__buddy.pet.action?.constructor?.name === 'Chase')) || null;
    },
    { what: 'chase to start', timeout: 20000, interval: 500 },
  );
// wait for the conversation to finish, answering any follow-up question with "maybe"
const finishConversation = () =>
  waitFor(
    async () => {
      const active = await B(() => {
        const b = window.__buddy.bubble;
        if (b.pendingChoiceIds.length) b.pick(b.pendingChoiceIds.includes('maybe') ? 'maybe' : b.pendingChoiceIds.at(-1));
        return window.__buddy.conv.active;
      });
      return !active;
    },
    { what: 'conversation end', timeout: 60000, interval: 300 },
  );
const setCursor = (x, y) => T((_e, { x, y }) => globalThis.__buddyTest.setCursor({ x, y }), { x, y });

console.log('Albuquerque Buddy e2e');
try {
  await step('overlay boots, he falls and lands on the bottom of the screen', async () => {
    await overlay.waitForFunction(() => window.__buddy && window.__buddy.pet.mode === 'ground', null, { timeout: 15000 });
    const s = await waitFor(async () => { const st = await state(); return st.platform ? st : null; }, { what: 'state report' });
    const b = await T(() => globalThis.__buddyTest.overlayBounds());
    // deterministic test run: no spontaneous conversations or chases (we trigger them explicitly)
    await T(() => globalThis.__buddyTest.applySettings({ dialogueFrequency: 0, chaseFrequency: 0 }));
    assert.equal(s.platform, 'ground');
    assert.equal(s.y, b.height);
  });

  await step('overlay is transparent and click-through by default', async () => {
    const bg = await B(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.documentElement).backgroundColor]);
    assert.deepEqual(bg, ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
    // a far corner of the canvas has fully transparent pixels
    const a = await B(() => {
      const c = document.getElementById('stage');
      return c.getContext('2d').getImageData(2, 2, 1, 1).data[3];
    });
    assert.equal(a, 0);
    await setCursor(5, 5);
    await sleep(200);
    assert.equal(await T(() => globalThis.__buddyTest.overlayIgnoresMouse()), true);
  });

  await step('hovering him makes only his body clickable; moving away restores click-through', async () => {
    await B(() => window.__buddy.pet.interrupt(new window.__buddy.actions.Idle({ dur: 30 })));
    await sleep(300);
    const b = await T(() => globalThis.__buddyTest.overlayBounds());
    // follow him with the cursor (he may be startled and hop away)
    await waitFor(
      async () => {
        const h = await B(() => window.__buddy.pet.toWorld(0, -60));
        await setCursor(b.x + h[0], b.y + h[1]);
        await sleep(120);
        if (process.env.E2E_DEBUG) console.log('    hover', h, b, await T(() => globalThis.__buddyTest.overlayIgnoresMouse()), (await state()).interactive, await B(() => [window.__buddy.pet.cursor.x, window.__buddy.pet.cursor.y, window.__buddy.pet.hitTest(window.__buddy.pet.cursor.x, window.__buddy.pet.cursor.y)]));
        return (await T(() => globalThis.__buddyTest.overlayIgnoresMouse())) === false;
      },
      { what: 'interactive' },
    );
    await setCursor(b.x + 5, b.y + 5);
    await waitFor(async () => (await T(() => globalThis.__buddyTest.overlayIgnoresMouse())) === true, { what: 'click-through' });
  });

  await step('drawn character renders with animation frames', async () => {
    await overlay.screenshot({ path: path.join(shots, 'overlay-ground.png') });
    const drawn = await B(() => {
      const { pet } = window.__buddy;
      const c = document.getElementById('stage');
      const d = devicePixelRatio;
      const img = c.getContext('2d').getImageData((pet.x - 30) * d, (pet.y - pet.H * 0.6) * d, 60 * d, 40 * d).data;
      let n = 0;
      for (let i = 3; i < img.length; i += 4) if (img[i] > 200) n++;
      return n;
    });
    assert.ok(drawn > 200, `expected opaque pixels where he stands, got ${drawn}`);
  });

  const b = await T(() => globalThis.__buddyTest.overlayBounds());
  const win = { id: 101, pid: 1, owner: 'Notes', x: b.x + 400, y: b.y + 450, w: 520, h: 300 };

  await step('real-window ledges: he lands on a window top and stands on it', async () => {
    await T((_e, w) => globalThis.__buddyTest.setWindows([w]), win);
    await B(({ x }) => {
      const { pet, actions } = window.__buddy;
      pet.interrupt(new actions.Fall());
      pet.x = x;
      pet.y = 150;
      pet.vx = 0;
      pet.vy = 0;
      pet.mode = 'air';
      pet.platform = null;
    }, { x: 660 });
    await waitFor(async () => (await state()).platform === 'w101:0', { what: 'landing on window' });
    await B(() => window.__buddy.pet.interrupt(new window.__buddy.actions.Sit({ dur: 30 })));
    await sleep(600);
    await overlay.screenshot({ path: path.join(shots, 'overlay-perched.png') });
  });

  await step('window moves: he rides along with it', async () => {
    const before = await state();
    await T((_e, w) => globalThis.__buddyTest.setWindows([{ ...w, x: w.x + 60, y: w.y - 80 }]), win);
    await sleep(700);
    const after = await state();
    assert.equal(after.platform, 'w101:0');
    assert.equal(after.y, 450 - 80);
    assert.ok(Math.abs(after.x - (before.x + 60)) <= 3, `x ${before.x} -> ${after.x}`);
  });

  await step('window closes under him: he falls and lands on the ground', async () => {
    await T(() => globalThis.__buddyTest.setWindows([]));
    await waitFor(async () => (await state()).mode === 'air' || (await state()).platform === 'ground', { what: 'falling' });
    await waitFor(async () => (await state()).platform === 'ground', { what: 'landing on ground' });
  });

  await step('a window in front hides part of a ledge (only visible edges are ledges)', async () => {
    const plats = await B(() => {
      window.__buddy.world.setWindows([
        { id: 2, x: 600, y: 300, w: 300, h: 300 },
        { id: 1, x: 400, y: 400, w: 600, h: 300 },
      ]);
      const p = window.__buddy.world.platforms.map((p) => [p.id, Math.round(p.x1), Math.round(p.x2), p.y]);
      window.__buddy.world.setWindows([]);
      return p;
    });
    assert.deepEqual(plats.slice(1), [
      ['w2:0', 600, 900, 300],
      ['w1:0', 400, 600, 400],
      ['w1:1', 900, 1000, 400],
    ]);
  });

  await step('he climbs the side of a window and gets on top', async () => {
    const tall = { id: 202, pid: 1, owner: 'Safari', x: b.x + 800, y: b.y + 330, w: 420, h: b.height - 330 };
    await T((_e, w) => globalThis.__buddyTest.setWindows([w]), tall);
    await B(() => {
      const { pet, actions } = window.__buddy;
      pet.x = 600;
      pet.interrupt(new actions.Climb({ winId: 202, side: 'L' }));
    });
    await waitFor(async () => (await state()).action === 'Climb' && (await state()).mode === 'climb', { what: 'climbing', timeout: 15000 });
    await overlay.screenshot({ path: path.join(shots, 'overlay-climb.png') });
    await waitFor(async () => (await state()).platform === 'w202:0', { what: 'on top of the window', timeout: 20000 });
    await T(() => globalThis.__buddyTest.setWindows([]));
    await waitFor(async () => (await state()).platform === 'ground', { what: 'back on ground' });
  });

  await step('cursor chase: he notices, runs over and grabs a reachable cursor, then lets go', async () => {
    await B(() => window.__buddy.pet.interrupt(new window.__buddy.actions.Idle({ dur: 1 })));
    const s = await state();
    const target = { x: Math.min(b.width - 100, s.x + 350), y: b.height - 110 };
    await setCursor(b.x + target.x, b.y + target.y);
    await chase();
    await waitFor(async () => (await state()).action === 'Chase', { what: 'chase start' });
    await waitFor(async () => (await state()).holding, { what: 'cursor caught', timeout: 15000 });
    await sleep(900);
    await overlay.screenshot({ path: path.join(shots, 'overlay-grab.png') });
    await waitFor(async () => !(await state()).holding && (await state()).action !== 'Chase', { what: 'release', timeout: 15000 });
  });

  await step('cursor chase: an unreachable cursor makes him leap, miss, get frustrated and give up', async () => {
    await setCursor(b.x + 300, b.y + 10);
    await B(() => window.__buddy.pet.interrupt(new window.__buddy.actions.Idle({ dur: 1 })));
    await sleep(300);
    await chase();
    const seen = new Set();
    await waitFor(
      async () => {
        const st = await state();
        seen.add(st.anim);
        return seen.has('tantrum') && st.action !== 'Chase';
      },
      { what: 'giving up', timeout: 30000, interval: 60 },
    );
    assert.ok(seen.has('reachUp'), `expected a reaching leap, saw ${[...seen]}`);
    assert.ok(seen.has('frustrated') || seen.has('tantrum'), 'expected frustration');
  });

  await step('leap catch: he grabs a cursor in mid-air and hangs from it', async () => {
    await setCursor(b.x + 700, b.y + b.height - 260);
    await B(() => {
      const { pet, actions } = window.__buddy;
      pet.x = 700;
      pet.interrupt(new actions.Idle({ dur: 0.1 }));
    });
    await sleep(300);
    await chase();
    await waitFor(async () => (await state()).mode === 'hang', { what: 'hanging', timeout: 15000, interval: 50 });
    await sleep(500);
    await overlay.screenshot({ path: path.join(shots, 'overlay-hang.png') });
    await waitFor(async () => (await state()).platform === 'ground' && (await state()).action !== 'Chase', { what: 'drop and land', timeout: 15000 });
  });

  await step('dragging him with the mouse and throwing him', async () => {
    await setCursor(b.x + 5, b.y + 5);
    await B(() => window.__buddy.pet.interrupt(new window.__buddy.actions.Idle({ dur: 20 })));
    await sleep(400);
    const h = await B(() => window.__buddy.pet.toWorld(0, -60));
    await setCursor(b.x + h[0], b.y + h[1]);
    await waitFor(async () => (await T(() => globalThis.__buddyTest.overlayIgnoresMouse())) === false, { what: 'interactive' });
    await overlay.mouse.move(h[0], h[1]);
    await overlay.mouse.down();
    for (let i = 1; i <= 10; i++) await overlay.mouse.move(h[0] - i * 20, h[1] - i * 30);
    assert.equal(await B(() => window.__buddy.pet.mode), 'held');
    await overlay.screenshot({ path: path.join(shots, 'overlay-held.png') });
    await overlay.mouse.up();
    await waitFor(async () => (await state()).platform === 'ground', { what: 'land after throw' });
  });

  await step('resize: size setting scales him', async () => {
    const h1 = await B(() => window.__buddy.pet.H);
    await T(() => globalThis.__buddyTest.applySettings({ size: 1.6 }));
    await sleep(200);
    const h2 = await B(() => window.__buddy.pet.H);
    assert.ok(Math.abs(h2 / h1 - 1.6) < 0.01);
    await T(() => globalThis.__buddyTest.applySettings({ size: 1 }));
  });

  await step('Albuquerque conversation: pitch → answer buttons → reactions, persisted', async () => {
    await setCursor(b.x + 5, b.y + 5);
    await talk();
    await waitFor(async () => (await state()).choices?.length === 3, { what: 'pitch with choices', timeout: 20000 });
    const s = await state();
    assert.deepEqual(s.choices, ['yes', 'no', 'maybe']);
    await overlay.screenshot({ path: path.join(shots, 'overlay-pitch.png') });
    await B(() => document.querySelector('.bubble-choices button[data-id="no"]').click());
    await finishConversation();
    const refusals = await B(() => window.__buddy.story.state.refusals);
    assert.ok(refusals >= 1);
  });

  await step('escalation: repeated refusals → meltdown (angry) → calm → "So, do we have a deal?"', async () => {
    await B(() => Object.assign(window.__buddy.story.state, { refusals: 6, ignores: 0, maybes: 0, dealStatus: 'none' }));
    await talk();
    const anims = new Set();
    const s = await waitFor(
      async () => {
        const st = await state();
        anims.add(st.anim);
        return st.choices?.includes('accept') ? st : null;
      },
      { what: 'deal question', timeout: 60000, interval: 80 },
    );
    assert.equal(s.bubble, 'So, do we have a deal?');
    assert.ok(anims.has('tantrum') || anims.has('angry'), `angry animation expected, saw ${[...anims]}`);
    assert.ok(anims.has('calm'), `calm-down animation expected, saw ${[...anims]}`);
    await overlay.screenshot({ path: path.join(shots, 'overlay-deal.png') });
    await B(() => document.querySelector('.bubble-choices button[data-id="bargain"]').click());
    await waitFor(
      async () => B(() => window.__buddy.bubble.fullText !== 'So, do we have a deal?' && !!document.querySelector('.bubble-choices button[data-id="accept"]')),
      { what: 'counter-offer', timeout: 20000 },
    );
    await B(() => document.querySelector('.bubble-choices button[data-id="accept"]').click());
    await waitFor(async () => (await B(() => window.__buddy.story.state.dealStatus)) === 'accepted', { what: 'deal accepted' });
    await waitFor(async () => (await state()).anim === 'celebrate', { what: 'celebration', timeout: 5000, interval: 50 });
    await finishConversation();
  });

  await step('ignoring him: the question times out and counts as ignored', async () => {
    await B(() => Object.assign(window.__buddy.story.state, { refusals: 0, ignores: 0, maybes: 0, dealStatus: 'none', askDealNext: false }));
    await talk();
    await waitFor(async () => (await state()).choices?.length, { what: 'question', timeout: 20000 });
    await B(() => window.__buddy.bubble.pick('ignore'));
    await waitFor(async () => (await B(() => window.__buddy.story.state.ignores)) === 1, { what: 'ignore counted' });
    await finishConversation();
  });

  let chat;
  await step('chat panel opens; offline mode is clearly labelled and still answers', async () => {
    await T(() => globalThis.__buddyTest.openChat());
    chat = await waitFor(async () => app.windows().find((w) => w.url().includes('/chat/')), { what: 'chat window' });
    await chat.waitForSelector('#input');
    await chat.waitForFunction(() => document.getElementById('statusText').textContent.length > 3);
    assert.match(await chat.textContent('#statusText'), /Offline/);
    assert.equal(await chat.isVisible('#offlineBanner'), true);
    await chat.fill('#input', 'what is 12*7?');
    await chat.press('#input', 'Enter');
    await chat.waitForSelector('.msg.assistant.offline');
    const t = await chat.textContent('.msg.assistant.offline:last-child');
    assert.match(t, /84/);
    assert.match(t, /Offline/i);
    await chat.screenshot({ path: path.join(shots, 'chat-offline.png') });
  });

  await step('chat: typing an answer while he asks the deal question answers him', async () => {
    await B(() => Object.assign(window.__buddy.story.state, { askDealNext: true, dealStatus: 'none' }));
    await talk();
    await waitFor(async () => (await state()).choices?.includes('accept'), { what: 'deal question', timeout: 20000 });
    await chat.fill('#input', 'no way, never');
    await chat.press('#input', 'Enter');
    await waitFor(async () => (await B(() => window.__buddy.story.state.dealStatus)) === 'refused', { what: 'refusal via chat' });
    await finishConversation();
  });

  await step('chat with Claude (mock Anthropic API): streams the reply, sends persona + history, key stays in main', async () => {
    await T(() => globalThis.__buddyTest.applySettings({ ai: { provider: 'anthropic', anthropicModel: 'claude-opus-5-5' } }));
    const r = await chat.evaluate(() => window.buddy.setSecret('anthropic', 'sk-ant-test-key'));
    assert.ok(r.stored);
    await chat.waitForFunction(() => /Claude/.test(document.getElementById('statusText').textContent));
    await chat.fill('#input', 'What is the capital of France?');
    await chat.press('#input', 'Enter');
    await chat.waitForFunction(() => [...document.querySelectorAll('.msg.assistant')].some((m) => m.textContent.includes('Paris is the capital of France. But have you seen Albuquerque?')));
    const req = mock.requests.filter((q) => q.url.startsWith('/v1/messages')).at(-1);
    assert.equal(req.body.model, 'claude-opus-5-5');
    assert.equal(req.body.stream, true);
    assert.match(req.body.system[0].text, /Albuquerque/);
    assert.match(req.body.system[0].text, /Always genuinely answer/);
    assert.equal(req.body.messages.at(-1).role, 'user');
    assert.match(req.body.messages.at(-1).content, /capital of France/);
    assert.equal(req.body.messages[0].role, 'user');
    // the key never reaches a renderer
    const leaked = await chat.evaluate(() => JSON.stringify(window.buddy).includes('sk-ant') || document.body.innerHTML.includes('sk-ant'));
    assert.equal(leaked, false);
    await waitFor(async () => (await state()).bubble?.includes('Paris'), { what: 'reply mirrored in his bubble' });
    await chat.screenshot({ path: path.join(shots, 'chat-ai.png') });
  });

  await step('chat with a bad key shows a clear error', async () => {
    await chat.evaluate(() => window.buddy.setSecret('anthropic', 'sk-ant-wrong'));
    await chat.fill('#input', 'hello?');
    await chat.press('#input', 'Enter');
    await chat.waitForSelector('.msg.system');
    assert.match(await chat.textContent('.msg.system:last-child'), /rejected the API key/);
  });

  await step('chat with an OpenAI-compatible endpoint (mock)', async () => {
    await T((_e, port) => globalThis.__buddyTest.applySettings({ ai: { provider: 'openai', openaiBaseUrl: `http://localhost:${port}/v1`, openaiModel: 'llama3.2' } }), mock.port);
    await chat.waitForFunction(() => /llama3\.2/.test(document.getElementById('statusText').textContent));
    await chat.fill('#input', 'what is four plus four');
    await chat.press('#input', 'Enter');
    await chat.waitForFunction(() => [...document.querySelectorAll('.msg.assistant')].some((m) => m.textContent.includes('Four plus four is eight.')));
    const req = mock.requests.filter((q) => q.url.endsWith('/chat/completions')).at(-1);
    assert.equal(req.body.messages[0].role, 'system');
    assert.equal(req.body.model, 'llama3.2');
  });

  await step('chat collapse / expand / close', async () => {
    await chat.click('#collapseBtn');
    await sleep(500);
    assert.equal(await chat.evaluate(() => document.body.classList.contains('collapsed')), true);
    assert.equal(await chat.evaluate(() => window.innerHeight < 80), true);
    await chat.click('#collapseBtn');
    await sleep(500);
    assert.equal(await chat.evaluate(() => window.innerHeight > 300), true);
    await chat.click('#closeBtn');
    await waitFor(async () => !app.windows().some((w) => w.url().includes('/chat/')), { what: 'chat closed' });
  });

  await step('settings window opens and pausing stops behaviour', async () => {
    await T(() => globalThis.__buddyTest.openSettings());
    const sw = await waitFor(async () => app.windows().find((w) => w.url().includes('/settings/')), { what: 'settings window' });
    await sw.waitForSelector('#paused');
    await sw.check('#paused');
    await sleep(300);
    assert.equal(await B(() => window.__buddy.settings.paused), true);
    await sw.screenshot({ path: path.join(shots, 'settings.png'), fullPage: true });
    await sw.uncheck('#paused');
  });

  await step('Quit from the settings window exits the app', async () => {
    const sw = app.windows().find((w) => w.url().includes('/settings/'));
    const exited = new Promise((r) => app.process().once('exit', (code) => r(code)));
    await sw.click('#quitBtn');
    const code = await Promise.race([exited, sleep(8000).then(() => 'timeout')]);
    assert.notEqual(code, 'timeout', 'app did not exit');
  });
} finally {
  mock.server.close();
  try {
    await app.close();
  } catch {
    /* already exited */
  }
}
console.log(`\n${passed} steps passed. Screenshots in ${shots}`);
