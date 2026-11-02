// Feeds real window rectangles to the overlay so he can stand on window edges.
// macOS: a long-running JXA helper (no permission needed). Elsewhere: not available — he
// simply uses the bottom of the screen.
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

export class WindowTracker {
  constructor({ helperDir, onWindows, onStatus, ownPid }) {
    this.helperDir = helperDir;
    this.onWindows = onWindows;
    this.onStatus = onStatus;
    this.ownPid = ownPid;
    this.proc = null;
    this.status = { available: false, reason: 'not started' };
    this.fake = null;
    this.restarts = 0;
  }

  setStatus(s) {
    this.status = s;
    this.onStatus?.(s);
  }

  start() {
    if (this.fake) return;
    if (process.platform !== 'darwin') {
      this.setStatus({ available: false, reason: 'Window ledges currently need macOS. He will use the bottom of the screen instead.' });
      return;
    }
    this.stop();
    const script = path.join(this.helperDir, 'mac-windows.js');
    this.proc = spawn('/usr/bin/osascript', ['-l', 'JavaScript', script, '0.1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const rl = readline.createInterface({ input: this.proc.stdout });
    let gotData = false;
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (!Array.isArray(msg.w)) {
          this.setStatus({ available: false, reason: `Window tracking error: ${msg.w?.error || 'unknown'}` });
          return;
        }
        if (!gotData) {
          gotData = true;
          this.setStatus({ available: true, reason: 'Using real window positions.' });
        }
        this.onWindows(msg.w.filter((w) => w.pid !== this.ownPid));
      } catch {
        /* ignore partial output */
      }
    });
    let errText = '';
    this.proc.stderr.on('data', (d) => (errText += d.toString()).slice(-2000));
    this.proc.on('exit', (code) => {
      this.proc = null;
      if (this.stopping) return;
      this.setStatus({ available: false, reason: `Window tracker stopped (${code}). ${errText.trim().slice(0, 200)}` });
      if (this.restarts++ < 3) setTimeout(() => this.start(), 2000);
    });
  }

  /** Tests can inject fake windows instead of the OS ones. */
  setFake(list) {
    this.fake = list;
    this.stop();
    this.setStatus({ available: true, reason: 'test windows' });
    this.onWindows(list);
  }

  stop() {
    if (this.proc) {
      this.stopping = true;
      this.proc.kill();
      this.proc = null;
      this.stopping = false;
    }
  }
}
