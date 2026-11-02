import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../../src/renderer/shared/world.js';
import { subtractIntervals, ShuffleBag } from '../../src/renderer/shared/util.js';
import { fk, ik2, basePose, VECTOR_SKELETON, aimArm } from '../../src/renderer/shared/rig.js';
import { animate, ANIM_NAMES } from '../../src/renderer/shared/animations.js';

test('ground plus visible window tops become platforms', () => {
  const w = new World(1000, 800);
  w.setWindows([
    { id: 1, x: 100, y: 300, w: 400, h: 300 },
    { id: 2, x: 300, y: 200, w: 400, h: 400 },
  ]);
  assert.deepEqual(
    w.platforms.map((p) => [p.id, p.x1, p.x2, p.y]),
    [
      ['ground', 0, 1000, 800],
      ['w1:0', 100, 500, 300],
      ['w2:0', 300, 700, 200],
    ],
  );
});

test('landing finds the first platform crossed while falling', () => {
  const w = new World(1000, 800);
  w.setWindows([{ id: 1, x: 100, y: 300, w: 400, h: 300 }]);
  assert.equal(w.findLanding(200, 290, 310).id, 'w1:0');
  assert.equal(w.findLanding(700, 290, 310), null);
  assert.equal(w.findLanding(700, 790, 805).id, 'ground');
});

test('windows hugging the top of the screen or tiny windows are ignored', () => {
  const w = new World(1000, 800);
  w.setWindows([
    { id: 1, x: 0, y: 0, w: 1000, h: 800 },
    { id: 2, x: 100, y: 400, w: 50, h: 50 },
  ]);
  assert.equal(w.ledges().length, 0);
});

test('interval subtraction', () => {
  assert.deepEqual(subtractIntervals(0, 100, [[20, 30], [50, 120]]), [[0, 20], [30, 50]]);
  assert.deepEqual(subtractIntervals(0, 100, [[-5, 200]]), []);
});

test('shuffle bag deals everything before repeating', () => {
  const b = new ShuffleBag([1, 2, 3, 4]);
  const seen = new Set([b.next(), b.next(), b.next(), b.next()]);
  assert.equal(seen.size, 4);
});

test('forward kinematics keeps feet on the ground for grounded poses', () => {
  for (const name of ['idle', 'walk', 'run', 'land', 'angry', 'celebrate', 'talk']) {
    for (const t of [0, 0.3, 0.77]) {
      const p = animate(name, t, { phase: t * 9, skel: VECTOR_SKELETON });
      if (!p.grounded) continue;
      const J = fk(p, VECTOR_SKELETON);
      const low = Math.max(J.legs.N.ankle[1], J.legs.F.ankle[1]) + VECTOR_SKELETON.footClearance;
      assert.ok(Math.abs(low) < 1e-6, `${name}@${t} feet at ${low}`);
    }
  }
});

test('every animation produces a finite pose', () => {
  for (const name of ANIM_NAMES) {
    const p = animate(name, 0.42, { phase: 2, skel: VECTOR_SKELETON, target: [30, -80], swing: 0.2 });
    const J = fk(p, VECTOR_SKELETON);
    for (const v of [J.head, J.arms.N.hand, J.arms.F.hand, J.legs.N.ankle].flat()) assert.ok(Number.isFinite(v), name);
  }
});

test('IK puts the hand on a reachable target', () => {
  const p = basePose();
  aimArm(p, VECTOR_SKELETON, 'N', [25, -70]);
  const J = fk(p, VECTOR_SKELETON);
  const [hx, hy] = J.arms.N.hand;
  assert.ok(Math.hypot(hx - 25, hy + 70) < 0.5, `hand at ${hx},${hy}`);
  const [a1, a2] = ik2([0, 0], [10, 10], 10, 10);
  assert.ok(Number.isFinite(a1) && Number.isFinite(a2));
});
