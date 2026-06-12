/*
 * photo.ts  v3 – portrait with living dot escape cycles.
 *
 * Every photo dot is part of a 20-second cycle:
 *   0 – 62 %  (12.4 s): settled at home in the portrait
 *   62 – 76 % ( 2.8 s): escaping outward in a spiral
 *   76 – 86 % ( 2.0 s): wandering freely near the photo
 *   86 – 100% ( 2.8 s): a fresh "replacement" dot arrives from a new direction
 *
 * Each dot has a random phase so escapes are staggered — at any moment
 * about 22 % of dots are mid-cycle (the aura cloud you see floating around
 * the portrait). Organic escapes orbit close; forced "donation" escapes (when
 * the user opens a token) drift toward the expanding text, creating the
 * visual that the portrait is feeding the words.  The photo refills in under
 * 20 s regardless.
 */

import * as THREE from 'three';
import { clamp, mulberry32 } from '../utils.js';

const COL    = 790;   /* text column max, must match globals.css main max-width */
const MARGIN = 24;
const GRID_W = 600;   /* sample columns — was 400; 50 % finer dot pitch         */
const MIN_ZONE = 160;
const MIN_VIEW = 900; /* was 1100; show on more screen sizes                     */
const SHARPEN  = 0.80;

/* ------------------------------------------------------------------ shaders */

const VERT = /* glsl */ `
  attribute vec2  aUV;
  attribute float aLum;
  attribute float aSeed;
  attribute float aEscapePhase; /* random offset into the 20-s escape cycle     */
  attribute float aDonateT;     /* -1 = organic only;  else seconds of donation */

  varying float vA;

  uniform float uDpr, uTime, uBirth, uHov, uFade, uVis, uSpacing;
  uniform vec2  uPtr, uOrigin, uSize, uDonateTarget;

  const float PI  = 3.14159265;
  const float TAU = 6.28318530;

  void main() {
    vec2 homePos = uOrigin + aUV * uSize;
    vec2 pos     = homePos;

    /* ---- organic 20-second escape cycle -------------------------------- */
    float period = 20.0;
    /* each dot gets an independent, smoothly varying cycle */
    float cycleT = mod(uTime * (0.96 + aSeed * 0.08) + aEscapePhase, period) / period;

    float escapeFrac = 0.0;
    vec2  wanderOff  = vec2(0.0);

    if (cycleT >= 0.62 && cycleT < 0.76) {
      /* leaving: spiral outward */
      float t = smoothstep(0.62, 0.76, cycleT);
      escapeFrac = t;
      float angle = aSeed * TAU + t * 3.5 + uTime * (0.4 + aSeed * 0.3);
      float r     = mix(0.0, 60.0 + aSeed * 110.0, t);
      wanderOff   = vec2(cos(angle), sin(angle)) * r;

    } else if (cycleT >= 0.76 && cycleT < 0.86) {
      /* wandering: gentle orbit near the portrait */
      escapeFrac  = 1.0;
      float angle = aSeed * TAU + uTime * (0.45 + aSeed * 0.5);
      float r     = 70.0 + aSeed * 100.0
                  + sin(uTime * 0.9 + aSeed * 5.0) * 20.0;
      wanderOff   = vec2(cos(angle), sin(angle)) * r;

    } else if (cycleT >= 0.86) {
      /* returning as a fresh replacement: arrive from a new direction */
      float t = 1.0 - smoothstep(0.86, 1.0, cycleT);
      escapeFrac  = t;
      /* arrival direction is rotated ~180 deg from the escape direction */
      float angle = aSeed * TAU + PI + uTime * 0.1;
      float r     = mix(0.0, 80.0 + aSeed * 90.0, t);
      wanderOff   = vec2(cos(angle), sin(angle)) * r;
    }

    /* ---- forced escape when the user opens a token (donate()) ---------- */
    if (aDonateT >= 0.0) {
      float elapsed = uTime - aDonateT;
      float forced  = 0.0;
      if (elapsed < 1.5) {
        forced = smoothstep(0.0, 1.5, elapsed);
      } else if (elapsed < 17.0) {
        forced = 1.0;
      } else {
        forced = 1.0 - smoothstep(17.0, 20.0, elapsed);
      }
      forced = clamp(forced, 0.0, 1.0);

      if (forced > escapeFrac) {
        escapeFrac = forced;
        /* fly toward the token that was just opened */
        vec2  toTarget  = uDonateTarget - homePos;
        float tDist     = max(length(toTarget), 1.0);
        vec2  dirTarget = toTarget / tDist;
        float driftDist = mix(60.0, min(tDist * 0.65, 380.0), smoothstep(0.0, 1.5, elapsed));
        /* jitter so dots don't all pile at the same spot */
        vec2 jitter = vec2(sin(aSeed * 19.7 + elapsed), cos(aSeed * 23.3 + elapsed)) * 55.0;
        wanderOff = dirTarget * driftDist + jitter;
      }
    }

    /* apply escape offset */
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

    /* ---- micro-drift (calmer when escaped) ----------------------------- */
    pos += vec2(
      sin(uTime * 1.1 + aSeed * 41.0),
      cos(uTime * 0.9 + aSeed * 27.0)
    ) * 0.32 * mix(1.0, 0.25, escapeFrac);

    /* ---- cursor soft lens (photo + escaped aura) ----------------------- */
    vec2  d    = pos - uPtr;
    float r    = max(length(d), 0.001);
    float fall = exp(-(r * r) / 18000.0);   /* sigma ~95 px */
    vec2  dir  = d / r;
    vec2  tang = vec2(-dir.y, dir.x);
    pos += (
      dir  * (9.0 + 3.0 * sin(uTime * 1.9 + aSeed * 19.0)) +
      tang * 6.0 * sin(uTime * 1.6 + aSeed * 13.0)
    ) * fall * uHov;

    /* ---- alpha --------------------------------------------------------- */
    float tw       = 0.95 + 0.05 * sin(aSeed * TAU + uTime * (0.7 + aSeed));
    float homeAlph = (0.08 + 0.84 * aLum) * tw * (1.0 + 0.18 * fall * uHov);
    float freeAlph = 0.18 * tw;   /* escaped dots blend into the free field   */
    float a        = mix(homeAlph, freeAlph, escapeFrac);
    vA = a * eb * uFade * uVis;

    float sz = uSpacing * (0.50 + 0.70 * aLum) * (1.0 + 0.45 * fall * uHov);
    gl_Position  = projectionMatrix * modelViewMatrix * vec4(pos, 0.0, 1.0);
    gl_PointSize = clamp(sz, 0.5, 4.2) * uDpr;
  }
`;

const FRAG = /* glsl */ `
  precision mediump float;
  varying float vA;
  void main() {
    vec2  c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.22, d) * vA;
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
  private rect    = { x: 0, y: 0, w: 0, h: 0 };

  /* CPU-side data for donate() spatial lookup */
  private uvXArr!:       Float32Array;
  private uvYArr!:       Float32Array;
  private donateTArr!:   Float32Array;
  private donateTAttr!:  THREE.BufferAttribute;
  private donatedIndices: number[] = [];

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
    cx.drawImage(img, 0, 0, gw, gh);
    const data = cx.getImageData(0, 0, gw, gh).data;

    /* tone-map with S-curve */
    const tones = new Float32Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) {
      const o = i * 4;
      const l = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
      const t = clamp((l - 0.03) / 0.90, 0, 1);
      tones[i] = Math.pow(t * t * (3 - 2 * t), 1.10);
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

    const rng = mulberry32(0x0070bea7);
    const uvArr:    number[] = [];
    const lumArr:   number[] = [];
    const seedArr:  number[] = [];
    const epArr:    number[] = [];  /* escape phase [0, 20] seconds */

    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i    = y * gw + x;
        const tone = clamp(tones[i] + SHARPEN * (tones[i] - blur[i]), 0, 1);
        if (tone < 0.010) continue;
        uvArr.push(
          (x + 0.5 + (rng() - 0.5) * 0.5) / gw,
          (y + 0.5 + (rng() - 0.5) * 0.5) / gh,
        );
        lumArr.push(tone);
        seedArr.push(rng());
        epArr.push(rng() * 20.0);   /* stagger phases across the full period */
      }
    }

    const n = lumArr.length;
    /* CPU arrays for donate() */
    this.uvXArr     = new Float32Array(n);
    this.uvYArr     = new Float32Array(n);
    this.donateTArr = new Float32Array(n).fill(-1);

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

    const donateAttr = new THREE.BufferAttribute(this.donateTArr, 1);
    donateAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aDonateT', donateAttr);
    this.donateTAttr = donateAttr;

    const mat = new THREE.ShaderMaterial({
      vertexShader:   VERT,
      fragmentShader: FRAG,
      uniforms: {
        uDpr:         { value: 1 },
        uTime:        { value: 0 },
        uBirth:       { value: 0 },
        uHov:         { value: 0 },
        uFade:        { value: 0 },
        uVis:         { value: 0 },
        uSpacing:     { value: 2.6 },
        uPtr:         { value: new THREE.Vector2(-1e4, -1e4) },
        uOrigin:      { value: new THREE.Vector2(0, 0) },
        uSize:        { value: new THREE.Vector2(1, 1) },
        uDonateTarget:{ value: new THREE.Vector2(-1e4, -1e4) },
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

  layout(w: number, h: number, dpr: number): void {
    if (!this.mat) return;
    const zone = w - COL - MARGIN;
    this.visTarget = zone >= MIN_ZONE && w >= MIN_VIEW ? 1 : 0;

    /* use more of the available zone — up to 85% or 640 px, whichever smaller */
    let pw = Math.max(10, Math.min(zone * 0.85, 640));
    let ph = pw * this.aspect;
    const maxH = h * 0.86;
    if (ph > maxH) { ph = maxH; pw = ph / this.aspect; }

    const x = COL + Math.max(0, (zone - pw) / 2);
    const y = (h - ph) * 0.44;
    this.rect = { x, y, w: pw, h: ph };

    const u = this.mat.uniforms;
    (u.uOrigin.value as THREE.Vector2).set(x, y);
    (u.uSize.value   as THREE.Vector2).set(pw, ph);
    u.uSpacing.value  = pw / this.gridW;
    u.uDpr.value      = dpr;
  }

  /* --------------------------------------------------------------- update */

  update(now: number, dt: number, fade: number, px: number, py: number): void {
    if (!this.ready || !this.mat) return;
    if (this.bornAt === 0) this.bornAt = now + 350;

    const u = this.mat.uniforms;
    const nowS = now / 1000;
    u.uTime.value  = nowS;
    u.uFade.value  = fade;
    u.uBirth.value = clamp((now - this.bornAt) / 2300, 0, 1) * 1.6;

    const { x, y, w, h } = this.rect;
    const inside =
      px >= x - 40 && px <= x + w + 40 &&
      py >= y - 40 && py <= y + h + 40;
    this.hov += ((inside ? 1 : 0) - this.hov) * Math.min(1, dt * 5);
    this.vis += (this.visTarget - this.vis)    * Math.min(1, dt * 4);
    u.uHov.value = this.hov;
    u.uVis.value = this.vis;
    (u.uPtr.value as THREE.Vector2).set(px, py);

    /* expire donations — only iterate the small donated set, not all 200K dots */
    let dirty = false;
    for (let k = this.donatedIndices.length - 1; k >= 0; k--) {
      const i = this.donatedIndices[k];
      if (this.donateTArr[i] >= 0 && nowS - this.donateTArr[i] > 20.5) {
        this.donateTArr[i] = -1;
        this.donatedIndices.splice(k, 1);
        dirty = true;
      }
    }
    if (dirty) this.donateTAttr.needsUpdate = true;
  }

  /* --------------------------------------------------------------- donate */

  /*
   * Pull `n` dots near the screen position (tx, ty) out of the portrait to
   * help assemble expanding text.  They drift toward the target and return
   * over 20 s, visually refilling the gap they left.
   */
  donate(targetX: number, targetY: number, n: number): void {
    if (!this.mat || !this.uvXArr) return;
    const { x, y, w, h } = this.rect;
    if (w <= 0 || h <= 0) return;

    const tUvX = (targetX - x) / w;
    const tUvY = (targetY - y) / h;

    /* collect eligible (not-already-donated) dots with their distances */
    const nDots = this.uvXArr.length;
    type Scored = { i: number; d: number };
    const candidates: Scored[] = [];
    for (let i = 0; i < nDots; i++) {
      if (this.donateTArr[i] >= 0) continue;
      const dx = this.uvXArr[i] - tUvX;
      const dy = this.uvYArr[i] - tUvY;
      candidates.push({ i, d: dx * dx + dy * dy });
    }
    candidates.sort((a, b) => a.d - b.d);

    const count = Math.min(n, candidates.length);
    const nowS  = performance.now() / 1000;
    for (let j = 0; j < count; j++) {
      const { i } = candidates[j];
      this.donateTArr[i] = nowS;
      this.donatedIndices.push(i);
    }
    this.donateTAttr.needsUpdate = true;

    /* update the drift-target uniform so escaped dots head toward the right place */
    (this.mat.uniforms.uDonateTarget.value as THREE.Vector2).set(targetX, targetY);
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
