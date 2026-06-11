/*
 * engine.ts
 * The dot engine, v2: one WebGL point cloud, two behaviors.
 *
 * A persistent pool of GPU-rendered dots (2,500 to 16,000 depending on
 * viewport) drifts forever through a curl-noise flow field: divergence-free,
 * so the motion reads as fluid eddies, not static. The cursor stirs the
 * field. Dots twinkle on individual phases.
 *
 * When text needs to appear, each glyph is rasterized offscreen and sampled
 * into target points. Free dots are claimed (nearest-of-K sampling, so the
 * field visibly gathers), then seek their targets with damped springs whose
 * stiffness ramps in over their stagger window. Launches run left to right,
 * so a line reads as being typed by the field. When enough of a character's
 * dots have settled, the real DOM character fades in underneath; the dots
 * linger 130ms, then puff outward and rejoin the flow. Population is
 * constant; nothing pops in or out.
 *
 * Targets live in page coordinates and are re-projected against scrollY
 * every frame, so assemblies stay glued to their text while scrolling.
 */

import * as THREE from 'three';
import {
  clamp, mulberry32, curl2, buildSchedule, strideForBudget,
  poolCount, bestCandidate,
} from '../utils.js';

const TAU = Math.PI * 2;

/* particle states */
const FREE = 0;
const SEEK = 1;
const LOCK = 2;
const RELEASE = 3;

type Rec = {
  el: Element;
  need: number;
  got: number;
  revealAt: number;
  done: boolean;
  fadeAt: number;
};

type Glyph = { pts: [number, number][]; h: number };

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vA;
  uniform float uDpr;
  void main() {
    vA = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uDpr;
  }
`;

const FRAG = /* glsl */ `
  precision mediump float;
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.14, d) * vA;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vec3(1.0), a);
  }
`;

export class DotEngine {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial | null = null;

  private N = 0;
  private px!: Float32Array; private py!: Float32Array;
  private vx!: Float32Array; private vy!: Float32Array;
  private tx!: Float32Array; private ty!: Float32Array;   /* page coords */
  private st!: Uint8Array;
  private seekT!: Float32Array;                            /* launch time */
  private relT!: Float32Array;                             /* release time */
  private alpha!: Float32Array; private baseA!: Float32Array;
  private size!: Float32Array; private seed!: Float32Array;
  private charOf!: Int32Array;

  private posAttr!: THREE.BufferAttribute;
  private sizeAttr!: THREE.BufferAttribute;
  private alphaAttr!: THREE.BufferAttribute;

  private recs: Rec[] = [];
  private active: number[] = [];

  private rng = mulberry32(0x00c0ffee);
  private glyphs = new Map<string, Glyph>();
  private mx: CanvasRenderingContext2D;

  private w = 1; private h = 1;
  private pointerX = -1e4; private pointerY = -1e4;
  private pointerVX = 0; private pointerVY = 0;
  private fade = 0;
  private running = false;
  private lt = 0;
  private raf = 0;
  private pausedAt = 0;

  readonly reduced: boolean;
  readonly ok: boolean;

  constructor(canvas: HTMLCanvasElement, { reduced = false } = {}) {
    this.reduced = reduced;
    const mc = document.createElement('canvas');
    this.mx = mc.getContext('2d', { willReadFrequently: true })!;

    let ok = true;
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: false,
        powerPreference: 'high-performance',
      });
      this.renderer.setClearColor(0x000000, 0);
    } catch {
      ok = false;
      this.renderer = null;
    }
    this.ok = ok && !reduced;

    if (this.ok) {
      this.allocate();
      this.mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uDpr: { value: 1 } },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.scene.add(new THREE.Points(this.geo, this.mat));
      this.resize();
      /* loaded in a background tab: freeze the timeline until first view */
      if (document.hidden) this.pausedAt = performance.now();
      addEventListener('resize', this.onResize, { passive: true });
      addEventListener('pointermove', this.onPointer, { passive: true });
      document.addEventListener('visibilitychange', this.onVis);
      this.kick();
    }
  }

  /* ---------------- setup ---------------- */

  private allocate() {
    const n = poolCount(innerWidth, innerHeight);
    this.N = n;
    this.px = new Float32Array(n); this.py = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n);
    this.tx = new Float32Array(n); this.ty = new Float32Array(n);
    this.st = new Uint8Array(n);
    this.seekT = new Float32Array(n);
    this.relT = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.baseA = new Float32Array(n);
    this.size = new Float32Array(n);
    this.seed = new Float32Array(n);
    this.charOf = new Int32Array(n);

    const r = this.rng;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.px[i] = r() * innerWidth;
      this.py[i] = r() * innerHeight;
      this.vx[i] = (r() - 0.5) * 10;
      this.vy[i] = (r() - 0.5) * 10;
      this.baseA[i] = 0.07 + r() * 0.36;
      this.size[i] = 1.5 + r() * 1.7;
      this.seed[i] = r();
      pos[i * 3] = this.px[i];
      pos[i * 3 + 1] = this.py[i];
    }
    this.posAttr = new THREE.BufferAttribute(pos, 3);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aSize', this.sizeAttr);
    this.geo.setAttribute('aAlpha', this.alphaAttr);
  }

  private onResize = () => this.resize();
  private onPointer = (e: PointerEvent) => {
    const nx = e.clientX, ny = e.clientY;
    this.pointerVX = nx - this.pointerX;
    this.pointerVY = ny - this.pointerY;
    this.pointerX = nx;
    this.pointerY = ny;
  };
  /*
   * Pause-aware visibility handling. rAF stops in hidden tabs, so when the
   * page becomes visible again every pending launch and reveal timestamp is
   * shifted forward by the time spent hidden. A visitor who opens the site
   * in a background tab gets the full intro the moment they first look.
   */
  private onVis = () => {
    if (document.hidden) {
      this.pausedAt = performance.now();
      return;
    }
    if (this.pausedAt) {
      const shift = performance.now() - this.pausedAt;
      this.pausedAt = 0;
      for (const ri of this.active) {
        const r = this.recs[ri];
        if (!r.done) r.revealAt += shift;
        else r.fadeAt += shift;
      }
      for (let i = 0; i < this.N; i++) {
        if (this.st[i] === SEEK) this.seekT[i] += shift;
      }
    }
    this.kick();
  };

  private resize() {
    if (!this.renderer || !this.mat) return;
    this.w = innerWidth;
    this.h = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.w, this.h, false);
    this.mat.uniforms.uDpr.value = dpr;
    /* top-left origin, +y down, 1 world unit = 1 CSS px */
    this.camera.left = 0;
    this.camera.right = this.w;
    this.camera.top = 0;
    this.camera.bottom = this.h;
    this.camera.updateProjectionMatrix();
    /* mid-assembly resizes reflow text: settle instantly, stay honest */
    if (this.active.length) this.finishAll();
  }

  private kick() {
    if (this.running || !this.ok) return;
    this.running = true;
    this.lt = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /* ---------------- the loop ---------------- */

  private frame = (now: number) => {
    if (document.hidden || !this.renderer) { this.running = false; return; }
    const dt = clamp((now - this.lt) / 1000, 0.001, 0.05);
    this.lt = now;
    const t = now / 1000;
    const sy = scrollY;
    this.fade = Math.min(1, this.fade + dt * 0.9);

    /* reveal characters whose dots have (mostly) landed */
    for (let ai = this.active.length - 1; ai >= 0; ai--) {
      const r = this.recs[this.active[ai]];
      if (!r.done && (now >= r.revealAt || (r.need > 0 && r.got >= r.need * 0.72))) {
        r.done = true;
        r.fadeAt = now + 130;
        r.el.classList.add('on');
      }
      if (r.done && now > r.fadeAt + 900) this.active.splice(ai, 1);
    }

    const { px, py, vx, vy, st, alpha } = this;
    const pvx = this.pointerVX, pvy = this.pointerVY;
    const stir = 60 + Math.min(220, Math.hypot(pvx, pvy) * 14);

    for (let i = 0; i < this.N; i++) {
      const s = st[i];

      if (s === SEEK && now >= this.seekT[i]) {
        /* damped spring with stiffness ramping in over 240ms */
        const ramp = Math.min(1, (now - this.seekT[i]) / 240);
        const k = 130 * ramp * ramp;
        const c = 2 * Math.sqrt(Math.max(k, 1)) * 0.92;
        const txv = this.tx[i];
        const tyv = this.ty[i] - sy;
        vx[i] += (k * (txv - px[i]) - c * vx[i]) * dt;
        vy[i] += (k * (tyv - py[i]) - c * vy[i]) * dt;
        px[i] += vx[i] * dt;
        py[i] += vy[i] * dt;
        const dx = txv - px[i], dy = tyv - py[i];
        if (ramp === 1 && dx * dx + dy * dy < 0.5 && Math.abs(vx[i]) + Math.abs(vy[i]) < 26) {
          st[i] = LOCK;
          px[i] = txv; py[i] = tyv;
          vx[i] = 0; vy[i] = 0;
          this.recs[this.charOf[i]].got++;
        }
        alpha[i] += (0.9 - alpha[i]) * Math.min(1, dt * 5);
        continue;
      }

      if (s === LOCK) {
        /* sit on the glyph, breathing imperceptibly, until the char shows */
        const r = this.recs[this.charOf[i]];
        px[i] = this.tx[i] + Math.sin(this.seed[i] * 43 + t * 2.1) * 0.3;
        py[i] = (this.ty[i] - sy) + Math.cos(this.seed[i] * 57 + t * 1.7) * 0.3;
        if (r.done && now >= r.fadeAt) {
          st[i] = RELEASE;
          this.relT[i] = now;
          const a = this.rng() * TAU;
          const sp = 24 + this.rng() * 46;
          vx[i] = Math.cos(a) * sp;
          vy[i] = Math.sin(a) * sp - 8;
        }
        alpha[i] += (0.92 - alpha[i]) * Math.min(1, dt * 8);
        continue;
      }

      /* FREE and RELEASE share the flow; RELEASE blends back in */
      const [u, v] = curl2(px[i] * 0.0011, py[i] * 0.0011, t * 0.075);
      const speed = 22 + this.seed[i] * 18;
      const blend = 1 - Math.exp(-dt * (s === RELEASE ? 2.6 : 1.6));
      vx[i] += (u * speed - vx[i]) * blend;
      vy[i] += (v * speed - vy[i]) * blend;

      /* the cursor stirs the field */
      const mdx = px[i] - this.pointerX;
      const mdy = py[i] - this.pointerY;
      const md2 = mdx * mdx + mdy * mdy;
      if (md2 < 12100 && md2 > 0.01) {
        const md = Math.sqrt(md2);
        const f = (1 - md / 110) * stir * dt;
        vx[i] += (mdx / md) * f + pvx * 0.4 * dt;
        vy[i] += (mdy / md) * f + pvy * 0.4 * dt;
      }

      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
      if (px[i] < -10) px[i] = this.w + 10; else if (px[i] > this.w + 10) px[i] = -10;
      if (py[i] < -10) py[i] = this.h + 10; else if (py[i] > this.h + 10) py[i] = -10;

      if (s === RELEASE && now - this.relT[i] > 420) st[i] = FREE;

      const tw = 0.62 + 0.38 * Math.sin(this.seed[i] * TAU + t * (0.6 + this.seed[i] * 1.6));
      const target = this.baseA[i] * tw * this.fade;
      alpha[i] += (target - alpha[i]) * Math.min(1, dt * (s === RELEASE ? 3 : 6));
    }

    /* push to GPU */
    const pos = this.posAttr.array as Float32Array;
    for (let i = 0; i < this.N; i++) {
      pos[i * 3] = px[i];
      pos[i * 3 + 1] = py[i];
    }
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  /* ---------------- glyph sampling ---------------- */

  private fontOf(el: Element): string {
    const cs = getComputedStyle(el);
    return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  }

  private glyphPoints(chr: string, font: string, stride: number): Glyph {
    const key = `${chr}|${font}|${stride}`;
    const hit = this.glyphs.get(key);
    if (hit) return hit;
    const mx = this.mx;
    mx.font = font;
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
    const pts: [number, number][] = [];
    const off = stride >> 1;
    for (let y = off; y < H; y += stride) {
      for (let x = off; x < W; x += stride) {
        if (data[(y * W + x) * 4 + 3] > 100) pts.push([x - 2, y - 2]);
      }
    }
    const rec: Glyph = { pts, h: asc + desc };
    this.glyphs.set(key, rec);
    return rec;
  }

  /* claim the nearest free dot of a small random sample */
  private takeParticle(x: number, y: number): number {
    const cand: number[] = [];
    for (let tries = 0; tries < 24 && cand.length < 5; tries++) {
      const i = (this.rng() * this.N) | 0;
      const s = this.st[i];
      if (s === FREE || s === RELEASE) cand.push(i);
    }
    return bestCandidate(cand, this.px, this.py, x, y);
  }

  private countFree(): number {
    let n = 0;
    for (let i = 0; i < this.N; i++) {
      if (this.st[i] === FREE || this.st[i] === RELEASE) n++;
    }
    return n;
  }

  /* ---------------- public API ---------------- */

  /*
   * Animate every un-revealed character under `root`. Resolves when the
   * block is legible. Under reduced motion (or without WebGL) it reveals
   * instantly.
   */
  assemble(root: HTMLElement, { delay = 0, perChar = 12 }: { delay?: number; perChar?: number } = {}): Promise<void> {
    const spans = Array.from(root.querySelectorAll<HTMLElement>('span.ch:not(.on)'));
    if (!spans.length) return Promise.resolve();
    if (!this.ok) {
      for (const s of spans) s.classList.add('on');
      return Promise.resolve();
    }

    const rng = this.rng;
    const sched = buildSchedule(spans.length, { perChar, rng });
    const start = performance.now() + delay;

    /* measure visible glyph spans + estimate ink for the stride budget */
    type Item = { el: HTMLElement; rect: DOMRect; i: number; fs: number };
    const items: Item[] = [];
    let est = 0;
    for (let i = 0; i < spans.length; i++) {
      const el = spans[i];
      if (!el.textContent || !el.textContent.trim()) { el.classList.add('on'); continue; }
      const rect = el.getBoundingClientRect();
      if (!rect.width && !rect.height) { el.classList.add('on'); continue; }
      const fs = parseFloat(getComputedStyle(el.parentElement ?? el).fontSize) || 16;
      items.push({ el, rect, i, fs });
      est += fs * fs * 0.18;
    }
    if (!items.length) return Promise.resolve();

    const free = this.countFree();
    const budget = clamp(Math.floor(free * 0.8), 600, 9000);
    const stride = strideForBudget(est, budget);
    const sx0 = scrollX, sy0 = scrollY;

    for (const it of items) {
      const font = this.fontOf(it.el.parentElement ?? it.el);
      const glyph = this.glyphPoints(it.el.textContent!, font, stride);
      const rec: Rec = {
        el: it.el,
        need: glyph.pts.length,
        got: 0,
        revealAt: start + sched.delays[it.i] + 560,
        done: false,
        fadeAt: 0,
      };
      const ri = this.recs.push(rec) - 1;
      this.active.push(ri);
      const scaleY = glyph.h > 0 ? it.rect.height / glyph.h : 1;
      for (const [gx, gy] of glyph.pts) {
        const txp = it.rect.left + sx0 + gx + (rng() - 0.5) * 0.7;
        const typ = it.rect.top + sy0 + gy * scaleY + (rng() - 0.5) * 0.7;
        const pi = this.takeParticle(txp, typ - sy0);
        if (pi < 0) { rec.need--; continue; }
        this.st[pi] = SEEK;
        this.tx[pi] = txp;
        this.ty[pi] = typ;
        this.seekT[pi] = start + sched.delays[it.i] + rng() * 34;
        this.charOf[pi] = ri;
      }
    }

    this.kick();
    return new Promise((res) => setTimeout(() => {
      /*
       * Safety net: reveal by live query at settle time. If any rec ref went
       * stale (e.g. hydration swapped nodes under us), the text still lands.
       */
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('span.ch:not(.on)'))) {
        el.classList.add('on');
      }
      res();
    }, delay + sched.total + 950));
  }

  /* Instantly reveal everything in flight (intro skip). */
  finishAll() {
    const now = performance.now();
    for (const ri of this.active) {
      const r = this.recs[ri];
      if (!r.done) {
        r.done = true;
        r.fadeAt = now;
        r.el.classList.add('on');
      }
    }
    for (let i = 0; i < this.N; i++) {
      if (this.st[i] === SEEK || this.st[i] === LOCK) {
        this.st[i] = RELEASE;
        this.relT[i] = now;
        this.vx[i] = (this.rng() - 0.5) * 60;
        this.vy[i] = (this.rng() - 0.5) * 60;
      }
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.running = false;
    removeEventListener('resize', this.onResize);
    removeEventListener('pointermove', this.onPointer);
    document.removeEventListener('visibilitychange', this.onVis);
    this.geo.dispose();
    this.mat?.dispose();
    this.renderer?.dispose();
    this.renderer = null;
  }
}

/* module singleton so React StrictMode double-mounts reuse one engine */
let engine: DotEngine | null = null;

export function getEngine(canvas: HTMLCanvasElement, reduced: boolean): DotEngine {
  if (!engine) engine = new DotEngine(canvas, { reduced });
  return engine;
}
