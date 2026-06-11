/*
 * utils.test.mjs
 * Unit tests for the pure engine logic. Run with: npm test (node --test).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp, lerp, dist2, easeOutCubic, mulberry32, buildSchedule,
  flightDuration, strideForBudget, nearestK, ambientCount, formatClicks,
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
  assert.equal(dist2(1, 1, 1, 1), 0);
});

test('easeOutCubic hits its endpoints and stays in bounds', () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(-1), 0, 'clamps below');
  assert.equal(easeOutCubic(2), 1, 'clamps above');
  let prev = 0;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const v = easeOutCubic(t);
    assert.ok(v >= prev - 1e-12, 'monotonic non-decreasing');
    assert.ok(v >= 0 && v <= 1);
    prev = v;
  }
});

test('mulberry32 is deterministic and uniform-ish in [0, 1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const c = mulberry32(43);
  const seqA = Array.from({ length: 8 }, () => a());
  const seqB = Array.from({ length: 8 }, () => b());
  const seqC = Array.from({ length: 8 }, () => c());
  assert.deepEqual(seqA, seqB, 'same seed, same stream');
  assert.notDeepEqual(seqA, seqC, 'different seed, different stream');
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
  const mean = Array.from({ length: 5000 }, () => a()).reduce((s, v) => s + v, 0) / 5000;
  assert.ok(Math.abs(mean - 0.5) < 0.03, `mean ~0.5, got ${mean}`);
});

test('buildSchedule clamps total stagger and orders delays', () => {
  const rng = mulberry32(7);
  const short = buildSchedule(4, { rng });
  assert.equal(short.total, 220, 'short text clamps to minTotal');
  const long = buildSchedule(500, { rng });
  assert.equal(long.total, 1150, 'long text clamps to maxTotal');
  const mid = buildSchedule(40, { rng });
  assert.equal(mid.total, 40 * 16);
  assert.equal(mid.delays.length, 40);
  assert.ok(mid.delays[39] > mid.delays[0], 'reads left to right');
  for (let i = 0; i < 40; i++) {
    assert.ok(mid.delays[i] >= i * mid.step, 'never earlier than its slot');
    assert.ok(mid.delays[i] <= (i + 0.351) * mid.step, 'jitter stays bounded');
  }
});

test('buildSchedule survives degenerate input', () => {
  const s = buildSchedule(0);
  assert.equal(s.delays.length, 1);
});

test('flightDuration stays within base ± spread/2', () => {
  const rng = mulberry32(99);
  for (let i = 0; i < 200; i++) {
    const d = flightDuration(rng, 430, 160);
    assert.ok(d >= 350 && d <= 510, `duration in range, got ${d}`);
  }
});

test('strideForBudget keeps the particle count under budget', () => {
  assert.equal(strideForBudget(1000, 3600), 3, 'small text keeps fine stride');
  const s = strideForBudget(200000, 3600);
  assert.ok(200000 / (s * s) <= 3600, 'budget respected');
  assert.ok(s <= 8, 'stride is capped');
  assert.equal(strideForBudget(10_000_000, 100), 8, 'hard ceiling');
});

test('nearestK returns the k closest pool indices', () => {
  const pool = [
    { x: 100, y: 100 },
    { x: 1, y: 1 },
    { x: 50, y: 50 },
    { x: 2, y: 2 },
  ];
  const idx = nearestK(pool, 0, 0, 2);
  assert.deepEqual(idx.sort(), [1, 3]);
  assert.equal(nearestK(pool, 0, 0, 0).length, 0);
  assert.equal(nearestK(pool, 0, 0, 10).length, 4, 'k beyond pool size is safe');
});

test('ambientCount scales with area and clamps', () => {
  assert.equal(ambientCount(320, 480), 60, 'small viewport floor');
  assert.equal(ambientCount(3840, 2160), 170, 'huge viewport ceiling');
  const mid = ambientCount(1440, 900);
  assert.ok(mid > 60 && mid < 170);
  assert.equal(mid, Math.round((1440 * 900) / 13500));
});

test('formatClicks pluralizes like Los Feliz', () => {
  assert.equal(formatClicks(0), '0 CLICKS');
  assert.equal(formatClicks(1), '1 CLICK');
  assert.equal(formatClicks(378), '378 CLICKS');
});
