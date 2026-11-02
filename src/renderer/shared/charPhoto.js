// Photo puppet: the real photo, cut into parts, animated on the same skeleton as everything else.
// Limb images rotate about their joints by (pose angle − angle in the photo), so with the rest
// pose he looks exactly like the photo, and every animation bends the actual picture.

import { SIDES } from './rig.js';

const ang = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]); // our convention: 0 = down, + = towards +x
const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export async function loadPhotoCharacter(baseUrl, opts = {}) {
  const rig = await (await fetch(`${baseUrl}/rig.json`, { cache: 'no-store' })).json();
  const images = {};
  await Promise.all(
    Object.entries(rig.parts).map(async ([name, p]) => {
      const img = new Image();
      img.src = `${baseUrl}/${p.file}?v=${rig.stamp || 0}`;
      await img.decode();
      images[name] = img;
    }),
  );
  return new PhotoCharacter(rig, images, opts);
}

export class PhotoCharacter {
  constructor(rig, images, opts = {}) {
    this.kind = 'photo';
    this.rig = rig;
    this.images = images;
    this.headScale = opts.headScale ?? rig.headScale ?? 1.2;
    const J = rig.joints;
    const figH = J.sole[1] - J.headTop[1];
    const k = 100 / figH; // units per px
    this.k = k;
    const O = [J.hip[0], J.sole[1]]; // feet origin (x under the hips)
    this.origin = O;
    const U = (p) => [(p[0] - O[0]) * k, (p[1] - O[1]) * k];
    const rel = (p, q) => [(p[0] - q[0]) * k, (p[1] - q[1]) * k];

    this.rest = {
      thighN: ang(J.hipN, J.kneeN),
      shinN: ang(J.kneeN, J.ankleN),
      thighF: ang(J.hipF, J.kneeF),
      shinF: ang(J.kneeF, J.ankleF),
      upperArmN: ang(J.shoulderN, J.elbowN),
      foreArmN: ang(J.elbowN, J.handN),
      upperArmF: ang(J.shoulderF, J.elbowF),
      foreArmF: ang(J.elbowF, J.handF),
    };
    const headCenter = [J.headTop[0], (J.headTop[1] + J.neck[1]) / 2];
    this.skel = {
      hip: U(J.hip),
      legs: {
        N: { root: rel(J.hipN, J.hip), l1: len(J.hipN, J.kneeN) * k, l2: len(J.kneeN, J.ankleN) * k, rest1: 0, rest2: 0 },
        F: { root: rel(J.hipF, J.hip), l1: len(J.hipF, J.kneeF) * k, l2: len(J.kneeF, J.ankleF) * k, rest1: 0, rest2: 0 },
      },
      torso: { neck: rel(J.neck, J.hip), shoulders: { N: rel(J.shoulderN, J.hip), F: rel(J.shoulderF, J.hip) } },
      arms: {
        N: { l1: len(J.shoulderN, J.elbowN) * k, l2: len(J.elbowN, J.handN) * k, rest1: 0, rest2: 0 },
        F: { l1: len(J.shoulderF, J.elbowF) * k, l2: len(J.elbowF, J.handF) * k, rest1: 0, rest2: 0 },
      },
      head: { center: rel(headCenter, J.neck), radius: ((J.neck[1] - J.headTop[1]) * k) / 2 },
      footClearance: (J.sole[1] - Math.max(J.ankleN[1], J.ankleF[1])) * k,
    };
    // the photo's own arm angles: used as his relaxed stance
    this.restArms = {
      N: [this.rest.upperArmN, wrap(this.rest.foreArmN - this.rest.upperArmN)],
      F: [this.rest.upperArmF, wrap(this.rest.foreArmF - this.rest.upperArmF)],
    };
    this.restLegs = {
      N: [this.rest.thighN, wrap(this.rest.shinN - this.rest.thighN)],
      F: [this.rest.thighF, wrap(this.rest.shinF - this.rest.thighF)],
    };
    // which hands are visible in the photo (a hand in a pocket isn't)
    this.handVisible = { N: rig.handVisible?.N ?? true, F: rig.handVisible?.F ?? true };
    this.skin = rig.skin || '#c08a6a';
    this.tintCache = { key: '', canvas: null };
  }

  /** Called on each target pose: stances that mimic the photo use the photo's real angles. */
  adjustPose(p, animName) {
    if (p.lapel) {
      p.arm.N = [...this.restArms.N];
      if (p.lapel === 'both') p.arm.F = [...this.restArms.F];
    }
    if (['idle', 'idleRelax', 'lookAround', 'notice', 'talk', 'wave', 'pitch', 'knock', 'shrug', 'facepalm', 'dramatic'].includes(animName)) {
      // stand the way he stands in the photo
      p.leg.N = [this.restLegs.N[0] + p.leg.N[0] * 0.5, this.restLegs.N[1] + p.leg.N[1]];
      p.leg.F = [this.restLegs.F[0] + p.leg.F[0] * 0.5, this.restLegs.F[1] + p.leg.F[1]];
    }
  }

  drawPart(ctx, name, jointImg, jointWorld, rotation, scale = 1) {
    const img = this.images[name];
    const P = this.rig.parts[name];
    if (!img || !P) return;
    const k = this.k;
    ctx.save();
    ctx.translate(jointWorld[0], jointWorld[1]);
    if (rotation) ctx.rotate(rotation);
    if (scale !== 1) ctx.scale(scale, scale);
    ctx.drawImage(img, (P.x - jointImg[0]) * k, (P.y - jointImg[1]) * k, P.w * k, P.h * k);
    ctx.restore();
  }

  draw(ctx, pose, J) {
    const R = this.rig.joints;
    const rest = this.rest;
    // legs (behind the jacket)
    for (const s of ['F', 'N']) {
      const L = J.legs[s];
      this.drawPart(ctx, `shin${s}`, R[`knee${s}`], L.knee, rest[`shin${s}`] - L.a2);
      this.drawPart(ctx, `thigh${s}`, R[`hip${s}`], L.root, rest[`thigh${s}`] - L.a1);
    }
    // torso
    this.drawPart(ctx, 'torso', R.hip, J.hip, J.lean);
    // far arm, then head, then near arm
    this.drawArm(ctx, pose, J, 'F');
    this.drawHead(ctx, pose, J);
    this.drawArm(ctx, pose, J, 'N');
  }

  drawArm(ctx, pose, J, s) {
    const R = this.rig.joints;
    const A = J.arms[s];
    this.drawPart(ctx, `foreArm${s}`, R[`elbow${s}`], A.elbow, this.rest[`foreArm${s}`] - A.a2);
    this.drawPart(ctx, `upperArm${s}`, R[`shoulder${s}`], A.shoulder, this.rest[`upperArm${s}`] - A.a1);
    // a hand hidden in a pocket in the photo gets a drawn-in hand once the arm moves away
    if (!this.handVisible[s]) {
      const dev = Math.abs(wrap(A.a2 - this.rest[`foreArm${s}`] + J.lean)) + Math.abs(wrap(A.a1 - this.rest[`upperArm${s}`] + J.lean));
      if (dev > 0.45) this.drawHand(ctx, A, pose.hand[s], Math.min(1, (dev - 0.45) / 0.3));
    }
  }

  drawHand(ctx, A, kind, alpha) {
    const dx = A.hand[0] - A.elbow[0], dy = A.hand[1] - A.elbow[1];
    const l = Math.hypot(dx, dy) || 1;
    const r = this.skel.arms.N.l2 * 0.2;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(A.hand[0] + (dx / l) * r * 0.6, A.hand[1] + (dy / l) * r * 0.6);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.fillStyle = this.skin;
    ctx.strokeStyle = 'rgba(20,12,10,0.8)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    if (kind === 'open') ctx.ellipse(r * 0.3, 0, r * 1.15, r * 0.85, 0, 0, Math.PI * 2);
    else ctx.ellipse(0, 0, r, r * 0.92, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  headImage(name, flush) {
    const img = this.images[name];
    if (!img || flush < 0.05) return img;
    const key = `${name}:${Math.round(flush * 10)}`;
    if (!this.tintCache[key]) {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = `rgba(230, 30, 20, ${0.5 * Math.round(flush * 10) / 10})`;
      g.fillRect(0, 0, c.width, c.height);
      this.tintCache[key] = c;
    }
    return this.tintCache[key];
  }

  drawHead(ctx, pose, J) {
    const R = this.rig.joints;
    const k = this.k;
    const hs = this.headScale;
    ctx.save();
    ctx.translate(J.neck[0], J.neck[1]);
    ctx.rotate(J.headAngle);
    ctx.scale(hs, hs);
    const flush = pose.flush || 0;
    const open = ['talk', 'laugh', 'shout'].includes(pose.mouthShape) ? pose.mouth : pose.mouthShape === 'o' ? pose.mouth * 0.6 : 0;
    const jawP = this.rig.parts.jaw;
    if (jawP && open > 0.02) {
      // dark mouth behind the dropping jaw
      const my = (R.mouthY - R.neck[1]) * k;
      const jx = (jawP.x + jawP.w / 2 - R.neck[0]) * k;
      ctx.fillStyle = '#2a0f10';
      ctx.beginPath();
      ctx.ellipse(jx, my + open * 2.2, (jawP.w * k) * 0.32, 1 + open * 2.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const name of ['head', 'jaw']) {
      const P = this.rig.parts[name];
      const img = this.headImage(name, flush);
      if (!P || !img) continue;
      const drop = name === 'jaw' ? open * 4.2 : 0;
      ctx.drawImage(img, (P.x - R.neck[0]) * k, (P.y - R.neck[1]) * k + drop, P.w * k, P.h * k);
    }
    ctx.restore();
  }
}
