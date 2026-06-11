/*
 * utils.js
 * Pure helpers for the dot engine. Zero DOM/WebGL access, so every export
 * here is unit-testable under `node --test` (see utils.test.mjs).
 * Imported by the Next.js app (allowJs) and by the test runner directly.
 */

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const lerp = (a, b, t) => a + (b - a) * t;

export const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

/* Cubic ease-out: fast launch, soft landing. */
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

/* ---------------- flow field ---------------- */

/* Deterministic lattice hash in [0, 1). */
export function hash2(x, y, s = 0) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (s | 0) * 1442695041;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

/*
 * Value noise in 2D with a third "time" dimension folded in via the lattice
 * seed, interpolated so the field evolves continuously.
 */
export function vnoise2(x, y, t = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const ti = Math.floor(t);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const tf = smooth(t - ti);
  const plane = (tz) => {
    const a = hash2(xi, yi, tz);
    const b = hash2(xi + 1, yi, tz);
    const c = hash2(xi, yi + 1, tz);
    const d = hash2(xi + 1, yi + 1, tz);
    return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
  };
  return lerp(plane(ti), plane(ti + 1), tf);
}

/*
 * curl2: divergence-free velocity field derived from the noise potential.
 * F = (dN/dy, -dN/dx). Divergence-free means the dots move like a fluid:
 * no sinks, no sources, just slow eddies. Returns [u, v] in roughly [-1, 1].
 */
export function curl2(x, y, t = 0, eps = 0.18) {
  const dndy = (vnoise2(x, y + eps, t) - vnoise2(x, y - eps, t)) / (2 * eps);
  const dndx = (vnoise2(x + eps, y, t) - vnoise2(x - eps, y, t)) / (2 * eps);
  return [dndy, -dndx];
}

/* ---------------- springs ---------------- */

/*
 * One integration step of a damped spring toward `target`.
 * dampRatio 1 = critical (no overshoot); we run ~0.92 for a tiny,
 * fluid-feeling overshoot. Returns [x', v'].
 */
export function springStep(x, v, target, k, dt, dampRatio = 1) {
  const c = 2 * Math.sqrt(k) * dampRatio;
  const a = k * (target - x) - c * v;
  const v2 = v + a * dt;
  return [x + v2 * dt, v2];
}

/* ---------------- scheduling + budgets ---------------- */

/*
 * Left-to-right reading-order stagger with jitter. Total stagger is clamped
 * so short tokens snap and long paragraphs still finish fast.
 */
export function buildSchedule(nChars, {
  minTotal = 200,
  maxTotal = 980,
  perChar = 13,
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

/*
 * Glyphs are rasterized and sampled every `stride` pixels. Pick the smallest
 * stride (>= 2 now that the GPU draws the dots) that fits the budget.
 */
export function strideForBudget(estInkPx, budget) {
  let s = 2;
  while (s < 8 && estInkPx / (s * s) > budget) s++;
  return s;
}

/* GPU particle pool size for a viewport. Dense enough to feel alive. */
export function poolCount(w, h, density = 110, lo = 2500, hi = 16000) {
  return Math.round(clamp((w * h) / density, lo, hi));
}

/* Of the candidate indices, return the one nearest to (x, y). */
export function bestCandidate(indices, xs, ys, x, y) {
  let best = -1;
  let bd = Infinity;
  for (const i of indices) {
    const d = dist2(xs[i], ys[i], x, y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/* Indices of the k pool entries nearest to (x, y). Pool entries: {x, y}. */
export function nearestK(pool, x, y, k) {
  const scored = pool.map((p, i) => ({ i, d: dist2(p.x, p.y, x, y) }));
  scored.sort((a, b) => a.d - b.d);
  return scored.slice(0, Math.max(0, k | 0)).map((s) => s.i);
}

/* Click-counter label, Los Feliz style. */
export function formatClicks(n) {
  return `${n} CLICK${n === 1 ? '' : 'S'}`;
}
