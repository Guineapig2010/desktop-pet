// Doe the robot: rolls onto the screen now and then so General Fok can try to make a deal.
// Simple physics (gravity, the bottom of the screen), can be picked up and dropped.

import { RobotCharacter } from '../shared/charRobot.js';
import { BASE_HEIGHT } from './pet.js';
import { clamp, damp, lerp, sign } from '../shared/util.js';

const GRAVITY = 2600;
const S = Math.sin;

export class Robot {
  constructor({ world, settings, fx, sound }) {
    this.world = world;
    this.settings = settings;
    this.fx = fx;
    this.sound = sound;
    this.char = new RobotCharacter();
    this.present = false;
    this.x = -200;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.mode = 'gone';
    this.target = null;
    this.leaving = false;
    this.face = 'normal';
    this.anim = 'idle';
    this.animT = 0;
    this.talk = 0;
    this.speaking = false;
    this.treadPhase = 0;
    this.time = 0;
    this.lean = 0;
    this.arms = { N: [0.25, 0.4], F: [0.15, 0.4] };
    this.drag = { active: false, x: 0, y: 0, ox: 0, oy: 0, hist: [] };
    this.blinkT = 3;
  }

  get H() {
    return BASE_HEIGHT * (this.settings.size || 1) * 0.68;
  }
  get k() {
    return this.H / 100;
  }

  /** Roll in from a side of the screen towards targetX. */
  enter(side, targetX) {
    const W = this.world.width;
    this.present = true;
    this.leaving = false;
    this.mode = 'ground';
    this.x = side < 0 ? -this.H * 0.6 : W + this.H * 0.6;
    this.y = this.world.height;
    this.vx = this.vy = 0;
    this.target = clamp(targetX, this.H * 0.5, W - this.H * 0.5);
    this.face = 'normal';
    this.setAnim('idle');
  }

  /** Teleport in from above (used when there's no room to roll in). */
  drop(x) {
    this.present = true;
    this.leaving = false;
    this.mode = 'air';
    this.x = clamp(x, this.H * 0.5, this.world.width - this.H * 0.5);
    this.y = -this.H * 0.2;
    this.vx = 0;
    this.vy = 0;
    this.target = this.x;
  }

  leave() {
    if (!this.present) return;
    this.leaving = true;
    this.target = this.x < this.world.width / 2 ? -this.H * 1.2 : this.world.width + this.H * 1.2;
    this.face = 'normal';
    this.setAnim('idle');
  }

  goTo(x) {
    this.target = clamp(x, this.H * 0.5, this.world.width - this.H * 0.5);
  }

  arrived() {
    return this.mode === 'ground' && this.target != null && Math.abs(this.x - this.target) < 3;
  }

  setAnim(name) {
    if (name !== this.anim) {
      this.anim = name;
      this.animT = 0;
    }
  }

  lookAt(x) {
    this.facing = sign(x - this.x) || this.facing;
  }

  hitTest(px, py) {
    if (!this.present) return false;
    const u = ((px - this.x) * this.facing) / this.k, v = (py - this.y) / this.k;
    return u > -28 && u < 28 && v > -112 && v < 2;
  }

  headTopWorld() {
    return [this.x, this.y - this.H * 1.1];
  }

  handWorld() {
    const h = this.char.handPos(this.arms.N, true);
    return [this.x + h[0] * this.k * this.facing, this.y + h[1] * this.k];
  }

  startDrag(px, py) {
    this.drag = { active: true, x: px, y: py, ox: px - this.x, oy: py - this.y, hist: [] };
    this.mode = 'held';
    this.face = 'x';
    this.sound.play('pop');
  }
  moveDrag(px, py) {
    this.drag.x = px;
    this.drag.y = py;
  }
  endDrag() {
    this.drag.active = false;
  }

  update(dt) {
    if (!this.present) return;
    this.time += dt;
    this.animT += dt;
    const W = this.world.width;
    const groundY = this.world.height;
    switch (this.mode) {
      case 'ground': {
        this.y = groundY;
        if (this.target != null) {
          const dx = this.target - this.x;
          const sp = 150 * clamp(this.settings.speed ?? 1, 0.3, 3) * Math.sqrt(this.H / 100);
          const step = clamp(dx, -sp * dt, sp * dt);
          this.vx = step / dt;
          if (Math.abs(dx) > 0.5) this.facing = sign(dx);
          this.x += step;
          this.treadPhase += step / (this.k * 6);
          this.lean = lerp(this.lean, clamp(-this.vx * 0.0006, -0.12, 0.12), damp(8, dt));
        }
        if (this.leaving && (this.x < -this.H * 1.1 || this.x > W + this.H * 1.1)) {
          this.present = false;
          this.mode = 'gone';
        }
        break;
      }
      case 'air': {
        this.vy += GRAVITY * dt;
        this.x = clamp(this.x + this.vx * dt, this.H * 0.4, W - this.H * 0.4);
        this.y += this.vy * dt;
        if (this.y >= groundY) {
          const impact = this.vy;
          this.y = groundY;
          this.vy = 0;
          this.vx = 0;
          this.mode = 'ground';
          this.target = this.leaving ? this.target : this.x;
          if (impact > 600) {
            this.fx.dust(this.x, this.y, this.H / 100, 8);
            this.sound.play('thud');
            this.face = 'x';
            setTimeout(() => this.face === 'x' && (this.face = 'normal'), 900);
          }
        }
        break;
      }
      case 'held': {
        const nx = this.drag.x - this.drag.ox, ny = this.drag.y - this.drag.oy;
        this.drag.hist.push({ t: performance.now(), x: nx, y: ny });
        while (this.drag.hist.length && performance.now() - this.drag.hist[0].t > 120) this.drag.hist.shift();
        this.lean = clamp((nx - this.x) * -0.02, -0.5, 0.5);
        this.x = nx;
        this.y = ny;
        this.treadPhase += dt * 20;
        if (!this.drag.active) {
          const h = this.drag.hist;
          if (h.length > 1) {
            const ddt = Math.max((h[h.length - 1].t - h[0].t) / 1000, 0.016);
            this.vx = clamp((h[h.length - 1].x - h[0].x) / ddt, -1500, 1500);
            this.vy = clamp((h[h.length - 1].y - h[0].y) / ddt, -1500, 1500);
          }
          this.mode = 'air';
          this.lean = 0;
        }
        break;
      }
    }
    // arms
    const t = this.animT;
    let N = [0.25 + 0.05 * S(this.time * 2), 0.4], F = [0.15 + 0.05 * S(this.time * 2 + 1), 0.4];
    let bob = 0;
    switch (this.anim) {
      case 'wave':
        N = [2.7, 0.4 + 0.5 * S(t * 12)];
        break;
      case 'shake':
        N = [1.45, 0.15 + 0.25 * S(t * 16)];
        break;
      case 'give':
        N = [1.5, 0.1];
        break;
      case 'compute':
        N = [2.5, 1.9];
        F = [2.4, 1.9];
        bob = 0.6 * S(t * 30);
        break;
      case 'celebrate':
        N = [2.8 + 0.25 * S(t * 12), 0.2];
        F = [2.7 + 0.25 * S(t * 12 + 1.5), 0.2];
        bob = -Math.abs(S(t * 9)) * 4;
        break;
      case 'angry':
        N = [2.3 + 0.3 * S(t * 26), 0.9];
        F = [2.2 + 0.3 * S(t * 26 + 1), 0.9];
        bob = 0.8 * S(t * 50);
        break;
      case 'shrug':
        N = [0.7, 1.6];
        F = [0.6, 1.6];
        break;
      case 'point':
        N = [1.7, 0.05];
        break;
    }
    if (this.mode === 'held' || this.mode === 'air') {
      N = [2.5 + 0.4 * S(this.time * 14), 0.3];
      F = [2.3 + 0.4 * S(this.time * 14 + 2), 0.3];
    }
    const r = damp(14, dt);
    for (const [k, v] of [['N', N], ['F', F]]) {
      this.arms[k][0] = lerp(this.arms[k][0], v[0], r);
      this.arms[k][1] = lerp(this.arms[k][1], v[1], r);
    }
    this.bob = bob;
    this.talk = this.speaking ? 0.4 + 0.6 * Math.abs(S(this.time * 17)) : lerp(this.talk, 0, damp(10, dt));
    // occasional screen blink
    this.blinkT -= dt;
    if (this.blinkT < 0 && this.face === 'normal') {
      this.face = 'blink';
      setTimeout(() => this.face === 'blink' && (this.face = 'normal'), 110);
      this.blinkT = 2 + Math.random() * 4;
    }
  }

  draw(ctx) {
    if (!this.present) return;
    const k = this.k;
    if (this.mode !== 'held') {
      const h = Math.max(0, this.world.height - this.y);
      const s = clamp(1 - h / (this.H * 3), 0.3, 1);
      ctx.fillStyle = `rgba(0,0,0,${0.2 * s})`;
      ctx.beginPath();
      ctx.ellipse(this.x, this.world.height - 1, this.H * 0.26 * s, this.H * 0.04 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(this.facing * k, k);
    this.char.draw(ctx, { face: this.face, talk: this.talk, treadPhase: this.treadPhase, armN: this.arms.N, armF: this.arms.F, lean: this.lean, time: this.time, bob: this.bob, flip: this.facing });
    ctx.restore();
  }

  bounds() {
    const r = this.H * 0.9;
    return { x1: this.x - r, y1: this.y - this.H * 1.3, x2: this.x + r, y2: this.y + this.H * 0.2 };
  }
}
