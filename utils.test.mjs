/*
 * utils.test.mjs
 * Unit tests for the pure engine logic. Run with: npm test (node --test).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp, lerp, dist2, easeOutCubic, mulberry32, hash2, vnoise2, curl2,
  springStep, buildSchedule, strideForBudget, poolCount, bestCandidate,
  nearestK, formatClicks, waveField, refillWindow,
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

test('refillWindow scales with the bite and never breaks the 20 s budget', () => {
  assert.equal(refillWindow(0, 1000), 1.5);
  assert.equal(refillWindow(1000, 1000), 14);
  assert.ok(refillWindow(100, 1000) < refillWindow(500, 1000));
  /* worst case: window cap + max launch delay + max flight stays under 20 s */
  const MAX_DELAY = 0.8, MAX_FLIGHT = 2.6;
  assert.ok(refillWindow(1, 1) + MAX_DELAY + MAX_FLIGHT < 20);
  assert.equal(refillWindow(5, 0), 1.5);
});

/* ================= v10 additions ================= */

import {
  lerpExp, coverTransform, wrapDelta, normalizeWheel, timeAgo, centerIndex, nearestCover, dockMagnify,
  stackPose, dragPromote, flingOutcome, exciteTarget, pickImage, uniqueTracks,
  normalizeRecent, fmtDuration, recoveryBand, fmtStrain,
} from './utils.js';

test('lerpExp converges and is frame-rate independent', () => {
  let a = 0;
  for (let i = 0; i < 120; i++) a = lerpExp(a, 100, 1 / 60, 8);
  assert.ok(Math.abs(a - 100) < 0.01, `60fps settled at ${a}`);
  let b = 0;
  for (let i = 0; i < 60; i++) b = lerpExp(b, 100, 1 / 30, 8);
  /* same wall-clock time at 30fps lands within a hair of the 60fps value */
  assert.ok(Math.abs(a - b) < 0.5, `30fps diverged: ${b} vs ${a}`);
  assert.equal(lerpExp(5, 5, 0.016, 8), 5);
});

test('coverTransform centres, flattens and lifts the focused card', () => {
  const n = 20;
  const c = coverTransform(7, 7 * 150, n);
  assert.equal(c.x, 0, 'centred card sits at screen centre');
  assert.equal(c.ry, 0, 'centred card faces the viewer');
  assert.equal(c.focus, 1);
  assert.ok(c.z > 0 && c.s > 1, 'centred card lifts and grows');
  const f = coverTransform(9, 7 * 150, n);
  assert.ok(f.focus === 0, 'two cards away is out of the focus window');
  assert.ok(Math.abs(f.ry - 56) < 1e-9, 'far cards carry the full tilt');
  assert.ok(f.x > 2 * 150, 'spread pushes neighbours outward');
});

test('coverTransform z-order is a pyramid: centre on top, symmetric sides', () => {
  const n = 20, scroll = 7 * 150;
  const mid = coverTransform(7, scroll, n);
  const l1 = coverTransform(6, scroll, n);
  const l2 = coverTransform(5, scroll, n);
  const r1 = coverTransform(8, scroll, n);
  const r2 = coverTransform(9, scroll, n);
  assert.ok(mid.zi > l1.zi && mid.zi > r1.zi, 'centre is on top');
  assert.ok(l1.zi > l2.zi, 'left side: nearer centre stacks higher');
  assert.ok(r1.zi > r2.zi, 'right side: nearer centre stacks higher');
  assert.equal(l1.zi, r1.zi, 'equidistant cards share a tier');
  assert.equal(l2.zi, r2.zi, 'two out: still symmetric');
});

test('wrapDelta finds the shortest signed way around', () => {
  assert.equal(wrapDelta(0, 100), 0);
  assert.equal(wrapDelta(30, 100), 30);
  assert.equal(wrapDelta(80, 100), -20);
  assert.equal(wrapDelta(-80, 100), 20);
  assert.equal(wrapDelta(250, 100), -50);
  assert.equal(wrapDelta(7, 0), 7, 'degenerate period passes through');
});

test('coverTransform loops: after the last card the first comes around', () => {
  const n = 25, sp = 150, opts = { spacing: sp, loop: true };
  /* centred on the last card: card 0 sits one slot to the RIGHT */
  const scroll = (n - 1) * sp;
  const first = coverTransform(0, scroll, n, opts);
  assert.ok(Math.abs(first.x - (sp + 120)) < 1e-9, 'card 0 wraps to the right side');
  /* and scrolling past the end keeps centring real cards */
  const past = coverTransform(0, n * sp, n, opts);
  assert.equal(past.focus, 1, 'one full lap re-centres card 0');
});

test('coverTransform is symmetric in focus around the centre', () => {
  const n = 20, scroll = 7 * 150;
  const a = coverTransform(6, scroll, n);
  const b = coverTransform(8, scroll, n);
  assert.ok(Math.abs(a.focus - b.focus) < 1e-12);
  assert.ok(Math.abs(a.x + b.x) < 1e-9, 'mirrored x offsets');
});

test('normalizeWheel converts lines/pages to px and clamps a notch', () => {
  assert.equal(normalizeWheel(100), 100, 'pixel mode passes through');
  assert.equal(normalizeWheel(3, 0, 1), 99, 'line mode scales by ~33px');
  assert.equal(normalizeWheel(1, 0, 2), 260, 'page mode hits the clamp');
  assert.equal(normalizeWheel(-9000), -260, 'clamped both ways');
  assert.equal(normalizeWheel(40, 25), 65, 'deltaX folds in (trackpads)');
});

test('timeAgo buckets read like a human wrote them', () => {
  const now = 1_800_000_000_000;
  assert.equal(timeAgo(now - 20 * 1000, now), 'just now');
  assert.equal(timeAgo(now - 5 * 60 * 1000, now), '5m ago');
  assert.equal(timeAgo(now - 3 * 3600 * 1000, now), '3h ago');
  assert.equal(timeAgo(now - 2 * 86400 * 1000, now), '2d ago');
  assert.equal(timeAgo(now - 21 * 86400 * 1000, now), '3w ago');
  assert.equal(timeAgo(NaN, now), '');
  assert.equal(timeAgo(now + 50_000, now), 'just now', 'clock skew is forgiven');
});

test('centerIndex rounds to the nearest card and clamps', () => {
  assert.equal(centerIndex(0, 150, 20), 0);
  assert.equal(centerIndex(7 * 150 + 60, 150, 20), 7);
  assert.equal(centerIndex(7 * 150 + 80, 150, 20), 8);
  assert.equal(centerIndex(1e9, 150, 20), 19);
  assert.equal(centerIndex(-50, 150, 20), 0);
});

test('centerIndex wraps in loop mode', () => {
  assert.equal(centerIndex(25 * 150, 150, 25, true), 0, 'one lap = card 0');
  assert.equal(centerIndex(26 * 150, 150, 25, true), 1);
  assert.equal(centerIndex(-150, 150, 25, true), 24, 'backwards wraps too');
});

test('nearestCover picks the card under (or nearest to) a click', () => {
  const n = 20, w = 1440, opts = { spacing: 215, spread: 146 };
  const scroll = 4 * 215; /* card 4 centred */
  assert.equal(nearestCover(w / 2, scroll, n, w, opts), 4, 'centre click');
  const c6 = coverTransform(6, scroll, n, opts);
  assert.equal(nearestCover(c6.x + w / 2, scroll, n, w, opts), 6, 'direct hit');
  assert.equal(nearestCover(c6.x + w / 2 + 40, scroll, n, w, opts), 6, 'gap click snaps');
  assert.equal(nearestCover(1e6, scroll, n, w, opts), n - 1, 'far right clamps');
  assert.equal(nearestCover(-1e6, scroll, n, w, opts), 0, 'far left clamps');
});

test('dockMagnify peaks under the pointer and dies at the radius', () => {
  assert.ok(Math.abs(dockMagnify(0) - 1.55) < 1e-9);
  assert.equal(dockMagnify(110), 1);
  assert.equal(dockMagnify(400), 1);
  let prev = 2;
  for (let d = 0; d <= 110; d += 5) {
    const s = dockMagnify(d);
    assert.ok(s <= prev + 1e-12, 'monotonically shrinking');
    assert.ok(s >= 1);
    prev = s;
  }
  assert.ok(Math.abs(dockMagnify(-40) - dockMagnify(40)) < 1e-12, 'symmetric');
});

test('stackPose: front rests square, deeper cards cascade clockwise up-right', () => {
  assert.deepEqual(stackPose(0), { rot: 0, fx: 0, fy: -0 });
  const a = stackPose(1), b = stackPose(2), c = stackPose(3);
  assert.ok(a.rot > 0 && b.rot > a.rot && c.rot > b.rot, 'one direction, deeper = wider');
  assert.ok(a.fx > 0 && b.fx > a.fx, 'peeks march right');
  assert.ok(a.fy < 0 && b.fy < a.fy, 'and upward');
  const half = stackPose(0.5);
  assert.ok(Math.abs(half.rot - a.rot / 2) < 1e-9, 'continuous depth interpolates linearly');
  assert.equal(stackPose(-3).rot, 0, 'negative depth clamps to the front pose');
});

test('dragPromote eases the deck forward with the drag and clamps', () => {
  assert.equal(dragPromote(0), 0);
  assert.equal(dragPromote(75), 0.5);
  assert.equal(dragPromote(150), 1);
  assert.equal(dragPromote(900), 1);
});

test('flingOutcome: distance or velocity dismisses, otherwise springs home', () => {
  assert.equal(flingOutcome(10, 5, 0, 0).dismiss, false);
  assert.equal(flingOutcome(200, 0, 0, 0).dismiss, true);
  assert.equal(flingOutcome(10, 0, 1500, 0).dismiss, true);
  const f = flingOutcome(10, 0, 1500, 0);
  assert.ok(Math.abs(Math.hypot(f.exitX, f.exitY) - 1) < 1e-9, 'unit exit');
  assert.ok(f.exitX > 0.99, 'fast flick exits along the velocity');
  const slow = flingOutcome(-200, 0, 0, 0);
  assert.ok(slow.exitX < -0.99, 'slow drag exits along the displacement');
});

test('exciteTarget: 1 at the cursor, 0 outside, monotonic falloff', () => {
  assert.equal(exciteTarget(0), 1);
  assert.equal(exciteTarget(130 * 130), 0);
  assert.equal(exciteTarget(1e9), 0);
  let prev = 1.1;
  for (let d = 0; d <= 130; d += 10) {
    const e = exciteTarget(d * d);
    assert.ok(e <= prev && e >= 0);
    prev = e;
  }
});

const IMGS = [
  { size: 'small', '#text': 's.jpg' },
  { size: 'medium', '#text': 'm.jpg' },
  { size: 'large', '#text': 'l.jpg' },
  { size: 'extralarge', '#text': 'xl.jpg' },
];

test('pickImage prefers extralarge and degrades gracefully', () => {
  assert.equal(pickImage(IMGS), 'xl.jpg');
  assert.equal(pickImage(IMGS.slice(0, 3)), 'l.jpg');
  assert.equal(pickImage([{ size: 'small', '#text': 's.jpg' }]), 's.jpg');
  assert.equal(pickImage([{ size: 'extralarge', '#text': '' }]), '');
  assert.equal(pickImage(undefined), '');
});

test('uniqueTracks dedupes by artist+name, keeps order, respects n', () => {
  const mk = (artist, name) => ({ artist, name });
  const list = [mk('A', 'x'), mk('A', 'x'), mk('B', 'x'), mk('A', 'X'), mk('C', 'y')];
  const u = uniqueTracks(list, 20);
  assert.equal(u.length, 3, 'case-insensitive dedupe');
  assert.deepEqual(u.map((t) => t.artist), ['A', 'B', 'C']);
  assert.equal(uniqueTracks(list, 2).length, 2);
});

test('normalizeRecent parses extended payloads, nowplaying and singletons', () => {
  const json = {
    recenttracks: {
      track: [
        {
          artist: { name: 'Tame Impala' }, name: 'One More Hour',
          album: { '#text': 'The Slow Rush' }, image: IMGS,
          url: 'https://last.fm/x', '@attr': { nowplaying: 'true' },
        },
        {
          artist: { '#text': 'Berlioz' }, name: 'ode to rahsaan',
          album: { '#text': 'open this wall' }, image: [],
          date: { uts: '1718000000' },
        },
        {
          artist: { name: 'Berlioz' }, name: 'ode to rahsaan',
          album: { '#text': 'open this wall' }, image: [],
          date: { uts: '1717000000' },
        },
        { artist: { name: '' }, name: 'ghost', album: { '#text': '' }, image: [] },
      ],
    },
  };
  const ts = normalizeRecent(json, 20);
  assert.equal(ts.length, 2, 'dupes and empty artists drop');
  assert.equal(ts[0].nowPlaying, true);
  assert.equal(ts[0].art, 'xl.jpg');
  assert.equal(ts[1].playedAt, 1718000000000);
  const single = normalizeRecent({ recenttracks: { track: json.recenttracks.track[0] } }, 5);
  assert.equal(single.length, 1, 'single-track object payload survives');
  assert.equal(normalizeRecent({}, 5).length, 0, 'empty payload survives');
});

test('fmtDuration renders hours and minutes', () => {
  assert.equal(fmtDuration(0), '0h 0m');
  assert.equal(fmtDuration(27225000), '7h 34m');
  assert.equal(fmtDuration(3600000), '1h 0m');
  assert.equal(fmtDuration(NaN), '0h 0m');
});

test('recoveryBand matches Whoop zones', () => {
  assert.equal(recoveryBand(10), 'low');
  assert.equal(recoveryBand(33), 'low');
  assert.equal(recoveryBand(34), 'moderate');
  assert.equal(recoveryBand(66), 'moderate');
  assert.equal(recoveryBand(67), 'high');
  assert.equal(recoveryBand(100), 'high');
  assert.equal(recoveryBand(undefined), 'unknown');
});

test('fmtStrain clamps to 0-21 with one decimal', () => {
  assert.equal(fmtStrain(14.27), '14.3');
  assert.equal(fmtStrain(25), '21.0');
  assert.equal(fmtStrain(-2), '0.0');
  assert.equal(fmtStrain(NaN), '0.0');
});
