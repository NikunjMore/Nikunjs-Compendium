/*
 * photo.ts  v8 - the still portrait.
 *
 * A clean separation of concerns: the portrait is its own quiet layer of
 * small dots and is never raided for material.  Words on the left are built
 * exclusively by the larger swirling field dots (engine.ts).
 *
 * Design goals, in order: look as close to the actual photograph as
 * possible, stay calm (no churn, no swapping, no warping), read as
 * professional.  Every grid cell above the ink threshold gets a dot - full
 * density - so the image is smooth rather than speckled, and each dot's
 * alpha is calibrated (gamma, dot-area compensation, and a fitted residual
 * tone curve) so flats render at the photograph's true relative
 * brightness.  The only motion: a one-time birth condensation, a barely
 * perceptible micro-drift, and a cursor light that brightens dots in place
 * without ever moving them.
 */

import * as THREE from 'three';
import { clamp, mulberry32 } from '../utils.js';

const MARGIN   = 18;
const GRID_W   = 700;  /* sample columns (source me.jpg is 1600 px wide) */
const MIN_ZONE = 160;
const MIN_VIEW = 900;  /* below this, desktop zone mode hides (slot takes over on mobile) */
const SHARPEN  = 0.70;

export type SlotRect   = { x: number; y: number; w: number; h: number } | null;
export type LayoutOpts = { colRight: number; footerTop: number };

/* ------------------------------------------------------------------ shaders */

const VERT = /* glsl */ `
  attribute vec2  aUV;
  attribute float aLum;   /* display tone (drives dot size)               */
  attribute float aA;     /* calibrated alpha (tone-true brightness)      */
  attribute float aSeed;

  varying float vA;

  uniform float uDpr, uTime, uBirth, uHov, uFade, uVis, uSpacing, uEnergy;
  uniform vec2  uPtr, uOrigin, uSize;

  const float TAU = 6.28318530;

  void main() {
    vec2 pos = uOrigin + aUV * uSize;

    /* ---- birth condensation (intro only) -------------------------------- */
    float stag = aUV.y * 0.45 + aSeed * 0.40;
    float b    = clamp((uBirth - stag) / 0.55, 0.0, 1.0);
    float eb   = 1.0 - pow(1.0 - b, 3.0);
    pos += vec2(
      sin(aSeed * 517.0 + aUV.x * 9.0),
      cos(aSeed * 263.0 + aUV.y * 7.0)
    ) * (110.0 * (1.0 - eb));

    /* ---- barely-there micro-drift (the photo holds still) --------------- */
    pos += vec2(
      sin(uTime * 0.8 + aSeed * 41.0),
      cos(uTime * 0.7 + aSeed * 27.0)
    ) * 0.10;

    /* ---- cursor light (glow only - dots never move, nothing distorts) --- */
    vec2  d    = pos - uPtr;
    float r2   = dot(d, d);
    float fall = exp(-r2 / 22000.0) *
                 (1.0 + 0.08 * sin(uTime * 1.2 + aSeed * 17.0));

    /* ---- alpha ----------------------------------------------------------- */
    float tw       = 0.985 + 0.015 * sin(aSeed * TAU + uTime * (0.5 + aSeed));
    float homeAlph = aA * tw * (1.0 + 0.45 * fall * uHov) * uEnergy;
    vA = homeAlph * eb * uFade * uVis;

    float sz = uSpacing * (0.66 + 0.50 * aLum) * (1.0 + 0.18 * fall * uHov);
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

    /* tone-map with a gentle S-curve */
    const tones = new Float32Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) {
      const o = i * 4;
      const l = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
      const t = clamp((l - 0.03) / 0.90, 0, 1);
      tones[i] = t * t * (3 - 2 * t);
    }
    /* unsharp mask for crisp edges and readable lettering at dot scale */
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

    /*
     * Residual tone correction, fitted against the source photo band by
     * band (render/source ratio measured at five tone levels, normalised
     * to the mid band).  Piecewise-linear in tone.
     */
    const CT = [0.00, 0.12, 0.35, 0.55, 0.75, 1.00];
    const CV = [0.86, 0.86, 1.37, 1.00, 0.98, 0.96];
    const toneCorr = (t: number): number => {
      for (let k = 1; k < CT.length; k++) {
        if (t <= CT[k]) {
          const f = (t - CT[k - 1]) / (CT[k] - CT[k - 1]);
          return CV[k - 1] + (CV[k] - CV[k - 1]) * f;
        }
      }
      return CV[CV.length - 1];
    };

    const rng = mulberry32(0x0070bea7);
    const uvArr:   number[] = [];
    const lumArr:  number[] = [];
    const aArr:    number[] = [];
    const seedArr: number[] = [];

    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i    = y * gw + x;
        const tone = clamp(tones[i] + SHARPEN * (tones[i] - blur[i]), 0, 1);
        if (tone < 0.012) continue;
        /* full density: every inked cell gets its dot - smooth, not grainy */
        uvArr.push(
          (x + 0.5 + (rng() - 0.5) * 0.18) / gw,
          (y + 0.5 + (rng() - 0.5) * 0.18) / gh,
        );
        lumArr.push(tone);
        /*
         * Calibrated alpha: near-linear response (gamma 1.15) divided by
         * dot area, scaled to keep the brightest flats below clipping,
         * with the fitted toneCorr flattening what remains.  A flat patch
         * of tone L renders at brightness ~L: cheeks stay cheek-coloured,
         * paper stays paper.
         */
        const lin = Math.pow(tone, 1.15);
        const rel = 0.66 + 0.50 * tone;
        aArr.push(clamp((lin / (rel * rel)) * 0.84 * toneCorr(tone), 0.012, 1));
        seedArr.push(rng());
      }
    }

    const n = lumArr.length;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aUV',      new THREE.BufferAttribute(new Float32Array(uvArr), 2));
    geo.setAttribute('aLum',     new THREE.BufferAttribute(new Float32Array(lumArr), 1));
    geo.setAttribute('aA',       new THREE.BufferAttribute(new Float32Array(aArr), 1));
    geo.setAttribute('aSeed',    new THREE.BufferAttribute(new Float32Array(seedArr), 1));

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
   * Desktop: park in the strip between the text column's measured right
   * edge and the viewport edge, stopping above the footer rule - centred
   * in the real leftover space on any aspect ratio (16:9, 16:10, 3:2,
   * ultrawide).  Mobile: fill the in-flow #photo-slot, scrolling with the
   * page.  The portrait scales with the viewport in both modes.
   */
  layout(
    w: number, h: number, dpr: number,
    slot: SlotRect = null,
    opts: LayoutOpts = { colRight: 792, footerTop: h },
  ): void {
    if (!this.mat) return;

    if (slot && slot.w > 40) {
      this.mode = 'slot';
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
    u.uTime.value  = now / 1000;
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
