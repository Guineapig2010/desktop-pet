// OPTIONAL, off by default: when he grabs the cursor, it gets "held" for at most 1.5 s.
// Escape releases it immediately, and so does pulling hard. macOS only.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { globalShortcut, screen } from 'electron';

export const MAX_HOLD_MS = 1500;

export class Restraint {
  constructor({ helperDir, onEnded }) {
    this.helperDir = helperDir;
    this.onEnded = onEnded;
    this.proc = null;
    this.timer = null;
    this.active = false;
  }

  get supported() {
    return process.platform === 'darwin';
  }

  ensureProc() {
    if (this.proc) return this.proc;
    this.proc = spawn('/usr/bin/osascript', ['-l', 'JavaScript', path.join(this.helperDir, 'mac-cursor.js')], { stdio: ['pipe', 'ignore', 'ignore'] });
    this.proc.on('exit', () => (this.proc = null));
    this.proc.stdin.on('error', () => {});
    return this.proc;
  }

  start(anchor) {
    if (!this.supported || this.active) return false;
    this.active = true;
    this.anchor = anchor;
    this.pulls = 0;
    this.started = Date.now();
    globalShortcut.register('Escape', () => this.stop('escape'));
    const proc = this.ensureProc();
    this.timer = setInterval(() => {
      if (Date.now() - this.started > MAX_HOLD_MS) return this.stop('timeout');
      const c = screen.getCursorScreenPoint();
      const dx = c.x - this.anchor.x, dy = c.y - this.anchor.y;
      const d = Math.hypot(dx, dy);
      if (d > 60) this.pulls++;
      if (this.pulls >= 4) return this.stop('pulled');
      if (d > 5) {
        // tug-of-war: pull the pointer most of the way back to his hands
        const x = Math.round(this.anchor.x + dx * 0.3), y = Math.round(this.anchor.y + dy * 0.3);
        proc.stdin.write(`${x} ${y}\n`);
      }
    }, 30);
    return true;
  }

  stop(reason = 'released') {
    if (!this.active) return;
    this.active = false;
    clearInterval(this.timer);
    try {
      globalShortcut.unregister('Escape');
    } catch {
      /* already gone */
    }
    this.onEnded?.(reason);
  }

  dispose() {
    this.stop('quit');
    if (this.proc) this.proc.kill();
  }
}
