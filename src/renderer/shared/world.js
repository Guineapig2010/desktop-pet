// The desktop as a little platformer level: the bottom of the screen is the ground and the
// visible top edges of real windows become ledges he can stand, sit and climb on.

import { subtractIntervals } from './util.js';

export const MIN_LEDGE = 60; // px of uncovered window edge needed to count as a ledge

export class World {
  constructor(width = 1280, height = 800) {
    this.width = width;
    this.height = height;
    this.windows = []; // front-to-back, overlay-local coordinates
    this.platforms = [];
    this.windowsEnabled = true;
    this.cratePlats = [];
    this.rebuild();
  }

  setBounds(w, h) {
    this.width = w;
    this.height = h;
    this.rebuild();
  }

  /** @param list [{id, x, y, w, h, owner}] in front-to-back order (overlay-local px) */
  setWindows(list) {
    this.windows = (list || []).filter(
      (w) => w.w >= 140 && w.h >= 80 && w.x + w.w > 0 && w.x < this.width && w.y < this.height - 40,
    );
    this.rebuild();
  }

  windowById(id) {
    return this.windows.find((w) => w.id === id);
  }

  rebuild() {
    const ground = { id: 'ground', kind: 'ground', x1: 0, x2: this.width, y: this.height };
    const plats = [ground];
    if (this.windowsEnabled) {
      this.windows.forEach((win, i) => {
        const top = win.y;
        if (top < 24) return; // flush with the top of the screen: no room to stand
        const cuts = [];
        for (let j = 0; j < i; j++) {
          const f = this.windows[j];
          if (f.y <= top + 1 && f.y + f.h >= top - 1) cuts.push([f.x, f.x + f.w]);
        }
        const x1 = Math.max(0, win.x), x2 = Math.min(this.width, win.x + win.w);
        subtractIntervals(x1, x2, cuts).forEach(([a, b], k) => {
          if (b - a >= MIN_LEDGE) plats.push({ id: `w${win.id}:${k}`, kind: 'window', winId: win.id, x1: a, x2: b, y: top });
        });
      });
    }
    this.platforms = plats.concat(this.cratePlats || []);
  }

  /** Tops of resting crates (see overlay/crates.js) are platforms too. */
  setCratePlatforms(list) {
    this.cratePlats = list;
    this.rebuild();
  }

  get ground() {
    return this.platforms[0];
  }

  /** First platform crossed when falling from yPrev to yNew at horizontal position x. */
  findLanding(x, yPrev, yNew) {
    let best = null;
    for (const p of this.platforms) {
      if (x < p.x1 || x > p.x2) continue;
      if (p.y >= yPrev - 0.5 && p.y <= yNew + 0.5) {
        if (!best || p.y < best.y) best = p;
      }
    }
    return best;
  }

  /** Platform that a point standing at (x, y) rests on (within tolerance). */
  platformAt(x, y, tol = 3) {
    let best = null;
    for (const p of this.platforms) {
      if (x >= p.x1 && x <= p.x2 && Math.abs(p.y - y) <= tol) {
        if (!best || p.kind === 'window') best = p;
      }
    }
    return best;
  }

  /** Platforms belonging to a window, i.e. its visible top-edge segments. */
  platformsOfWindow(winId) {
    return this.platforms.filter((p) => p.winId === winId);
  }

  /** Is the point (x, y) inside any window? Returns the front-most such window. */
  windowAtPoint(x, y) {
    return this.windows.find((w) => x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) || null;
  }

  ledges() {
    return this.platforms.filter((p) => p.kind === 'window' || p.kind === 'crate');
  }
}
