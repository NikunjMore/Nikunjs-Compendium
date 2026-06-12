/*
 * utils.test.mjs
 * Unit tests for the pure engine logic. Run with: npm test (node --test).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp, lerp, dist2, easeOutCubic, mulberry32, hash2, vnoise2, curl2,
  springStep, buildSchedule, strideForBudget, poolCount, bestCandidate,
  nearestK, formatClicks, waveField,
} from './utils.js';

test('clamp pins values to the range', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
});

test('lerp interpolates linearly', () => {
  assert.equal(lerp(0, 10, 0), 0);
  assert.equal(lerp(0, 10, 1), 10);
  assert.equal(lerp(0, 10, 0.5), 5);
});

test('dist2 is the squared distance', () => {
  assert.equal(dist2(0, 0, 3, 4), 25);
});

test('easeOutCubic hits endpoints, clamps, and is monotonic', () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(-1), 0);
  assert.equal(easeOutCubic(2), 1);
  let prev = 0;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const v = easeOutCubic(t);
    assert.ok(v >= prev - 1e-12 && v >= 0 && v <= 1);
    prev = v;
  }
});

test('mulberry32 is deterministic and uniform-ish in [0, 1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const c = mulberry32(43);
  const seqA = Array.from({ length: 8 }, () => a());
  assert.deepEqual(seqA, Array.from({ length: 8 }, () => b()));
  assert.notDeepEqual(seqA, Array.from({ length: 8 }, () => c()));
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
  const mean = Array.from({ length: 5000 }, () => a()).reduce((s, v) => s + v, 0) / 5000;
  assert.ok(Math.abs(mean - 0.5) < 0.03);
});

test('hash2 is deterministic and in [0, 1)', () => {
  assert.equal(hash2(3, 7, 1), hash2(3, 7, 1));
  assert.notEqual(hash2(3, 7, 1), hash2(4, 7, 1));
  for (let i = 0; i < 200; i++) {
    const v = hash2(i, i * 31, 5);
    assert.ok(v >= 0 && v < 1);
  }
});

test('vnoise2 is smooth: nearby samples stay close', () => {
  for (let i = 0; i < 60; i++) {
    const x = i * 0.73, y = i * 1.21, t = i * 0.11;
    const d = Math.abs(vnoise2(x + 0.01, y, t) - vnoise2(x, y, t));
    assert.ok(d < 0.06, `noise jumped by ${d} at sample ${i}`);
    const v = vnoise2(x, y, t);
    assert.ok(v >= 0 && v <= 1);
  }
});

test('curl2 is (numerically) divergence-free', () => {
  /* div F = d(u)/dx + d(v)/dy should be ~0 for a curl field */
  const h = 0.05;
  for (let i = 0; i < 25; i++) {
    const x = 0.37 + i * 0.61, y = 1.91 + i * 0.43, t = i * 0.2;
    const dudx = (curl2(x + h, y, t)[0] - curl2(x - h, y, t)[0]) / (2 * h);
    const dvdy = (curl2(x, y + h, t)[1] - curl2(x, y - h, t)[1]) / (2 * h);
    assert.ok(Math.abs(dudx + dvdy) < 0.75, `divergence ${dudx + dvdy} at ${i}`);
  }
});

test('springStep converges to its target', () => {
  let x = 0, v = 0;
  for (let i = 0; i < 240; i++) [x, v] = springStep(x, v, 100, 90, 1 / 60, 0.92);
  assert.ok(Math.abs(x - 100) < 0.5, `settled at ${x}`);
  assert.ok(Math.abs(v) < 1);
});

test('springStep with near-critical damping barely overshoots', () => {
  let x = 0, v = 0, peak = 0;
  for (let i = 0; i < 600; i++) {
    [x, v] = springStep(x, v, 100, 90, 1 / 120, 0.92);
    peak = Math.max(peak, x);
  }
  assert.ok(peak < 108, `overshoot peaked at ${peak}`);
});

test('buildSchedule clamps total stagger and orders delays', () => {
  const rng = mulberry32(7);
  assert.equal(buildSchedule(4, { rng }).total, 200);
  assert.equal(buildSchedule(500, { rng }).total, 980);
  const mid = buildSchedule(40, { rng });
  assert.equal(mid.total, 40 * 13);
  assert.equal(mid.delays.length, 40);
  assert.ok(mid.delays[39] > mid.delays[0]);
  for (let i = 0; i < 40; i++) {
    assert.ok(mid.delays[i] >= i * mid.step);
    assert.ok(mid.delays[i] <= (i + 0.351) * mid.step);
  }
  assert.equal(buildSchedule(0).delays.length, 1, 'degenerate input survives');
});

test('strideForBudget keeps the particle count under budget', () => {
  assert.equal(strideForBudget(1000, 3600), 2, 'small text keeps the finest stride');
  const s = strideForBudget(200000, 3600);
  assert.ok(200000 / (s * s) <= 3600);
  assert.equal(strideForBudget(10_000_000, 100), 8, 'hard ceiling');
});

test('poolCount scales with area and clamps', () => {
  assert.equal(poolCount(320, 480), 2500, 'small viewport floor');
  assert.equal(poolCount(3840, 2160), 16000, 'huge viewport ceiling');
  const mid = poolCount(1440, 900);
  assert.equal(mid, Math.round((1440 * 900) / 110));
  assert.ok(mid > 2500 && mid < 16000);
});

test('bestCandidate returns the nearest of the sampled indices', () => {
  const xs = new Float32Array([100, 1, 50, 2]);
  const ys = new Float32Array([100, 1, 50, 2]);
  assert.equal(bestCandidate([0, 1, 2], xs, ys, 0, 0), 1);
  assert.equal(bestCandidate([0, 2], xs, ys, 0, 0), 2);
  assert.equal(bestCandidate([], xs, ys, 0, 0), -1);
});

test('nearestK returns the k closest pool indices', () => {
  const pool = [
    { x: 100, y: 100 }, { x: 1, y: 1 }, { x: 50, y: 50 }, { x: 2, y: 2 },
  ];
  assert.deepEqual(nearestK(pool, 0, 0, 2).sort(), [1, 3]);
  assert.equal(nearestK(pool, 0, 0, 10).length, 4);
});

test('formatClicks pluralizes like Los Feliz', () => {
  assert.equal(formatClicks(0), '0 CLICKS');
  assert.equal(formatClicks(1), '1 CLICK');
  assert.equal(formatClicks(378), '378 CLICKS');
});

test('waveField is deterministic and bounded', () => {
  const [u1, v1, c1] = waveField(100, 200, 3);
  const [u2, v2, c2] = waveField(100, 200, 3);
  assert.deepEqual([u1, v1, c1], [u2, v2, c2]);
  const lim = 26 * (1 + 0.35 + 0.45) + 1e-9;
  for (let i = 0; i < 400; i++) {
    const [u, v, c] = waveField(i * 37.7, i * 91.3, i * 0.21);
    assert.ok(Math.abs(u) <= lim && Math.abs(v) <= lim);
    assert.ok(c >= -1 && c <= 1);
  }
});

test('waveField repeats one wavelength along the travel direction', () => {
  const o = { chop: 0 };
  const th = 0.6435011087932844;
  const dx = Math.cos(th) * 440;
  const dy = Math.sin(th) * 440;
  const a = waveField(50, 80, 2, o);
  const b = waveField(50 + dx, 80 + dy, 2, o);
  assert.ok(Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6);
});

test('waveField travels: riding a crest keeps the phase', () => {
  const o = { chop: 0 };
  const th = 0.6435011087932844;
  const dt = 1.7;
  const a = waveField(120, 40, 1, o);
  const b = waveField(120 + Math.cos(th) * 90 * dt, 40 + Math.sin(th) * 90 * dt, 1 + dt, o);
  assert.ok(Math.abs(a[2] - b[2]) < 1e-6);
});

test('waveField is periodic in time', () => {
  const o = { chop: 0 };
  const T = 440 / 90;
  const a = waveField(300, 500, 4, o);
  const b = waveField(300, 500, 4 + T, o);
  assert.ok(Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6);
});
