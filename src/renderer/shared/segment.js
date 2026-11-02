// Turns a background-free photo of a person into puppet parts.
// Given joint positions (auto-guessed, then adjustable), every opaque pixel is assigned to the
// nearest "bone capsule" (head, torso, upper/lower arms, thighs, shins). Each part is cut out
// with a small overlap so the joints don't show seams when limbs rotate.
//
// Works in any browser context (Electron renderer, or Chromium via the build script).

export const PART_NAMES = ['head', 'jaw', 'torso', 'upperArmN', 'foreArmN', 'upperArmF', 'foreArmF', 'thighN', 'shinN', 'thighF', 'shinF'];

/** Bounding box of opaque pixels. */
export function alphaBounds(alpha, w, h, thr = 40) {
  let x1 = w, y1 = h, x2 = -1, y2 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > thr) {
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
      }
    }
  }
  return x2 < 0 ? null : { x1, y1, x2, y2 };
}

function rowSpan(alpha, w, y, thr = 40) {
  let a = -1, b = -1;
  for (let x = 0; x < w; x++) {
    if (alpha[y * w + x] > thr) {
      if (a < 0) a = x;
      b = x;
    }
  }
  return a < 0 ? null : [a, b];
}

/** Centroid x of opaque pixels in a row band, optionally restricted to x range. */
function bandCentroid(alpha, w, y0, y1, xa = 0, xb = w - 1, thr = 40) {
  let s = 0, n = 0;
  for (let y = Math.max(0, y0 | 0); y <= y1; y++) for (let x = Math.max(0, xa | 0); x <= Math.min(w - 1, xb); x++) if (alpha[y * w + x] > thr) {
    s += x;
    n++;
  }
  return n ? s / n : (xa + xb) / 2;
}

/**
 * Guess joint positions from the silhouette using typical human proportions.
 * Returns joints in image pixel coordinates. "N" limbs are on the viewer's right.
 */
export function autoJoints(alpha, w, h) {
  const b = alphaBounds(alpha, w, h);
  if (!b) throw new Error('The image has no visible subject. Remove the background first.');
  const T = b.y1, B = b.y2, H = B - T;
  const at = (f) => Math.round(T + f * H);
  const cx = bandCentroid(alpha, w, at(0.0), at(0.08));
  const shY = at(0.2);
  const sh = rowSpan(alpha, w, shY) || [cx - H * 0.12, cx + H * 0.12];
  const shHalf = Math.min((sh[1] - sh[0]) / 2, H * 0.17);
  const bodyCx = (sh[0] + sh[1]) / 2;
  const hipY = at(0.5);
  const legBand = [at(0.78), at(0.9)];
  const lx = bandCentroid(alpha, w, legBand[0], legBand[1], b.x1, bodyCx);
  const rx = bandCentroid(alpha, w, legBand[0], legBand[1], bodyCx, b.x2);
  const knY = at(0.73), anY = at(0.95);
  const elY = at(0.37), haY = at(0.5);
  const elSpan = rowSpan(alpha, w, elY) || sh;
  const haSpan = rowSpan(alpha, w, haY) || sh;
  return {
    headTop: [cx, T],
    neck: [cx, at(0.145)],
    mouthY: at(0.105),
    hip: [bodyCx, hipY],
    shoulderN: [bodyCx + shHalf * 0.72, at(0.2)],
    elbowN: [Math.max(bodyCx + shHalf * 0.8, elSpan[1] - H * 0.04), elY],
    handN: [Math.max(bodyCx + shHalf * 0.7, haSpan[1] - H * 0.035), haY],
    shoulderF: [bodyCx - shHalf * 0.72, at(0.2)],
    elbowF: [Math.min(bodyCx - shHalf * 0.8, elSpan[0] + H * 0.04), elY],
    handF: [Math.min(bodyCx - shHalf * 0.7, haSpan[0] + H * 0.035), haY],
    hipN: [bodyCx + H * 0.065, hipY],
    kneeN: [rx, knY],
    ankleN: [rx, anY],
    hipF: [bodyCx - H * 0.065, hipY],
    kneeF: [lx, knY],
    ankleF: [lx, anY],
    sole: [bodyCx, B],
  };
}

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const L2 = vx * vx + vy * vy || 1;
  let t = ((px - ax) * vx + (py - ay) * vy) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + vx * t), dy = py - (ay + vy * t);
  return Math.sqrt(dx * dx + dy * dy);
}

function extend(a, b, f) {
  return [b[0] + (b[0] - a[0]) * f, b[1] + (b[1] - a[1]) * f];
}

/**
 * Label every opaque pixel with a part index (PART_NAMES), 255 = transparent.
 */
export function labelPixels(alpha, w, h, J, opts = {}) {
  const H = J.sole[1] - J.headTop[1];
  const shoulderHalf = Math.abs(J.shoulderN[0] - J.shoulderF[0]) / 2;
  const caps = [
    // [partIndex, a, b, radius, yMin, yMax]
    [2, J.neck, J.hip, Math.max(shoulderHalf * 1.05, H * 0.1), J.neck[1] - H * 0.03, J.hip[1] + H * (opts.hem ?? 0.07)],
    [3, J.shoulderN, J.elbowN, H * 0.055, -Infinity, Infinity],
    [4, J.elbowN, extend(J.elbowN, J.handN, 0.25), H * 0.05, -Infinity, Infinity],
    [5, J.shoulderF, J.elbowF, H * 0.055, -Infinity, Infinity],
    [6, J.elbowF, extend(J.elbowF, J.handF, 0.25), H * 0.05, -Infinity, Infinity],
    [7, J.hipN, J.kneeN, H * 0.075, J.hip[1] - H * 0.04, Infinity],
    [8, J.kneeN, [J.ankleN[0], J.sole[1]], H * 0.065, J.kneeN[1] - H * 0.06, Infinity],
    [9, J.hipF, J.kneeF, H * 0.075, J.hip[1] - H * 0.04, Infinity],
    [10, J.kneeF, [J.ankleF[0], J.sole[1]], H * 0.065, J.kneeF[1] - H * 0.06, Infinity],
  ];
  const labels = new Uint8Array(w * h).fill(255);
  const headCx = J.headTop[0];
  const neckY = J.neck[1];
  const mouthY = J.mouthY;
  const jawHalf = H * 0.06;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (alpha[i] <= 8) continue;
      let best = 2, bestScore = Infinity;
      for (const [idx, a, b, r, y0, y1] of caps) {
        if (y < y0 || y > y1) continue;
        const s = segDist(x, y, a[0], a[1], b[0], b[1]) / r;
        if (s < bestScore) {
          bestScore = s;
          best = idx;
        }
      }
      if (y < neckY && !(best >= 3 && best <= 6 && bestScore < 0.9)) {
        best = mouthY && y > mouthY && Math.abs(x - headCx) < jawHalf * 1.6 && opts.jaw !== false ? 1 : 0;
      }
      labels[i] = best;
    }
  }
  return labels;
}

/**
 * Cut the parts out. `ctxFactory(w,h)` must return a 2D canvas (HTMLCanvas or OffscreenCanvas).
 * Returns { parts: {name: {x, y, w, h, canvas}} }.
 */
export function cutParts(imageData, labels, ctxFactory, overlap = 3) {
  const { width: w, height: h, data } = imageData;
  const out = {};
  PART_NAMES.forEach((name, idx) => {
    // bounding box + dilated membership
    let x1 = w, y1 = h, x2 = -1, y2 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (labels[y * w + x] === idx) {
      if (x < x1) x1 = x;
      if (x > x2) x2 = x;
      if (y < y1) y1 = y;
      if (y > y2) y2 = y;
    }
    if (x2 < 0) return;
    x1 = Math.max(0, x1 - overlap);
    y1 = Math.max(0, y1 - overlap);
    x2 = Math.min(w - 1, x2 + overlap);
    y2 = Math.min(h - 1, y2 + overlap);
    const pw = x2 - x1 + 1, ph = y2 - y1 + 1;
    const canvas = ctxFactory(pw, ph);
    const g = canvas.getContext('2d');
    const img = g.createImageData(pw, ph);
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const i = y * w + x;
        if (data[i * 4 + 3] <= 8) continue;
        let mine = labels[i] === idx;
        if (!mine && name !== 'jaw') {
          // overlap into neighbouring parts so joints stay closed when rotated
          for (let dy = -overlap; dy <= overlap && !mine; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= h) continue;
            for (let dx = -overlap; dx <= overlap; dx++) {
              const xx = x + dx;
              if (xx >= 0 && xx < w && labels[yy * w + xx] === idx) {
                mine = true;
                break;
              }
            }
          }
        }
        if (!mine) continue;
        const o = ((y - y1) * pw + (x - x1)) * 4;
        img.data[o] = data[i * 4];
        img.data[o + 1] = data[i * 4 + 1];
        img.data[o + 2] = data[i * 4 + 2];
        img.data[o + 3] = data[i * 4 + 3];
      }
    }
    g.putImageData(img, 0, 0);
    out[name] = { x: x1, y: y1, w: pw, h: ph, canvas };
  });
  return out;
}

/** Average skin colour sampled from the face/hand area (used for drawn-in hands). */
export function sampleSkin(imageData, J) {
  const { width: w, data } = imageData;
  const H = J.sole[1] - J.headTop[1];
  const cx = J.headTop[0], cy = J.headTop[1] + H * 0.06;
  let r = 0, g = 0, b = 0, n = 0;
  const R = Math.max(2, H * 0.015);
  for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
    const i = ((y | 0) * w + (x | 0)) * 4;
    if (data[i + 3] < 200) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  if (!n) return '#c08a6a';
  const hx = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

/** Simple background removal for photos with a plain-ish background: flood fill from the edges. */
export function floodRemoveBackground(imageData, tolerance = 38) {
  const { width: w, height: h, data } = imageData;
  const visited = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y, ref) => {
    const i = y * w + x;
    if (visited[i]) return;
    const o = i * 4;
    const d = Math.abs(data[o] - ref[0]) + Math.abs(data[o + 1] - ref[1]) + Math.abs(data[o + 2] - ref[2]);
    if (d > tolerance * 3) return;
    visited[i] = 1;
    stack.push(x, y, data[o], data[o + 1], data[o + 2]);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0, [data[x * 4], data[x * 4 + 1], data[x * 4 + 2]]);
    const o = ((h - 1) * w + x) * 4;
    push(x, h - 1, [data[o], data[o + 1], data[o + 2]]);
  }
  for (let y = 0; y < h; y++) {
    const o1 = y * w * 4, o2 = (y * w + w - 1) * 4;
    push(0, y, [data[o1], data[o1 + 1], data[o1 + 2]]);
    push(w - 1, y, [data[o2], data[o2 + 1], data[o2 + 2]]);
  }
  while (stack.length) {
    const b = stack.pop(), g = stack.pop(), r = stack.pop(), y = stack.pop(), x = stack.pop();
    const ref = [r, g, b];
    if (x > 0) push(x - 1, y, ref);
    if (x < w - 1) push(x + 1, y, ref);
    if (y > 0) push(x, y - 1, ref);
    if (y < h - 1) push(x, y + 1, ref);
  }
  for (let i = 0; i < w * h; i++) if (visited[i]) data[i * 4 + 3] = 0;
  return imageData;
}

/** Build the rig description consumed by PhotoCharacter. */
export function buildRig(J, parts, skin) {
  return {
    version: 1,
    joints: J,
    skin,
    parts: Object.fromEntries(Object.entries(parts).map(([n, p]) => [n, { file: `${n}.png`, x: p.x, y: p.y, w: p.w, h: p.h }])),
  };
}
