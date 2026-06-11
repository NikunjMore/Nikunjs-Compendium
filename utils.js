/*
 * utils.js
 * Pure helpers for the dot engine. Zero DOM access, so every export
 * here is unit-testable under `node --test` (see utils.test.mjs).
 */

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const lerp = (a, b, t) => a + (b - a) * t;

export const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

/* Cubic ease-out: fast launch, soft landing. Used for every dot flight. */
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

/* Mulberry32: tiny deterministic PRNG so visuals (and tests) are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/*
 * buildSchedule
 * Left-to-right reading-order stagger: char i starts at roughly i * step,
 * with a little jitter so the wave of dots feels organic, not mechanical.
 * Total stagger is clamped so short tokens snap and long paragraphs
 * still finish fast (Los Feliz pacing, slightly smoothed).
 */
export function buildSchedule(nChars, {
  minTotal = 220,
  maxTotal = 1150,
  perChar = 16,
  jitter = 0.35,
  rng = Math.random,
} = {}) {
  const n = Math.max(1, nChars | 0);
  const total = clamp(n * perChar, minTotal, maxTotal);
  const step = total / n;
  const delays = new Array(n);
  for (let i = 0; i < n; i++) delays[i] = i * step + rng() * step * jitter;
  return { total, step, delays };
}

/* Per-dot flight time, mildly randomized. */
export function flightDuration(rng = Math.random, base = 430, spread = 160) {
  return base + (rng() - 0.5) * spread;
}

/*
 * strideForBudget
 * Glyphs are rasterized and sampled every `stride` pixels. Given an
 * estimate of total ink pixels, pick the smallest stride (>= 3) that
 * keeps the particle count under budget. Hard ceiling of 8.
 */
export function strideForBudget(estInkPx, budget) {
  let s = 3;
  while (s < 8 && estInkPx / (s * s) > budget) s++;
  return s;
}

/* Indices of the k pool entries nearest to (x, y). Pool entries: {x, y}. */
export function nearestK(pool, x, y, k) {
  const scored = pool.map((p, i) => ({ i, d: dist2(p.x, p.y, x, y) }));
  scored.sort((a, b) => a.d - b.d);
  return scored.slice(0, Math.max(0, k | 0)).map((s) => s.i);
}

/* Ambient dot population for a given viewport. Visible but never a snowstorm. */
export function ambientCount(w, h, density = 13500, lo = 60, hi = 170) {
  return Math.round(clamp((w * h) / density, lo, hi));
}

/* Click-counter label, Los Feliz style. */
export function formatClicks(n) {
  return `${n} CLICK${n === 1 ? '' : 'S'}`;
}
