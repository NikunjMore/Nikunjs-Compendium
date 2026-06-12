/*
 * photo.ts  v4 - portrait with living churn, cell handoff, and word donation.
 *
 * The portrait is a grid of GPU dots (GRID_W sample columns). Three systems:
 *
 * 1. Organic churn - every dot runs a staggered 20 s cycle: settled at home,
 *    spiral out, wander near the portrait, return from a new direction. At
 *    any moment a slice of dots is mid-cycle (the aura around the photo), so
 *    the picture constantly trades dots with the free field.
 *
 * 2. Cell handoff (takeCellsToward / takeCellsInRect) - the engine swaps its
 *    own free dots into photo cells: the cell hides (alpha envelope, fully
 *    refilled in under 20 s) while an engine dot launches from the exact
 *    same spot to go build words. The portrait visibly feeds the text.
 *
 * 3. Layout modes - 'zone' (desktop: right of the text column, fixed) and
 *    'slot' (mobile: an in-flow element that scrolls with the page). The
 *    portrait scales with the viewport in both modes.
 *
 * v4 rendering: dot size tracks the grid pitch (no additive mush), less
 * jitter, near-still dots - the picture reads sharper at the same grid.
 */

import * as THREE from 'three';
import { clamp, mulberry32 } from '../utils.js';

const MARGIN   = 18;
const GRID_W   = 880;  /* sample columns (source me.jpg is 1600 px wide)     */
const MIN_ZONE = 160;
const MIN_VIEW = 900;  /* below this, desktop zone mode hides (slot takes over on mobile) */
const SHARPEN  = 0.85;

/*
 * Edge-aware density: flat areas keep DENS_FLOOR of their dots (with alpha
 * compensated so tone holds), edges and text keep everything.  This is what
 * lets an 880-column grid stay around ~420k dots instead of a million while
 * the certificate lettering stays dense and readable.
 */
const DENS_FLOOR = 0.22;  /* darkest flats keep this fraction          */
const DENS_TONE  = 0.42;  /* bright flats (paper) keep up to floor+this (solid paper) */
const DENS_GAIN  = 18;    /* edges and lettering keep everything        */
const COMP_CAP   = 3.2;

/*
 * Hide envelope (shader): fade out in 0.3 s, hidden until 8 s, refade by
 * 15 s - every taken cell is back well inside the 20 s budget.
 */
const HIDE_DONE = 16.0;

export type SlotRect = { x: number; y: number; w: number; h: number } | null;
export type LayoutOpts = { colRight: number; footerTop: number };

/* ------------------------------------------------------------------ shaders */

const VERT = /* glsl */ `
  attribute vec2  aUV;
  attribute float aLum;
  attribute float aSeed;
  attribute float aEscapePhase; /* random offset into the 20-s churn cycle */
  attribute float aHideT;       /* -1 = visible; else uTime when the cell was taken */
  attribute float aComp;        /* alpha compensation for density-thinned areas */

  varying float vA;

  uniform float uDpr, uTime, uBirth, uHov, uFade, uVis, uSpacing, uEnergy;
  uniform vec2  uPtr, uOrigin, uSize;

  const float PI  = 3.14159265;
  const float TAU = 6.28318530;

  void main() {
    vec2 homePos = uOrigin + aUV * uSize;
    vec2 pos     = homePos;

    /* ---- organic churn: a slow tonal wave ------------------------------- */
    /*
     * aEscapePhase is keyed to the dot's brightness, so dots of similar
     * tone cycle together: one thin tonal slice of the portrait is away at
     * a time, and every returning dot lands among siblings of its own
     * brightness.  Swaps read seamless instead of frantic.  The pace is
     * deliberately calm - long dwell at home, slow drifting orbits.
     */
    float period = 20.0;
    float cycleT = mod(uTime + aEscapePhase, period) / period;

    float escapeFrac = 0.0;
    vec2  wanderOff  = vec2(0.0);

    if (cycleT >= 0.78 && cycleT < 0.86) {
      /* leaving: slow outward spiral */
      float t = smoothstep(0.78, 0.86, cycleT);
      escapeFrac = t;
      float angle = aSeed * TAU + t * 2.2 + uTime * (0.16 + aSeed * 0.12);
      float r     = mix(0.0, 45.0 + aSeed * 70.0, t);
      wanderOff   = vec2(cos(angle), sin(angle)) * r;

    } else if (cycleT >= 0.86 && cycleT < 0.93) {
      /* wandering: unhurried orbit near the portrait */
      escapeFrac  = 1.0;
      float angle = aSeed * TAU + uTime * (0.18 + aSeed * 0.20);
      float r     = 50.0 + aSeed * 70.0
                  + sin(uTime * 0.5 + aSeed * 5.0) * 12.0;
      wanderOff   = vec2(cos(angle), sin(angle)) * r;

    } else if (cycleT >= 0.93) {
      /* returning: ease home from a rotated direction */
      float t = 1.0 - smoothstep(0.93, 1.0, cycleT);
      escapeFrac  = t;
      float angle = aSeed * TAU + PI + uTime * 0.06;
      float r     = mix(0.0, 55.0 + aSeed * 60.0, t);
      wanderOff   = vec2(cos(angle), sin(angle)) * r;
    }

    pos += wanderOff * escapeFrac;

    /* ---- birth condensation (only for home dots) ----------------------- */
    float stag = aUV.y * 0.45 + aSeed * 0.40;
    float b    = clamp((uBirth - stag) / 0.55, 0.0, 1.0);
    float eb   = 1.0 - pow(1.0 - b, 3.0);
    if (escapeFrac < 0.1) {
      pos += vec2(
        sin(aSeed * 517.0 + aUV.x * 9.0),
        cos(aSeed * 263.0 + aUV.y * 7.0)
      ) * (110.0 * (1.0 - eb));
    }

    /* ---- micro-drift (very calm so the image stays crisp) -------------- */
    pos += vec2(
      sin(uTime * 1.1 + aSeed * 41.0),
      cos(uTime * 0.9 + aSeed * 27.0)
    ) * 0.18 * mix(1.0, 0.3, escapeFrac);

    /* ---- cursor soft lens ----------------------------------------------- */
    vec2  d    = pos - uPtr;
    float r    = max(length(d), 0.001);
    float fall = exp(-(r * r) / 18000.0);   /* sigma ~95 px */
    vec2  dir  = d / r;
    vec2  tang = vec2(-dir.y, dir.x);
    pos += (
      dir  * (6.0 + 1.5 * sin(uTime * 1.3 + aSeed * 19.0)) +
      tang * 3.0 * sin(uTime * 1.1 + aSeed * 13.0)
    ) * fall * uHov;

    /* ---- taken-cell hide envelope --------------------------------------- */
    float hid = 0.0;
    if (aHideT >= 0.0) {
      float e = uTime - aHideT;
      hid = smoothstep(0.0, 0.30, e) * (1.0 - smoothstep(8.0, 15.0, e));
    }

    /* ---- alpha ----------------------------------------------------------- */
    float tw       = 0.97 + 0.03 * sin(aSeed * TAU + uTime * (0.7 + aSeed));
    float homeAlph = (0.10 + 0.86 * aLum) * tw * (1.0 + 0.15 * fall * uHov)
                   * aComp * uEnergy;
    float freeAlph = 0.16 * tw;   /* escaped dots blend into the free field */
    float a        = mix(homeAlph, freeAlph, escapeFrac);
    vA = a * eb * uFade * uVis * (1.0 - hid);

    float sz = uSpacing * (0.66 + 0.50 * aLum) * (1.0 + 0.35 * fall * uHov);
    gl_Position  = projectionMatrix * modelViewMatrix * vec4(pos, 0.0, 1.0);
    gl_PointSize = clamp(sz, 0.5, 3.2) * uDpr;
  }
`;

const FRAG = /* glsl */ `
  precision mediump float;
  varying float vA;
  void main() {
    vec2  c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.20, d) * vA;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vec3(1.0), a);
  }
`;

/* ============================================================ PhotoLayer */

export class PhotoLayer {
  private scene: THREE.Scene;
  private geo:   THREE.BufferGeometry | null = null;
  private mat:   THREE.ShaderMaterial  | null = null;
  private pts:   THREE.Points          | null = null;

  private aspect  = 4 / 3;
  private gridW   = GRID_W;
  private ready   = false;
  private bornAt  = 0;
  private hov     = 0;
  private vis     = 0;
  private visTarget = 0;
  private mode: 'zone' | 'slot' = 'zone';
  /* rect in page coordinates (zone mode: page == screen, no desktop scroll) */
  private rect = { x: 0, y: 0, w: 0, h: 0 };
  private sy   = 0;

  /* CPU-side cell data for handoff lookups */
  private uvXArr!:  Float32Array;
  private uvYArr!:  Float32Array;
  private hideTArr!: Float32Array;
  private hideAttr!: THREE.BufferAttribute;
  private hiddenIndices: number[] = [];
  private rng = mulberry32(0x0070bea7);

  constructor(scene: THREE.Scene) { this.scene = scene; }

  /* ---------------------------------------------------------------- load */

  async load(url: string): Promise<void> {
    const img = new Image();
    img.src = url;
    await img.decode();

    const gw = this.gridW;
    const gh = Math.max(2, Math.round(gw * (img.naturalHeight / img.naturalWidth)));
    this.aspect = gh / gw;

    const cv = document.createElement('canvas');
    cv.width = gw; cv.height = gh;
    const cx = cv.getContext('2d', { willReadFrequently: true })!;
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, gw, gh);
    const data = cx.getImageData(0, 0, gw, gh).data;

    /* tone-map with S-curve */
    const tones = new Float32Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) {
      const o = i * 4;
      const l = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
      const t = clamp((l - 0.03) / 0.90, 0, 1);
      tones[i] = Math.pow(t * t * (3 - 2 * t), 1.08);
    }
    /* unsharp mask for sharper edges at dot scale */
    const blur = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= gh) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= gw) continue;
            s += tones[yy * gw + xx]; n++;
          }
        }
        blur[y * gw + x] = s / n;
      }
    }

    const rng = this.rng;
    const uvArr:   number[] = [];
    const lumArr:  number[] = [];
    const seedArr: number[] = [];
    const epArr:   number[] = [];  /* churn phase [0, 20] seconds */
    const compArr: number[] = [];  /* alpha compensation for thinning */

    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i    = y * gw + x;
        const edge = Math.abs(tones[i] - blur[i]);
        const tone = clamp(tones[i] + SHARPEN * (tones[i] - blur[i]), 0, 1);
        if (tone < 0.012) continue;
        /* tone+edge-aware thinning: bright paper stays dense and solid,
           dark flats thin the most, edges/lettering keep every dot */
        const keepP = clamp(DENS_FLOOR + DENS_TONE * tone + DENS_GAIN * edge, DENS_FLOOR, 1);
        if (rng() > keepP) continue;
        uvArr.push(
          (x + 0.5 + (rng() - 0.5) * 0.28) / gw,
          (y + 0.5 + (rng() - 0.5) * 0.28) / gh,
        );
        lumArr.push(tone);
        seedArr.push(rng());
        /* churn phase keyed to brightness: similar tones cycle together */
        epArr.push(tone * 16.5 + rng() * 3.5);
        compArr.push(Math.min(1 / keepP, COMP_CAP));
      }
    }

    const n = lumArr.length;
    this.uvXArr   = new Float32Array(n);
    this.uvYArr   = new Float32Array(n);
    this.hideTArr = new Float32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      this.uvXArr[i] = uvArr[i * 2];
      this.uvYArr[i] = uvArr[i * 2 + 1];
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',     new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aUV',          new THREE.BufferAttribute(new Float32Array(uvArr), 2));
    geo.setAttribute('aLum',         new THREE.BufferAttribute(new Float32Array(lumArr), 1));
    geo.setAttribute('aSeed',        new THREE.BufferAttribute(new Float32Array(seedArr), 1));
    geo.setAttribute('aEscapePhase', new THREE.BufferAttribute(new Float32Array(epArr), 1));
    geo.setAttribute('aComp',        new THREE.BufferAttribute(new Float32Array(compArr), 1));

    const hideAttr = new THREE.BufferAttribute(this.hideTArr, 1);
    hideAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aHideT', hideAttr);
    this.hideAttr = hideAttr;

    const mat = new THREE.ShaderMaterial({
      vertexShader:   VERT,
      fragmentShader: FRAG,
      uniforms: {
        uDpr:     { value: 1 },
        uTime:    { value: 0 },
        uBirth:   { value: 0 },
        uHov:     { value: 0 },
        uFade:    { value: 0 },
        uVis:     { value: 0 },
        uSpacing: { value: 2.6 },
        uEnergy:  { value: 1 },
        uPtr:     { value: new THREE.Vector2(-1e4, -1e4) },
        uOrigin:  { value: new THREE.Vector2(0, 0) },
        uSize:    { value: new THREE.Vector2(1, 1) },
      },
      transparent: true,
      depthTest:   false,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
    });

    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder   = -1;
    this.scene.add(pts);
    this.geo  = geo;
    this.mat  = mat;
    this.pts  = pts;
    this.ready = true;
  }

  /* --------------------------------------------------------------- layout */

  /*
   * Desktop: park in the zone right of the text column, scaled to fit.
   * Mobile: fill the in-flow #photo-slot element (page coords), scrolling
   * with the content. `slot` is the slot's page-coordinate rect, or null
   * when the slot is hidden.
   */
  layout(
    w: number, h: number, dpr: number,
    slot: SlotRect = null,
    opts: LayoutOpts = { colRight: 792, footerTop: h },
  ): void {
    if (!this.mat) return;

    if (slot && slot.w > 40) {
      this.mode = 'slot';
      /* fit the portrait inside the slot, preserving aspect */
      let pw = slot.w;
      let ph = pw * this.aspect;
      if (ph > slot.h && slot.h > 0) { ph = slot.h; pw = ph / this.aspect; }
      this.rect = {
        x: slot.x + (slot.w - pw) / 2,
        y: slot.y + Math.max(0, (slot.h - ph) / 2),
        w: pw, h: ph,
      };
      this.visTarget = 1;
    } else {
      /*
       * Zone mode: the strip between the text column's real right edge and
       * the viewport edge, stopping above the footer rule.  Centring inside
       * the *measured* leftovers (instead of fixed offsets) keeps the
       * portrait visually centred and clear of the footer on any aspect
       * ratio - 16:9, 16:10, 3:2, ultrawide, all of them.
       */
      this.mode = 'zone';
      const left = opts.colRight + MARGIN;
      const zone = w - left - MARGIN;
      this.visTarget = zone >= MIN_ZONE && w >= MIN_VIEW ? 1 : 0;

      const availTop = 18;
      const availBot = Math.min(h - 14, opts.footerTop - 14);
      const availH   = Math.max(60, availBot - availTop);

      let pw = Math.max(10, Math.min(zone * 0.92, 720));
      let ph = pw * this.aspect;
      if (ph > availH) { ph = availH; pw = ph / this.aspect; }

      const x = left + Math.max(0, (zone - pw) / 2);
      const y = availTop + (availH - ph) * 0.46;
      this.rect = { x, y, w: pw, h: ph };
    }

    const u = this.mat.uniforms;
    (u.uSize.value as THREE.Vector2).set(this.rect.w, this.rect.h);
    u.uSpacing.value = this.rect.w / this.gridW;
    u.uDpr.value     = dpr;
    /*
     * When the dot pitch drops below one device pixel the sprites overlap
     * and additive blending overshoots; scale alpha by the squared pitch
     * so the tone stays calibrated at any render size.
     */
    const pitch = (this.rect.w * dpr) / this.gridW;
    u.uEnergy.value = clamp(pitch * pitch, 0.30, 1.0);
    this.applyOrigin();
  }

  private applyOrigin(): void {
    if (!this.mat) return;
    const u = this.mat.uniforms;
    const yOff = this.mode === 'slot' ? this.sy : 0;
    (u.uOrigin.value as THREE.Vector2).set(this.rect.x, this.rect.y - yOff);
  }

  /* current on-screen rect (after scroll compensation) */
  screenRect(): { x: number; y: number; w: number; h: number } {
    const yOff = this.mode === 'slot' ? this.sy : 0;
    return { x: this.rect.x, y: this.rect.y - yOff, w: this.rect.w, h: this.rect.h };
  }

  visible(): boolean {
    return this.ready && this.visTarget > 0.5 && this.rect.w > 40;
  }

  /* --------------------------------------------------------------- update */

  update(now: number, dt: number, fade: number, px: number, py: number, sy: number): void {
    if (!this.ready || !this.mat) return;
    if (this.bornAt === 0) this.bornAt = now + 350;
    this.sy = sy;
    this.applyOrigin();

    const u = this.mat.uniforms;
    const nowS = now / 1000;
    u.uTime.value  = nowS;
    u.uFade.value  = fade;
    u.uBirth.value = clamp((now - this.bornAt) / 2300, 0, 1) * 1.6;

    const r = this.screenRect();
    const inside =
      px >= r.x - 40 && px <= r.x + r.w + 40 &&
      py >= r.y - 40 && py <= r.y + r.h + 40;
    this.hov += ((inside ? 1 : 0) - this.hov) * Math.min(1, dt * 5);
    this.vis += (this.visTarget - this.vis)   * Math.min(1, dt * 4);
    u.uHov.value = this.hov;
    u.uVis.value = this.vis;
    (u.uPtr.value as THREE.Vector2).set(px, py);

    /* expire finished hides - only the small hidden set is touched */
    let dirty = false;
    for (let k = this.hiddenIndices.length - 1; k >= 0; k--) {
      const i = this.hiddenIndices[k];
      if (this.hideTArr[i] >= 0 && nowS - this.hideTArr[i] > HIDE_DONE) {
        this.hideTArr[i] = -1;
        this.hiddenIndices.splice(k, 1);
        dirty = true;
      }
    }
    if (dirty) this.hideAttr.needsUpdate = true;
  }

  /* ------------------------------------------------------------- handoff */

  private cellScreen(i: number): [number, number] {
    const r = this.screenRect();
    return [r.x + this.uvXArr[i] * r.w, r.y + this.uvYArr[i] * r.h];
  }

  private take(indices: number[]): [number, number][] {
    const nowS = performance.now() / 1000;
    const out: [number, number][] = [];
    for (const i of indices) {
      this.hideTArr[i] = nowS;
      this.hiddenIndices.push(i);
      out.push(this.cellScreen(i));
    }
    if (out.length) this.hideAttr.needsUpdate = true;
    return out;
  }

  /*
   * Take up to n cells nearest to the screen point (tx, ty): the face of
   * the portrait closest to the expanding text empties out and the engine
   * launches its dots from those exact spots. Cells refill in under 20 s.
   */
  takeCellsToward(tx: number, ty: number, n: number): [number, number][] {
    if (!this.visible() || !this.uvXArr) return [];
    const r = this.screenRect();
    const tUvX = (tx - r.x) / r.w;
    const tUvY = (ty - r.y) / r.h;
    const total = this.uvXArr.length;
    const cand: { i: number; d: number }[] = [];
    /* stride the grid so the sort stays cheap on ~200k cells */
    for (let i = 0; i < total; i += 3) {
      if (this.hideTArr[i] >= 0) continue;
      const dx = this.uvXArr[i] - tUvX;
      const dy = this.uvYArr[i] - tUvY;
      cand.push({ i, d: dx * dx + dy * dy });
    }
    cand.sort((a, b) => a.d - b.d);
    return this.take(cand.slice(0, n).map((c) => c.i));
  }

  /*
   * Take up to n cells inside a screen-space rect (inflated word box).
   * Sampled pseudo-randomly so the bite looks organic, not a scanline.
   */
  takeCellsInRect(rx: number, ry: number, rw: number, rh: number, n: number): [number, number][] {
    if (!this.visible() || !this.uvXArr) return [];
    const r = this.screenRect();
    const u0 = (rx - r.x) / r.w,      v0 = (ry - r.y) / r.h;
    const u1 = (rx + rw - r.x) / r.w, v1 = (ry + rh - r.y) / r.h;
    const total = this.uvXArr.length;
    const cand: number[] = [];
    for (let i = 0; i < total; i += 2) {
      if (this.hideTArr[i] >= 0) continue;
      const ux = this.uvXArr[i], uy = this.uvYArr[i];
      if (ux >= u0 && ux <= u1 && uy >= v0 && uy <= v1) cand.push(i);
    }
    /* Fisher-Yates partial shuffle for the first n */
    const m = Math.min(n, cand.length);
    for (let j = 0; j < m; j++) {
      const k = j + Math.floor(this.rng() * (cand.length - j));
      const tmp = cand[j]; cand[j] = cand[k]; cand[k] = tmp;
    }
    return this.take(cand.slice(0, m));
  }

  /* --------------------------------------------------------------- dispose */

  dispose(): void {
    if (this.pts) this.scene.remove(this.pts);
    this.geo?.dispose();
    this.mat?.dispose();
    this.geo = null; this.mat = null; this.pts = null;
    this.ready = false;
  }
}
