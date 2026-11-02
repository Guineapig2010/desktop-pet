// Personal Helper controller (main process).
// Owns: what is shared (one display or window, chosen by the user), the visible "he can see your
// screen" indicator with a Stop button, Esc-to-cancel, confirmations, and the choreography that
// makes General Fok fly over and press things at the exact moment the REAL click happens.
import { BrowserWindow, globalShortcut, screen, systemPreferences, shell } from 'electron';
import path from 'node:path';
import { listSources, capture, signature, signatureDiff } from './capture.js';
import { input, inputStatus, requestAccessibility } from './input.js';
import { runHelper, explainOpenAICompatible } from './agent.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cancelled = () => Object.assign(new Error('Stopped.'), { code: 'cancel' });

export class HelperController {
  constructor(o) {
    this.o = o; // { rendererDir, preload, getOverlay, getChat, ourWindows, sendOverlay, appendChat, settings, secrets, aiStatus, log, latestWindows, moveOverlayTo, broadcast, openChat, isMac }
    this.source = null;
    this.live = false;
    this.task = null;
    this.indicator = null;
    this.activity = '';
    this.seq = 0;
    this.waiters = new Map(); // `${event}:${id}` → resolve
    this.confirms = new Map();
    this.confirmTexts = new Map();
    this.guardUntil = 0;
  }

  // ── status ────────────────────────────────────────────────────────────
  state() {
    return {
      sharing: !!this.source,
      sourceName: this.source?.name || null,
      sourceKind: this.source?.kind || null,
      live: this.live,
      busy: !!this.task,
      activity: this.activity,
      confirms: [...this.confirmTexts.entries()].map(([id, text]) => ({ id, text })),
    };
  }
  emit() {
    this.o.broadcast('helper:status', this.state());
  }
  status(text) {
    this.activity = text;
    this.emit();
  }

  permissions() {
    const mac = process.platform === 'darwin';
    return {
      platform: process.platform,
      screen: mac ? systemPreferences.getMediaAccessStatus('screen') : 'granted',
      accessibility: mac ? systemPreferences.isTrustedAccessibilityClient(false) : true,
      input: inputStatus(),
    };
  }
  openPermission(kind) {
    if (process.platform !== 'darwin') return;
    if (kind === 'accessibility') requestAccessibility();
    const pane = kind === 'accessibility' ? 'Privacy_Accessibility' : 'Privacy_ScreenCapture';
    shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
  }

  // ── sharing ───────────────────────────────────────────────────────────
  async sources() {
    return listSources();
  }

  share(src) {
    this.source = { id: src.id, kind: src.kind, name: src.name, displayId: src.displayId };
    this.protect(true);
    this.showIndicator();
    this.o.appendChat({ role: 'system', source: 'notice', text: `👁 I can now see "${src.name}" (only that). Nothing is sent anywhere until you ask me something about it. Click Stop on the red bar or here to stop sharing.` });
    this.emit();
    return this.state();
  }

  stopSharing() {
    this.cancel('stopped sharing');
    if (this.source) this.o.appendChat({ role: 'system', source: 'notice', text: '👁 Screen sharing stopped. I can’t see your screen anymore.' });
    this.source = null;
    this.live = false;
    this.protect(false);
    if (this.indicator && !this.indicator.isDestroyed()) this.indicator.close();
    this.indicator = null;
    this.emit();
    return this.state();
  }

  setLive(on) {
    this.live = !!on && !!this.source;
    this.emit();
    return this.state();
  }

  /** Keep our own windows (pet, chat, indicator) out of the screenshots (macOS/Windows). */
  protect(on) {
    for (const w of this.o.ourWindows()) {
      try {
        w.setContentProtection(on);
      } catch {
        /* not supported */
      }
    }
  }

  showIndicator() {
    if (this.indicator && !this.indicator.isDestroyed()) return;
    const d = this.source?.displayId ? screen.getAllDisplays().find((x) => x.id === this.source.displayId) : screen.getPrimaryDisplay();
    const wa = (d || screen.getPrimaryDisplay()).workArea;
    const w = 460, h = 46;
    this.indicator = new BrowserWindow({
      x: Math.round(wa.x + (wa.width - w) / 2),
      y: wa.y + 6,
      width: w,
      height: h,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      hasShadow: false,
      acceptFirstMouse: true,
      title: 'General Fok can see your screen',
      ...(this.o.isMac ? { type: 'panel' } : {}),
      webPreferences: { preload: this.o.preload, contextIsolation: true, sandbox: true },
    });
    this.indicator.setAlwaysOnTop(true, 'screen-saver');
    this.indicator.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    try {
      this.indicator.setContentProtection(true);
    } catch {
      /* ignore */
    }
    this.indicator.loadFile(path.join(this.o.rendererDir, 'indicator/index.html'));
    this.indicator.once('ready-to-show', () => this.indicator?.showInactive());
    this.indicator.on('closed', () => (this.indicator = null));
  }

  // ── overlay choreography ─────────────────────────────────────────────
  onOverlayEvent(name, data) {
    const k = `${name}:${data?.id}`;
    const r = this.waiters.get(k);
    if (r) {
      this.waiters.delete(k);
      r();
    }
  }
  waitFor(name, id, ms, signal) {
    return new Promise((resolve, reject) => {
      const k = `${name}:${id}`;
      const t = setTimeout(() => {
        this.waiters.delete(k);
        resolve(false); // never block a task on an animation
      }, ms);
      this.waiters.set(k, () => {
        clearTimeout(t);
        resolve(true);
      });
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        this.waiters.delete(k);
        reject(cancelled());
      }, { once: true });
    });
  }

  overlayPoint(pt) {
    // make sure the pet's stage is on the display that holds the target (multi-monitor)
    const d = screen.getDisplayNearestPoint({ x: Math.round(pt.x), y: Math.round(pt.y) });
    this.o.moveOverlayTo(d.id);
    const ob = this.o.getOverlay()?.getBounds() || d.workArea;
    return { x: pt.x - ob.x, y: pt.y - ob.y };
  }

  async fly(pt, purpose, label, signal) {
    const id = ++this.seq;
    const local = this.overlayPoint(pt);
    this.o.sendOverlay('helper:fly', { id, x: local.x, y: local.y, purpose, label });
    await this.waitFor('helperHovering', id, 9000, signal);
    return id;
  }

  async reach(id, signal) {
    this.o.sendOverlay('helper:reach', { id });
    await this.waitFor('helperTouch', id, 2500, signal);
  }

  windowAt(pt) {
    const list = this.o.latestWindows() || [];
    return list.find((w) => pt.x >= w.x && pt.x <= w.x + w.w && pt.y >= w.y && pt.y <= w.y + w.h) || null;
  }

  /** Run fn with our own windows out of the way of point pt (so they can't intercept input). */
  async clear(pt, fn) {
    this.guardUntil = Date.now() + 1500;
    const ov = this.o.getOverlay();
    ov?.setIgnoreMouseEvents(true, { forward: true });
    const hidden = [];
    for (const w of this.o.ourWindows()) {
      if (w === ov || w.isDestroyed() || !w.isVisible()) continue;
      const b = w.getBounds();
      if (pt.x >= b.x && pt.x <= b.x + b.width && pt.y >= b.y && pt.y <= b.y + b.height) {
        w.hide();
        hidden.push(w);
      }
    }
    if (hidden.length) await sleep(120);
    try {
      return await fn();
    } finally {
      for (const w of hidden) if (!w.isDestroyed()) w.showInactive();
    }
  }

  /** Fly to pt, re-check the target, reach out and act exactly when the hand touches it. */
  async approach(pt, purpose, label, shot, signal) {
    this.status(`${purpose === 'point' ? 'Pointing at' : 'Flying to'} ${label}…`);
    const win0 = this.windowAt(pt);
    const sig0 = shot ? signature(shot, pt, 14) : null;
    let id = await this.fly(pt, purpose, label, signal);
    // the window under the target moved during the flight? follow it
    if (win0) {
      const now = (this.o.latestWindows() || []).find((w) => w.id === win0.id);
      if (!now) throw new Error('The window I was heading for closed. Take a new screenshot.');
      const dx = now.x - win0.x, dy = now.y - win0.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        pt = { x: pt.x + dx, y: pt.y + dy };
        this.status(`The window moved — adjusting course to ${label}…`);
        id = await this.fly(pt, purpose, label, signal);
      }
    }
    // has the target itself changed? compare a fresh capture with what the model saw
    if (sig0 && this.source) {
      const fresh = await this.shoot(true);
      const d = signatureDiff(sig0, signature(fresh, pt, 14));
      this.o.log(`target check ${label}: diff ${d.toFixed(1)}`);
      if (d > 32) throw new Error(`The screen changed around "${label}" while I was flying over (it may have moved or the page updated). Take a fresh screenshot and find it again.`);
    }
    await this.reach(id, signal);
    return { id, pt };
  }

  async shoot(silent) {
    if (!this.source) throw new Error('Screen sharing was stopped.');
    if (!silent) this.status('Taking a screenshot…');
    return capture(this.source, (srcId) => {
      const wid = Number(String(srcId).split(':')[1]);
      const w = (this.o.latestWindows() || []).find((x) => x.id === wid);
      if (w) return { x: w.x, y: w.y, w: w.w, h: w.h };
      return null;
    });
  }

  confirm(text) {
    const id = `c${++this.seq}`;
    this.o.openChat();
    this.o.sendOverlay('helper:say', { text: 'Before I do that… check the chat! 👀', mood: 'chat' });
    this.status('Waiting for your OK…');
    return new Promise((resolve) => {
      this.confirms.set(id, resolve);
      this.confirmTexts.set(id, text);
      this.o.broadcast('helper:confirm', { id, text });
      this.emit();
      this.task?.ctrl.signal.addEventListener('abort', () => {
        this.confirms.delete(id);
        this.confirmTexts.delete(id);
        resolve(false);
      }, { once: true });
    });
  }
  answerConfirm(id, ok) {
    const r = this.confirms.get(id);
    if (!r) return;
    this.confirms.delete(id);
    this.confirmTexts.delete(id);
    this.emit();
    this.o.appendChat({ role: 'user', source: 'user', text: ok ? '✅ Yes, do it.' : '❌ No, don’t.' });
    r(!!ok);
  }

  // ── tasks ─────────────────────────────────────────────────────────────
  cancel(reason = 'cancelled') {
    if (!this.task) return false;
    this.task.ctrl.abort();
    this.o.log(`helper cancel: ${reason}`);
    return true;
  }

  async ask({ text, mode }) {
    text = String(text || '').trim() || "Explain what I'm looking at.";
    mode = mode === 'do' ? 'do' : 'explain';
    this.o.appendChat({ role: 'user', source: 'user', text: mode === 'do' ? `🛠 ${text}` : `👁 ${text}` });
    if (!this.source) {
      this.o.appendChat({ role: 'system', source: 'notice', text: 'First choose what I may look at: click “Share screen…” and pick a display or a window.' });
      return { ok: false, error: 'not sharing' };
    }
    if (this.task) return { ok: false, error: 'busy' };
    const st = this.o.aiStatus();
    if (!st.configured) {
      this.o.appendChat({ role: 'system', source: 'notice', text: 'Seeing your screen needs a vision-capable AI. Connect Claude in Settings → Chat AI (or an OpenAI-compatible vision model for explain-only).' });
      return { ok: false, error: 'offline' };
    }
    if (mode === 'do' && st.provider !== 'anthropic') {
      this.o.appendChat({ role: 'system', source: 'notice', text: '“Do it for me” needs Claude (Anthropic) because it uses Claude’s computer-use tools. With this AI service I can explain, but not click.' });
      mode = 'explain';
    }
    if (mode === 'do') {
      const p = inputStatus();
      if (!p.available) {
        if (p.needsPermission === 'accessibility') requestAccessibility();
        this.o.appendChat({ role: 'system', source: 'error', text: `${p.reason} Open System Settings → Privacy & Security → Accessibility, turn on this app (or Terminal if you started it from Terminal), then try again. Until then I can explain and point, but not click.` });
        mode = 'explain';
      }
    }
    const ctrl = new AbortController();
    this.task = { ctrl, mode };
    const signal = ctrl.signal;
    const onEsc = () => this.cancel('escape');
    try {
      globalShortcut.unregister('Escape');
    } catch {
      /* none */
    }
    globalShortcut.register('Escape', onEsc);
    this.o.sendOverlay('helper:active', { on: true });
    this.emit();
    const provider = st.provider === 'anthropic' ? 'Anthropic (Claude)' : 'your AI service';
    let sentCount = 0;
    const sent = () => {
      sentCount++;
      if (sentCount === 1) this.o.appendChat({ role: 'system', source: 'notice', text: `📸 Sending screenshots of “${this.source.name}” to ${provider} for this request.` });
    };
    const s = this.o.settings();
    const persona = { petName: s.petName, userName: s.userName };
    const say = (t) => {
      this.o.appendChat({ role: 'assistant', source: 'helper', text: t });
      this.o.sendOverlay('helper:say', { text: t.length > 150 ? `${t.slice(0, 140).replace(/\s+\S*$/, '')}…` : t });
    };
    let flew = false;
    const act = {
      position: () => input.position(),
      click: async (pt, opts, label, shot) => {
        flew = true;
        const r = await this.approach(pt, 'click', label, shot, signal);
        this.status(`Clicking ${label}`);
        await this.clear(r.pt, async () => input.click(r.pt, opts));
        this.o.sendOverlay('helper:pressed', {});
        await sleep(250);
      },
      move: async (pt) => {
        flew = true;
        await this.fly(pt, 'hover', 'there', signal);
        input.move(pt);
      },
      drag: async (from, to, shot) => {
        flew = true;
        const r = await this.approach(from, 'click', 'the drag handle', shot, signal);
        await this.clear(r.pt, () => input.drag(r.pt, to));
        this.o.sendOverlay('helper:pressed', {});
      },
      down: () => input.down(),
      up: () => input.up(),
      scroll: async (pt, dir, amount, shot) => {
        if (pt) {
          flew = true;
          const r = await this.approach(pt, 'scroll', `scrolling ${dir}`, null, signal);
          pt = r.pt;
        }
        this.status(`Scrolling ${dir}…`);
        await this.clear(pt || input.position(), async () => {
          for (let i = 0; i < Math.max(1, Math.min(10, amount)); i++) {
            if (signal.aborted) throw cancelled();
            input.scroll(i === 0 ? pt : null, dir, 1);
            await sleep(40);
          }
        });
      },
      type: async (t) => {
        if (!flew) {
          flew = true;
          await this.fly(input.position(), 'type', 'the text field', signal);
        }
        this.status(`Typing “${t.length > 30 ? `${t.slice(0, 30)}…` : t}”`);
        this.o.sendOverlay('helper:typing', { on: true });
        try {
          for (let i = 0; i < t.length; i += 20) {
            if (signal.aborted) throw cancelled();
            input.type(t.slice(i, i + 20));
            await sleep(10);
          }
        } finally {
          this.o.sendOverlay('helper:typing', { on: false });
        }
      },
      key: async (k, repeat) => {
        this.status(`Pressing ${k}`);
        this.o.sendOverlay('helper:pressed', {});
        input.key(k, repeat);
      },
      holdKey: (k, secs) => input.holdKey(k, secs, signal),
      point: async (pt, label, shot) => {
        flew = true;
        const r = await this.approach(pt, 'point', label, null, signal);
        this.o.sendOverlay('helper:pressed', {});
        this.status(`Look here: ${label}`);
        await sleep(2200);
        return r;
      },
    };
    try {
      let result;
      if (st.provider === 'anthropic') {
        const history = this.o.recentChat(8);
        result = await runHelper({
          apiKey: this.o.secrets.get('anthropic'),
          baseURL: process.env.BUDDY_ANTHROPIC_BASE_URL || undefined,
          model: s.ai.anthropicModel,
          task: text,
          mode,
          sourceName: this.source.name,
          persona,
          history,
          ctx: { shoot: () => this.shoot(), act, confirm: (t) => this.confirm(t), say, status: (t) => this.status(t), sent, signal },
        });
      } else {
        const shot = await this.shoot();
        sent();
        result = await explainOpenAICompatible({ apiKey: this.o.secrets.get('openai'), baseUrl: s.ai.openaiBaseUrl, model: s.ai.openaiModel, task: text, shot, sourceName: this.source.name, persona, signal });
        say(result);
      }
      if (sentCount > 1) this.o.appendChat({ role: 'system', source: 'notice', text: `📸 Done — ${sentCount} screenshots of “${this.source?.name}” were sent to ${provider} for this request.` });
      return { ok: true, text: result };
    } catch (e) {
      if (e.code === 'cancel' || signal.aborted) {
        this.o.appendChat({ role: 'system', source: 'notice', text: '⏹ Stopped. (Esc or Stop cancels me any time.)' });
        this.o.sendOverlay('helper:say', { text: 'Okay, okay, stopping! Rocket off!' });
        return { ok: false, error: 'cancelled' };
      }
      const msg = e.code === 'screen' ? `${e.message} (System Settings → Privacy & Security → Screen & System Audio Recording.)` : this.o.explainError(e);
      this.o.appendChat({ role: 'system', source: 'error', text: msg });
      return { ok: false, error: msg };
    } finally {
      try {
        globalShortcut.unregister('Escape');
      } catch {
        /* ignore */
      }
      for (const [, r] of this.confirms) r(false);
      this.confirms.clear();
      this.confirmTexts.clear();
      this.task = null;
      this.o.sendOverlay('helper:finish', {});
      setTimeout(() => !this.task && this.o.sendOverlay('helper:active', { on: false }), 2500);
      this.status('');
    }
  }

  get guarding() {
    return Date.now() < this.guardUntil;
  }
}
