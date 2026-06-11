/*
 * particles.js
 * The dot engine.
 *
 * One fixed, full-viewport canvas runs two populations:
 *
 *   1. AMBIENT dots: a sparse field of ~1px white dots drifting slowly
 *      (the Moment vibe). They twinkle gently and shy away from the cursor.
 *
 *   2. FLIGHTS: when text needs to appear, every glyph is rasterized
 *      offscreen and sampled into target points. Dots are borrowed from
 *      the ambient field (nearest first) and topped up with fresh dots
 *      spawned around the text. Each dot flies to its point on a glyph,
 *      staggered left-to-right so the line reads as being "typed".
 *      When a character's dots have landed, the real DOM character fades
 *      in underneath and the dots dissolve. Borrowed dots are returned
 *      to the field at the edges, so the population stays constant.
 *
 * All flight coordinates live in PAGE space and are drawn at
 * (x, y - scrollY), so assemblies stay glued to their text even if the
 * user scrolls mid-animation.
 */

import {
  clamp, lerp, easeOutCubic, mulberry32, buildSchedule,
  flightDuration, strideForBudget, nearestK, ambientCount,
} from './utils.js';

const TAU = Math.PI * 2;

export class DotEngine {
  constructor(canvas, { reduced = false } = {}) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.reduced = reduced;
    this.rng = mulberry32(0x00c0ffee);
    this.ambient = [];
    this.flights = [];
    this.reveals = [];   // { span, at } sorted-ish queue
    this.glyphs = new Map();
    const mc = document.createElement('canvas');
    this.mx = mc.getContext('2d', { willReadFrequently: true });
    this.mouse = { x: -1e4, y: -1e4 };
    this.fade = 0;       // global ambient fade-in
    this.running = false;
    this.lt = 0;

    this.resize();
    this.seed();

    addEventListener('resize', () => { this.resize(); this.seed(true); }, { passive: true });
    addEventListener('pointermove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; }, { passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.start(); });
    this.start();
  }

  /* ---------------- canvas + ambient field ---------------- */

  resize() {
    const d = Math.min(window.devicePixelRatio || 1, 2);
    this.w = innerWidth;
    this.h = innerHeight;
    this.cv.width = Math.round(this.w * d);
    this.cv.height = Math.round(this.h * d);
    this.g.setTransform(d, 0, 0, d, 0, 0);
  }

  seed(keep = false) {
    const n = ambientCount(this.w, this.h);
    if (!keep) this.ambient.length = 0;
    while (this.ambient.length < n) {
      this.ambient.push(this.dot(this.rng() * this.w, this.rng() * this.h));
    }
    if (this.ambient.length > n) this.ambient.length = n;
  }

  dot(x, y) {
    const r = this.rng;
    return {
      x, y,
      vx: (r() - 0.5) * 16, vy: (r() - 0.5) * 16,
      r: 0.55 + r() * 0.75,
      a: 0.14 + r() * 0.38,
      ph: r() * TAU,
      sp: 0.4 + r() * 1.2,
    };
  }

  edgeSpawn() {
    const r = this.rng;
    const side = (r() * 4) | 0;
    if (side === 0) return this.dot(r() * this.w, -6);
    if (side === 1) return this.dot(r() * this.w, this.h + 6);
    if (side === 2) return this.dot(-6, r() * this.h);
    return this.dot(this.w + 6, r() * this.h);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lt = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  /* ---------------- main loop ---------------- */

  frame(now) {
    if (document.hidden) { this.running = false; return; }
    const dt = Math.min(0.05, (now - this.lt) / 1000);
    this.lt = now;
    const { g, w, h } = this;
    g.clearRect(0, 0, w, h);
    this.fade = Math.min(1, this.fade + dt * 1.2);
    g.fillStyle = '#ffffff';

    /* ambient */
    for (const p of this.ambient) {
      if (!this.reduced) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.ph += dt * p.sp;
        const dx = p.x - this.mouse.x;
        const dy = p.y - this.mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 4900 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const f = (1 - d2 / 4900) * 30 * dt;
          p.x += (dx / d) * f;
          p.y += (dy / d) * f;
        }
        if (p.x < -8) p.x = w + 8; else if (p.x > w + 8) p.x = -8;
        if (p.y < -8) p.y = h + 8; else if (p.y > h + 8) p.y = -8;
      }
      const tw = this.reduced ? 1 : 0.72 + 0.28 * Math.sin(p.ph);
      g.globalAlpha = p.a * tw * this.fade;
      g.fillRect(p.x, p.y, p.r * 2, p.r * 2);
    }

    /* reveals: flip real characters on as their dots land */
    while (this.reveals.length && this.reveals[0].at <= now) {
      this.reveals.shift().span.classList.add('on');
    }

    /* flights */
    const sy = scrollY;
    let live = 0;
    for (const f of this.flights) {
      if (f.dead) continue;
      const tl = now - f.start;
      const s2 = f.r * 2;
      if (tl < 0) {
        /* waiting to launch: hold at source */
        g.globalAlpha = 0.5 * this.fade;
        g.fillRect(f.sx, f.sy - sy, s2, s2);
        live++;
        continue;
      }
      const t = tl / f.dur;
      if (t < 1) {
        const e = easeOutCubic(t);
        const x = lerp(f.sx, f.tx, e);
        const y = lerp(f.sy, f.ty, e) + Math.sin(t * Math.PI) * f.bow;
        g.globalAlpha = Math.min(1, t * 3 + 0.15) * 0.92;
        g.fillRect(x, y - sy, s2, s2);
        live++;
        continue;
      }
      /* landed: hold, then dissolve shortly after the character appears */
      const ft = (now - f.fadeAt) / 180;
      if (ft >= 1) {
        f.dead = true;
        if (f.replace) this.ambient.push(this.edgeSpawn());
        continue;
      }
      g.globalAlpha = ft <= 0 ? 0.92 : 0.92 * (1 - ft);
      g.fillRect(f.tx, f.ty - sy, s2, s2);
      live++;
    }
    if (this.flights.length && !live && !this.reveals.length) this.flights.length = 0;

    g.globalAlpha = 1;
    requestAnimationFrame((t) => this.frame(t));
  }

  /* ---------------- text preparation ---------------- */

  /*
   * Wrap every character of every text node under `root` in a
   * <span class="ch"> so characters can be revealed one by one.
   * Whitespace spans are revealed immediately (nothing to draw).
   * Safe to call on detached nodes, before insertion.
   */
  prepare(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest('svg')) return NodeFilter.FILTER_REJECT;
        if (p.classList.contains('ch')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      for (const chr of node.nodeValue) {
        const s = document.createElement('span');
        s.className = 'ch';
        if (!chr.trim()) s.classList.add('on'); /* whitespace: instant */
        s.textContent = chr;
        frag.appendChild(s);
      }
      node.parentNode.replaceChild(frag, node);
    }
    return root;
  }

  /* Rasterize one glyph offscreen and sample its ink into points. Cached. */
  glyphPoints(chr, font, stride) {
    const key = `${chr}|${font}|${stride}`;
    const hit = this.glyphs.get(key);
    if (hit) return hit;
    const mx = this.mx;
    mx.font = font; /* set before measuring */
    const m = mx.measureText(chr);
    const asc = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? 16;
    const desc = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? 5;
    const W = Math.max(2, Math.ceil(m.width) + 4);
    const H = Math.max(2, Math.ceil(asc + desc) + 4);
    if (mx.canvas.width < W) mx.canvas.width = W;
    if (mx.canvas.height < H) mx.canvas.height = H;
    mx.clearRect(0, 0, mx.canvas.width, mx.canvas.height);
    mx.font = font; /* canvas resize resets state */
    mx.fillStyle = '#fff';
    mx.textBaseline = 'alphabetic';
    mx.fillText(chr, 2, 2 + asc);
    const data = mx.getImageData(0, 0, W, H).data;
    const pts = [];
    const off = stride >> 1;
    for (let y = off; y < H; y += stride) {
      for (let x = off; x < W; x += stride) {
        if (data[(y * W + x) * 4 + 3] > 100) pts.push([x - 2, y - 2]);
      }
    }
    const rec = { pts, h: asc + desc };
    this.glyphs.set(key, rec);
    return rec;
  }

  fontOf(el) {
    const cs = getComputedStyle(el);
    return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  }

  /* ---------------- assembly ---------------- */

  /*
   * Animate every un-revealed character under `root`.
   * Dots swarm in and build the words; characters fade in as their
   * dots land. Resolves when the whole block is legible.
   */
  assemble(root, { delay = 0, perChar = 14 } = {}) {
    const spans = [...root.querySelectorAll('span.ch:not(.on)')];
    if (!spans.length) return Promise.resolve();

    if (this.reduced) {
      for (const s of spans) s.classList.add('on');
      return Promise.resolve();
    }

    const rng = this.rng;
    const sched = buildSchedule(spans.length, { perChar, rng });
    const start = performance.now() + delay;

    /* First pass: measure + estimate ink so we can pick a stride. */
    const items = [];
    let est = 0;
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      const rect = span.getBoundingClientRect();
      if (!rect.width && !rect.height) { span.classList.add('on'); continue; }
      const fs = parseFloat(getComputedStyle(span.parentElement).fontSize) || 16;
      items.push({ span, rect, i });
      est += fs * fs * 0.18;
    }
    if (!items.length) return Promise.resolve();
    const stride = strideForBudget(est, 3600);

    /* Borrow ambient dots (nearest first) for a fraction of the points. */
    const mid = items[(items.length / 2) | 0].rect;
    const borrowMax = Math.floor(this.ambient.length * 0.5);
    const borrowIdx = nearestK(this.ambient, mid.left + mid.width / 2, mid.top + mid.height / 2, borrowMax);
    const borrowed = [];
    /* splice from highest index so positions stay valid */
    for (const bi of borrowIdx.slice().sort((a, b) => b - a)) {
      borrowed.push(this.ambient.splice(bi, 1)[0]);
    }
    let bPtr = 0;
    let totalPts = 0;

    const sx0 = scrollX, sy0 = scrollY;
    for (const it of items) {
      const { span, rect, i } = it;
      const font = this.fontOf(span.parentElement);
      const glyph = this.glyphPoints(span.textContent, font, stride);
      const d = sched.delays[i];
      const revealAt = start + d + 340;
      this.reveals.push({ span, at: revealAt });
      const scaleY = glyph.h > 0 ? rect.height / glyph.h : 1;
      for (const [gx, gy] of glyph.pts) {
        totalPts++;
        const tx = rect.left + sx0 + gx + (rng() - 0.5) * 0.8;
        const ty = rect.top + sy0 + gy * scaleY + (rng() - 0.5) * 0.8;
        let sx, sy, replace = false;
        /* interleave borrowed field dots with fresh ring spawns */
        if (bPtr < borrowed.length && totalPts % 3 === 0) {
          const b = borrowed[bPtr++];
          sx = b.x + sx0;
          sy = b.y + sy0;
          replace = true;
        } else {
          const ang = rng() * TAU;
          const rad = 30 + rng() * 90;
          sx = tx + Math.cos(ang) * rad;
          sy = ty + Math.sin(ang) * rad * 0.7;
        }
        this.flights.push({
          sx, sy, tx, ty,
          start: start + d + rng() * 30,
          dur: flightDuration(rng),
          fadeAt: revealAt + 50,
          bow: (rng() - 0.5) * 16,
          r: 0.55 + rng() * 0.6,
          replace,
          dead: false,
        });
      }
    }
    /* any unused borrowed dots go straight back */
    while (bPtr < borrowed.length) this.ambient.push(borrowed[bPtr++]);

    this.reveals.sort((a, b) => a.at - b.at);
    this.start();

    const settle = delay + sched.total + 340 + 240;
    return new Promise((res) => setTimeout(res, settle));
  }

  /* Instantly reveal everything in flight (intro skip). */
  finishAll() {
    for (const r of this.reveals) r.span.classList.add('on');
    this.reveals.length = 0;
    for (const f of this.flights) {
      if (!f.dead && f.replace) this.ambient.push(this.edgeSpawn());
      f.dead = true;
    }
    this.flights.length = 0;
  }
}
