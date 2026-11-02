// The built-in, hand-drawn character: a big, broad, bearded man with a buzz cut and a huge
// squinting grin, wearing a black embossed-pattern three-piece suit (jacket, vest with a gold
// watch chain, black shirt, patterned black tie, pocket square) and black textured shoes.
// Everything is drawn with canvas paths so he stays crisp at any size.

import { VECTOR_SKELETON, SIDES } from './rig.js';

const COL = {
  outline: '#09090b',
  suit: '#1a191d',
  suitLight: '#2e2b33',
  suitHi: '#3b3741',
  vest: '#151418',
  shirt: '#0c0c0e',
  tie: '#1f1d23',
  tieHi: '#3d3944',
  skin: '#c98f6c',
  skinShade: '#a36a50',
  skinHi: '#dcaa88',
  cheek: 'rgba(214, 92, 80, 0.35)',
  hair: '#221c19',
  hairGrey: 'rgba(150, 140, 132, 0.55)',
  beard: '#241d1a',
  mouth: '#3a1215',
  tongue: '#b8545a',
  teeth: '#f7f2ea',
  teethLine: '#c9c0b4',
  gold: '#d4ad52',
  goldDark: '#8f6f2a',
  square: '#d9d4ca',
  shoe: '#121114',
  shoeHi: '#4a4650',
  pocket: '#0c0b0e',
};

// Deterministic pseudo-random so the suit pattern is identical every launch.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeSuitPattern(ctx, base, motif, hi) {
  const T = 64;
  const c = new OffscreenCanvas(T, T);
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, T, T);
  const r = seeded(7);
  const shapes = [];
  for (let i = 0; i < 7; i++) shapes.push({ x: r() * T, y: r() * T, s: 5 + r() * 6, a: r() * Math.PI * 2, k: r() });
  for (const ox of [-T, 0, T]) {
    for (const oy of [-T, 0, T]) {
      for (const sh of shapes) {
        g.save();
        g.translate(sh.x + ox, sh.y + oy);
        g.rotate(sh.a);
        if (sh.k < 0.5) {
          // paisley teardrop with a curl
          g.beginPath();
          g.moveTo(0, -sh.s);
          g.bezierCurveTo(sh.s * 0.9, -sh.s * 0.4, sh.s * 0.7, sh.s * 0.8, 0, sh.s * 0.7);
          g.bezierCurveTo(-sh.s * 0.7, sh.s * 0.6, -sh.s * 0.5, -sh.s * 0.2, 0, -sh.s);
          g.strokeStyle = motif;
          g.lineWidth = 1.6;
          g.stroke();
          g.beginPath();
          g.arc(0, sh.s * 0.15, sh.s * 0.28, 0, Math.PI * 1.6);
          g.strokeStyle = hi;
          g.lineWidth = 1;
          g.stroke();
        } else {
          // swirl
          g.beginPath();
          for (let t = 0; t < 9; t += 0.25) {
            const rr = t * sh.s * 0.11;
            const x = Math.cos(t) * rr, y = Math.sin(t) * rr;
            t === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
          }
          g.strokeStyle = motif;
          g.lineWidth = 1.4;
          g.stroke();
          g.fillStyle = hi;
          g.beginPath();
          g.arc(sh.s * 0.9, 0, 0.9, 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
      }
    }
  }
  const pat = ctx.createPattern(c, 'repeat');
  pat.setTransform(new DOMMatrix().scale(1 / 7)); // ≈9 units per tile
  return pat;
}

export class VectorCharacter {
  constructor() {
    this.kind = 'vector';
    this.skel = VECTOR_SKELETON;
    this.patterns = null;
  }

  ensurePatterns(ctx) {
    if (this.patterns) return;
    this.patterns = {
      suit: makeSuitPattern(ctx, COL.suit, COL.suitLight, COL.suitHi),
      vest: makeSuitPattern(ctx, COL.vest, '#26242b', '#302d36'),
      tie: makeSuitPattern(ctx, COL.tie, COL.tieHi, '#4a4652'),
    };
  }

  /** Draw in character units; the caller has already set up the transform. */
  draw(ctx, pose, J) {
    this.ensurePatterns(ctx);
    this.drawArm(ctx, J, 'F', pose.hand.F, true);
    this.drawLeg(ctx, J, 'F');
    this.drawLeg(ctx, J, 'N');
    this.drawTorso(ctx, J);
    this.drawHead(ctx, pose, J);
    this.drawArm(ctx, J, 'N', pose.hand.N, false);
  }

  limb(ctx, pts, width, fill) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = COL.outline;
    ctx.lineWidth = width + 2.2;
    ctx.stroke();
    ctx.strokeStyle = fill;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  drawLeg(ctx, J, s) {
    const L = J.legs[s];
    this.limb(ctx, [L.root, L.knee, L.ankle], 12.5, this.patterns.suit);
    // crease highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(L.knee[0], L.knee[1]);
    ctx.lineTo(L.ankle[0], L.ankle[1]);
    ctx.stroke();
    this.drawShoe(ctx, L.ankle, L.a2);
  }

  drawShoe(ctx, ankle, a2) {
    ctx.save();
    ctx.translate(ankle[0], ankle[1]);
    ctx.rotate(-a2);
    ctx.beginPath();
    ctx.moveTo(-4.5, -1.5);
    ctx.lineTo(6, -1.5);
    ctx.bezierCurveTo(10.5, -1, 12.5, 1.2, 12.5, 3);
    ctx.lineTo(12.3, 4.6);
    ctx.lineTo(-4.8, 4.6);
    ctx.lineTo(-5, 0.5);
    ctx.closePath();
    ctx.fillStyle = COL.shoe;
    ctx.fill();
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = COL.outline;
    ctx.stroke();
    // gloss + croc texture
    ctx.strokeStyle = COL.shoeHi;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(5, -0.3);
    ctx.quadraticCurveTo(9.5, 0, 11, 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.5;
    for (let x = -3; x < 10; x += 2.2) {
      ctx.beginPath();
      ctx.moveTo(x, 1.4);
      ctx.lineTo(x + 1.1, 3.6);
      ctx.stroke();
    }
    // sole
    ctx.fillStyle = '#050506';
    ctx.fillRect(-4.8, 3.7, 17, 0.9);
    ctx.restore();
  }

  drawArm(ctx, J, s, hand, far) {
    const A = J.arms[s];
    if (hand === 'pocket') {
      // hand tucked in the trouser pocket: sleeve ends at the hip
      this.limb(ctx, [A.shoulder, A.elbow, A.hand], 12, this.patterns.suit);
      return;
    }
    this.limb(ctx, [A.shoulder, A.elbow, A.hand], 12, this.patterns.suit);
    // shirt cuff
    const dx = A.hand[0] - A.elbow[0], dy = A.hand[1] - A.elbow[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const cuff = [A.hand[0] - ux * 1.5, A.hand[1] - uy * 1.5];
    ctx.strokeStyle = COL.shirt;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(cuff[0] - ux * 0.5, cuff[1] - uy * 0.5);
    ctx.lineTo(cuff[0] + ux * 0.8, cuff[1] + uy * 0.8);
    ctx.stroke();
    this.drawHand(ctx, [A.hand[0] + ux * 3.2, A.hand[1] + uy * 3.2], Math.atan2(uy, ux), hand);
  }

  drawHand(ctx, p, ang, kind) {
    ctx.save();
    ctx.translate(p[0], p[1]);
    ctx.rotate(ang);
    ctx.fillStyle = COL.skin;
    ctx.strokeStyle = COL.outline;
    ctx.lineWidth = 1.1;
    if (kind === 'fist') {
      ctx.beginPath();
      ctx.ellipse(0.5, 0, 5, 4.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = COL.skinShade;
      ctx.lineWidth = 0.8;
      for (const y of [-2, 0, 2]) {
        ctx.beginPath();
        ctx.moveTo(3, y);
        ctx.lineTo(5, y);
        ctx.stroke();
      }
    } else if (kind === 'grab') {
      // cupped claw
      ctx.beginPath();
      ctx.moveTo(-3, -4.2);
      ctx.quadraticCurveTo(7.5, -6.5, 7.8, 0);
      ctx.quadraticCurveTo(7.5, 5.5, -3, 4.2);
      ctx.quadraticCurveTo(-5, 0, -3, -4.2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = COL.skinShade;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(6, -2.5);
      ctx.lineTo(3.5, -1.5);
      ctx.moveTo(6.3, 1.5);
      ctx.lineTo(3.6, 1);
      ctx.stroke();
    } else {
      // open palm with thumb
      ctx.beginPath();
      ctx.ellipse(1.5, 0, 5.6, 4.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(-0.5, -4, 2.8, 1.6, -0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = COL.skinShade;
      ctx.lineWidth = 0.7;
      for (const y of [-1.5, 0.5, 2.3]) {
        ctx.beginPath();
        ctx.moveTo(4, y);
        ctx.lineTo(6.6, y * 1.1);
        ctx.stroke();
      }
    }
    // knuckle tattoo-ish ink dots (his hands have dark marks in the photo)
    ctx.fillStyle = 'rgba(40,30,30,0.45)';
    ctx.beginPath();
    ctx.arc(1, -1.4, 0.6, 0, Math.PI * 2);
    ctx.arc(2.4, 1.2, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  torsoPath(ctx) {
    ctx.beginPath();
    ctx.moveTo(-15, 7);
    ctx.lineTo(15, 7);
    ctx.bezierCurveTo(18, -5, 19.5, -20, 18, -29);
    ctx.quadraticCurveTo(16.5, -36, 8, -38);
    ctx.lineTo(-6, -38);
    ctx.quadraticCurveTo(-16, -36, -17.5, -29);
    ctx.bezierCurveTo(-19, -20, -18.5, -5, -15, 7);
    ctx.closePath();
  }

  drawTorso(ctx, J) {
    ctx.save();
    ctx.translate(J.hip[0], J.hip[1]);
    ctx.rotate(J.lean);

    // jacket body
    this.torsoPath(ctx);
    ctx.fillStyle = this.patterns.suit;
    ctx.fill();
    ctx.save();
    ctx.clip();
    const sh = ctx.createLinearGradient(-18, -38, 18, 7);
    sh.addColorStop(0, 'rgba(255,255,255,0.08)');
    sh.addColorStop(0.55, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = sh;
    ctx.fillRect(-20, -40, 40, 50);

    // vest (visible in the open jacket)
    ctx.beginPath();
    ctx.moveTo(-5, -37);
    ctx.lineTo(8, -37);
    ctx.lineTo(10, -8);
    ctx.lineTo(6.5, 5);
    ctx.lineTo(2, 2.5);
    ctx.lineTo(-3, 5);
    ctx.lineTo(-6.5, -8);
    ctx.closePath();
    ctx.fillStyle = this.patterns.vest;
    ctx.fill();
    ctx.strokeStyle = COL.outline;
    ctx.lineWidth = 0.9;
    ctx.stroke();

    // black shirt V
    ctx.beginPath();
    ctx.moveTo(-3, -38);
    ctx.lineTo(6.5, -38);
    ctx.lineTo(2, -23);
    ctx.closePath();
    ctx.fillStyle = COL.shirt;
    ctx.fill();
    // collar points
    ctx.fillStyle = '#18181b';
    ctx.beginPath();
    ctx.moveTo(-3, -38.5);
    ctx.lineTo(1, -33.5);
    ctx.lineTo(-1.2, -32.5);
    ctx.closePath();
    ctx.moveTo(6.5, -38.5);
    ctx.lineTo(3, -33.5);
    ctx.lineTo(5.4, -32.5);
    ctx.closePath();
    ctx.fill();

    // tie (patterned black)
    ctx.beginPath();
    ctx.moveTo(0.6, -35.5);
    ctx.lineTo(3.4, -35.5);
    ctx.lineTo(2.9, -33.3);
    ctx.lineTo(4.1, -22);
    ctx.lineTo(2, -19.5);
    ctx.lineTo(-0.1, -22);
    ctx.lineTo(1.1, -33.3);
    ctx.closePath();
    ctx.fillStyle = this.patterns.tie;
    ctx.fill();
    ctx.strokeStyle = COL.outline;
    ctx.lineWidth = 0.7;
    ctx.stroke();

    // vest buttons
    ctx.fillStyle = '#4a4650';
    for (const y of [-17, -12, -7]) {
      ctx.beginPath();
      ctx.arc(2.6, y, 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
    // gold watch chain: two swags across the vest
    ctx.strokeStyle = COL.gold;
    ctx.lineWidth = 0.8;
    ctx.setLineDash([0.9, 0.5]);
    ctx.beginPath();
    ctx.moveTo(-5, -9);
    ctx.quadraticCurveTo(-1.5, -3.5, 2.6, -7);
    ctx.quadraticCurveTo(6.5, -3, 9.4, -8.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COL.gold;
    ctx.beginPath();
    ctx.arc(2.6, -7, 0.7, 0, Math.PI * 2);
    ctx.fill();

    // lapels
    ctx.fillStyle = this.patterns.suit;
    ctx.strokeStyle = COL.outline;
    ctx.lineWidth = 0.9;
    ctx.beginPath(); // far lapel
    ctx.moveTo(-5.5, -38);
    ctx.lineTo(-9.5, -31);
    ctx.lineTo(-6.8, -29.5);
    ctx.lineTo(-7.8, -26.5);
    ctx.lineTo(-6.6, -9);
    ctx.lineTo(-4.5, -24);
    ctx.lineTo(-2.5, -37);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath(); // near lapel
    ctx.moveTo(8.5, -38);
    ctx.lineTo(13, -31);
    ctx.lineTo(10.3, -29.5);
    ctx.lineTo(11.4, -26.5);
    ctx.lineTo(10, -9);
    ctx.lineTo(7.5, -24);
    ctx.lineTo(5.8, -37);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-9, -30.5);
    ctx.lineTo(-6.6, -10);
    ctx.moveTo(12.5, -30.5);
    ctx.lineTo(10, -10);
    ctx.stroke();

    // lapel pin
    ctx.fillStyle = '#6a6470';
    ctx.beginPath();
    ctx.arc(11.3, -27.5, 0.7, 0, Math.PI * 2);
    ctx.fill();

    // breast pocket + pocket square
    ctx.strokeStyle = COL.outline;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(11.5, -21);
    ctx.lineTo(16.5, -21.6);
    ctx.stroke();
    ctx.fillStyle = COL.square;
    ctx.beginPath();
    ctx.moveTo(12, -21.1);
    ctx.lineTo(12.8, -23.6);
    ctx.lineTo(13.9, -22);
    ctx.lineTo(15, -24);
    ctx.lineTo(16, -21.7);
    ctx.closePath();
    ctx.fill();

    // side pockets
    ctx.strokeStyle = COL.outline;
    ctx.beginPath();
    ctx.moveTo(10.5, -2);
    ctx.lineTo(16.5, -2.6);
    ctx.moveTo(-15.5, -2.6);
    ctx.lineTo(-10, -2);
    ctx.stroke();
    ctx.restore(); // unclip

    // outline
    this.torsoPath(ctx);
    ctx.strokeStyle = COL.outline;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  headPath(ctx) {
    ctx.beginPath();
    ctx.moveTo(-10.5, -3);
    ctx.bezierCurveTo(-10.5, -13.5, -3, -16.5, 2, -16.5);
    ctx.bezierCurveTo(8.5, -16.5, 12.5, -12, 12.5, -4);
    ctx.lineTo(12.7, 4);
    ctx.bezierCurveTo(12.7, 11, 7.5, 15.8, 1.5, 15.8);
    ctx.bezierCurveTo(-5, 15.8, -10.5, 11, -10.5, 4);
    ctx.closePath();
  }

  drawHead(ctx, pose, J) {
    ctx.save();
    ctx.translate(J.head[0], J.head[1]);
    ctx.rotate(J.headAngle);

    // thick neck
    ctx.fillStyle = COL.skinShade;
    ctx.fillRect(-6, 8, 12, 9);

    // ear
    ctx.fillStyle = COL.skin;
    ctx.strokeStyle = COL.outline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(-8.8, -0.5, 2.8, 4, 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = COL.skinShade;
    ctx.beginPath();
    ctx.arc(-8.6, -0.5, 1.5, -1.2, 1.5);
    ctx.stroke();

    // face
    this.headPath(ctx);
    ctx.fillStyle = COL.skin;
    ctx.fill();
    ctx.save();
    ctx.clip();
    const g = ctx.createRadialGradient(5, -6, 2, 2, 0, 18);
    g.addColorStop(0, COL.skinHi);
    g.addColorStop(0.6, COL.skin);
    g.addColorStop(1, COL.skinShade);
    ctx.fillStyle = g;
    ctx.fillRect(-12, -18, 26, 36);
    if (pose.flush > 0.01) {
      ctx.fillStyle = `rgba(225, 40, 30, ${0.55 * pose.flush})`;
      ctx.fillRect(-12, -18, 26, 36);
    }
    // cheeks
    ctx.fillStyle = COL.cheek;
    ctx.beginPath();
    ctx.ellipse(9, 0.8, 2.8, 2, 0, 0, Math.PI * 2);
    ctx.ellipse(0.5, 0.8, 2.6, 1.9, 0, 0, Math.PI * 2);
    ctx.fill();

    // buzz cut
    ctx.beginPath();
    ctx.moveTo(-11, -0.5);
    ctx.bezierCurveTo(-11.5, -12, -3, -17.2, 2, -17);
    ctx.bezierCurveTo(8.5, -17, 12.8, -13, 12.2, -9);
    ctx.bezierCurveTo(9.5, -11, 6, -11.6, 3, -11.2);
    ctx.bezierCurveTo(-1, -10.6, -4.5, -8.5, -6, -4.5);
    ctx.lineTo(-6.6, -0.5);
    ctx.closePath();
    ctx.fillStyle = COL.hair;
    ctx.fill();
    ctx.fillStyle = COL.hairGrey;
    const r = seeded(3);
    for (let i = 0; i < 40; i++) {
      const x = -10 + r() * 21, y = -16 + r() * 12;
      ctx.fillRect(x, y, 0.35, 0.35);
    }

    // beard (full, dark with grey flecks)
    ctx.beginPath();
    ctx.moveTo(-8.2, -2.5);
    ctx.bezierCurveTo(-10.5, 6, -6, 16.8, 1.8, 16.8);
    ctx.bezierCurveTo(8.5, 16.8, 13.4, 11.5, 13.2, 3.5);
    ctx.lineTo(12.8, 1);
    ctx.bezierCurveTo(11.5, 3.2, 9.5, 3.4, 7.5, 3);
    ctx.bezierCurveTo(4.5, 2.6, 1.5, 3.1, -0.8, 2.2);
    ctx.bezierCurveTo(-3.5, 1.2, -5.5, 0, -6.4, -2.5);
    ctx.closePath();
    ctx.fillStyle = COL.beard;
    ctx.fill();
    ctx.fillStyle = COL.hairGrey;
    for (let i = 0; i < 70; i++) {
      const x = -8 + r() * 21, y = 2 + r() * 14;
      ctx.fillRect(x, y, 0.4, 0.4);
    }
    ctx.restore();

    this.headPath(ctx);
    ctx.strokeStyle = COL.outline;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // nose (broad, in profile on the facing side)
    ctx.beginPath();
    ctx.moveTo(9.8, -3.5);
    ctx.bezierCurveTo(11.4, -1.2, 13.8, 0.8, 13.3, 2.4);
    ctx.bezierCurveTo(12.9, 3.6, 11, 3.8, 9.8, 3);
    ctx.fillStyle = COL.skin;
    ctx.fill();
    ctx.strokeStyle = COL.outline;
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.fillStyle = COL.skinShade;
    ctx.beginPath();
    ctx.ellipse(11.4, 2.5, 0.9, 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    this.drawEyes(ctx, pose);
    this.drawMouth(ctx, pose);
    ctx.restore();
  }

  drawEyes(ctx, pose) {
    const eyes = [
      [1, -4.2],
      [8, -4.2],
    ];
    const brow = pose.brow;
    const lx = pose.look[0] * 0.8, ly = pose.look[1] * 0.5;
    ctx.lineCap = 'round';
    // brows: thick and dark
    ctx.strokeStyle = COL.hair;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(-2, -8.2 + brow * 0.2);
    ctx.lineTo(3.2, -8.4 + brow * 1.7);
    ctx.moveTo(5.8, -8.4 + brow * 1.7);
    ctx.lineTo(10.8, -8.0 + brow * 0.2);
    ctx.stroke();

    ctx.strokeStyle = COL.outline;
    ctx.fillStyle = COL.outline;
    ctx.lineWidth = 1.1;
    for (const [ex, ey] of eyes) {
      switch (pose.eyes) {
        case 'closed':
          ctx.beginPath();
          ctx.arc(ex, ey - 0.6, 1.8, 0.25 * Math.PI, 0.75 * Math.PI);
          ctx.stroke();
          break;
        case 'happy':
          ctx.beginPath();
          ctx.arc(ex, ey + 0.8, 1.9, 1.2 * Math.PI, 1.8 * Math.PI);
          ctx.stroke();
          break;
        case 'wide':
          ctx.fillStyle = '#fbf7f0';
          ctx.beginPath();
          ctx.ellipse(ex, ey, 1.9, 2.1, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = COL.outline;
          ctx.beginPath();
          ctx.arc(ex + lx * 0.6, ey + ly * 0.6, 0.8, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'angry':
          ctx.beginPath();
          ctx.moveTo(ex - 1.8, ey - 0.4);
          ctx.lineTo(ex + 1.8, ey + 0.3);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(ex + lx * 0.4, ey + 0.4, 0.7, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'half':
          ctx.beginPath();
          ctx.moveTo(ex - 1.8, ey);
          ctx.lineTo(ex + 1.8, ey);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(ex + lx * 0.5, ey + 0.6, 0.65, 0, Math.PI);
          ctx.fill();
          break;
        case 'dizzy': {
          ctx.beginPath();
          for (let t = 0; t < 10; t += 0.4) {
            const rr = t * 0.2;
            const x = ex + Math.cos(t + pose.mouth * 9) * rr, y = ey + Math.sin(t + pose.mouth * 9) * rr;
            t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.lineWidth = 0.6;
          ctx.stroke();
          ctx.lineWidth = 1.1;
          break;
        }
        default:
          // his trademark squint: cheeks push the lower lid up
          ctx.fillStyle = '#fbf7f0';
          ctx.beginPath();
          ctx.ellipse(ex, ey, 1.7, 1.0, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#2b1d16';
          ctx.beginPath();
          ctx.arc(ex + lx * 0.6, ey + ly * 0.4, 0.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(ex - 2, ey - 0.3);
          ctx.quadraticCurveTo(ex, ey - 1.6, ex + 2, ey - 0.3);
          ctx.stroke();
          ctx.strokeStyle = COL.skinShade;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(ex - 1.6, ey + 1.2);
          ctx.quadraticCurveTo(ex, ey + 1.9, ex + 1.6, ey + 1.2);
          ctx.stroke();
          ctx.strokeStyle = COL.outline;
          ctx.lineWidth = 1.1;
      }
    }
    // crow's feet from grinning
    if (['open', 'happy'].includes(pose.eyes)) {
      ctx.strokeStyle = COL.skinShade;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(-1.6, -4.4);
      ctx.lineTo(-2.8, -5);
      ctx.moveTo(-1.6, -3.6);
      ctx.lineTo(-2.9, -3.3);
      ctx.stroke();
    }
  }

  drawMouth(ctx, pose) {
    const m = pose.mouth;
    const shape = pose.mouthShape;
    ctx.lineJoin = 'round';
    const outline = () => {
      ctx.strokeStyle = COL.outline;
      ctx.lineWidth = 0.9;
      ctx.stroke();
    };
    // mustache sits over every mouth
    const mustache = () => {
      ctx.fillStyle = COL.beard;
      ctx.beginPath();
      ctx.moveTo(-1.5, 4.6);
      ctx.bezierCurveTo(1.5, 2.6, 7, 2.2, 11.8, 3.8);
      ctx.bezierCurveTo(9, 4.6, 4, 4.8, -1.5, 4.6);
      ctx.fill();
    };

    if (shape === 'grin' || shape === 'talk' || shape === 'laugh' || shape === 'shout') {
      const open = shape === 'grin' ? 0.15 + m * 0.5 : shape === 'talk' ? m : shape === 'laugh' ? 0.6 + m * 0.5 : 0.7 + m * 0.5;
      const bottom = 8.8 + open * 4.2;
      ctx.beginPath();
      ctx.moveTo(-1.8, 4.8);
      ctx.bezierCurveTo(2, 3.9, 8, 3.7, 12, 4.4);
      ctx.bezierCurveTo(11, bottom - 1, 8, bottom, 5, bottom);
      ctx.bezierCurveTo(1.8, bottom, -0.6, bottom - 2.5, -1.8, 4.8);
      ctx.closePath();
      ctx.fillStyle = COL.mouth;
      ctx.fill();
      ctx.save();
      ctx.clip();
      // upper teeth
      ctx.fillStyle = COL.teeth;
      ctx.beginPath();
      ctx.moveTo(-2, 4.6);
      ctx.bezierCurveTo(2, 3.8, 8, 3.6, 12.5, 4.3);
      ctx.lineTo(12.5, 7.2);
      ctx.bezierCurveTo(8, 6.8, 2, 7.0, -2, 7.4);
      ctx.closePath();
      ctx.fill();
      // lower teeth (visible when the jaw is mostly closed)
      if (open < 0.7) {
        ctx.beginPath();
        ctx.moveTo(-1, bottom - 2.2);
        ctx.bezierCurveTo(3, bottom - 1.2, 8, bottom - 1.4, 12, bottom - 2.8);
        ctx.lineTo(12, bottom + 1);
        ctx.lineTo(-1, bottom + 1);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = COL.tongue;
        ctx.beginPath();
        ctx.ellipse(5, bottom - 0.6, 4.2, 2.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = COL.teethLine;
      ctx.lineWidth = 0.4;
      for (let x = 0.5; x < 12; x += 1.7) {
        ctx.beginPath();
        ctx.moveTo(x, 4);
        ctx.lineTo(x + 0.1, 7.1);
        ctx.stroke();
      }
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(-1.8, 4.8);
      ctx.bezierCurveTo(2, 3.9, 8, 3.7, 12, 4.4);
      ctx.bezierCurveTo(11, bottom - 1, 8, bottom, 5, bottom);
      ctx.bezierCurveTo(1.8, bottom, -0.6, bottom - 2.5, -1.8, 4.8);
      outline();
      // smile creases
      ctx.strokeStyle = COL.skinShade;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(-2.6, 2.6);
      ctx.quadraticCurveTo(-3.4, 5, -2.4, 7.2);
      ctx.stroke();
      mustache();
      return;
    }
    if (shape === 'grit') {
      ctx.beginPath();
      ctx.rect(0, 4.8, 11, 3.6);
      ctx.fillStyle = COL.teeth;
      ctx.fill();
      outline();
      ctx.strokeStyle = COL.teethLine;
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.moveTo(0, 6.6);
      ctx.lineTo(11, 6.6);
      for (let x = 1.6; x < 11; x += 1.6) {
        ctx.moveTo(x, 4.8);
        ctx.lineTo(x, 8.4);
      }
      ctx.stroke();
      mustache();
      return;
    }
    if (shape === 'o') {
      ctx.beginPath();
      ctx.ellipse(5.5, 7, 1.8 + m * 1.2, 1.6 + m * 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = COL.mouth;
      ctx.fill();
      outline();
      mustache();
      return;
    }
    if (shape === 'frown') {
      ctx.beginPath();
      ctx.moveTo(0.5, 8.5);
      ctx.quadraticCurveTo(5.5, 4.8, 10.5, 8.5);
      ctx.strokeStyle = COL.outline;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      mustache();
      return;
    }
    if (shape === 'smirk') {
      ctx.beginPath();
      ctx.moveTo(1, 6.4);
      ctx.quadraticCurveTo(6, 7.6, 11, 4.6);
      ctx.strokeStyle = COL.outline;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      mustache();
      return;
    }
    if (shape === 'wobble') {
      ctx.beginPath();
      for (let x = 0; x <= 11; x += 0.5) {
        const y = 7 + Math.sin(x * 1.6) * 0.8;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = COL.outline;
      ctx.lineWidth = 1;
      ctx.stroke();
      mustache();
      return;
    }
    // 'smile' (closed)
    ctx.beginPath();
    ctx.moveTo(-0.5, 5.2);
    ctx.quadraticCurveTo(5.5, 9.2, 11.5, 4.8);
    ctx.strokeStyle = COL.outline;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    mustache();
  }

  /** Approximate head box in character units (for effects placement). */
  headAnchor(J) {
    return J.head;
  }
}

export const VECTOR_COLORS = COL;
