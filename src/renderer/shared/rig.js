// Skeleton, forward/inverse kinematics and pose blending.
//
// Conventions (character space, "units"; 100 units ≈ full character height):
//   * origin is the point between the feet, +x is the direction he faces, +y is DOWN.
//   * a limb angle of 0 points straight down; positive angles swing the limb FORWARD
//     (towards +x). A limb's direction vector is (sin a, cos a).
//   * torso `lean` > 0 tips the upper body forward. Arms are relative to the torso,
//     legs are relative to the world vertical.
//   * every bone has a rest angle (0 for the drawn character; whatever the photo shows for
//     a photo puppet). absolute angle = rest + pose value.

import { lerp, lerpAngle, clamp } from './util.js';

export const SIDES = ['N', 'F']; // N = near limb (drawn in front), F = far limb (drawn behind)

/** Skeleton of the built-in drawn character (a big, broad guy). */
export const VECTOR_SKELETON = {
  hip: [0, -40],
  legs: {
    N: { root: [5, 0], l1: 19, l2: 18, rest1: 0, rest2: 0 },
    F: { root: [-5, 0], l1: 19, l2: 18, rest1: 0, rest2: 0 },
  },
  torso: { neck: [1, -36], shoulders: { N: [13, -31], F: [-12, -31] } },
  arms: {
    N: { l1: 17, l2: 15, rest1: 0, rest2: 0 },
    F: { l1: 17, l2: 15, rest1: 0, rest2: 0 },
  },
  head: { center: [2, -11], radius: 11.5 },
  footClearance: 3.5, // shoe sole below the ankle
};

export function basePose() {
  return {
    bodyX: 0,
    bodyY: 0,
    lean: 0,
    headTilt: 0,
    arm: { N: [0.12, 0.15], F: [-0.06, 0.15] },
    leg: { N: [0, 0], F: [0, 0] },
    hand: { N: 'open', F: 'open' },
    sx: 1,
    sy: 1,
    rot: 0,
    pivot: [0, 0],
    mouth: 0,
    mouthShape: 'grin',
    eyes: 'open',
    brow: 0,
    look: [0, 0],
    flush: 0,
    grounded: true,
    alpha: 1,
  };
}

export function clonePose(p) {
  return {
    ...p,
    arm: { N: [...p.arm.N], F: [...p.arm.F] },
    leg: { N: [...p.leg.N], F: [...p.leg.F] },
    hand: { ...p.hand },
    pivot: [...p.pivot],
    look: [...p.look],
  };
}

/** Blend pose a towards b by t (0..1). Discrete fields snap to b. Mutates and returns a. */
export function blendPose(a, b, t) {
  a.bodyX = lerp(a.bodyX, b.bodyX, t);
  a.bodyY = lerp(a.bodyY, b.bodyY, t);
  a.lean = lerpAngle(a.lean, b.lean, t);
  a.headTilt = lerpAngle(a.headTilt, b.headTilt, t);
  for (const s of SIDES) {
    a.arm[s][0] = lerpAngle(a.arm[s][0], b.arm[s][0], t);
    a.arm[s][1] = lerpAngle(a.arm[s][1], b.arm[s][1], t);
    a.leg[s][0] = lerpAngle(a.leg[s][0], b.leg[s][0], t);
    a.leg[s][1] = lerpAngle(a.leg[s][1], b.leg[s][1], t);
  }
  a.hand = { ...b.hand };
  a.sx = lerp(a.sx, b.sx, t);
  a.sy = lerp(a.sy, b.sy, t);
  a.rot = lerpAngle(a.rot, b.rot, t);
  a.pivot = [lerp(a.pivot[0], b.pivot[0], t), lerp(a.pivot[1], b.pivot[1], t)];
  a.mouth = lerp(a.mouth, b.mouth, Math.min(1, t * 2));
  a.mouthShape = b.mouthShape;
  a.eyes = b.eyes;
  a.brow = lerp(a.brow, b.brow, t);
  a.look = [lerp(a.look[0], b.look[0], t), lerp(a.look[1], b.look[1], t)];
  a.flush = lerp(a.flush, b.flush, t);
  a.grounded = b.grounded;
  a.alpha = lerp(a.alpha, b.alpha, t);
  return a;
}

const dir = (a) => [Math.sin(a), Math.cos(a)];
/** Rotate a point by the canvas convention (positive = clockwise on screen). */
export function rot(p, th) {
  const c = Math.cos(th), s = Math.sin(th);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];

/**
 * Forward kinematics. Returns joint positions in character units plus the absolute angles
 * of every bone. If pose.grounded, the whole body is shifted so the lowest foot touches y=0.
 */
export function fk(pose, skel) {
  const hip = [skel.hip[0] + pose.bodyX, skel.hip[1] + pose.bodyY];
  const th = pose.lean;
  const J = { hip, lean: th, legs: {}, arms: {} };
  for (const s of SIDES) {
    const L = skel.legs[s];
    const root = add(hip, L.root);
    const a1 = L.rest1 + pose.leg[s][0];
    const knee = add(root, dir(a1).map((v) => v * L.l1));
    const a2 = a1 + L.rest2 + pose.leg[s][1];
    const ankle = add(knee, dir(a2).map((v) => v * L.l2));
    J.legs[s] = { root, knee, ankle, a1, a2 };
  }
  J.neck = add(hip, rot(skel.torso.neck, th));
  for (const s of SIDES) {
    const A = skel.arms[s];
    const sh = add(hip, rot(skel.torso.shoulders[s], th));
    const a1 = -th + A.rest1 + pose.arm[s][0];
    const elbow = add(sh, dir(a1).map((v) => v * A.l1));
    const a2 = a1 + A.rest2 + pose.arm[s][1];
    const hand = add(elbow, dir(a2).map((v) => v * A.l2));
    J.arms[s] = { shoulder: sh, elbow, hand, a1, a2 };
  }
  J.headAngle = th + pose.headTilt;
  J.head = add(J.neck, rot(skel.head.center, J.headAngle));

  if (pose.grounded) {
    const clear = skel.footClearance || 0;
    const lowest = Math.max(J.legs.N.ankle[1], J.legs.F.ankle[1]) + clear;
    const dy = -lowest;
    shiftJoints(J, 0, dy);
  }
  return J;
}

export function shiftJoints(J, dx, dy) {
  const sh = (p) => {
    p[0] += dx;
    p[1] += dy;
  };
  sh(J.hip);
  sh(J.neck);
  sh(J.head);
  for (const s of SIDES) {
    sh(J.legs[s].root);
    sh(J.legs[s].knee);
    sh(J.legs[s].ankle);
    sh(J.arms[s].shoulder);
    sh(J.arms[s].elbow);
    sh(J.arms[s].hand);
  }
}

/**
 * Two-bone IK: returns absolute angles [a1, a2] so a chain starting at `root` reaches `target`.
 * bend = -1 puts the elbow below the line (natural for reaching arms).
 */
export function ik2(root, target, l1, l2, bend = -1) {
  const dx = target[0] - root[0], dy = target[1] - root[1];
  const d = clamp(Math.hypot(dx, dy), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const phi = Math.atan2(dx, dy);
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const alpha = Math.acos(cosA);
  const a1 = phi + bend * alpha;
  const elbow = [root[0] + Math.sin(a1) * l1, root[1] + Math.cos(a1) * l1];
  const a2 = Math.atan2(target[0] - elbow[0], target[1] - elbow[1]);
  return [a1, a2];
}

/**
 * Point the arm on side `s` at a target (character units). Writes into pose.arm[s].
 * Needs a first FK pass so it knows where the shoulder is.
 */
export function aimArm(pose, skel, s, target, bend = -1) {
  const J = fk({ ...pose, grounded: false }, skel);
  // fk without grounding: shoulder position relative to the un-grounded body.
  const groundedJ = pose.grounded ? fk(pose, skel) : J;
  const dy = groundedJ.arms[s].shoulder[1] - J.arms[s].shoulder[1];
  const sh = J.arms[s].shoulder;
  const A = skel.arms[s];
  const [a1, a2] = ik2(sh, [target[0], target[1] - dy], A.l1, A.l2, bend);
  pose.arm[s][0] = a1 + pose.lean - A.rest1;
  pose.arm[s][1] = a2 - a1 - A.rest2;
  return pose;
}

export function armReach(skel) {
  return skel.arms.N.l1 + skel.arms.N.l2;
}
