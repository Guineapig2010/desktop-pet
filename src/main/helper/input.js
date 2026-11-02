// Real mouse + keyboard control (CGEvent on macOS via libnut, XTest on Linux, SendInput on Windows).
// Coordinates passed in are global screen *points* (Electron's coordinate space).
// macOS: needs Accessibility permission (System Settings → Privacy & Security → Accessibility).
import { createRequire } from 'node:module';
import { screen, systemPreferences } from 'electron';

const require = createRequire(import.meta.url);

let lib = null;
let loadError = null;
try {
  const name = { darwin: 'libnut-darwin', linux: 'libnut-linux', win32: 'libnut-win32' }[process.platform];
  lib = require(`@nut-tree-fork/${name}`);
  lib.setMouseDelay?.(0);
  lib.setKeyboardDelay?.(4);
} catch (e) {
  loadError = e;
}

export function inputStatus() {
  if (!lib) return { available: false, reason: `Input control library failed to load: ${loadError?.message || 'unknown'}` };
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
    return { available: false, needsPermission: 'accessibility', reason: 'macOS Accessibility permission is needed to click and type for you.' };
  }
  return { available: true };
}

/** Ask macOS to show the Accessibility prompt (no-op elsewhere). */
export function requestAccessibility() {
  if (process.platform === 'darwin') return systemPreferences.isTrustedAccessibilityClient(true);
  return true;
}

function toNative(p) {
  // Windows libraries expect physical pixels; macOS and X11 use the same space as Electron.
  if (process.platform === 'win32') return screen.dipToScreenPoint(p);
  return p;
}

function need() {
  const st = inputStatus();
  if (!st.available) {
    const e = new Error(st.reason);
    e.code = st.needsPermission || 'input_unavailable';
    throw e;
  }
}

const BUTTON = { left: 'left', right: 'right', middle: 'middle' };
const SHIFTED = { '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', _: '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`' };

// Claude/xdotool-style key names → libnut key names
const KEY_ALIASES = {
  return: 'enter', enter: 'enter', kp_enter: 'enter', tab: 'tab', escape: 'escape', esc: 'escape', backspace: 'backspace', delete: 'delete',
  space: 'space', up: 'up', down: 'down', left: 'left', right: 'right', home: 'home', end: 'end', page_up: 'pageup', pageup: 'pageup',
  page_down: 'pagedown', pagedown: 'pagedown', prior: 'pageup', next: 'pagedown', insert: 'insert', caps_lock: 'capslock',
  minus: '-', equal: '=', plus: '+', comma: ',', period: '.', slash: '/', backslash: '\\', semicolon: ';', apostrophe: "'",
  bracketleft: '[', bracketright: ']', grave: '`',
};
const MOD_ALIASES = {
  ctrl: 'control', control: 'control', ctl: 'control', alt: 'alt', option: 'alt', opt: 'alt', shift: 'shift',
  cmd: 'command', command: 'command', super: 'command', meta: 'command', win: 'command',
};

export function parseCombo(text) {
  const parts = String(text).split('+').map((s) => s.trim()).filter(Boolean);
  const mods = [];
  let key = null;
  for (const p of parts) {
    const l = p.toLowerCase();
    if (MOD_ALIASES[l] && parts.length > 1 && p !== parts[parts.length - 1]) mods.push(MOD_ALIASES[l]);
    else key = KEY_ALIASES[l] || (/^f\d{1,2}$/.test(l) ? l : l.length === 1 ? l : l);
  }
  // On Linux/Windows "command" means the Windows/super key
  const fixed = mods.map((m) => (m === 'command' && process.platform !== 'darwin' ? 'command' : m));
  return { key, mods: fixed };
}

export const input = {
  move(p) {
    need();
    const n = toNative(p);
    lib.moveMouse(Math.round(n.x), Math.round(n.y));
  },
  position() {
    need();
    const p = lib.getMousePos();
    return process.platform === 'win32' ? screen.screenToDipPoint(p) : p;
  },
  click(p, { button = 'left', count = 1, modifiers = '' } = {}) {
    need();
    this.move(p);
    const mods = modifiers ? parseCombo(`${modifiers}+x`).mods : [];
    for (const m of mods) lib.keyToggle(m, 'down');
    try {
      if (count === 2) lib.mouseClick(BUTTON[button] || 'left', true);
      else for (let i = 0; i < count; i++) lib.mouseClick(BUTTON[button] || 'left', false);
    } finally {
      for (const m of mods.reverse()) lib.keyToggle(m, 'up');
    }
  },
  down(button = 'left') {
    need();
    lib.mouseToggle('down', BUTTON[button] || 'left');
  },
  up(button = 'left') {
    need();
    lib.mouseToggle('up', BUTTON[button] || 'left');
  },
  async drag(from, to) {
    need();
    this.move(from);
    lib.mouseToggle('down', 'left');
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const n = toNative({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
      lib.dragMouse(Math.round(n.x), Math.round(n.y));
      await new Promise((r) => setTimeout(r, 12));
    }
    lib.mouseToggle('up', 'left');
  },
  scroll(p, direction, amount = 3) {
    need();
    if (p) this.move(p);
    const n = Math.max(1, Math.min(30, Math.round(amount)));
    const dx = direction === 'left' ? -n : direction === 'right' ? n : 0;
    const dy = direction === 'up' ? n : direction === 'down' ? -n : 0;
    lib.scrollMouse(dx, dy);
  },
  type(text) {
    need();
    // type in small chunks so long strings stay reliable
    const s = String(text);
    if (process.platform === 'linux') {
      // XTest types shifted symbols without Shift (e.g. "!" → "1"): press them explicitly.
      for (const ch of s) {
        if (SHIFTED[ch]) lib.keyTap(SHIFTED[ch], 'shift');
        else lib.typeString(ch);
      }
      return;
    }
    // macOS/Windows: unicode-aware typing
    for (let i = 0; i < s.length; i += 40) lib.typeString(s.slice(i, i + 40));
  },
  key(text, repeat = 1) {
    need();
    const { key, mods } = parseCombo(text);
    if (!key) throw new Error(`Unknown key "${text}"`);
    for (let i = 0; i < Math.max(1, Math.min(100, repeat)); i++) {
      if (mods.length) lib.keyTap(key, mods);
      else lib.keyTap(key);
    }
  },
  async holdKey(text, seconds, signal) {
    need();
    const { key, mods } = parseCombo(text);
    for (const m of mods) lib.keyToggle(m, 'down');
    lib.keyToggle(key, 'down');
    const end = Date.now() + Math.min(300, seconds) * 1000;
    try {
      while (Date.now() < end && !signal?.aborted) await new Promise((r) => setTimeout(r, 50));
    } finally {
      lib.keyToggle(key, 'up');
      for (const m of mods.reverse()) lib.keyToggle(m, 'up');
    }
  },
};
