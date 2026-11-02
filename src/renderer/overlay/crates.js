// Wooden crates you can spawn (⌥3), drag, throw and remove (right-click).
// They fall, stack on each other and on window edges, and their tops become platforms,
// so General Fok can carry them around, build with them and stand on them.

import { clamp } from '../shared/util.js';

const GRAVITY = 2600;
let nextId = 1;

export class Crates {
  constructor({ world, fx, sound }) {
    this.world = world;
    this.fx = fx;
    this.sound = sound;
    this.list = [];
    this.changed = true;
    this.drag = null;
  }

  spawn(x, y, size) {
    if (this.list.length >= 30) this.remove(this.list[0].id, true);
    const w = Math.round(size);
    const c = { id: nextId++, x: clamp(x, w / 2, this.world.width - w / 2), y: Math.min(y + w / 2, this.world.height), w, vx: 0, vy: 0, state: 'fall', rot: (Math.random() - 0.5) * 0.3, carriedBy: null, placedAt: 0 };
    this.list.push(c);
    this.fx.sparkle(c.x, c.y - w / 2, w / 75, 6);
    this.sound.play('pop');
    this.changed = true;
    return c;
  }

  get(id) {
    return this.list.find((c) => c.id === id) || null;
  }

  remove(id, quiet) {
    const c = this.get(id);
    if (!c) return false;
    this.list = this.list.filter((x) => x !== c);
    if (!quiet) {
      this.fx.dust(c.x, c.y - c.w / 2, c.w / 60, 12);
      this.fx.sparkle(c.x, c.y - c.w / 2, c.w / 75, 8);
      this.sound.play('pop');
    }
    this.changed = true;
    return true;
  }

  clear() {
    for (const c of [...this.list]) this.remove(c.id);
  }

  /** Topmost crate under a point. */
  hitTest(px, py) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      if (px >= c.x - c.w / 2 - 2 && px <= c.x + c.w / 2 + 2 && py >= c.y - c.w - 2 && py <= c.y + 2) return c;
    }
    return null;
  }

  /** Platforms made by crate tops (for the world). */
  platforms() {
    return this.list
      .filter((c) => c.state === 'rest')
      .map((c) => ({ id: `c${c.id}`, kind: 'crate', crateId: c.id, x1: c.x - c.w / 2, x2: c.x + c.w / 2, y: c.y - c.w }));
  }

  /** Is there something under this crate's bottom? Returns the support height or null. */
  support(c, yPrev, yNow) {
    let best = null;
    const left = c.x - c.w / 2, right = c.x + c.w / 2;
    for (const p of this.world.platforms) {
      if (p.kind === 'crate') continue; // crates are checked below (using live positions)
      const ok = p.kind === 'ground' ? true : c.x >= p.x1 && c.x <= p.x2;
      if (ok && p.y >= yPrev - 0.5 && p.y <= yNow + 0.5 && (best === null || p.y < best)) best = p.y;
    }
    for (const o of this.list) {
      if (o === c || o.state !== 'rest') continue;
      const top = o.y - o.w;
      const overlap = Math.min(right, o.x + o.w / 2) - Math.max(left, o.x - o.w / 2);
      if (overlap >= c.w * 0.3 && top >= yPrev - 0.5 && top <= yNow + 0.5 && (best === null || top < best)) best = top;
    }
    return best;
  }

  startDrag(c, px, py) {
    if (c.carriedBy) c.carriedBy.dropCarried?.();
    this.drag = { c, ox: px - c.x, oy: py - c.y, x: px, y: py, hist: [] };
    c.state = 'held';
    this.changed = true;
  }
  moveDrag(px, py) {
    if (this.drag) {
      this.drag.x = px;
      this.drag.y = py;
    }
  }
  endDrag() {
    if (!this.drag) return;
    const { c, hist } = this.drag;
    if (hist.length > 1) {
      const a = hist[0], b = hist[hist.length - 1];
      const dt = Math.max((b.t - a.t) / 1000, 0.016);
      c.vx = clamp((b.x - a.x) / dt, -1500, 1500);
      c.vy = clamp((b.y - a.y) / dt, -1500, 1500);
    }
    c.state = 'fall';
    this.drag = null;
    this.changed = true;
  }

  update(dt) {
    const W = this.world.width;
    for (const c of this.list) {
      if (c.state === 'held' && this.drag?.c === c) {
        const nx = this.drag.x - this.drag.ox, ny = this.drag.y - this.drag.oy;
        this.drag.hist.push({ t: performance.now(), x: nx, y: ny });
        while (this.drag.hist.length && performance.now() - this.drag.hist[0].t > 120) this.drag.hist.shift();
        c.rot = clamp((nx - c.x) * 0.02, -0.4, 0.4);
        c.x = nx;
        c.y = ny;
        continue;
      }
      if (c.state === 'carried' || c.state === 'held') continue;
      if (c.state === 'toss') {
        // flying into a planned slot
        c.tt += dt / c.tdur;
        const k = Math.min(1, c.tt);
        c.x = c.fx + (c.tx - c.fx) * k;
        c.y = c.fy + (c.ty - c.fy) * k - Math.sin(k * Math.PI) * c.w * 0.8;
        c.rot = (1 - k) * 0.6;
        if (k >= 1) {
          c.state = 'rest';
          c.rot = 0;
          c.vx = c.vy = 0;
          this.sound.play('land');
          this.fx.dust(c.x, c.y, c.w / 90, 4);
          this.changed = true;
        }
        continue;
      }
      if (c.state === 'rest') {
        // lost its support (a crate below was removed / window moved)? start falling
        if (this.support(c, c.y - 1, c.y + 1) === null) {
          c.state = 'fall';
          this.changed = true;
        }
        continue;
      }
      // falling
      const prev = c.y;
      c.vy = Math.min(c.vy + GRAVITY * dt, 2600);
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot *= 1 - Math.min(1, dt * 3);
      if (c.x < c.w / 2) {
        c.x = c.w / 2;
        c.vx = Math.abs(c.vx) * 0.4;
      } else if (c.x > W - c.w / 2) {
        c.x = W - c.w / 2;
        c.vx = -Math.abs(c.vx) * 0.4;
      }
      if (c.vy > 0) {
        const s = this.support(c, prev, c.y);
        if (s !== null) {
          const impact = c.vy;
          c.y = s;
          c.vy = 0;
          c.vx = 0;
          c.rot = 0;
          c.state = 'rest';
          this.changed = true;
          if (impact > 500) {
            this.fx.dust(c.x, c.y, c.w / 80, 6);
            this.sound.play(impact > 1300 ? 'thud' : 'land');
          }
        }
      }
      if (c.y > this.world.height) {
        c.y = this.world.height;
        c.vy = 0;
        c.state = 'rest';
        this.changed = true;
      }
    }
  }

  draw(ctx) {
    for (const c of this.list) drawCrate(ctx, c);
  }

  bounds() {
    if (!this.list.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const c of this.list) {
      x1 = Math.min(x1, c.x - c.w);
      x2 = Math.max(x2, c.x + c.w);
      y1 = Math.min(y1, c.y - c.w * 2.2);
      y2 = Math.max(y2, c.y + 4);
    }
    return { x1, y1, x2, y2 };
  }
}

export function drawCrate(ctx, c) {
  const w = c.w;
  ctx.save();
  ctx.translate(c.x, c.y - w / 2);
  if (c.rot) ctx.rotate(c.rot);
  const h = w / 2;
  // body
  const g = ctx.createLinearGradient(-h, -h, h, h);
  g.addColorStop(0, '#d9a35e');
  g.addColorStop(1, '#b07a3b');
  ctx.fillStyle = g;
  ctx.fillRect(-h, -h, w, w);
  // planks
  ctx.strokeStyle = 'rgba(110, 66, 24, 0.55)';
  ctx.lineWidth = Math.max(1, w * 0.02);
  for (let i = 1; i < 4; i++) {
    const y = -h + (w * i) / 4;
    ctx.beginPath();
    ctx.moveTo(-h, y);
    ctx.lineTo(h, y);
    ctx.stroke();
  }
  // frame + diagonal brace
  const f = w * 0.12;
  ctx.fillStyle = '#8f5a26';
  ctx.fillRect(-h, -h, w, f);
  ctx.fillRect(-h, h - f, w, f);
  ctx.fillRect(-h, -h, f, w);
  ctx.fillRect(h - f, -h, f, w);
  ctx.save();
  ctx.beginPath();
  ctx.rect(-h + f, -h + f, w - 2 * f, w - 2 * f);
  ctx.clip();
  ctx.strokeStyle = '#8f5a26';
  ctx.lineWidth = f * 0.9;
  ctx.beginPath();
  ctx.moveTo(-h, h);
  ctx.lineTo(h, -h);
  ctx.stroke();
  ctx.restore();
  // nails
  ctx.fillStyle = '#5b5b62';
  const n = f / 2;
  for (const [x, y] of [[-h + n, -h + n], [h - n, -h + n], [-h + n, h - n], [h - n, h - n]]) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, w * 0.022), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#4d2f12';
  ctx.lineWidth = Math.max(1.2, w * 0.025);
  ctx.strokeRect(-h, -h, w, w);
  ctx.restore();
}
