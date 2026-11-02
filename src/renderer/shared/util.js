// Small math + randomness helpers shared by the renderer modules (and unit tests).

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const sign = (v) => (v < 0 ? -1 : 1);
export const TAU = Math.PI * 2;

export function rand(a = 0, b = 1) {
  return a + Math.random() * (b - a);
}
export function randInt(a, b) {
  return Math.floor(rand(a, b + 1));
}
export function chance(p) {
  return Math.random() < p;
}
export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Exponential smoothing factor that is frame-rate independent. */
export function damp(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

/** Interpolate angles the short way round. */
export function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * t;
}

export const ease = {
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

/**
 * A "shuffle bag": hands out every item once (in random order) before any repeats,
 * and never gives the same item twice in a row across refills.
 */
export class ShuffleBag {
  constructor(items) {
    this.items = items.slice();
    this.bag = [];
    this.last = undefined;
  }
  next() {
    if (this.items.length === 0) return undefined;
    if (this.bag.length === 0) {
      this.bag = this.items.slice();
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
      if (this.bag.length > 1 && this.bag[this.bag.length - 1] === this.last) {
        [this.bag[0], this.bag[this.bag.length - 1]] = [this.bag[this.bag.length - 1], this.bag[0]];
      }
    }
    this.last = this.bag.pop();
    return this.last;
  }
}

/** Registry of shuffle bags keyed by name, so dialogue categories never repeat back-to-back. */
export class LinePicker {
  constructor(table) {
    this.table = table;
    this.bags = new Map();
  }
  next(key, vars = {}) {
    const list = this.table[key];
    if (!list || list.length === 0) return '';
    if (!this.bags.has(key)) this.bags.set(key, new ShuffleBag(list));
    return fill(this.bags.get(key).next(), vars);
  }
}

/** Replace {placeholders} in a line. */
export function fill(line, vars = {}) {
  return String(line).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}

/** Subtract a list of [a,b] intervals from the interval [x1,x2]; returns remaining pieces. */
export function subtractIntervals(x1, x2, cuts) {
  let pieces = [[x1, x2]];
  for (const [c1, c2] of cuts) {
    const next = [];
    for (const [p1, p2] of pieces) {
      if (c2 <= p1 || c1 >= p2) {
        next.push([p1, p2]);
        continue;
      }
      if (c1 > p1) next.push([p1, c1]);
      if (c2 < p2) next.push([c2, p2]);
    }
    pieces = next;
    if (pieces.length === 0) break;
  }
  return pieces;
}
