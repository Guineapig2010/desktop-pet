// Procedural animation library: every function returns a target pose for a moment in time.
// The pet blends towards these targets each frame, so transitions are always smooth.

import { basePose, aimArm } from './rig.js';
import { clamp } from './util.js';

const S = Math.sin;
const C = Math.cos;
const pos = (v) => Math.max(0, v);

/**
 * @param {string} name   animation name
 * @param {number} t      seconds since this animation started
 * @param {object} c      context: { phase, talking, target, skel, swing, impact, speaking, time }
 */
export function animate(name, t, c = {}) {
  const fn = ANIMS[name] || ANIMS.idle;
  const p = basePose();
  fn(p, t, c);
  if (c.talking) talkOverlay(p, c.time ?? t);
  return p;
}

function talkOverlay(p, t) {
  p.mouth = 0.35 + 0.65 * pos(S(t * 21) * 0.8 + S(t * 13.3) * 0.5);
  if (p.mouthShape === 'grin') p.mouthShape = 'talk';
}

/** Hand on the lapel, other hand in the pocket — his signature stance. */
function lapelArms(p, t) {
  p.arm.N = [0.08 + 0.03 * S(t * 1.3), 3.2];
  p.hand.N = 'fist';
  p.arm.F = [-0.22, 0.55];
  p.hand.F = 'pocket';
}

export const ANIMS = {
  idle(p, t, c) {
    lapelArms(p, t);
    p.sy = 1 + 0.012 * S(t * 2.1);
    p.sx = 1 - 0.006 * S(t * 2.1);
    p.headTilt = 0.03 * S(t * 0.7);
    p.leg.N = [0.06, 0];
    p.leg.F = [-0.05, 0];
  },
  idleRelax(p, t) {
    p.arm.N = [0.1 + 0.04 * S(t * 1.2), 0.2];
    p.arm.F = [-0.08 + 0.04 * S(t * 1.2 + 1), 0.25];
    p.sy = 1 + 0.012 * S(t * 2.1);
    p.leg.N = [0.08, 0];
    p.leg.F = [-0.06, 0];
  },
  lookAround(p, t) {
    lapelArms(p, t);
    p.headTilt = 0.12 * S(t * 1.6);
    p.look = [S(t * 1.6) > 0 ? 1 : -1, -0.2];
  },
  stretch(p, t) {
    const k = clamp(t / 0.6, 0, 1) * (t < 2 ? 1 : clamp(1 - (t - 2) / 0.5, 0, 1));
    p.arm.N = [2.9 * k + 0.1, 0.2 * k];
    p.arm.F = [2.8 * k, 0.2 * k];
    p.lean = -0.12 * k;
    p.sy = 1 + 0.05 * k;
    p.eyes = k > 0.5 ? 'closed' : 'open';
    p.mouthShape = k > 0.5 ? 'o' : 'grin';
    p.mouth = 0.6 * k;
  },
  walk(p, t, c) {
    const ph = c.phase ?? t * 6;
    p.leg.N = [0.42 * S(ph), -(0.12 + 0.75 * pos(C(ph)))];
    p.leg.F = [0.42 * S(ph + Math.PI), -(0.12 + 0.75 * pos(C(ph + Math.PI)))];
    p.arm.N = [-0.38 * S(ph), 0.3];
    p.arm.F = [0.38 * S(ph), 0.3];
    p.hand.N = p.hand.F = 'fist';
    p.lean = 0.05;
    p.headTilt = 0.03 * S(ph * 2);
  },
  strut(p, t, c) {
    // a confident walk with the lapel hand
    ANIMS.walk(p, t, c);
    p.arm.N = [0.08, 3.2];
    p.hand.N = 'fist';
    p.lean = -0.02;
  },
  run(p, t, c) {
    const ph = c.phase ?? t * 12;
    p.leg.N = [0.85 * S(ph), -(0.3 + 1.35 * pos(C(ph)))];
    p.leg.F = [0.85 * S(ph + Math.PI), -(0.3 + 1.35 * pos(C(ph + Math.PI)))];
    p.arm.N = [-0.95 * S(ph) + 0.25, 1.55];
    p.arm.F = [0.95 * S(ph) + 0.25, 1.55];
    p.hand.N = p.hand.F = 'fist';
    p.lean = 0.3;
    p.headTilt = -0.12;
    p.mouthShape = 'grit';
    p.brow = 0.4;
  },
  jumpPrep(p) {
    p.leg.N = [0.75, -1.35];
    p.leg.F = [0.6, -1.25];
    p.lean = 0.28;
    p.arm.N = [-0.7, 0.35];
    p.arm.F = [-0.75, 0.35];
    p.sy = 0.9;
    p.sx = 1.08;
  },
  rise(p, t) {
    p.grounded = false;
    p.leg.N = [0.55, -1.0];
    p.leg.F = [-0.1, -0.35];
    p.arm.N = [2.7, 0.2];
    p.arm.F = [2.5, 0.3];
    p.hand.N = p.hand.F = 'open';
    p.sy = 1.06;
    p.sx = 0.95;
    p.mouthShape = 'open';
    p.mouth = 0.5;
  },
  fall(p, t) {
    p.grounded = false;
    p.arm.N = [2.45 + 0.45 * S(t * 19), 0.35];
    p.arm.F = [2.25 + 0.45 * S(t * 19 + 1.7), 0.35];
    p.leg.N = [0.35 * S(t * 15), -0.45];
    p.leg.F = [0.35 * S(t * 15 + 2), -0.3];
    p.hand.N = p.hand.F = 'open';
    p.eyes = 'wide';
    p.mouthShape = 'o';
    p.mouth = 0.8;
  },
  land(p, t, c) {
    const impact = clamp(c.impact ?? 1, 0.3, 1.4);
    const k = clamp(1 - t / 0.28, 0, 1) * impact;
    p.leg.N = [0.7 * k, -1.3 * k];
    p.leg.F = [0.55 * k, -1.2 * k];
    p.lean = 0.25 * k;
    p.arm.N = [0.6 * k + 0.1, 0.4];
    p.arm.F = [0.5 * k, 0.4];
    p.sy = 1 - 0.2 * k;
    p.sx = 1 + 0.14 * k;
  },
  angry(p, t) {
    const st = S(t * 11);
    p.leg.N = [0.45 * pos(st), -1.0 * pos(st)];
    p.leg.F = [0.45 * pos(-st), -1.0 * pos(-st)];
    p.arm.N = [2.35 + 0.25 * S(t * 27), 0.75];
    p.arm.F = [2.15 + 0.25 * S(t * 27 + 1), 0.75];
    p.hand.N = p.hand.F = 'fist';
    p.flush = 1;
    p.brow = 1;
    p.eyes = 'angry';
    p.mouthShape = 'shout';
    p.mouth = 0.7 + 0.3 * S(t * 17);
    p.bodyX = 0.6 * S(t * 60);
    p.lean = 0.08;
  },
  fume(p, t) {
    // arms crossed, red-faced, quietly seething
    p.arm.N = [1.15, 2.25];
    p.arm.F = [1.0, 2.35];
    p.hand.N = p.hand.F = 'fist';
    p.flush = 0.7 + 0.3 * S(t * 3);
    p.brow = 1;
    p.eyes = 'angry';
    p.mouthShape = 'grit';
    p.bodyX = 0.3 * S(t * 45);
    p.leg.N = [0.1 * pos(S(t * 6)), -0.3 * pos(S(t * 6))];
  },
  tantrum(p, t) {
    p.arm.N = [t * 13, 0.2];
    p.arm.F = [t * 13 + Math.PI, 0.2];
    p.hand.N = p.hand.F = 'fist';
    p.leg.N = [0.5 * S(t * 16), -0.7];
    p.leg.F = [0.5 * S(t * 16 + Math.PI), -0.7];
    p.flush = 1;
    p.brow = 1;
    p.eyes = 'angry';
    p.mouthShape = 'shout';
    p.mouth = 1;
  },
  calm(p, t) {
    // deep breaths: arms rise and fall
    const b = 0.5 - 0.5 * C(t * 1.6);
    p.arm.N = [0.5 + 1.2 * b, 1.6 - 0.8 * b];
    p.arm.F = [0.4 + 1.2 * b, 1.6 - 0.8 * b];
    p.hand.N = p.hand.F = 'open';
    p.eyes = 'closed';
    p.mouthShape = b > 0.5 ? 'o' : 'smile';
    p.mouth = 0.4 * b;
    p.sy = 1 + 0.03 * b;
    p.flush = 0.25 * (1 - b);
  },
  talk(p, t) {
    p.arm.N = [0.75 + 0.3 * S(t * 3.1), 1.25 + 0.35 * S(t * 5.3)];
    p.hand.N = 'open';
    p.arm.F = [-0.22, 0.55];
    p.hand.F = 'pocket';
    p.headTilt = 0.05 * S(t * 4.1);
    p.mouthShape = 'talk';
  },
  pitch(p, t) {
    // salesman: both hands out, presenting the dream
    p.arm.N = [1.35 + 0.2 * S(t * 2.4), 0.5 + 0.25 * S(t * 4.8)];
    p.arm.F = [1.25 + 0.2 * S(t * 2.4 + 0.6), 0.5];
    p.hand.N = p.hand.F = 'open';
    p.headTilt = -0.06 + 0.05 * S(t * 2.4);
    p.lean = 0.06;
  },
  plead(p, t) {
    p.arm.N = [1.35, 1.9 + 0.1 * S(t * 6)];
    p.arm.F = [1.35, 1.9 + 0.1 * S(t * 6 + 1)];
    p.hand.N = p.hand.F = 'fist';
    p.lean = 0.12;
    p.eyes = 'wide';
    p.mouthShape = 'smile';
  },
  dramatic(p, t) {
    // back of the hand to the forehead
    p.arm.N = [2.55, 2.2];
    p.hand.N = 'open';
    p.arm.F = [0.9 + 0.1 * S(t * 3), 0.2];
    p.hand.F = 'open';
    p.lean = -0.15;
    p.headTilt = -0.25;
    p.eyes = 'closed';
    p.mouthShape = 'o';
    p.mouth = 0.5;
  },
  knock(p, t) {
    p.arm.N = [1.45, 0.25 + 0.6 * pos(S(t * 13))];
    p.hand.N = 'fist';
    p.arm.F = [-0.1, 0.3];
    p.lean = 0.05;
    p.eyes = 'wide';
  },
  wave(p, t) {
    p.arm.N = [2.6, 0.45 + 0.45 * S(t * 11)];
    p.hand.N = 'open';
    p.arm.F = [-0.22, 0.55];
    p.hand.F = 'pocket';
    p.mouthShape = 'grin';
  },
  shrug(p, t) {
    const k = clamp(t / 0.25, 0, 1);
    p.arm.N = [0.45 * k, 1.9 * k];
    p.arm.F = [0.4 * k, 1.9 * k];
    p.hand.N = p.hand.F = 'open';
    p.headTilt = 0.15 * k;
    p.sy = 1 + 0.02 * k;
    p.mouthShape = 'smirk';
  },
  sulk(p, t) {
    p.arm.N = [1.1, 2.3];
    p.arm.F = [1.0, 2.35];
    p.hand.N = p.hand.F = 'fist';
    p.headTilt = 0.22;
    p.look = [-0.6, 0.6];
    p.eyes = 'half';
    p.mouthShape = 'frown';
    p.sy = 0.98;
  },
  facepalm(p, t) {
    p.arm.N = [2.05, 2.55];
    p.hand.N = 'open';
    p.arm.F = [-0.1, 0.3];
    p.headTilt = 0.25;
    p.eyes = 'closed';
    p.mouthShape = 'frown';
  },
  notice(p, t) {
    lapelArms(p, t);
    p.sy = 1 + 0.06 * clamp(1 - t / 0.3, 0, 1);
    p.eyes = 'wide';
    p.mouthShape = 'o';
    p.mouth = 0.4;
  },
  reachUp(p, t, c) {
    p.arm.N = [2.95, 0.05];
    p.arm.F = [2.85, 0.1];
    p.hand.N = p.hand.F = 'open';
    p.leg.N = [0.05, 0];
    p.leg.F = [-0.05, 0];
    p.sy = 1.04 + 0.02 * S(t * 18);
    p.eyes = 'wide';
    p.mouthShape = 'grit';
    if (c.target && c.skel) {
      aimArm(p, c.skel, 'N', c.target);
      aimArm(p, c.skel, 'F', [c.target[0] - 3, c.target[1] + 2]);
    }
  },
  grab(p, t, c) {
    p.hand.N = p.hand.F = 'grab';
    p.lean = 0.12;
    p.eyes = t < 0.5 ? 'wide' : 'happy';
    p.mouthShape = 'grin';
    p.mouth = 0.6;
    p.leg.N = [0.1, -0.1];
    p.leg.F = [-0.1, -0.1];
    if (c.target && c.skel) {
      aimArm(p, c.skel, 'N', [c.target[0] + 2.5, c.target[1]]);
      aimArm(p, c.skel, 'F', [c.target[0] - 2.5, c.target[1] + 1]);
    } else {
      p.arm.N = [1.7, 0.3];
      p.arm.F = [1.6, 0.3];
    }
  },
  holdCelebrate(p, t, c) {
    ANIMS.grab(p, t, c);
    p.eyes = 'happy';
    p.mouthShape = 'laugh';
    p.mouth = 0.6 + 0.4 * pos(S(t * 14));
    p.leg.N = [0.3 * pos(S(t * 9)), -0.6 * pos(S(t * 9))];
    p.leg.F = [0.3 * pos(-S(t * 9)), -0.6 * pos(-S(t * 9))];
  },
  hang(p, t, c) {
    p.grounded = false;
    p.arm.N = [Math.PI - 0.08, 0];
    p.arm.F = [Math.PI + 0.08, 0];
    p.hand.N = p.hand.F = 'grab';
    p.leg.N = [0.45 * S(t * 7), -0.5 - 0.3 * S(t * 7)];
    p.leg.F = [0.45 * S(t * 7 + 2.2), -0.5];
    p.eyes = 'happy';
    p.mouthShape = 'laugh';
    p.mouth = 0.6 + 0.3 * S(t * 12);
    p.rot = c.swing || 0;
    p.pivot = c.pivot || [0, -100];
  },
  held(p, t, c) {
    p.grounded = false;
    p.arm.N = [2.2 + 0.5 * S(t * 13), 0.4];
    p.arm.F = [2.0 + 0.5 * S(t * 13 + 2), 0.4];
    p.hand.N = p.hand.F = 'open';
    p.leg.N = [0.35 * S(t * 10), -0.35];
    p.leg.F = [0.35 * S(t * 10 + 2.5), -0.2];
    p.rot = c.swing || 0;
    p.pivot = c.pivot || [0, -78];
    p.eyes = 'wide';
    p.mouthShape = 'o';
    p.mouth = 0.6;
  },
  climb(p, t, c) {
    p.grounded = false;
    const ph = c.phase ?? t * 6;
    p.arm.N = [2.7 + 0.35 * S(ph), 0.5 + 0.4 * pos(-S(ph))];
    p.arm.F = [2.7 + 0.35 * S(ph + Math.PI), 0.5 + 0.4 * pos(S(ph))];
    p.hand.N = p.hand.F = 'grab';
    p.leg.N = [0.7 + 0.45 * S(ph + Math.PI), -1.3];
    p.leg.F = [0.7 + 0.45 * S(ph), -1.3];
    p.lean = 0.12;
    p.mouthShape = 'grit';
  },
  sit(p, t) {
    p.grounded = false;
    p.bodyY = 39;
    p.leg.N = [1.45, -1.45 + 0.25 * S(t * 2.2)];
    p.leg.F = [1.35, -1.35 + 0.25 * S(t * 2.2 + 1.2)];
    p.arm.N = [0.75, 0.75];
    p.arm.F = [0.65, 0.8];
    p.lean = 0.05;
    p.sy = 1 + 0.01 * S(t * 2);
  },
  sitLapel(p, t) {
    ANIMS.sit(p, t);
    p.arm.N = [0.4, 2.9];
    p.hand.N = 'fist';
  },
  sleep(p, t) {
    ANIMS.sit(p, t);
    p.leg.N = [1.45, -1.45];
    p.leg.F = [1.35, -1.35];
    p.headTilt = 0.38;
    p.lean = 0.12 + 0.03 * S(t * 1.4);
    p.eyes = 'closed';
    p.mouthShape = 'o';
    p.mouth = 0.25 + 0.15 * S(t * 1.4);
    p.arm.N = [0.55, 0.9];
    p.arm.F = [0.5, 0.9];
  },
  dizzy(p, t) {
    ANIMS.sit(p, t);
    p.headTilt = 0.25 * S(t * 3.5);
    p.lean = 0.08 * S(t * 3.5 + 1);
    p.eyes = 'dizzy';
    p.mouthShape = 'wobble';
    p.arm.N = [0.4, 0.3];
    p.arm.F = [0.3, 0.3];
  },
  celebrate(p, t) {
    p.arm.N = [2.85 + 0.2 * S(t * 12), 0.15 + 0.4 * pos(S(t * 12))];
    p.arm.F = [2.75 + 0.2 * S(t * 12 + 1.5), 0.15 + 0.4 * pos(S(t * 12 + 1.5))];
    p.hand.N = p.hand.F = 'fist';
    p.leg.N = [0.35 * pos(S(t * 9)), -0.7 * pos(S(t * 9))];
    p.leg.F = [0.35 * pos(-S(t * 9)), -0.7 * pos(-S(t * 9))];
    p.eyes = 'happy';
    p.mouthShape = 'laugh';
    p.mouth = 0.6 + 0.4 * pos(S(t * 15));
  },
  laugh(p, t) {
    p.arm.N = [0.6, 1.9];
    p.arm.F = [0.5, 1.9];
    p.hand.N = p.hand.F = 'open';
    p.lean = 0.15 + 0.06 * S(t * 16);
    p.eyes = 'happy';
    p.mouthShape = 'laugh';
    p.mouth = 0.6 + 0.4 * pos(S(t * 16));
    p.sy = 1 + 0.02 * S(t * 16);
  },
  frustrated(p, t) {
    // stomp + shake fists at the cursor
    const st = S(t * 12);
    p.leg.N = [0.4 * pos(st), -0.9 * pos(st)];
    p.arm.N = [1.9 + 0.3 * S(t * 25), 1.2];
    p.arm.F = [1.7 + 0.3 * S(t * 25 + 1), 1.2];
    p.hand.N = p.hand.F = 'fist';
    p.flush = 0.6;
    p.brow = 1;
    p.eyes = 'angry';
    p.mouthShape = 'grit';
  },
  stumble(p, t) {
    p.lean = -0.35 + 0.2 * S(t * 9);
    p.arm.N = [2.0 + 0.6 * S(t * 15), 0.2];
    p.arm.F = [1.6 + 0.6 * S(t * 15 + 2), 0.2];
    p.hand.N = p.hand.F = 'open';
    p.leg.N = [0.4, -0.2];
    p.leg.F = [-0.3, -0.2];
    p.eyes = 'wide';
    p.mouthShape = 'o';
    p.mouth = 0.7;
  },
};

export const ANIM_NAMES = Object.keys(ANIMS);
