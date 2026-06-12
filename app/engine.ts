/*
 * engine.ts  v4 - dot field with ocean swell, vortex swirl, and photo handoff.
 *
 * Free dots ride three layered motions:
 *   1. A diagonal travelling swell (waveField): bands of motion sweep across
 *      the screen like open water, and dots sparkle on the crests.
 *   2. Curl-noise eddies - divergence-free wander so the field stays fluid.
 *   3. Four slow vortex attractors plus a cursor whirlpool: dots near the
 *      pointer are pushed away AND spun tangentially.
 *
 * Assembly is unchanged at heart (claim nearest free dots, damped springs,
 * left-to-right stagger, DOM chars fade in underneath) with one new trick:
 * when an expansion has an origin and the portrait is on screen, the engine
 * swaps its claimed dots INTO photo cells - the cell hides, the engine dot
 * launches from that exact pixel, and the portrait visibly feeds the words.
 * Cells refill in under 20 s.
 *
 * The borrow only happens when the field is actually short of dots near
 * the click - otherwise the portrait is left alone.  Borrowed cells are
 * repaired by replacement dots that migrate in from off-screen, on a
 * schedule that scales with the bite (entire photo: under 20 s).
 */

import * as THREE from 'three';
import { PhotoLayer, type LayoutOpts, type SlotRect } from './photo';
import {
  clamp, mulberry32, curl2, waveField, buildSchedule, strideForBudget, poolCount,
} from '../utils.js';

const TAU = Math.PI * 2;

const FREE    = 0;
const SEEK    = 1;
const LOCK    = 2;
const RELEASE = 3;
const DEAD    = 4;

type Rec = {
  el: Element; need: number; got: number;
  revealAt: number; done: boolean; fadeAt: number;
};
type Glyph = { pts: [number, number][]; h: number };

/* ---------------------------------------------------------------- shaders */

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vA;
  uniform float uDpr;
  void main() {
    vA = aAlpha;
    gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uDpr;
  }
`;

const FRAG = /* glsl */ `
  precision mediump float;
  varying float vA;
  void main() {
    vec2  c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.14, d) * vA;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vec3(1.0), a);
  }
`;

/* ============================================================ DotEngine */

export class DotEngine {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene    = new THREE.Scene();
  private camera   = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
  private geo      = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial | null = null;

  private N = 0;
  private px!: Float32Array; private py!: Float32Array;
  private vx!: Float32Array; private vy!: Float32Array;
  private tx!: Float32Array; private ty!: Float32Array;
  private st!: Uint8Array;
  private seekT!: Float32Array;
  private relT!:  Float32Array;
  private alpha!: Float32Array; private baseA!: Float32Array;
  private size!:  Float32Array; private seed!:  Float32Array;
  private charOf!: Int32Array;

  private posAttr!:   THREE.BufferAttribute;
  private sizeAttr!:  THREE.BufferAttribute;
  private alphaAttr!: THREE.BufferAttribute;

  private recs:   Rec[]    = [];
  private active: number[] = [];
  private photo:  PhotoLayer | null = null;
  private slotEl: HTMLElement | null = null;

  private rng    = mulberry32(0x00c0ffee);
  private glyphs = new Map<string, Glyph>();
  private mx:    CanvasRenderingContext2D;

  private w = 1; private h = 1;
  private pointerX = -1e4; private pointerY = -1e4;
  private pointerVX = 0;   private pointerVY = 0;
  private fade    = 0;
  private running = false;
  private lt      = 0;
  private raf     = 0;
  private pausedAt = 0;
  private crowd   = 1;

  /* ---- vortex attractors -------------------------------------------- */
  /* Four slow-drifting whirlpool centres.  Even/odd indices spin opposite ways. */
  private readonly VN = 4;
  private vortPX  = new Float32Array(4);
  private vortPY  = new Float32Array(4);
  private vortStr = new Float32Array([260, 220, 200, 180]);
  /* +1 = CCW, -1 = CW */
  private vortSgn = new Float32Array([1, -1, 1, -1]);

  readonly reduced: boolean;
  readonly ok:      boolean;

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
    } catch { ok = false; this.renderer = null; }
    this.ok = ok && !reduced;

    if (this.ok) {
      this.allocate();
      this.mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: { uDpr: { value: 1 } },
        transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.scene.add(new THREE.Points(this.geo, this.mat));
      this.resize();
      if (document.hidden) this.pausedAt = performance.now();
      addEventListener('resize',       this.onResize,  { passive: true });
      addEventListener('pointermove',  this.onPointer, { passive: true });
      document.addEventListener('visibilitychange', this.onVis);
      this.kick();
    }
  }

  /* ---------------------------------------------------------------- setup */

  private allocate() {
    const n = poolCount(innerWidth, innerHeight);
    this.N = n;
    this.px = new Float32Array(n); this.py = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n);
    this.tx = new Float32Array(n); this.ty = new Float32Array(n);
    this.st      = new Uint8Array(n);
    this.seekT   = new Float32Array(n);
    this.relT    = new Float32Array(n);
    this.alpha   = new Float32Array(n);
    this.baseA   = new Float32Array(n);
    this.size    = new Float32Array(n);
    this.seed    = new Float32Array(n);
    this.charOf  = new Int32Array(n);

    const r   = this.rng;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.px[i]    = r() * innerWidth;
      this.py[i]    = r() * innerHeight;
      this.vx[i]    = (r() - 0.5) * 10;
      this.vy[i]    = (r() - 0.5) * 10;
      this.baseA[i] = 0.07 + r() * 0.36;
      this.size[i]  = 1.5 + r() * 1.7;
      this.seed[i]  = r();
      pos[i * 3]    = this.px[i];
      pos[i * 3 + 1]= this.py[i];
    }
    this.posAttr   = new THREE.BufferAttribute(pos, 3);
    this.sizeAttr  = new THREE.BufferAttribute(this.size, 1);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aSize',    this.sizeAttr);
    this.geo.setAttribute('aAlpha',   this.alphaAttr);
  }

  private onResize  = () => this.resize();
  private onPointer = (e: PointerEvent) => {
    const nx = e.clientX, ny = e.clientY;
    this.pointerVX = nx - this.pointerX;
    this.pointerVY = ny - this.pointerY;
    this.pointerX  = nx;
    this.pointerY  = ny;
  };
  private onVis = () => {
    if (document.hidden) { this.pausedAt = performance.now(); return; }
    if (this.pausedAt) {
      const shift = performance.now() - this.pausedAt;
      this.pausedAt = 0;
      for (const ri of this.active) {
        const r = this.recs[ri];
        if (!r.done) r.revealAt += shift; else r.fadeAt += shift;
      }
      for (let i = 0; i < this.N; i++) {
        if (this.st[i] === SEEK) this.seekT[i] += shift;
      }
    }
    this.kick();
  };

  private slotPageRect(): SlotRect {
    const el = this.slotEl;
    if (!el || !el.isConnected) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return null;
    const r = el.getBoundingClientRect();
    if (r.width < 40) return null;
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  }

  /* measured page anchors so the portrait can centre itself in the real
     leftover space and stay clear of the footer rule on any aspect ratio */
  private layoutOpts(): LayoutOpts {
    let colRight = 792;
    let footerTop = innerHeight;
    const main = document.querySelector('main');
    if (main) colRight = Math.max(520, Math.min(main.getBoundingClientRect().right, innerWidth));
    const foot = document.querySelector('footer');
    if (foot) {
      const fr = foot.getBoundingClientRect();
      if (fr.height > 0) footerTop = fr.top + scrollY;
    }
    return { colRight, footerTop };
  }

  private resize() {
    if (!this.renderer || !this.mat) return;
    this.w = innerWidth; this.h = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.w, this.h, false);
    this.mat.uniforms.uDpr.value = dpr;
    this.camera.left   = 0; this.camera.right  = this.w;
    this.camera.top    = 0; this.camera.bottom = this.h;
    this.camera.updateProjectionMatrix();
    this.photo?.layout(this.w, this.h, dpr, this.slotPageRect(), this.layoutOpts());
    if (this.active.length) this.finishAll();
  }

  private kick() {
    if (this.running || !this.ok) return;
    this.running = true;
    this.lt  = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /* ---------------------------------------------------------------- vortices */

  /* Update the four drifting vortex centres.  Positions are in screen px,
     driven by slow sinusoids so they never stop and never repeat quickly. */
  private updateVortices(t: number) {
    this.vortPX[0] = this.w * (0.18 + 0.09 * Math.sin(t * 0.11));
    this.vortPY[0] = this.h * (0.30 + 0.11 * Math.cos(t * 0.08));

    this.vortPX[1] = this.w * (0.78 + 0.08 * Math.cos(t * 0.09));
    this.vortPY[1] = this.h * (0.65 + 0.10 * Math.sin(t * 0.10));

    this.vortPX[2] = this.w * (0.48 + 0.13 * Math.sin(t * 0.07 + 2.1));
    this.vortPY[2] = this.h * (0.14 + 0.07 * Math.cos(t * 0.12 + 1.0));

    this.vortPX[3] = this.w * (0.62 + 0.07 * Math.cos(t * 0.13 + 0.5));
    this.vortPY[3] = this.h * (0.82 + 0.06 * Math.sin(t * 0.08 + 3.1));
  }

  /* ---------------------------------------------------------------- the loop */

  private frame = (now: number) => {
    if (document.hidden || !this.renderer) { this.running = false; return; }
    const dt = clamp((now - this.lt) / 1000, 0.001, 0.05);
    this.lt  = now;
    const t  = now / 1000;
    const sy = scrollY;
    this.fade = Math.min(1, this.fade + dt * 0.9);

    this.updateVortices(t);

    /* reveal and expire records */
    for (let ai = this.active.length - 1; ai >= 0; ai--) {
      const r = this.recs[this.active[ai]];
      if (!r.done && (now >= r.revealAt || (r.need > 0 && r.got >= r.need * 0.72))) {
        r.done = true; r.fadeAt = now + 130; r.el.classList.add('on');
      }
      if (r.done && now > r.fadeAt + 900) this.active.splice(ai, 1);
    }

    const { px, py, vx, vy, st, alpha } = this;
    /* pointer momentum decays when the pointer rests */
    this.pointerVX *= Math.exp(-dt * 4);
    this.pointerVY *= Math.exp(-dt * 4);
    const pvx = this.pointerVX, pvy = this.pointerVY;
    const stir = 170 + Math.min(450, Math.hypot(pvx, pvy) * 24);

    for (let i = 0; i < this.N; i++) {
      const s = st[i];

      if (s === DEAD) {
        if (alpha[i] > 0.001) alpha[i] += (0 - alpha[i]) * Math.min(1, dt * 5);
        continue;
      }

      if (s === SEEK && now >= this.seekT[i]) {
        const ramp = Math.min(1, (now - this.seekT[i]) / 240);
        const k    = 130 * ramp * ramp;
        const c    = 2 * Math.sqrt(Math.max(k, 1)) * 0.92;
        const txv  = this.tx[i];
        const tyv  = this.ty[i] - sy;
        vx[i] += (k * (txv - px[i]) - c * vx[i]) * dt;
        vy[i] += (k * (tyv - py[i]) - c * vy[i]) * dt;
        px[i] += vx[i] * dt;
        py[i] += vy[i] * dt;
        const dx = txv - px[i], dy = tyv - py[i];
        if (ramp === 1 && dx * dx + dy * dy < 0.5 && Math.abs(vx[i]) + Math.abs(vy[i]) < 26) {
          st[i] = LOCK; px[i] = txv; py[i] = tyv; vx[i] = 0; vy[i] = 0;
          this.recs[this.charOf[i]].got++;
        }
        alpha[i] += (0.9 - alpha[i]) * Math.min(1, dt * 5);
        continue;
      }

      if (s === LOCK) {
        const r = this.recs[this.charOf[i]];
        px[i] = this.tx[i] + Math.sin(this.seed[i] * 43 + t * 2.1) * 0.3;
        py[i] = (this.ty[i] - sy) + Math.cos(this.seed[i] * 57 + t * 1.7) * 0.3;
        if (r.done && now >= r.fadeAt) {
          if (this.rng() < 0.45) {
            st[i] = DEAD;
          } else {
            st[i] = RELEASE; this.relT[i] = now;
            const a2 = this.rng() * TAU;
            const sp = 20 + this.rng() * 40;
            vx[i] = Math.cos(a2) * sp; vy[i] = Math.sin(a2) * sp - 6;
          }
        }
        alpha[i] += (0.92 - alpha[i]) * Math.min(1, dt * 8);
        continue;
      }

      /* FREE and RELEASE - the swirling, rolling free field */

      /* 1. Curl-noise eddies (calmer than v3 so the swell reads clearly) */
      const [u, v] = curl2(px[i] * 0.0011, py[i] * 0.0011, t * 0.075);
      const eddy   = 14 + this.seed[i] * 12;
      let targetVX = u * eddy;
      let targetVY = v * eddy;

      /* 2. Diagonal ocean swell sweeping across the screen */
      const [wu, wv, crest] = waveField(px[i], py[i], t);
      targetVX += wu;
      targetVY += wv;

      /* 3. Vortex tangential contributions */
      for (let vi = 0; vi < this.VN; vi++) {
        const dvx = px[i] - this.vortPX[vi];
        const dvy = py[i] - this.vortPY[vi];
        const d2  = dvx * dvx + dvy * dvy;
        const maxR = this.vortStr[vi];
        if (d2 < maxR * maxR && d2 > 1) {
          const d          = Math.sqrt(d2);
          const influence  = (1 - d / maxR);
          /* quadratic falloff: very strong near centre, fades at edge */
          const vortSpeed  = influence * influence * 52 * this.vortSgn[vi];
          /* tangential direction (CCW = (-dy/d, dx/d)) */
          targetVX += (-dvy / d) * vortSpeed;
          targetVY += ( dvx / d) * vortSpeed;
        }
      }

      /* 4. Blend current velocity toward target */
      const blend = 1 - Math.exp(-dt * (s === RELEASE ? 2.6 : 1.6));
      vx[i] += (targetVX - vx[i]) * blend;
      vy[i] += (targetVY - vy[i]) * blend;

      /* 5. Cursor: radial repulsion + tangential whirlpool */
      const mdx = px[i] - this.pointerX;
      const mdy = py[i] - this.pointerY;
      const md2 = mdx * mdx + mdy * mdy;
      if (md2 < 28900 && md2 > 0.01) {         /* 170 px radius */
        const md        = Math.sqrt(md2);
        const radialF   = (1 - md / 170) * stir * dt;
        /* tangential force (CCW whirlpool around cursor) */
        const tangentF  = radialF * 1.0;
        vx[i] += (mdx / md) * radialF + (-mdy / md) * tangentF + pvx * 0.6 * dt;
        vy[i] += (mdy / md) * radialF + ( mdx / md) * tangentF + pvy * 0.6 * dt;
      }

      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
      if (px[i] < -10) px[i] = this.w + 10; else if (px[i] > this.w + 10) px[i] = -10;
      if (py[i] < -10) py[i] = this.h + 10; else if (py[i] > this.h + 10) py[i] = -10;

      if (s === RELEASE && now - this.relT[i] > 420) st[i] = FREE;

      const visible = this.seed[i] <= this.crowd ? 1 : 0;
      /* dots sparkle as the swell crest passes through them */
      const sparkle = 1 + 0.22 * Math.max(0, crest);
      const tw      = (0.62 + 0.38 * Math.sin(this.seed[i] * TAU + t * (0.6 + this.seed[i] * 1.6))) * sparkle;
      const target  = this.baseA[i] * tw * this.fade * visible;
      alpha[i] += (target - alpha[i]) * Math.min(1, dt * (s === RELEASE ? 3 : 4));
    }

    this.photo?.update(now, dt, this.fade, this.pointerX, this.pointerY, sy);

    const pos = this.posAttr.array as Float32Array;
    for (let i = 0; i < this.N; i++) {
      pos[i * 3]     = px[i];
      pos[i * 3 + 1] = py[i];
    }
    this.posAttr.needsUpdate   = true;
    this.alphaAttr.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  /* -------------------------------------------------------- glyph sampling */

  private fontOf(el: Element): string {
    const cs = getComputedStyle(el);
    return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  }

  private glyphPoints(chr: string, font: string, stride: number): Glyph {
    const key = `${chr}|${font}|${stride}`;
    const hit  = this.glyphs.get(key);
    if (hit) return hit;
    const mx = this.mx;
    mx.font  = font;
    const m  = mx.measureText(chr);
    const asc  = m.fontBoundingBoxAscent  ?? m.actualBoundingBoxAscent  ?? 16;
    const desc = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? 5;
    const W = Math.max(2, Math.ceil(m.width) + 4);
    const H = Math.max(2, Math.ceil(asc + desc) + 4);
    if (mx.canvas.width  < W) mx.canvas.width  = W;
    if (mx.canvas.height < H) mx.canvas.height = H;
    mx.clearRect(0, 0, mx.canvas.width, mx.canvas.height);
    mx.font = font;
    mx.fillStyle = '#fff'; mx.textBaseline = 'alphabetic';
    mx.fillText(chr, 2, 2 + asc);
    const data = mx.getImageData(0, 0, W, H).data;
    const pts: [number, number][] = [];
    const off = stride >> 1;
    for (let y = off; y < H; y += stride)
      for (let x = off; x < W; x += stride)
        if (data[(y * W + x) * 4 + 3] > 100) pts.push([x - 2, y - 2]);
    const rec: Glyph = { pts, h: asc + desc };
    this.glyphs.set(key, rec);
    return rec;
  }

  private makeClaimer(ox: number, oy: number): () => number {
    const order: number[] = [];
    for (let i = 0; i < this.N; i++) {
      const s = this.st[i];
      if (s === FREE || s === RELEASE) order.push(i);
    }
    const score = new Float32Array(this.N);
    for (const i of order)
      score[i] = Math.hypot(this.px[i] - ox, this.py[i] - oy) + this.rng() * 170;
    order.sort((a, b) => score[a] - score[b]);
    let ptr = 0;
    return () => (ptr < order.length ? order[ptr++] : -1);
  }

  setCrowd(c: number) { this.crowd = clamp(c, 0, 1); this.kick(); }

  private countFree(): number {
    let n = 0;
    for (let i = 0; i < this.N; i++)
      if (this.st[i] === FREE || this.st[i] === RELEASE) n++;
    return n;
  }

  /* ---------------------------------------------------------- public API */

  attachPhoto(url: string): void {
    if (!this.ok || this.photo) return;
    const layer = new PhotoLayer(this.scene);
    this.photo  = layer;
    void layer.load(url).then(() => {
      if (this.photo !== layer) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      layer.layout(this.w, this.h, dpr, this.slotPageRect(), this.layoutOpts());
      this.kick();
    }).catch(() => {
      if (this.photo === layer) this.photo = null;
      layer.dispose();
    });
  }

  /* the in-flow element the portrait should fill on small screens */
  setPhotoSlot(el: HTMLElement | null): void {
    this.slotEl = el;
    this.relayoutPhoto();
  }

  /* re-measure the photo placement (layout shifts, slot moves, expansions) */
  relayoutPhoto(): void {
    if (!this.photo) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.photo.layout(this.w, this.h, dpr, this.slotPageRect(), this.layoutOpts());
  }

  assemble(root: HTMLElement, { delay = 0, perChar = 12, origin }: {
    delay?:  number;
    perChar?: number;
    origin?:  { x: number; y: number };
  } = {}): Promise<void> {
    const spans = Array.from(root.querySelectorAll<HTMLElement>('span.ch:not(.on)'));
    if (!spans.length) return Promise.resolve();
    if (!this.ok) {
      for (const s of spans) s.classList.add('on');
      return Promise.resolve();
    }

    const rng   = this.rng;
    const sched = buildSchedule(spans.length, { perChar, rng });
    const start = performance.now() + delay;

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

    const free   = this.countFree();
    const budget = clamp(Math.floor(free * 0.55), 900, 6000);
    const stride = strideForBudget(est, budget);
    const estPts = Math.min(budget, Math.round(est / (stride * stride)));

    /*
     * Photo handoff, only on real scarcity: if the free dots within reach
     * of the click cannot cover this assembly, borrow the shortfall from
     * the portrait - its nearest cells go dark as their dots launch into
     * the words, and replacements migrate back in from off-screen (the
     * whole repair scales with the bite, never more than 20 s).
     */
    let starts: [number, number][] = [];
    let si = 0;
    if (origin && this.photo?.visible()) {
      let nearby = 0;
      for (let i = 0; i < this.N; i++) {
        const st0 = this.st[i];
        if (st0 !== FREE && st0 !== RELEASE) continue;
        const dx = this.px[i] - origin.x;
        const dy = this.py[i] - origin.y;
        if (dx * dx + dy * dy < 78400) nearby++;   /* within 280 px */
      }
      const shortfall = estPts - nearby;
      if (shortfall > 40) {
        starts = this.photo.takeCellsToward(origin.x, origin.y, Math.min(shortfall, 700));
      }
    }
    /* borrowed cells stand in for the would-be farthest travellers */
    const tailFrom = Math.max(0, estPts - starts.length);

    const sx0 = scrollX, sy0 = scrollY;
    const rootRect = root.getBoundingClientRect();
    const claim = this.makeClaimer(
      origin?.x ?? rootRect.left + rootRect.width  / 2,
      origin?.y ?? rootRect.top  + rootRect.height / 2,
    );

    let claimed = 0;
    for (const it of items) {
      const font  = this.fontOf(it.el.parentElement ?? it.el);
      const glyph = this.glyphPoints(it.el.textContent!, font, stride);
      const rec: Rec = {
        el: it.el, need: glyph.pts.length, got: 0,
        revealAt: start + sched.delays[it.i] + 560,
        done: false, fadeAt: 0,
      };
      const ri = this.recs.push(rec) - 1;
      this.active.push(ri);
      const scaleY = glyph.h > 0 ? it.rect.height / glyph.h : 1;
      for (const [gx, gy] of glyph.pts) {
        const txp = it.rect.left + sx0 + gx + (rng() - 0.5) * 0.7;
        const typ = it.rect.top  + sy0 + gy * scaleY + (rng() - 0.5) * 0.7;
        const pi  = claim();
        if (pi < 0) { rec.need--; continue; }
        /* once local supply runs out, dots launch from borrowed photo cells */
        if (claimed >= tailFrom && si < starts.length) {
          const sp = starts[si++];
          this.px[pi] = sp[0]; this.py[pi] = sp[1];
          this.vx[pi] = 0;     this.vy[pi] = 0;
          this.alpha[pi] = 0.8;
        }
        claimed++;
        this.st[pi]     = SEEK;
        this.tx[pi]     = txp;
        this.ty[pi]     = typ;
        this.seekT[pi]  = start + sched.delays[it.i] + rng() * 34;
        this.charOf[pi] = ri;
      }
    }

    this.kick();
    return new Promise((res) => setTimeout(() => {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('span.ch:not(.on)')))
        el.classList.add('on');
      res();
    }, delay + sched.total + 950));
  }

  finishAll() {
    const now = performance.now();
    for (const ri of this.active) {
      const r = this.recs[ri];
      if (!r.done) { r.done = true; r.fadeAt = now; r.el.classList.add('on'); }
    }
    for (let i = 0; i < this.N; i++) {
      if (this.st[i] === SEEK || this.st[i] === LOCK) {
        if (this.rng() < 0.45) {
          this.st[i] = DEAD;
        } else {
          this.st[i] = RELEASE; this.relT[i] = now;
          this.vx[i] = (this.rng() - 0.5) * 60;
          this.vy[i] = (this.rng() - 0.5) * 60;
        }
      }
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.running = false;
    removeEventListener('resize',      this.onResize);
    removeEventListener('pointermove', this.onPointer);
    document.removeEventListener('visibilitychange', this.onVis);
    this.photo?.dispose();
    this.photo = null;
    this.geo.dispose();
    this.mat?.dispose();
    this.renderer?.dispose();
    this.renderer = null;
  }
}

let engine: DotEngine | null = null;

export function getEngine(canvas: HTMLCanvasElement, reduced: boolean): DotEngine {
  if (!engine) engine = new DotEngine(canvas, { reduced });
  return engine;
}
