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

/* ---------------- ocean swell ---------------- */

/*
 * waveField: a diagonal travelling swell, like open water seen from above.
 * Two superposed sine waves move along `theta`; particle velocity follows
 * the orbital motion of deep-water waves (along-travel component in phase,
 * perpendicular component 90 degrees out of phase), so dots roll in bands
 * that sweep diagonally across the screen instead of wandering.
 *
 * Returns [u, v, crest]: a velocity in px/s and the primary wave phase
 * (sin, in [-1, 1]) so callers can sparkle dots on the crests.
 */
export function waveField(x, y, t, {
  theta  = 0.6435011087932844, /* travel direction ~37 deg: top-left -> bottom-right */
  lambda = 440,                /* primary wavelength, px                              */
  speed  = 90,                 /* crest speed, px/s                                   */
  amp    = 26,                 /* velocity amplitude, px/s                            */
  chop   = 0.45,               /* secondary chop wave, fraction of amp                */
} = {}) {
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);
  const k  = (Math.PI * 2) / lambda;
  const w  = k * speed;
  const p1 = k * (x * dx + y * dy) - w * t;
  const s1 = Math.sin(p1);
  const c1 = Math.cos(p1);
  let u = dx * s1 * amp - dy * c1 * amp * 0.35;
  let v = dy * s1 * amp + dx * c1 * amp * 0.35;
  if (chop > 0) {
    const th2 = theta + 0.42;
    const dx2 = Math.cos(th2);
    const dy2 = Math.sin(th2);
    const k2  = k * 2.15;
    const w2  = k2 * speed * 0.62;
    const s2  = Math.sin(k2 * (x * dx2 + y * dy2) - w2 * t + 1.7);
    u += dx2 * s2 * amp * chop;
    v += dy2 * s2 * amp * chop;
  }
  return [u, v, s1];
}

/*
 * refillWindow: how long (seconds) the photo spreads its refill arrivals
 * after donating `taken` of its `total` cells.  Scales with the bite size:
 * a few hundred cells stream back in a couple of seconds; the entire photo
 * staggers over 14 s, which (plus flight time) stays inside the 20 s budget.
 */
export function refillWindow(taken, total, { base = 1.5, span = 18, cap = 14 } = {}) {
  const frac = total > 0 ? clamp(taken / total, 0, 1) : 0;
  return Math.min(cap, base + span * frac);
}

/* ================= v10 additions ================= */

/* Frame-rate independent exponential approach: returns the new current
   value after dt seconds chasing `target` at `rate` (1/s). */
export function lerpExp(current, target, dt, rate = 8) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/* ---------------- cover flow (music tab) ---------------- */

/* Wrap v into [-period/2, period/2): the shortest signed way around a loop. */
export function wrapDelta(v, period) {
  if (!(period > 0)) return v;
  return ((((v + period / 2) % period) + period) % period) - period / 2;
}

/*
 * coverTransform: where the i-th album card sits for a given scroll offset.
 * The row reads like a louvered shutter (video ref #6): every card shares
 * one tilt direction, and the card nearest the screen centre eases flat
 * (face-on), lifts toward the viewer and grows so its name/notes can pop.
 *
 *   i       card index, 0..n-1 (0 = most recent listen)
 *   scroll  px along the row; scroll = i*spacing centres card i
 *   n       total cards
 *
 * With { loop: true } the row is a circle of period n*spacing: scroll is
 * unbounded and every card sits at its nearest wrapped position, so after
 * the last cover the first comes around again.
 *
 * z-order is a pyramid centred on the screen: the centred card is on top
 * and cards stack lower the farther they are from centre, symmetrically,
 * so the left side cascades exactly like the right.
 *
 * Returns { x, ry, z, s, focus, zi }:
 *   x  px from screen centre   ry  rotateY deg (0 = facing viewer)
 *   z  translateZ px           s   scale
 *   focus 0..1 (1 = centred)   zi  integer z-index
 */
export function coverTransform(i, scroll, n, {
  spacing = 150, tilt = 56, lift = 170, spread = 120, window: win = 1.45,
  loop = false,
} = {}) {
  let raw = i * spacing - scroll;
  if (loop && n > 0) raw = wrapDelta(raw, n * spacing);
  const d = raw / spacing;
  const a = Math.abs(d);
  const focus = a >= win ? 0 : Math.pow(1 - a / win, 2.2);
  const x = d * spacing + Math.sign(d) * spread * Math.min(a, 1);
  const ry = tilt * (1 - focus);
  const z = lift * focus;
  const s = 0.88 + 0.16 * focus;
  const zi = Math.max(1, 500 - Math.round(a * 14));
  return { x, ry, z, s, focus, zi };
}

/*
 * normalizeWheel: one wheel event -> a scroll step in px, whatever the
 * device reports. deltaMode 0 = pixels, 1 = lines, 2 = pages. A single
 * notch is clamped so an aggressive flick can't teleport the row.
 */
export function normalizeWheel(dy, dx = 0, mode = 0, { line = 33, page = 800, max = 260 } = {}) {
  const k = mode === 1 ? line : mode === 2 ? page : 1;
  return clamp((dy + dx) * k, -max, max);
}

/* "just now", "4m ago", "3h ago", "2d ago", "5w ago" */
export function timeAgo(thenMs, nowMs = Date.now()) {
  if (!Number.isFinite(thenMs)) return '';
  const s = Math.max(0, (nowMs - thenMs) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

/* Which card is closest to centre for a given scroll. */
export function centerIndex(scroll, spacing, n, loop = false) {
  const i = Math.round(scroll / spacing);
  if (loop && n > 0) return ((i % n) + n) % n;
  return clamp(i, 0, Math.max(0, n - 1));
}

/*
 * nearestCover: which card sits closest (in screen x) to a click at
 * clickX? Inverts coverTransform by brute force - n is tiny - so clicks
 * landing in the air between tilted covers still pick the right one:
 * the whole row is a hit target, no dead zones.
 */
export function nearestCover(clickX, scroll, n, w, opts = {}) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < n; i++) {
    const { x } = coverTransform(i, scroll, n, opts);
    const d = Math.abs(x + w / 2 - clickX);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/* ---------------- dock magnification (tab bar) ---------------- */

/*
 * dockMagnify: macOS-style magnification (video ref #3). `dist` is the
 * horizontal distance in px from the pointer to an icon centre. Smooth
 * cosine-squared bell: 1+boost at the pointer, exactly 1 at the radius.
 */
export function dockMagnify(dist, { radius = 110, boost = 0.55 } = {}) {
  const a = Math.abs(dist);
  if (a >= radius) return 1;
  const c = Math.cos((Math.PI * a) / (2 * radius));
  return 1 + boost * c * c;
}

/* ---------------- photo card stack ---------------- */

/*
 * stackPose: the deck fan from the reference video (#4), measured frame
 * by frame: every deeper card rotates further CLOCKWISE and peeks out
 * toward the top-right - one cascading direction, never alternating.
 * Depth is continuous on purpose: while the front card is being dragged,
 * every card below renders at (k - promote), so the whole deck glides
 * one slot forward in step with the drag (the reference's signature).
 *
 * Returns { rot (deg), fx, fy }: offsets as fractions of the card width.
 */
export function stackPose(d) {
  const dd = Math.max(0, d);
  return {
    rot: 6.2 * dd,
    fx: 0.030 * dd,
    fy: -0.024 * dd,
  };
}

/*
 * dragPromote: how far the deck has slid toward its next pose while the
 * front card is `dist` px into a drag. Fully promoted by 150 px, like
 * the reference (the next card is already straight before release).
 */
export function dragPromote(dist, full = 150) {
  return clamp(dist / full, 0, 1);
}

/*
 * flingOutcome: when a dragged card is released, does it fly away (cycle
 * to the back of the stack) or spring home? Distance or velocity can win.
 * Returns { dismiss, exitX, exitY } with a unit-ish exit direction.
 */
export function flingOutcome(dx, dy, vx, vy, {
  distThresh = 120, velThresh = 900,
} = {}) {
  const dist = Math.hypot(dx, dy);
  const vel = Math.hypot(vx, vy);
  const dismiss = dist > distThresh || vel > velThresh;
  let ex = dx, ey = dy;
  if (vel > 220) { ex = vx; ey = vy; }
  const m = Math.hypot(ex, ey) || 1;
  return { dismiss, exitX: ex / m, exitY: ey / m };
}

/* ---------------- cursor flare (background dots, video ref #5) ------- */

/*
 * exciteTarget: how brightly a dot at squared-distance d2 from the cursor
 * should flare. 1 at the cursor, 0 at/after `radius`, eased so the bright
 * core is tight and the falloff is soft.
 */
export function exciteTarget(d2, radius = 130) {
  const r2 = radius * radius;
  if (d2 >= r2) return 0;
  return Math.pow(1 - Math.sqrt(d2) / radius, 1.6);
}

/* ---------------- Last.fm ---------------- */

/* Choose the best art URL from a Last.fm image array. */
export function pickImage(images) {
  if (!Array.isArray(images)) return '';
  const by = {};
  for (const im of images) by[im.size] = im['#text'] || '';
  return by.extralarge || by.large || by.medium ||
    images.map((i) => i['#text']).filter(Boolean).pop() || '';
}

/* Keep the first occurrence (most recent listen) of each artist+name. */
export function uniqueTracks(tracks, n = 20) {
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    const key = `${t.artist} — ${t.name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= n) break;
  }
  return out;
}

/*
 * normalizeRecent: raw user.getrecenttracks JSON -> the n most recent
 * distinct songs, newest first. Survives the API quirks: a single track
 * arrives as an object, `extended=1` nests artist under .name, otherwise
 * under '#text'; the now-playing entry carries @attr.nowplaying.
 */
export function normalizeRecent(json, n = 20) {
  let list = json?.recenttracks?.track ?? [];
  if (!Array.isArray(list)) list = [list];
  const mapped = list.map((t) => ({
    artist: t.artist?.name ?? t.artist?.['#text'] ?? '',
    name: t.name ?? '',
    album: t.album?.['#text'] ?? '',
    art: pickImage(t.image),
    url: t.url ?? '',
    nowPlaying: t['@attr']?.nowplaying === 'true',
    playedAt: t.date?.uts ? Number(t.date.uts) * 1000 : null,
  })).filter((t) => t.name && t.artist);
  return uniqueTracks(mapped, n);
}

/* ---------------- Whoop formatting ---------------- */

/* 27225000 ms -> "7h 34m" (rounds minutes). */
export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0h 0m';
  const mins = Math.round(ms / 60000);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/* Whoop recovery zones: 0-33 red, 34-66 yellow, 67-100 green. */
export function recoveryBand(score) {
  if (!Number.isFinite(score)) return 'unknown';
  if (score < 34) return 'low';
  if (score < 67) return 'moderate';
  return 'high';
}

/* Strain renders with one decimal, clamped to Whoop's 0-21 scale. */
export function fmtStrain(x) {
  if (!Number.isFinite(x)) return '0.0';
  return (Math.round(clamp(x, 0, 21) * 10) / 10).toFixed(1);
}
