// The pet: physics (gravity, landings, window ledges, climbing), a small action system for
// behaviours, the cursor chase/grab gag, being dragged and thrown, and pose animation.

import { animate } from '../shared/animations.js';
import { basePose, clonePose, blendPose, fk, rot as rotPt } from '../shared/rig.js';
import { clamp, lerp, rand, randInt, chance, pick, damp, dist, sign } from '../shared/util.js';
import { drawVein, drawDizzy, drawTrapped } from './effects.js';

export const BASE_HEIGHT = 150; // px at size 1.0
const GRAVITY = 2600;

// ─────────────────────────────────────────────────────────────────────────────
// Actions. Each returns true from update() when finished.
// ─────────────────────────────────────────────────────────────────────────────
class Action {
  constructor(opts = {}) {
    Object.assign(this, opts);
    this.t = 0;
  }
  start() {}
  update() {
    return true;
  }
  anim() {
    return { name: 'idle' };
  }
  end() {}
  get interruptible() {
    return true;
  }
}

class Idle extends Action {
  start(p) {
    this.dur ??= rand(1.5, 4);
    this.variant ??= pick(['idle', 'idle', 'idle', 'idleRelax', 'lookAround']);
  }
  update(p, dt) {
    p.vx = 0;
    return this.t >= this.dur;
  }
  anim(p) {
    return { name: this.variant };
  }
}

class Walk extends Action {
  start(p) {
    this.run ??= false;
    this.strut ??= false;
  }
  update(p, dt) {
    if (p.mode !== 'ground') return p.mode === 'air' ? false : true;
    const plat = p.platform;
    const margin = p.H * 0.18;
    const tx = plat ? clamp(this.x, plat.x1 + margin, plat.x2 - margin) : this.x;
    const dx = tx - p.x;
    if (Math.abs(dx) < 4 || this.t > 25) {
      p.vx = 0;
      return true;
    }
    p.facing = sign(dx);
    const sp = (this.run ? p.runSpeed : p.walkSpeed) * (this.mult || 1);
    p.vx = p.facing * Math.min(sp, Math.abs(dx) / dt);
    return false;
  }
  anim(p) {
    return { name: this.run ? 'run' : this.strut ? 'strut' : 'walk' };
  }
}

class Jump extends Action {
  // Jump to (x, y) — y is the platform height to land on.
  start(p) {
    this.phase = 'prep';
    this.prep = this.quick ? 0.06 : 0.16;
  }
  update(p, dt) {
    if (this.phase === 'prep') {
      p.vx = 0;
      if (p.mode !== 'ground') return true;
      if (this.t >= this.prep) {
        p.launchTo(this.x, this.y, this.arc);
        p.sound('jump');
        this.phase = 'air';
      }
      return false;
    }
    return p.mode === 'ground' && this.t > this.prep + 0.05;
  }
  anim(p) {
    if (this.phase === 'prep') return { name: 'jumpPrep' };
    return { name: p.vy < 250 ? 'rise' : 'fall' };
  }
}

class Climb extends Action {
  start(p) {
    this.phase = 'approach';
  }
  sideX(p, win) {
    return this.side === 'L' ? win.x - p.H * 0.1 : win.x + win.w + p.H * 0.1;
  }
  update(p, dt) {
    const win = p.world.windowById(this.winId);
    if (!win) {
      if (p.mode === 'climb') p.fallOff('windowGone');
      return true;
    }
    if (this.phase === 'approach') {
      if (p.mode !== 'ground') return false;
      const sx = clamp(this.sideX(p, win), p.H * 0.25, p.world.width - p.H * 0.25);
      const dx = sx - p.x;
      if (Math.abs(dx) > 6) {
        p.facing = sign(dx);
        p.vx = p.facing * Math.min(p.walkSpeed * 1.4, Math.abs(dx) / dt);
        if (this.t > 20) return true;
        return false;
      }
      p.vx = 0;
      if (win.y + win.h < p.y - p.H * 0.9) return true; // window floats too high above us
      this.phase = 'climb';
      p.mode = 'climb';
      p.platform = null;
      p.facing = this.side === 'L' ? 1 : -1;
      p.climbWin = win.id;
      return false;
    }
    if (this.phase === 'climb') {
      if (p.mode !== 'climb') return true; // knocked off
      p.x = this.sideX(p, win);
      p.y -= p.climbSpeed * dt;
      p.climbPhase += (p.climbSpeed * dt) / (p.H * 0.18);
      if (p.y <= win.y + 2) {
        // mount the ledge
        const mx = this.side === 'L' ? win.x + p.H * 0.3 : win.x + win.w - p.H * 0.3;
        const plat = p.world.platformAt(mx, win.y, 2);
        if (plat && plat.winId === win.id) {
          p.x = mx;
          p.y = win.y;
          p.mode = 'ground';
          p.platform = plat;
          p.vy = 0;
          p.climbWin = null;
          p.landT = 0.2;
          p.landImpact = 0.5;
          p.sound('land');
          // made it! enjoy the view for a moment
          p.queueFront(new Idle({ dur: rand(2.5, 4.5), variant: 'lookAround' }));
        } else {
          p.fallOff();
        }
        return true;
      }
      return false;
    }
    return true;
  }
  anim(p) {
    return this.phase === 'climb' ? { name: 'climb', ctx: { phase: p.climbPhase } } : { name: 'walk' };
  }
}

class Sit extends Action {
  start(p) {
    this.dur ??= rand(6, 16);
    this.lapel = chance(0.5);
  }
  update(p, dt) {
    p.vx = 0;
    p.sitting = true;
    return this.t >= this.dur || p.mode !== 'ground';
  }
  end(p) {
    p.sitting = false;
  }
  anim(p) {
    return { name: this.lapel ? 'sitLapel' : 'sit', ctx: { floor: p.platform?.kind === 'ground' } };
  }
}

class Sleep extends Action {
  start(p) {
    this.z = 0;
  }
  update(p, dt) {
    p.vx = 0;
    p.sitting = true;
    this.z += dt;
    if (this.z > 1.1) {
      this.z = 0;
      const h = p.headWorld();
      p.fx.zzz(h[0] + p.facing * p.H * 0.12, h[1] - p.H * 0.1, p.H / 150);
    }
    return p.mode !== 'ground' || p.idleCursorTime < 2;
  }
  end(p) {
    p.sitting = false;
    if (p.mode === 'ground' && p.idleCursorTime < 2) p.say('wake');
  }
  anim(p) {
    return { name: 'sleep', ctx: { floor: p.platform?.kind === 'ground' } };
  }
}

class Emote extends Action {
  start(p) {
    this.dur ??= 1.5;
    this.hopT = 0;
    if (this.sayKey) p.say(this.sayKey);
    if (this.sfx) p.sound(this.sfx);
  }
  update(p, dt) {
    p.vx = 0;
    if (this.hop && p.mode === 'ground') {
      this.hopT -= dt;
      if (this.hopT <= 0) {
        this.hopT = rand(0.35, 0.55);
        p.vy = -Math.sqrt(2 * GRAVITY * p.H * 0.22);
        p.mode = 'air';
        p.platform = null;
        p.quietLanding = true;
      }
    }
    if (this.name === 'angry' || this.name === 'tantrum') p.anger = Math.max(p.anger, 0.8);
    if (this.name === 'knock' && Math.floor(this.t * 4.15) !== Math.floor((this.t - dt) * 4.15)) {
      p.sound('knock');
      const h = p.handWorld('N');
      p.fx.knockLines(h[0], h[1], p.H / 150);
    }
    return this.t >= this.dur && (p.mode === 'ground' || !this.hop);
  }
  anim(p) {
    return { name: this.name, ctx: { floor: p.platform?.kind === 'ground' } };
  }
}

class Converse extends Action {
  update(p, dt) {
    p.vx = 0;
    if (p.convHop && p.mode === 'ground') {
      p.convHopT = (p.convHopT || 0) - dt;
      if (p.convHopT <= 0) {
        p.convHopT = rand(0.35, 0.6);
        p.vy = -Math.sqrt(2 * GRAVITY * p.H * 0.2);
        p.mode = 'air';
        p.platform = null;
        p.quietLanding = true;
      }
    }
    return !p.conversing;
  }
  anim(p) {
    return { name: p.convAnim || 'talk', ctx: { floor: p.platform?.kind === 'ground', ...(p.convCtx || {}) } };
  }
}

class Fall extends Action {
  update(p) {
    return p.mode === 'ground';
  }
  anim(p) {
    return { name: 'fall' };
  }
}

// ── Being dragged around by the user ────────────────────────────────────────
class Held extends Action {
  get interruptible() {
    return false;
  }
  start(p) {
    p.mode = 'held';
    p.platform = null;
    p.vx = p.vy = 0;
    p.swing = 0;
    p.swingV = 0;
    this.hist = [];
    p.say('pickedUp');
    p.sound('pop');
  }
  update(p, dt) {
    const tx = p.drag.x - p.drag.ox, ty = p.drag.y - p.drag.oy;
    const vx = (tx - p.x) / Math.max(dt, 1e-3);
    p.x = tx;
    p.y = ty;
    this.hist.push({ t: performance.now(), x: p.drag.x, y: p.drag.y });
    while (this.hist.length && performance.now() - this.hist[0].t > 120) this.hist.shift();
    // pendulum: the body lags behind horizontal motion
    const target = clamp(-vx * 0.0011, -0.9, 0.9);
    p.swingV += ((target - p.swing) * 60 - p.swingV * 7) * dt;
    p.swing += p.swingV * dt;
    if (!p.drag.active) {
      // released: throw with the recent mouse velocity
      let tvx = 0, tvy = 0;
      if (this.hist.length >= 2) {
        const a = this.hist[0], b = this.hist[this.hist.length - 1];
        const ddt = Math.max((b.t - a.t) / 1000, 0.016);
        tvx = (b.x - a.x) / ddt;
        tvy = (b.y - a.y) / ddt;
      }
      p.mode = 'air';
      p.vx = clamp(tvx, -2200, 2200);
      p.vy = clamp(tvy, -2200, 2200);
      p.thrown = Math.hypot(p.vx, p.vy) > 1100;
      if (p.thrown) p.say('thrown');
      p.swing = 0;
      return true;
    }
    return false;
  }
  anim(p) {
    return { name: 'held', ctx: { swing: p.swing, pivot: p.drag.pivot } };
  }
}

// ── The cursor chase ───────────────────────────────────────────────────────
class Chase extends Action {
  get interruptible() {
    return this.phase !== 'hold' && this.phase !== 'hang';
  }
  start(p) {
    this.phase = 'notice';
    this.pt = 0;
    this.attempts = 0;
    this.maxAttempts = randInt(3, 5);
    this.limit = rand(11, 16);
    p.facing = sign(p.cursor.x - p.x);
    const h = p.headWorld();
    p.fx.mark(h[0], h[1] - p.H * 0.18, p.H / 150, '!');
    p.sound('notice');
  }
  setPhase(ph) {
    this.phase = ph;
    this.pt = 0;
  }
  update(p, dt) {
    this.pt += dt;
    const c = p.cursor;
    const reachUp = p.H * 1.12; // fingertips when arms are raised
    switch (this.phase) {
      case 'notice':
        p.vx = 0;
        p.facing = sign(c.x - p.x) || p.facing;
        if (this.pt > 0.65) {
          p.say('chaseStart');
          this.setPhase('pursue');
        }
        return false;

      case 'pursue': {
        if (this.t > this.limit) return this.giveUp(p);
        if (p.mode === 'air') return false;
        if (p.mode !== 'ground') return true;
        const dx = c.x - p.x;
        const plat = p.platform;
        const groundReach = Math.abs(dx) < p.H * 0.38 && c.y < p.y - p.H * 0.2 && c.y > p.y - p.H * 1.15;
        if (groundReach) {
          this.setPhase('hold');
          this.grabKind = 'ground';
          this.holdDur = rand(3, 4.5);
          p.catchCursor();
          return false;
        }
        // cursor below our ledge, or past its end: hop off towards it
        if (plat && plat.kind === 'window' && (c.y > p.y + p.H * 0.3 || c.x < plat.x1 || c.x > plat.x2)) {
          if (Math.abs(dx) < p.H * 0.4 || c.x < plat.x1 || c.x > plat.x2) {
            p.facing = sign(dx);
            p.launchTo(clamp(c.x, p.H * 0.3, p.world.width - p.H * 0.3), p.world.height, p.H * 0.3, true);
            p.sound('jump');
            return false;
          }
        }
        if (Math.abs(dx) < p.H * 0.55 && c.y < p.y - p.H * 0.9) {
          // leap at it!
          this.setPhase('leap');
          const want = p.y - (c.y + reachUp * 0.92);
          const maxH = p.H * 3.6;
          const h = clamp(want, p.H * 0.35, maxH);
          p.vy = -Math.sqrt(2 * GRAVITY * h);
          const tAir = (2 * Math.abs(p.vy)) / GRAVITY;
          p.vx = clamp((c.x - p.x) / (tAir * 0.5), -700, 700);
          p.mode = 'air';
          p.platform = null;
          p.sound('jump');
          this.leapPeak = false;
          return false;
        }
        p.facing = sign(dx);
        const margin = p.H * 0.18;
        if (plat && ((p.x <= plat.x1 + margin + 2 && dx < 0) || (p.x >= plat.x2 - margin - 2 && dx > 0)) && plat.kind === 'ground') {
          p.vx = 0;
          return false;
        }
        p.vx = p.facing * Math.min(p.runSpeed * 1.15, Math.abs(dx) / dt);
        if (plat && plat.kind === 'window') {
          // let him run off the edge if the cursor is beyond it
          const nx = p.x + p.vx * dt;
          if (nx < plat.x1 + margin || nx > plat.x2 - margin) {
            p.launchTo(clamp(c.x, p.H * 0.3, p.world.width - p.H * 0.3), p.world.height, p.H * 0.25, true);
            return false;
          }
        }
        return false;
      }

      case 'leap': {
        const hands = p.handsWorld();
        p.facing = sign(c.x - p.x) || p.facing;
        if (dist(hands[0], hands[1], c.x, c.y) < p.H * 0.3) {
          this.setPhase('hang');
          this.holdDur = rand(2.6, 4);
          p.startHang();
          return false;
        }
        if (p.mode === 'ground' && this.pt > 0.1) return this.miss(p);
        return false;
      }

      case 'hang': {
        if (p.mode !== 'hang') return this.finish(p, false);
        if (this.pt > 0.9 && !this.celebrated) {
          this.celebrated = true;
          p.say('celebrate');
        }
        const shake = Math.hypot(c.vx, c.vy);
        if (shake > 3600 && this.pt > 0.4) {
          p.releaseHang(true);
          p.say('thrown');
          return this.finish(p, false);
        }
        if (this.pt > this.holdDur || p.forceRelease) {
          p.say(p.forceRelease === 'escape' ? 'restraintEscape' : 'release');
          p.releaseHang(false);
          return this.finish(p, true);
        }
        return false;
      }

      case 'hold': {
        // ground grab: hands clamp around the cursor
        const reach = p.H * 0.62;
        const sh = p.shoulderWorld();
        const d = dist(sh[0], sh[1], c.x, c.y);
        if (d > reach * 1.35 || c.y > p.y - p.H * 0.1) {
          p.endCatch();
          p.say('slipped');
          this.attempts--; // a slip isn't his fault
          return this.miss(p);
        }
        // shuffle along to keep up with a slowly moving cursor
        const dx = c.x - p.x;
        if (Math.abs(dx) > p.H * 0.32 && p.mode === 'ground') {
          p.facing = sign(dx);
          p.vx = p.facing * p.walkSpeed * 1.3;
        } else p.vx = 0;
        if (this.pt > 0.8 && !this.celebrated) {
          this.celebrated = true;
          p.say('celebrate');
          p.sound('celebrate');
          p.fx.sparkle(c.x, c.y, p.H / 150, 8);
        }
        if (this.pt > this.holdDur || p.forceRelease) {
          p.say(p.forceRelease === 'escape' ? 'restraintEscape' : 'release');
          p.endCatch();
          return this.finish(p, true);
        }
        return false;
      }

      case 'frustrated':
        p.vx = 0;
        if (this.pt > 1.0) this.setPhase('pursue');
        return false;

      case 'giveup':
        p.vx = 0;
        return this.pt > 2.0;
    }
    return true;
  }
  miss(p) {
    this.attempts++;
    p.anger = clamp(p.anger + 0.25, 0, 1);
    if (this.attempts >= this.maxAttempts || this.t > this.limit) return this.giveUp(p);
    p.say('chaseMiss');
    p.sound('grumble');
    this.setPhase('frustrated');
    return false;
  }
  giveUp(p) {
    p.say('chaseGiveUp');
    p.sound('grumble');
    p.anger = 1;
    this.setPhase('giveup');
    this.gaveUp = true;
    return false;
  }
  finish(p, success) {
    p.forceRelease = null;
    if (success) {
      p.queueFront(new Emote({ name: 'laugh', dur: 1.2 }));
    }
    return true;
  }
  end(p) {
    p.endCatch();
    p.onChaseEnded(this);
  }
  anim(p) {
    const c = p.cursor;
    switch (this.phase) {
      case 'notice':
        return { name: 'notice' };
      case 'pursue':
        return p.mode === 'air' ? { name: p.vy < 0 ? 'rise' : 'fall' } : { name: 'run', ctx: { phase: p.stepPhase } };
      case 'leap':
        return p.mode === 'air' ? { name: 'reachUp', ctx: { target: p.toLocal(c.x, c.y), skel: p.character.skel } } : { name: 'land' };
      case 'hold':
        return { name: this.celebrated ? 'holdCelebrate' : 'grab', ctx: { target: p.toLocal(c.x, c.y), skel: p.character.skel } };
      case 'hang':
        return { name: 'hang', ctx: { swing: p.swing, pivot: p.hangPivot } };
      case 'frustrated':
        return { name: 'frustrated' };
      case 'giveup':
        return { name: 'tantrum' };
    }
    return { name: 'idle' };
  }
}

// ── Helper mode: jetpack flight to a target on screen ──────────────────────
// Phases: equip → fly (to a hover point BESIDE the target) → hover (main verifies the target)
// → reach (hand moves onto the target; main clicks at the moment of touch) → press → hold
// → (next target… or) return → land.
class Fly extends Action {
  get interruptible() {
    return false;
  }
  start(p) {
    this.phase = 'equip';
    this.pt = 0;
    p.mode = 'fly';
    p.platform = null;
    p.vx = p.vy = 0;
    p.jetpackOn = true;
    p.sound('whoosh');
  }
  setPhase(ph) {
    this.phase = ph;
    this.pt = 0;
  }
  /** New target (overlay-local px). purpose: click | point | scroll | type | hover */
  retarget(t) {
    Object.assign(this, t);
    const p = this.pet;
    const H = p.H, W = p.world.width;
    // stay BESIDE the target so we never cover it: pick the side with room / the side we're on
    let side = p.x <= t.x ? -1 : 1;
    if (t.x + H * 0.75 > W) side = -1;
    if (t.x - H * 0.75 < 0) side = 1;
    this.side = side;
    const k = p.k;
    this.hx = t.x + side * 40 * k;
    this.hy = clamp(t.y + 70 * k, H * 1.02, p.world.height);
    if (this.phase !== 'equip') this.setPhase('fly');
  }
  update(p, dt) {
    this.pet = p;
    this.pt += dt;
    const H = p.H;
    p.thrust = lerp(p.thrust || 0, this.phase === 'fly' || this.phase === 'return' ? 1 : this.phase === 'equip' ? 0.3 : 0.55, damp(6, dt));
    switch (this.phase) {
      case 'equip':
        p.jetpack = Math.min(1, this.pt / 0.35);
        if (this.pt > 0.45) this.setPhase(this.hx != null ? 'fly' : 'hold');
        return false;
      case 'fly':
      case 'return': {
        const tx = this.phase === 'return' ? this.landX : this.hx;
        const ty = this.phase === 'return' ? this.landY - 2 : this.hy;
        const dx = tx - p.x, dy = ty - p.y;
        const d = Math.hypot(dx, dy);
        const maxV = 1150 * clamp(p.speedMul, 0.5, 2);
        // arrive steering: slow down near the goal (brake)
        const want = Math.min(maxV, d * 4.2);
        const dvx = (d > 0.01 ? (dx / d) * want : 0) - p.vx, dvy = (d > 0.01 ? (dy / d) * want : 0) - p.vy;
        const acc = 3400;
        const dl = Math.hypot(dvx, dvy);
        const s = dl > acc * dt ? (acc * dt) / dl : 1;
        p.vx += dvx * s;
        p.vy += dvy * s;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.facing = Math.abs(p.vx) > 40 ? sign(p.vx) : p.facing;
        if (Math.random() < dt * 30) {
          const n = p.nozzleWorld();
          p.fx.smoke(n[0], n[1], H / 150);
        }
        if (d < 3 && Math.hypot(p.vx, p.vy) < 60) {
          p.vx = p.vy = 0;
          if (this.phase === 'return') {
            p.y = this.landY;
            p.mode = 'air';
            p.vy = 10;
            p.jetpackOff = true;
            return true;
          }
          p.facing = -this.side;
          this.setPhase('hover');
          p.host.event?.('helperHovering', { id: this.id });
        }
        return false;
      }
      case 'hover':
      case 'hold':
        p.x = lerp(p.x, this.hx ?? p.x, damp(6, dt));
        p.y = lerp(p.y, this.hy ?? p.y, damp(6, dt));
        if (this.hx != null) p.facing = -this.side;
        return false;
      case 'reach': {
        const dur = 0.32;
        this.reachK = Math.min(1, this.pt / dur);
        if (this.pt >= dur && !this.touched) {
          this.touched = true;
          p.host.event?.('helperTouch', { id: this.id });
        }
        return false;
      }
      case 'press':
        if (this.pt > 0.35) this.setPhase(this.purpose === 'point' ? 'pointing' : 'hold');
        return false;
      case 'pointing':
        return false;
    }
    return false;
  }
  reach(id) {
    if (id !== this.id) return;
    this.touched = false;
    this.setPhase('reach');
  }
  pressed() {
    this.setPhase('press');
  }
  finish() {
    const p = this.pet;
    const below = p.world.findLanding(p.x, p.y, p.world.height + 1) || p.world.ground;
    this.landX = clamp(p.x, p.H * 0.4, p.world.width - p.H * 0.4);
    this.landY = below.y;
    this.setPhase('return');
  }
  anim(p) {
    const tgt = this.x != null ? p.toLocal(this.x, this.y) : null;
    switch (this.phase) {
      case 'fly':
      case 'return':
      case 'equip':
        return { name: 'fly', ctx: { swing: clamp(Math.abs(p.vx) * 0.00035, 0, 0.38) - clamp(p.vy * 0.0001, -0.1, 0.1) } };
      case 'reach': {
        // move the hand smoothly from the chest to the target
        const k = this.reachK || 0;
        const start = [20, -60];
        const tt = tgt ? [start[0] + (tgt[0] - start[0]) * k, start[1] + (tgt[1] - start[1]) * k] : null;
        return { name: this.purpose === 'scroll' ? 'scrolling' : 'reach', ctx: { target: tt, skel: p.character.skel } };
      }
      case 'press':
        return { name: 'reach', ctx: { target: tgt && [tgt[0] + 1.5, tgt[1] + 1.5], skel: p.character.skel, press: true } };
      case 'pointing':
        return { name: 'point', ctx: { target: tgt, skel: p.character.skel } };
      case 'hold':
        if (this.typing) return { name: 'typing' };
        return { name: tgt && this.purpose !== 'type' ? 'reach' : 'hover', ctx: { target: tgt, skel: p.character.skel } };
      default:
        return { name: 'hover' };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export class Pet {
  constructor({ world, character, settings, fx, host }) {
    this.world = world;
    this.character = character;
    this.settings = settings;
    this.fx = fx;
    this.host = host; // { say(key|{text}), sound(name), restraint(on, x, y), event(name, data) }
    this.x = world.width * rand(0.3, 0.7);
    this.y = world.height - 200;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.mode = 'air';
    this.platform = null;
    this.action = null;
    this.queue = [];
    this.pose = basePose();
    this.animName = 'fall';
    this.animT = 0;
    this.time = 0;
    this.stepPhase = 0;
    this.climbPhase = 0;
    this.landT = 0;
    this.landImpact = 0;
    this.anger = 0;
    this.blinkT = rand(2, 5);
    this.cursor = { x: -9999, y: -9999, vx: 0, vy: 0, t: 0 };
    this.idleCursorTime = 0;
    this.hoverTime = 0;
    this.chaseCooldown = rand(12, 20);
    this.cooldowns = {};
    this.drag = { active: false, x: 0, y: 0, ox: 0, oy: 0, pivot: [0, -78] };
    this.swing = 0;
    this.swingV = 0;
    this.conversing = false;
    this.convAnim = 'talk';
    this.speaking = false;
    this.holdingCursor = false;
    this.forceRelease = null;
    this.J = fk(this.pose, character.skel);
  }

  // ── derived quantities ────────────────────────────────────────────────────
  get H() {
    return BASE_HEIGHT * (this.settings.size || 1);
  }
  get k() {
    return this.H / 100;
  }
  get speedMul() {
    return clamp(this.settings.speed ?? 1, 0.2, 3);
  }
  get walkSpeed() {
    return 75 * this.speedMul * Math.sqrt(this.H / BASE_HEIGHT);
  }
  get runSpeed() {
    return 330 * this.speedMul * Math.sqrt(this.H / BASE_HEIGHT);
  }
  get climbSpeed() {
    return 85 * this.speedMul;
  }
  get busy() {
    return this.action && !(this.action instanceof Idle) && !(this.action instanceof Sit) && !(this.action instanceof Walk);
  }

  setCharacter(ch) {
    this.character = ch;
    this.J = fk(this.pose, ch.skel);
  }

  // ── host helpers ──────────────────────────────────────────────────────────
  say(key, opts) {
    this.host.say?.(key, opts);
  }
  sound(name) {
    this.host.sound?.(name);
  }
  cool(name, secs) {
    const now = this.time;
    if ((this.cooldowns[name] || -1e9) > now) return false;
    this.cooldowns[name] = now + secs;
    return true;
  }

  // ── geometry helpers ──────────────────────────────────────────────────────
  toLocal(wx, wy) {
    return [((wx - this.x) * this.facing) / this.k, (wy - this.y) / this.k];
  }
  toWorld(u, v) {
    let p = [u * this.pose.sx, v * this.pose.sy];
    if (this.pose.rot) {
      const pv = this.pose.pivot;
      const r = rotPt([p[0] - pv[0], p[1] - pv[1]], this.pose.rot);
      p = [r[0] + pv[0], r[1] + pv[1]];
    }
    return [this.x + this.facing * p[0] * this.k, this.y + p[1] * this.k];
  }
  headWorld() {
    return this.toWorld(this.J.head[0], this.J.head[1]);
  }
  headTopWorld() {
    return this.toWorld(this.J.head[0], this.J.head[1] - 14);
  }
  handWorld(s) {
    return this.toWorld(this.J.arms[s].hand[0], this.J.arms[s].hand[1]);
  }
  handsWorld() {
    const a = this.handWorld('N'), b = this.handWorld('F');
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
  shoulderWorld() {
    return this.toWorld(this.J.arms.N.shoulder[0], this.J.arms.N.shoulder[1]);
  }

  /** Is the overlay point (px, py) on the pet's body? */
  hitTest(px, py) {
    let [u, v] = this.toLocal(px, py);
    u /= this.pose.sx || 1;
    v /= this.pose.sy || 1;
    if (this.pose.rot) {
      const pv = this.pose.pivot;
      const r = rotPt([u - pv[0], v - pv[1]], -this.pose.rot);
      u = r[0] + pv[0];
      v = r[1] + pv[1];
    }
    const top = Math.min(this.J.head[1] - 18, -60);
    const bottom = Math.max(this.J.legs.N.ankle[1], this.J.legs.F.ankle[1]) + 6;
    return u > -24 && u < 26 && v > top && v < bottom;
  }

  /** Approximate screen-space bounding box (for dirty-rect clearing). */
  bounds() {
    const r = this.H * 1.3;
    return { x1: this.x - r, y1: this.y - this.H * 1.6, x2: this.x + r, y2: this.y + this.H * 1.3 };
  }

  // ── physics helpers ──────────────────────────────────────────────────────
  launchTo(tx, ty, arc, quick) {
    const apexY = Math.min(this.y, ty) - Math.max(arc ?? this.H * 0.35, 20);
    const vy0 = -Math.sqrt(2 * GRAVITY * Math.max(1, this.y - apexY));
    const tUp = -vy0 / GRAVITY;
    const tDown = Math.sqrt((2 * Math.max(1, ty - apexY)) / GRAVITY);
    this.vx = clamp((tx - this.x) / (tUp + tDown), -1100, 1100);
    this.vy = vy0;
    this.mode = 'air';
    this.platform = null;
    this.facing = sign(tx - this.x) || this.facing;
  }

  fallOff(reason) {
    this.mode = 'air';
    this.platform = null;
    this.climbWin = null;
    if (reason && this.cool('fallLine', 4)) this.say(reason);
  }

  land(plat) {
    const impact = this.vy;
    this.y = plat.y;
    this.vy = 0;
    this.vx = 0;
    this.mode = 'ground';
    this.platform = plat;
    if (this.quietLanding) {
      this.quietLanding = false;
      this.landT = 0.12;
      this.landImpact = 0.4;
      return;
    }
    this.landImpact = clamp(impact / 1400, 0.3, 1.4);
    this.landT = 0.28;
    if (impact > 500) {
      this.fx.dust(this.x, this.y, this.H / 150, impact > 1200 ? 14 : 8);
      this.sound(impact > 1300 ? 'thud' : 'land');
    }
    if (this.thrown) {
      this.thrown = false;
      if (impact > 1500 || Math.random() < 0.5) {
        this.clearQueue();
        this.setAction(new Emote({ name: 'dizzy', dur: 2.6, sayKey: 'dizzy' }));
      }
    }
  }

  // ── cursor catching ──────────────────────────────────────────────────────
  catchCursor() {
    this.holdingCursor = true;
    this.say('caught');
    this.sound('grab');
    this.host.restraint?.(true, this.cursor.x, this.cursor.y);
  }
  endCatch() {
    if (this.holdingCursor || this.mode === 'hang') this.host.restraint?.(false);
    this.holdingCursor = false;
  }
  startHang() {
    this.mode = 'hang';
    this.platform = null;
    this.vx = this.vy = 0;
    this.swing = clamp(this.vx * 0.001, -0.5, 0.5);
    this.swingV = 0;
    this.hangPivot = [0, -103];
    this.holdingCursor = true;
    this.say('caught');
    this.sound('grab');
    this.host.restraint?.(true, this.cursor.x, this.cursor.y);
  }
  releaseHang(flung) {
    this.endCatch();
    // feet position follows from the swing angle
    const L = 103 * this.k;
    this.x = this.cursor.x - Math.sin(this.swing) * L * this.facing * -1;
    this.y = this.cursor.y + Math.cos(this.swing) * L;
    this.mode = 'air';
    this.vx = flung ? clamp(this.cursor.vx * 0.6, -1600, 1600) : this.swingV * L * 0.4;
    this.vy = flung ? clamp(this.cursor.vy * 0.6, -1600, 600) : -120;
    this.thrown = flung;
    this.swing = 0;
  }
  onRestraintEnded(reason) {
    if (this.holdingCursor && reason === 'escape') this.forceRelease = 'escape';
  }

  // ── action management ────────────────────────────────────────────────────
  setAction(a) {
    if (this.action) this.action.end(this);
    this.action = a;
    if (a) {
      a.t = 0;
      a.start(this);
    }
  }
  clearQueue() {
    this.queue.length = 0;
  }
  queueFront(a) {
    this.queue.unshift(a);
  }
  interrupt(a) {
    this.clearQueue();
    this.setAction(a);
  }

  onChaseEnded(chase) {
    const f = clamp(this.settings.chaseFrequency ?? 0.5, 0, 1);
    this.chaseCooldown = lerp(150, 15, f) * rand(0.8, 1.2) + (chase.gaveUp ? 10 : 0);
    this.host.event?.('chaseEnded', { caught: !chase.gaveUp });
  }

  startChase() {
    if (this.mode !== 'ground' || this.conversing) return false;
    this.interrupt(new Chase());
    return true;
  }

  startDrag(px, py) {
    if (this.action instanceof Fly) return;
    const [u, v] = this.toLocal(px, py);
    this.drag = { active: true, x: px, y: py, ox: px - this.x, oy: py - this.y, pivot: [u, v] };
    this.endCatch();
    this.interrupt(new Held());
    this.host.event?.('pickedUp');
  }
  moveDrag(px, py) {
    this.drag.x = px;
    this.drag.y = py;
  }
  endDrag() {
    this.drag.active = false;
  }

  beginConverse() {
    if (!this.canConverse()) return false;
    this.conversing = true;
    this.interrupt(new Converse());
    return true;
  }
  endConverse() {
    this.conversing = false;
    this.convHop = false;
  }
  canConverse() {
    if (this.mode !== 'ground') return false;
    if (this.action && !this.action.interruptible) return false;
    if (this.action instanceof Chase || this.action instanceof Held || this.action instanceof Climb || this.action instanceof Fly) return false;
    return true;
  }

  emote(name, dur, opts = {}) {
    if (this.action && !this.action.interruptible) return;
    this.interrupt(new Emote({ name, dur, ...opts }));
  }

  summon(x) {
    this.endCatch();
    this.interrupt(null);
    this.x = clamp(x ?? this.world.width / 2, this.H * 0.3, this.world.width - this.H * 0.3);
    this.y = this.H * 0.4;
    this.mode = 'air';
    this.platform = null;
    this.vx = 0;
    this.vy = 0;
    this.say('greet');
  }

  // ── helper mode (jetpack) ────────────────────────────────────────────────
  helperFly(t) {
    let f = this.action instanceof Fly ? this.action : null;
    if (!f) {
      this.endCatch();
      this.conversing = false;
      f = new Fly();
      f.pet = this;
      this.interrupt(f);
    }
    f.pet = this;
    f.retarget(t);
    return f;
  }
  helperReach(id) {
    if (this.action instanceof Fly) this.action.reach(id);
  }
  helperPressed() {
    if (this.action instanceof Fly) this.action.pressed();
  }
  helperTyping(on) {
    if (this.action instanceof Fly) this.action.typing = on;
  }
  helperFinish() {
    if (this.action instanceof Fly) {
      this.action.pet = this;
      this.action.finish();
    }
  }
  get flying() {
    return this.action instanceof Fly;
  }
  nozzleWorld() {
    const J = this.J;
    const sk = this.character.skel;
    const back = Math.min(sk.torso.shoulders.F[0], sk.torso.shoulders.N[0]) - 6;
    const [u, v] = rotPt([back, -8], J.lean);
    return this.toWorld(J.hip[0] + u, J.hip[1] + v);
  }

  // ── brain: pick what to do next ──────────────────────────────────────────
  think() {
    const W = this.world.width;
    const H = this.H;
    if (this.settings.paused || this.helperActive) {
      this.queue.push(chance(0.5) ? new Idle({ dur: rand(3, 6) }) : new Sit({ dur: rand(6, 10) }));
      return;
    }
    if (this.idleCursorTime > 150 && this.mode === 'ground') {
      this.queue.push(new Sleep());
      return;
    }
    const plat = this.platform;
    const onLedge = plat && plat.kind === 'window';
    const ledges = this.world
      .ledges()
      .filter((l) => l !== plat && l.x2 - l.x1 >= H * 0.6 && l.y > H * 1.15 && l.y < this.world.height - H * 0.4);
    const maxJump = H * 2.6;
    const opts = [];
    const add = (w, fn) => opts.push([w, fn]);

    add(3, () => this.queue.push(new Idle()));
    add(3, () => {
      const span = plat ? [plat.x1 + H * 0.25, plat.x2 - H * 0.25] : [H, W - H];
      this.queue.push(new Walk({ x: rand(span[0], span[1]), strut: chance(0.3) }));
    });
    if (!onLedge) add(1.1, () => this.queue.push(new Walk({ x: this.x < W / 2 ? rand(W * 0.65, W - H) : rand(H, W * 0.35), run: true })));
    add(0.8, () => {
      const tx = clamp(this.x + rand(-1, 1) * H * 0.8, (plat?.x1 ?? 0) + H * 0.3, (plat?.x2 ?? W) - H * 0.3);
      this.queue.push(new Jump({ x: tx, y: this.y, arc: H * rand(0.3, 0.7) }));
    });
    add(onLedge ? 2.5 : 0.8, () => this.queue.push(new Sit()));
    add(0.4, () => this.queue.push(new Emote({ name: 'stretch', dur: 2.6 })));
    add(0.3, () => this.queue.push(new Emote({ name: 'wave', dur: 1.6 })));
    if (ledges.length) {
      add(onLedge ? 0.8 : 2.2, () => {
        const l = pick(ledges);
        const dy = this.y - l.y;
        const tx = clamp(this.x, l.x1 + H * 0.3, l.x2 - H * 0.3);
        if (dy <= maxJump && Math.abs(tx - this.x) < W * 0.6) {
          // walk closer first if far away, then jump
          if (Math.abs(tx - this.x) > H * 2.5 && plat) this.queue.push(new Walk({ x: clamp(tx, plat.x1 + H * 0.3, plat.x2 - H * 0.3) }));
          this.queue.push(new Jump({ x: tx, y: l.y, arc: H * 0.4 }));
        } else if (!onLedge) {
          const win = this.world.windowById(l.winId);
          if (win) this.queue.push(new Climb({ winId: win.id, side: this.x < win.x + win.w / 2 ? 'L' : 'R' }));
        }
      });
    }
    if (onLedge) {
      add(2, () => {
        // hop down off the ledge
        const left = this.x - plat.x1 < plat.x2 - this.x;
        const edge = left ? plat.x1 - H * 0.4 : plat.x2 + H * 0.4;
        const tx = clamp(edge + (left ? -1 : 1) * rand(0, H * 1.5), H * 0.3, W - H * 0.3);
        const below = this.world.findLanding(tx, this.y + 1, this.world.height) || this.world.ground;
        this.queue.push(new Jump({ x: tx, y: below.y, arc: H * 0.3 }));
      });
    }
    const dialogue = clamp(this.settings.dialogueFrequency ?? 0.5, 0, 1);
    if (dialogue > 0 && this.cool('ambient', lerp(240, 40, dialogue))) add(0.5 * dialogue, () => this.host.event?.('ambient'));

    let total = opts.reduce((s, o) => s + o[0], 0);
    let r = Math.random() * total;
    for (const [w, fn] of opts) {
      r -= w;
      if (r <= 0) {
        fn();
        break;
      }
    }
    if (!this.queue.length) this.queue.push(new Idle());
  }

  // ── cursor input ─────────────────────────────────────────────────────────
  setCursor(x, y, now) {
    const c = this.cursor;
    const dt = Math.max((now - c.t) / 1000, 1 / 120);
    if (c.t) {
      const nvx = (x - c.x) / dt, nvy = (y - c.y) / dt;
      c.vx = lerp(c.vx, nvx, 0.5);
      c.vy = lerp(c.vy, nvy, 0.5);
    }
    if (Math.abs(x - c.x) + Math.abs(y - c.y) > 1.5) this.idleCursorTime = 0;
    c.x = x;
    c.y = y;
    c.t = now;
  }

  reactToCursor(dt) {
    const c = this.cursor;
    if (this.conversing || this.mode !== 'ground') return;
    const act = this.action;
    const calm = !act || act instanceof Idle || act instanceof Walk || act instanceof Sit;
    if (!calm) return;
    const h = this.headWorld();
    const d = dist(h[0], h[1], c.x, c.y);
    const speed = Math.hypot(c.vx, c.vy);
    if (d < this.H * 0.55 && speed > 2600 && this.cool('startle', 15)) {
      this.interrupt(new Emote({ name: 'stumble', dur: 0.6, sayKey: 'startled' }));
      this.fx.sweat(h[0], h[1] - this.H * 0.1, this.H / 150);
      return;
    }
    if (this.hitTest(c.x, c.y)) {
      this.hoverTime += dt;
      if (this.hoverTime > 1.3 && this.cool('hoverWave', 30)) {
        this.interrupt(new Emote({ name: 'wave', dur: 1.6, sayKey: 'poked' }));
      }
    } else this.hoverTime = 0;
    if (d < this.H * 2.2 && act instanceof Idle && Math.abs(c.vx) + Math.abs(c.vy) > 50) {
      this.facing = sign(c.x - this.x) || this.facing;
    }
  }

  maybeChase(dt) {
    const f = clamp(this.settings.chaseFrequency ?? 0.5, 0, 1);
    if (f <= 0 || this.settings.paused || this.conversing || this.helperActive) return;
    this.chaseCooldown -= dt;
    if (this.chaseCooldown > 0 || this.mode !== 'ground') return;
    if (this.action && !(this.action instanceof Idle || this.action instanceof Walk || this.action instanceof Sit)) return;
    if (this.idleCursorTime > 30) return; // only when you're actually around
    const pSec = 0.03 + 0.2 * f * f;
    if (Math.random() < pSec * dt) this.startChase();
  }

  // ── main update ──────────────────────────────────────────────────────────
  update(dt) {
    this.time += dt;
    this.idleCursorTime += dt;
    this.anger = Math.max(0, this.anger - dt * 0.12);
    const W = this.world.width;

    // behaviour
    if (!this.action || this.action.update(this, dt)) {
      const next = this.queue.shift();
      if (next) this.setAction(next);
      else {
        this.setAction(null);
        this.think();
        this.setAction(this.queue.shift() || new Idle());
      }
    }
    if (this.action) this.action.t += dt;
    this.reactToCursor(dt);
    this.maybeChase(dt);

    // physics
    const H = this.H;
    switch (this.mode) {
      case 'ground': {
        this.x += this.vx * dt;
        this.stepPhase += (Math.abs(this.vx) * dt) / (H * (this.action instanceof Walk && this.action.run ? 0.27 : 0.2));
        const p = this.platform;
        if (!p) {
          this.mode = 'air';
          break;
        }
        this.y = p.y;
        if (this.x < p.x1 || this.x > p.x2) {
          // walked off a ledge
          this.mode = 'air';
          this.platform = null;
        }
        break;
      }
      case 'air': {
        const yPrev = this.y;
        this.vy = Math.min(this.vy + GRAVITY * dt, 2600);
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        // walls: bounce
        const m = H * 0.2;
        if (this.x < m) {
          this.x = m;
          this.vx = Math.abs(this.vx) * 0.45;
        } else if (this.x > W - m) {
          this.x = W - m;
          this.vx = -Math.abs(this.vx) * 0.45;
        }
        // ceiling
        if (this.y - H < 0 && this.vy < 0) {
          this.y = H;
          this.vy = Math.abs(this.vy) * 0.2;
        }
        if (this.vy > 0) {
          const plat = this.world.findLanding(this.x, yPrev, this.y);
          if (plat) this.land(plat);
        }
        if (this.y > this.world.height) this.land(this.world.ground);
        if (this.mode === 'air' && !(this.action instanceof Jump || this.action instanceof Chase || this.action instanceof Held || this.action instanceof Emote || this.action instanceof Converse || this.action instanceof Fall)) {
          this.interrupt(new Fall());
        }
        break;
      }
      case 'climb':
        break;
      case 'fly':
        break;
      case 'held':
        break;
      case 'hang': {
        // pendulum hanging from the cursor
        const c = this.cursor;
        const L = 103 * this.k;
        const acc = (-GRAVITY / L) * Math.sin(this.swing) - this.swingV * 1.4 + (c.vx / L) * -0.9 * this.facing * 0.06;
        this.swingV += acc * dt;
        this.swing = clamp(this.swing + this.swingV * dt, -1.2, 1.2);
        this.x = c.x;
        this.y = c.y + L;
        break;
      }
    }
    if (this.mode !== 'held' && this.mode !== 'hang' && this.mode !== 'fly') this.x = clamp(this.x, H * 0.2, W - H * 0.2);
    // jetpack fades away after landing
    if (this.jetpackOff && this.mode === 'ground') {
      this.jetpack = Math.max(0, (this.jetpack || 0) - dt * 3);
      this.thrust = 0;
      if (this.jetpack <= 0) this.jetpackOff = this.jetpackOn = false;
    } else if (this.jetpackOff) this.thrust = lerp(this.thrust || 0, 0.25, damp(4, dt));
    if (this.landT > 0) this.landT -= dt;

    this.updateAnimation(dt);
  }

  // ── animation ────────────────────────────────────────────────────────────
  updateAnimation(dt) {
    let a = this.action ? this.action.anim(this) : { name: 'idle' };
    if (this.mode === 'ground' && this.landT > 0 && !(this.action instanceof Converse) && !(this.action instanceof Emote)) {
      a = { name: 'land', ctx: { impact: this.landImpact } };
    }
    if (a.name !== this.animName) {
      this.animName = a.name;
      this.animT = 0;
    }
    this.animT += dt;
    const ctx = { phase: this.stepPhase, skel: this.character.skel, time: this.time, talking: this.speaking, ...(a.ctx || {}) };
    const target = animate(a.name, this.animT, ctx);
    if (ctx.floor && ['sit', 'sitLapel', 'sleep', 'dizzy'].includes(a.name)) floorSit(target);
    this.character.adjustPose?.(target, a.name);

    // look at the cursor when it's near
    const c = this.cursor;
    const h = this.J ? this.headWorld() : [this.x, this.y - this.H];
    const dx = c.x - h[0], dy = c.y - h[1];
    const d = Math.hypot(dx, dy);
    if (d < this.H * 3.5 && target.eyes !== 'closed' && target.eyes !== 'happy') {
      target.look = [clamp((dx * this.facing) / 120, -1, 1), clamp(dy / 120, -1, 1)];
      if (['idle', 'idleRelax', 'walk', 'notice'].includes(a.name)) target.headTilt += clamp((dy / d) * 0.12, -0.12, 0.12);
    }
    // blinking
    this.blinkT -= dt;
    if (this.blinkT < 0) {
      if (target.eyes === 'open') target.eyes = 'closed';
      if (this.blinkT < -0.12) this.blinkT = rand(2, 5.5);
    }
    // lingering anger shows on the face
    if (this.anger > 0.3) {
      target.flush = Math.max(target.flush, (this.anger - 0.3) * 1.2);
      target.brow = Math.max(target.brow, this.anger * 0.8);
    }
    const rate = ['hang', 'held'].includes(a.name) ? 30 : 16;
    blendPose(this.pose, target, damp(rate, dt));
    // rotation pivot must not lag
    this.pose.pivot = target.pivot;
    this.pose.rot = target.rot;
    this.J = fk(this.pose, this.character.skel);

    // emotional particles
    if (this.pose.flush > 0.75 && Math.random() < dt * 6) {
      const ht = this.headTopWorld();
      this.fx.steam(ht[0], ht[1], this.H / 150);
    }
  }

  // ── drawing ──────────────────────────────────────────────────────────────
  draw(ctx) {
    const k = this.k;
    const p = this.pose;
    // shadow on whatever is below
    if (this.mode !== 'hang' && this.mode !== 'held' && this.mode !== 'climb' && this.mode !== 'fly') {
      const below = this.platform || this.world.findLanding(this.x, this.y, this.world.height + 1) || this.world.ground;
      const h = Math.max(0, below.y - this.y);
      const s = clamp(1 - h / (this.H * 3), 0.25, 1);
      ctx.save();
      ctx.fillStyle = `rgba(0,0,0,${0.22 * s})`;
      ctx.beginPath();
      ctx.ellipse(this.x, below.y - 1, this.H * 0.24 * s, this.H * 0.035 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.translate(this.x, this.y);
    ctx.scale(this.facing * k, k);
    if (p.rot) {
      ctx.translate(p.pivot[0], p.pivot[1]);
      ctx.rotate(p.rot);
      ctx.translate(-p.pivot[0], -p.pivot[1]);
    }
    ctx.scale(p.sx, p.sy);
    if (this.jetpack > 0) drawJetpack(ctx, this, this.time);
    this.character.draw(ctx, p, this.J);
    ctx.restore();

    // symbols
    const s = this.H / 150;
    const ht = this.headTopWorld();
    if (this.pose.flush > 0.5) drawVein(ctx, ht[0] + this.facing * this.H * 0.1, ht[1] + this.H * 0.02, s, this.time);
    if (this.animName === 'dizzy') drawDizzy(ctx, ht[0], ht[1] - this.H * 0.02, s, this.time);
    if (this.holdingCursor) drawTrapped(ctx, this.cursor.x, this.cursor.y, s, this.time);
  }
}

/** Rocket pack on his back with animated flames (character units). */
function drawJetpack(ctx, pet, t) {
  const J = pet.J;
  const sk = pet.character.skel;
  const back = Math.min(sk.torso.shoulders.F[0], sk.torso.shoulders.N[0]) - 3;
  const s = pet.jetpack;
  ctx.save();
  ctx.translate(J.hip[0], J.hip[1]);
  ctx.rotate(J.lean);
  ctx.translate(back, -22);
  ctx.scale(s, s);
  const thrust = pet.thrust || 0;
  // flames
  if (thrust > 0.05) {
    for (const nx of [-4, 3]) {
      const len = (10 + 16 * thrust) * (0.8 + 0.4 * Math.random());
      const g = ctx.createLinearGradient(0, 16, 0, 16 + len);
      g.addColorStop(0, 'rgba(255,255,220,0.95)');
      g.addColorStop(0.3, 'rgba(255,200,60,0.9)');
      g.addColorStop(0.7, 'rgba(255,90,30,0.75)');
      g.addColorStop(1, 'rgba(255,40,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(nx - 3, 16);
      ctx.quadraticCurveTo(nx - 2.5, 16 + len * 0.6, nx + Math.sin(t * 40 + nx) * 1.2, 16 + len);
      ctx.quadraticCurveTo(nx + 2.5, 16 + len * 0.6, nx + 3, 16);
      ctx.fill();
    }
  }
  // tanks
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = '#0a0a0c';
  for (const [x, col] of [[-4, '#c7372f'], [3, '#e0473d']]) {
    const g = ctx.createLinearGradient(x - 4, 0, x + 4, 0);
    g.addColorStop(0, col);
    g.addColorStop(0.45, '#ff8a7a');
    g.addColorStop(1, '#8e1f1a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x - 4, -14, 8, 28, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#5a5f66';
    ctx.beginPath();
    ctx.moveTo(x - 2.6, 13);
    ctx.lineTo(x + 2.6, 13);
    ctx.lineTo(x + 3.4, 17);
    ctx.lineTo(x - 3.4, 17);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // strap + fin
  ctx.fillStyle = '#2b2a30';
  ctx.fillRect(-8, -6, 16, 3);
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath();
  ctx.arc(-0.5, -9, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Adapt a sitting pose to sit on the floor (legs straight out) instead of on a ledge. */
function floorSit(p) {
  p.bodyY = 33;
  p.leg.N = [1.5, -0.05];
  p.leg.F = [1.42, -0.05];
}

export const _test = { Idle, Walk, Jump, Climb, Chase, Held, Emote, Converse, Sit, Sleep, Fall, Fly, GRAVITY };
