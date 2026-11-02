// Overlay host: a transparent, click-through, full-screen window. Runs the game loop, draws the
// pet, routes mouse input, plays the Albuquerque conversations and mirrors chat replies.

import { World } from '../shared/world.js';
import { VectorCharacter } from '../shared/charVector.js';
import { loadPhotoCharacter } from '../shared/charPhoto.js';
import { Story, classifyReply } from '../shared/story.js';
import { LINES } from '../shared/dialogue.js';
import { LinePicker, clamp, lerp, rand, fill, sign, pick } from '../shared/util.js';
import { Pet, _test as actions } from './pet.js';
import { Effects } from './effects.js';
import { Bubble } from './bubble.js';
import { Sound } from './sound.js';
import { Robot } from './robot.js';
import { DealScenes } from '../shared/dealScenes.js';

const api = window.buddy;
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const ui = document.getElementById('ui');

const init = await api.getInit();
const settings = { ...init.settings };
const world = new World(window.innerWidth, window.innerHeight);
world.windowsEnabled = settings.useWindows !== false;
const fx = new Effects();
const sound = new Sound();
sound.set(settings.sound !== false, settings.volume ?? 0.5);
const bubble = new Bubble(ui);
const lines = new LinePicker(LINES);
const vars = () => ({ user: settings.userName || 'pal' });
const story = new Story(init.story || {}, vars());

let character = new VectorCharacter();
async function loadCharacter(info) {
  if (info && info.url && settings.character !== 'cartoon') {
    try {
      character = await loadPhotoCharacter(info.url, { headScale: settings.headScale });
      api.log(`photo character loaded from ${info.url}`);
    } catch (e) {
      api.log(`photo character failed (${e.message}); using the drawn character`);
      character = new VectorCharacter();
    }
  } else character = new VectorCharacter();
  pet?.setCharacter(character);
}

// ── speech ──────────────────────────────────────────────────────────────────
let speechPriority = 0; // 0 none, 1 reaction, 2 chat reply, 3 conversation
let speechTimer = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readTime = (text) => 1300 + text.length * 48;

async function speak(text, { priority = 1, mood = 'normal', hold = true } = {}) {
  if (priority < speechPriority) return false;
  speechPriority = priority;
  clearTimeout(speechTimer);
  pet.speaking = true;
  const ok = await bubble.say(text, { mood, onChar: (ch) => sound.babble(ch, mood) });
  pet.speaking = false;
  if (!ok) return false;
  if (hold) {
    speechTimer = setTimeout(() => {
      if (speechPriority === priority) {
        bubble.hide();
        speechPriority = 0;
      }
    }, readTime(text));
  }
  return true;
}

const host = {
  say(key) {
    if (conv.active) return;
    const text = LINES[key] ? lines.next(key, vars()) : fill(key, vars());
    if (text) speak(text, { priority: 1, mood: ['chaseMiss', 'chaseGiveUp'].includes(key) ? 'annoyed' : 'normal' });
  },
  sound(name) {
    sound.play(name);
  },
  restraint(on, x, y) {
    if (settings.cursorRestraint) api.restraint(on, x, y);
  },
  event(name, data) {
    if (name === 'pickedUp' && conv.active) conv.abort();
    if (name === 'helperHovering' || name === 'helperTouch') api.helperEvent(name, data);
    if (name === 'ambient' && !conv.active && speechPriority === 0) {
      if (Math.random() < 0.3) speak(deals.musing(vars()), { priority: 1 });
      else host.say(story.state.dealStatus === 'accepted' && Math.random() < 0.5 ? 'planning' : 'ambient');
    }
    if (name === 'pickedUp' && robot.present && !conv.active) robot.lookAt(pet.x);
  },
};

const pet = new Pet({ world, character, settings, fx, host });
const robot = new Robot({ world, settings, fx, sound });
const doeBubble = new Bubble(ui, 'robot');
const deals = new DealScenes();
await loadCharacter(init.character);
if (init.petState) {
  pet.x = clamp(init.petState.x ?? pet.x, 50, world.width - 50);
}

// ── Albuquerque conversations ───────────────────────────────────────────────
const conv = {
  active: false,
  aborted: false,
  nextAt: performance.now() / 1000 + rand(25, 55),
  abort() {
    this.aborted = true;
    bubble.pick('aborted');
    bubble.hide();
    doeBubble.hide();
    speechPriority = 0;
  },
  schedule() {
    const f = clamp(settings.dialogueFrequency ?? 0.5, 0, 1);
    this.nextAt = f <= 0 ? Infinity : performance.now() / 1000 + lerp(900, 70, f) * rand(0.7, 1.3);
  },
};

function mirrorToChat(role, text) {
  api.chatAppend({ role, text, source: 'scripted' });
}

async function playBeat(beat) {
  pet.convAnim = beat.anim || 'talk';
  pet.convHop = !!beat.hop;
  if (beat.effect === 'confetti') {
    const h = pet.headWorld();
    fx.confetti(h[0], h[1] - pet.H * 0.3, pet.H / 150);
    sound.play('celebrate');
  }
  if (beat.mood === 'furious') sound.play('grumble');
  if (beat.flop) sound.play('thud');
  for (const text of beat.lines) {
    if (conv.aborted) return 'aborted';
    mirrorToChat('assistant', text);
    await speak(text, { priority: 3, mood: beat.mood || 'normal', hold: false });
    if (conv.aborted) return 'aborted';
    if (beat.choices && text === beat.lines[beat.lines.length - 1]) break;
    await sleep(readTime(text) * (beat.auto ? 0.8 : 1));
  }
  pet.convHop = false;
  if (conv.aborted) return 'aborted';
  if (beat.choices) {
    conv.answeredViaChat = false;
    const id = await bubble.ask(beat.choices, beat.timeout);
    if (id !== 'aborted' && id !== 'ignore' && !conv.answeredViaChat) {
      const label = beat.choices.find((c) => c.id === id)?.label;
      if (label) mirrorToChat('user', label);
    }
    return id;
  }
  return beat.auto ? 'continue' : null;
}

async function runConversation() {
  if (conv.active || settings.paused) return false;
  if (!pet.beginConverse()) return false;
  conv.active = true;
  conv.aborted = false;
  story.vars = vars();
  api.log('conversation start');
  try {
    let beat = story.start();
    while (beat && !conv.aborted) {
      const ans = await playBeat(beat);
      api.saveStory(story.state);
      if (ans === 'aborted' || conv.aborted) break;
      if (beat.end || (!beat.choices && !beat.auto)) break;
      beat = story.respond(ans);
      if (ans === 'ignore' && beat) pet.convAnim = beat.anim;
    }
    api.saveStory(story.state);
    if (!conv.aborted) await sleep(2200);
  } finally {
    story.phase = null;
    bubble.hide();
    speechPriority = 0;
    pet.endConverse();
    conv.active = false;
    conv.schedule();
    api.log('conversation end');
  }
  return true;
}

// ── Personal Helper: the main process drives flights; we animate and report touches ──
const helper = { active: false };
const HELPER_QUIPS = ['Hold my watch chain!', 'Jetpack: engaged!', 'Fok Airlines, now departing!', 'Stand back, professional at work.', 'Wheee— I mean, very professional.'];

// ── Doe the robot: visits and deal scenes ──────────────────────────────────
const doe = {
  nextAt: performance.now() / 1000 + rand(90, 200),
  schedule() {
    const f = clamp(settings.doeFrequency ?? 0.5, 0, 1);
    this.nextAt = f <= 0 ? Infinity : performance.now() / 1000 + lerp(1500, 120, f) * rand(0.7, 1.3);
  },
};
const waitUntil = async (fn, ms) => {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (fn()) return true;
    await sleep(80);
  }
  return false;
};
const DOE_POKES = ['DO NOT TOUCH THE MERCHANDISE.', 'BEEP. THAT TICKLES. I DO NOT LIKE IT.', 'PERSONAL SPACE: 30 CENTIMETRES.', 'HELLO, HUMAN. THE GENERAL IS A SCOUNDREL.', 'BOOP.'];

async function doeSay(text, face, anim) {
  bubble.hide();
  speechPriority = 0;
  pet.speaking = false;
  pet.convAnim = 'idle';
  if (anim) robot.setAnim(anim);
  if (face) robot.face = face;
  robot.speaking = true;
  await doeBubble.say(text, { mood: 'robot', speed: 34, onChar: (ch) => sound.babble(ch, 'robot') });
  robot.speaking = false;
}

async function doHandshake() {
  bubble.hide();
  doeBubble.hide();
  robot.lookAt(pet.x);
  pet.facing = sign(robot.x - pet.x) || pet.facing;
  robot.setAnim('shake');
  pet.convAnim = 'handshake';
  sound.play('grab');
  const t0 = performance.now();
  while (performance.now() - t0 < 1500 && !conv.aborted) {
    const h = robot.handWorld();
    pet.convCtx = { target: pet.toLocal(h[0], h[1]) };
    await sleep(30);
  }
  const h = robot.handWorld();
  fx.sparkle(h[0], h[1], pet.H / 150, 10);
  pet.convCtx = null;
}

async function playDealSteps(steps) {
  for (const st of steps) {
    if (conv.aborted || !robot.present || robot.mode === 'held') return 'aborted';
    if (st.handshake) {
      await doHandshake();
      continue;
    }
    if (st.who === 'doe') {
      mirrorToChat('assistant', `🤖 Doe: ${st.text}`);
      await doeSay(st.text, st.face, st.anim);
      if (conv.aborted) return 'aborted';
      await sleep(readTime(st.text) * 0.8);
      continue;
    }
    // General Fok
    doeBubble.hide();
    robot.setAnim('idle');
    if (robot.face !== 'angry' && robot.face !== 'dollar') robot.face = 'normal';
    pet.facing = sign(robot.x - pet.x) || pet.facing;
    pet.convAnim = st.anim || 'talk';
    pet.convHop = st.anim === 'tantrum' || (st.anim === 'celebrate' && Math.random() < 0.5);
    if (st.effect === 'confetti') {
      const hh = pet.headWorld();
      fx.confetti((hh[0] + robot.x) / 2, hh[1] - pet.H * 0.3, pet.H / 150);
      sound.play('celebrate');
    }
    if (st.mood === 'furious') sound.play('grumble');
    mirrorToChat('assistant', st.text);
    await speak(st.text, { priority: 3, mood: st.mood || 'normal', hold: false });
    pet.convHop = false;
    if (conv.aborted) return 'aborted';
    if (st.ask) {
      conv.answeredViaChat = false;
      const id = await bubble.ask(st.ask.choices, 15);
      if (id === 'aborted' || conv.aborted) return 'aborted';
      const label = st.ask.choices.find((c) => c.id === id)?.label;
      if (label && !conv.answeredViaChat) mirrorToChat('user', label);
      await playDealSteps(st.ask.branches[id] || st.ask.branches.ignore);
      continue;
    }
    await sleep(readTime(st.text) * 0.8);
  }
  return 'done';
}

async function runDoeScene() {
  if (conv.active || settings.paused || robot.present) return false;
  if (!pet.canConverse()) return false;
  conv.active = true;
  conv.aborted = false;
  conv.kind = 'doe';
  api.log('doe scene start');
  try {
    if (pet.platform?.kind === 'window') {
      // hop down to meet him on the ground
      pet.interrupt(new actions.Jump({ x: pet.x, y: world.height, arc: pet.H * 0.3 }));
      await waitUntil(() => pet.mode === 'ground' && pet.platform?.kind === 'ground', 5000);
    }
    const side = pet.x < world.width / 2 ? 1 : -1; // Doe arrives from the roomier side
    const gap = pet.H * 0.68;
    let meetX = pet.x + side * gap;
    if (meetX < pet.H * 0.6 || meetX > world.width - pet.H * 0.6) meetX = pet.x - side * gap;
    robot.enter(sign(meetX - pet.x) > 0 ? 1 : -1, meetX);
    pet.interrupt(new actions.Idle({ dur: 30, variant: 'notice' }));
    pet.facing = sign(robot.x - pet.x) || 1;
    const hh = pet.headWorld();
    fx.mark(hh[0], hh[1] - pet.H * 0.18, pet.H / 150, '$', '#7dff8a');
    sound.play('notice');
    const ok = await waitUntil(() => robot.arrived() || conv.aborted || !robot.present, 20000);
    if (!ok || conv.aborted) return false;
    if (!pet.beginConverse()) return false;
    pet.facing = sign(robot.x - pet.x) || pet.facing;
    robot.lookAt(pet.x);
    const sc = deals.scene(vars());
    await playDealSteps(sc.steps);
    if (!conv.aborted) await sleep(600);
  } finally {
    bubble.hide();
    doeBubble.hide();
    robot.speaking = false;
    speechPriority = 0;
    robot.leave();
    pet.convCtx = null;
    pet.endConverse();
    conv.active = false;
    conv.kind = null;
    doe.schedule();
    api.log('doe scene end');
  }
  return true;
}

// ── mirror AI chat replies in his bubble ───────────────────────────────────
async function showChatReply(text) {
  if (conv.active) return;
  const short = text.length > 170 ? `${text.slice(0, 160).replace(/\s+\S*$/, '')}… (more in chat)` : text;
  const wasCalm = pet.canConverse();
  if (wasCalm) pet.beginConverse();
  pet.convAnim = 'talk';
  await speak(short, { priority: 2, mood: 'chat' });
  setTimeout(() => {
    if (!conv.active && pet.conversing && speechPriority <= 2) pet.endConverse();
  }, readTime(short));
}

// ── canvas / loop ───────────────────────────────────────────────────────────
let dpr = 1;
function resize() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  world.setBounds(window.innerWidth, window.innerHeight);
  refreshPlatform();
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let lastDirty = null;
let frameInterval = settings.lowPower ? 1000 / 30 : 0;
let lastFrame = 0;

function frame(now) {
  requestAnimationFrame(frame);
  if (frameInterval && now - lastFrame < frameInterval - 2) return;
  lastFrame = now;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  pet.update(dt);
  robot.update(dt);
  fx.update(dt);
  if (!conv.active && !settings.paused && now / 1000 > doe.nextAt) {
    runDoeScene().then((ok) => {
      if (!ok && !conv.active) doe.nextAt = now / 1000 + 8;
    });
  }

  if (helper.active) {
    conv.nextAt = Math.max(conv.nextAt, now / 1000 + 30);
    doe.nextAt = Math.max(doe.nextAt, now / 1000 + 60);
  }
  if (!conv.active && !settings.paused && now / 1000 > conv.nextAt) {
    runConversation().then((ok) => {
      if (!ok) conv.nextAt = now / 1000 + 5; // he was busy; try again shortly
    });
  }

  // clear only what was drawn last frame
  const b = pet.bounds();
  const fb = fx.bounds;
  const dirty = fb ? { x1: Math.min(b.x1, fb.x1), y1: Math.min(b.y1, fb.y1), x2: Math.max(b.x2, fb.x2), y2: Math.max(b.y2, fb.y2) } : b;
  if (robot.present || robot.wasPresent) {
    const rb = robot.bounds();
    dirty.x1 = Math.min(dirty.x1, rb.x1);
    dirty.y1 = Math.min(dirty.y1, rb.y1);
    dirty.x2 = Math.max(dirty.x2, rb.x2);
    dirty.y2 = Math.max(dirty.y2, rb.y2);
  }
  robot.wasPresent = robot.present;
  if (pet.holdingCursor) {
    dirty.x1 = Math.min(dirty.x1, pet.cursor.x - 60);
    dirty.y1 = Math.min(dirty.y1, pet.cursor.y - 60);
    dirty.x2 = Math.max(dirty.x2, pet.cursor.x + 60);
    dirty.y2 = Math.max(dirty.y2, pet.cursor.y + 60);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const r of [lastDirty, dirty]) {
    if (r) ctx.clearRect(r.x1 - 4, r.y1 - 4, r.x2 - r.x1 + 8, r.y2 - r.y1 + 8);
  }
  lastDirty = dirty;
  robot.draw(ctx);
  pet.draw(ctx);
  fx.draw(ctx);
  if (robot.present) {
    const rt = robot.headTopWorld();
    doeBubble.position(rt[0], rt[1], world.width);
  }

  const ht = pet.headTopWorld();
  bubble.position(ht[0], ht[1] - pet.H * 0.05, world.width);
}
requestAnimationFrame(frame);

// ── click-through: only the pet and the bubble catch the mouse ─────────────
let interactive = false;
function setInteractive(on) {
  if (on === interactive) return;
  interactive = on;
  api.setInteractive(on);
  document.body.classList.toggle('grab', on);
}
function overInteractive(x, y) {
  if (pet.drag.active) return true;
  if (pet.hitTest(x, y)) return true;
  if (robot.drag.active || robot.hitTest(x, y)) return true;
  if (bubble.visible) {
    const r = bubble.rect();
    if (x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4) return true;
  }
  return false;
}

api.onCursor(({ x, y }) => {
  pet.setCursor(x, y, performance.now());
  setInteractive(overInteractive(x, y));
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (!pet.hitTest(e.clientX, e.clientY) && robot.hitTest(e.clientX, e.clientY)) {
    robot.startDrag(e.clientX, e.clientY);
    robotDownAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    document.body.classList.add('dragging');
    if (conv.active && conv.kind === 'doe') conv.abort();
    return;
  }
  if (pet.hitTest(e.clientX, e.clientY)) {
    pet.startDrag(e.clientX, e.clientY);
    document.body.classList.add('dragging');
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  }
});
let downAt = null;
let robotDownAt = null;
window.addEventListener('mousemove', (e) => {
  if (pet.drag.active) pet.moveDrag(e.clientX, e.clientY);
  if (robot.drag.active) robot.moveDrag(e.clientX, e.clientY);
});
window.addEventListener('mouseup', (e) => {
  if (!robot.drag.active) return;
  robot.endDrag();
  document.body.classList.remove('dragging');
  const moved = robotDownAt && Math.hypot(e.clientX - robotDownAt.x, e.clientY - robotDownAt.y);
  if (moved < 5 && !conv.active) doeSay(pick(DOE_POKES), 'angry').then(() => setTimeout(() => doeBubble.hide(), 1800));
  else if (!conv.active) setTimeout(() => robot.present && robot.mode === 'ground' && robot.leave(), 2500);
  robotDownAt = null;
});
window.addEventListener('mouseup', (e) => {
  if (!pet.drag.active) return;
  pet.endDrag();
  document.body.classList.remove('dragging');
  const moved = downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  if (downAt && moved < 5 && performance.now() - downAt.t < 300) {
    // a click, not a drag
    clicks++;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      if (clicks >= 2) api.openChat();
      else if (!conv.active && Math.random() < 0.35) runConversation();
      else pet.emote('laugh', 1.0, { sayKey: 'poked' });
      clicks = 0;
    }, 260);
  }
  downAt = null;
});
let clicks = 0;
let clickTimer = null;

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (pet.hitTest(e.clientX, e.clientY)) api.showContextMenu();
});
window.addEventListener('wheel', (e) => {
  if (!pet.hitTest(e.clientX, e.clientY) || !(e.altKey || e.metaKey)) return;
  const size = clamp((settings.size || 1) * (e.deltaY < 0 ? 1.06 : 1 / 1.06), 0.4, 3);
  api.setSettings({ size: Math.round(size * 100) / 100 });
});

// ── messages from the main process ─────────────────────────────────────────
function refreshPlatform() {
  if (pet.mode !== 'ground' || !pet.platform) return;
  if (pet.platform.kind === 'ground') {
    pet.platform = world.ground;
    pet.y = world.ground.y;
  }
}

api.onWindows((list) => {
  const prevId = pet.mode === 'ground' ? pet.platform?.winId : null;
  const prev = prevId != null ? world.windowById(prevId) : null;
  world.setWindows(list);
  refreshPlatform();
  if (prevId == null || !prev) return;
  const now = world.windowById(prevId);
  if (!now) {
    pet.fallOff('windowGone');
    return;
  }
  const dx = now.x - prev.x, dy = now.y - prev.y;
  pet.x += dx;
  pet.y = now.y;
  const plat = world.platformsOfWindow(prevId).find((p) => pet.x >= p.x1 - 2 && pet.x <= p.x2 + 2);
  if (!plat) {
    pet.fallOff('windowGone');
    return;
  }
  pet.platform = plat;
  if (Math.hypot(dx, dy) > 70 && pet.cool('winMoved', 6) && !conv.active) pet.emote('stumble', 0.8, { sayKey: 'windowMoved' });
});

api.onSettings((s) => {
  const prevChar = settings.character;
  const prevHead = settings.headScale;
  Object.assign(settings, s);
  world.windowsEnabled = settings.useWindows !== false;
  world.rebuild();
  refreshPlatform();
  sound.set(settings.sound !== false, settings.volume ?? 0.5);
  frameInterval = settings.lowPower ? 1000 / 30 : 0;
  if (settings.paused && conv.active) conv.abort();
  if (prevChar !== settings.character || prevHead !== settings.headScale) loadCharacter(init.character);
  if (s.dialogueFrequency !== undefined) conv.schedule();
  if (s.doeFrequency !== undefined) doe.schedule();
});

api.onCommand(async ({ cmd, data }) => {
  switch (cmd) {
    case 'talk':
      if (!(await runConversation())) speak("Hang on, I'm busy! Ask me again in a sec.", { priority: 1 });
      break;
    case 'doe':
      if (robot.present && !conv.active) robot.leave();
      if (!(await runDoeScene())) speak("Doe? Not now, I'm busy!", { priority: 1 });
      break;
    case 'chase':
      pet.chaseCooldown = 0;
      if (!pet.startChase()) speak('Let me land first!', { priority: 1 });
      break;
    case 'summon':
      pet.summon(data?.x);
      break;
    case 'reloadCharacter':
      init.character = data;
      await loadCharacter(data);
      break;
    case 'helper:active':
      helper.active = !!data.on;
      pet.helperActive = helper.active;
      if (helper.active && conv.active) conv.abort();
      if (helper.active && robot.present) robot.leave();
      break;
    case 'helper:fly': {
      const wasFlying = pet.flying;
      pet.helperFly(data);
      if (!wasFlying && Math.random() < 0.5) speak(pick(HELPER_QUIPS), { priority: 2 });
      break;
    }
    case 'helper:reach':
      pet.helperReach(data.id);
      break;
    case 'helper:pressed':
      pet.helperPressed();
      sound.play('knock');
      break;
    case 'helper:typing':
      pet.helperTyping(!!data.on);
      break;
    case 'helper:finish':
      pet.helperFinish();
      break;
    case 'helper:say':
      speak(data.text, { priority: 2, mood: data.mood || 'chat' });
      break;
    case 'chatUserMessage': {
      // typing an answer in the chat counts as answering his question
      const ids = bubble.pendingChoiceIds;
      if (ids.length) {
        const id = classifyReply(data.text, ids);
        if (id) {
          conv.answeredViaChat = true; // the typed text is already in the chat log
          bubble.pick(id);
          api.chatAnswered({ handled: true });
          return;
        }
      }
      api.chatAnswered({ handled: false });
      break;
    }
    case 'chatReply':
      showChatReply(data.text);
      break;
    case 'chatThinking':
      if (!conv.active) pet.convAnim = 'talk';
      break;
    case 'resetStory':
      Object.assign(story.state, data);
      break;
  }
});

api.onRestraintEnded(({ reason }) => pet.onRestraintEnded(reason));

// periodic state for the main process (story summary for the AI, position memory, tests)
setInterval(() => {
  api.reportState({
    x: Math.round(pet.x),
    y: Math.round(pet.y),
    mode: pet.mode,
    action: pet.action?.constructor?.name || null,
    flyPhase: pet.action?.phase && pet.flying ? pet.action.phase : null,
    jetpack: Math.round((pet.jetpack || 0) * 100) / 100,
    anim: pet.animName,
    platform: pet.platform?.id || null,
    holding: pet.holdingCursor,
    conversing: conv.active,
    convKind: conv.kind || null,
    doe: robot.present ? { x: Math.round(robot.x), mode: robot.mode, anim: robot.anim, face: robot.face, bubble: doeBubble.visible ? doeBubble.fullText : null, leaving: robot.leaving } : null,
    storySummary: story.summary(),
    stage: story.stage,
    characterKind: character.kind,
    interactive,
    bubble: bubble.visible ? bubble.fullText : null,
    choices: bubble.pendingChoiceIds,
  });
}, 500);

// test / debug handle
window.__buddy = { pet, world, story, bubble, conv, runConversation, fx, settings, actions, robot, doeBubble, runDoeScene, doe, get character() { return character; } };
api.log(`overlay ready ${world.width}x${world.height} @${dpr}x, character=${character.kind}`);
