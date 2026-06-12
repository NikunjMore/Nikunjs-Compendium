/*
 * photo.ts
 * The portrait: a second population of dots in the same field.
 *
 * The photo on the right is not an <img>. It is ~50,000 dots sampled from
 * the picture's luminance, drawn by the same renderer with the same soft
 * disc sprite as the rest of the field, so the page stays one substance
 * throughout: everything you see is dots.
 *
 * This population is sovereign. It is never claimable by the text engine,
 * and it ignores the crowd dial, so however much of the compendium has been
 * unfolded (none of it, all of it), the portrait keeps every dot it was born
 * with. The words spend the field; the photo is not for spending.
 *
 * The cursor presses into it like a soft lens: dots within a gaussian
 * falloff slide a few pixels outward and swirl, brighten slightly, then
 * settle back. The displacement is all in the vertex shader (uniforms only),
 * so hovering costs nothing on the CPU. It rearranges, but never disperses:
 * you can always tell it is the same photo.
 *
 * Geometry never overlaps the prose: the portrait lives strictly right of
 * the 920px text column (which max-width caps even when every token is
 * open), and below ~1100px viewports it bows out entirely.
 */

import * as THREE from 'three';
import { clamp, mulberry32 } from '../utils.js';

/* the text column is capped at 920px; keep a gutter beyond it */
const COL = 944;
const MARGIN = 26;
const GRID_W = 200;          /* sample columns; rows follow the aspect */
const MIN_ZONE = 180;        /* px of free width required to show at all */
const MIN_VIEW = 1100;       /* below this viewport width, bow out */

const VERT = /* glsl */ `
  attribute vec2 aUV;
  attribute float aLum;
  attribute float aSeed;
  varying float vA;
  uniform float uDpr, uTime, uBirth, uHov, uFade, uVis, uSpacing;
  uniform vec2 uPtr, uOrigin, uSize;

  void main() {
    vec2 pos = uOrigin + aUV * uSize;

    /* birth: condense out of a loose cloud, sweeping down with noise */
    float stag = aUV.y * 0.45 + aSeed * 0.40;
    float b = clamp((uBirth - stag) / 0.55, 0.0, 1.0);
    float eb = 1.0 - pow(1.0 - b, 3.0);
    pos += vec2(
      sin(aSeed * 517.0 + aUV.x * 9.0),
      cos(aSeed * 263.0 + aUV.y * 7.0)
    ) * (110.0 * (1.0 - eb));

    /* idle micro-drift: alive like the field, steady like a photograph */
    pos += vec2(
      sin(uTime * 1.1 + aSeed * 41.0),
      cos(uTime * 0.9 + aSeed * 27.0)
    ) * 0.45;

    /* the cursor's soft lens: push, swirl, settle */
    vec2 d = pos - uPtr;
    float r = max(length(d), 0.001);
    float fall = exp(-(r * r) / 16200.0); /* gaussian, sigma = 90px */
    vec2 dir = d / r;
    vec2 tang = vec2(-dir.y, dir.x);
    pos += (
      dir * (9.0 + 3.0 * sin(uTime * 1.9 + aSeed * 19.0)) +
      tang * 6.0 * sin(uTime * 1.6 + aSeed * 13.0)
    ) * fall * uHov;

    float tw = 0.93 + 0.07 * sin(aSeed * 6.2832 + uTime * (0.7 + aSeed));
    float a = (0.10 + 0.80 * aLum) * tw;
    a *= 1.0 + 0.22 * fall * uHov;
    vA = a * eb * uFade * uVis;

    float sz = uSpacing * (0.58 + 0.85 * aLum) * (1.0 + 0.45 * fall * uHov);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 0.0, 1.0);
    gl_PointSize = clamp(sz, 1.0, 5.0) * uDpr;
  }
`;

/* the same soft disc the field uses, so both populations read as one ink */
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

export class PhotoLayer {
  private scene: THREE.Scene;
  private geo: THREE.BufferGeometry | null = null;
  private mat: THREE.ShaderMaterial | null = null;
  private pts: THREE.Points | null = null;

  private aspect = 4 / 3;     /* h / w, replaced on load */
  private gridW = GRID_W;
  private ready = false;
  private bornAt = 0;
  private hov = 0;
  private vis = 0;
  private visTarget = 0;
  private rect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /*
   * Sample the photograph into dots. The image is drawn once into a small
   * offscreen canvas (the browser does the area-averaging), and each grid
   * cell with any light in it becomes a dot whose alpha and size carry the
   * tone. Cells of true black are skipped: on this page, darkness is just
   * the absence of dots.
   */
  async load(url: string): Promise<void> {
    const img = new Image();
    img.src = url;
    await img.decode();
    const gw = this.gridW;
    const gh = Math.max(2, Math.round(gw * (img.naturalHeight / img.naturalWidth)));
    this.aspect = gh / gw;

    const cv = document.createElement('canvas');
    cv.width = gw;
    cv.height = gh;
    const cx = cv.getContext('2d', { willReadFrequently: true })!;
    cx.drawImage(img, 0, 0, gw, gh);
    const data = cx.getImageData(0, 0, gw, gh).data;

    const rng = mulberry32(0x0070bea7);
    const uv: number[] = [];
    const lum: number[] = [];
    const seed: number[] = [];
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const o = (y * gw + x) * 4;
        const l = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
        /* a gentle S-curve: lift the mids, deepen the toe, keep highlights */
        const t = clamp((l - 0.04) / 0.89, 0, 1);
        const tone = Math.pow(t * t * (3 - 2 * t), 1.12);
        if (tone < 0.012) continue;
        uv.push(
          (x + 0.5 + (rng() - 0.5) * 0.66) / gw,
          (y + 0.5 + (rng() - 0.5) * 0.66) / gh,
        );
        lum.push(tone);
        seed.push(rng());
      }
    }

    const n = lum.length;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aUV', new THREE.BufferAttribute(new Float32Array(uv), 2));
    geo.setAttribute('aLum', new THREE.BufferAttribute(new Float32Array(lum), 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(seed), 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uDpr: { value: 1 },
        uTime: { value: 0 },
        uBirth: { value: 0 },
        uHov: { value: 0 },
        uFade: { value: 0 },
        uVis: { value: 0 },
        uSpacing: { value: 2.6 },
        uPtr: { value: new THREE.Vector2(-1e4, -1e4) },
        uOrigin: { value: new THREE.Vector2(0, 0) },
        uSize: { value: new THREE.Vector2(1, 1) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; /* positions are born in the shader */
    pts.renderOrder = -1;      /* the free field drifts over the portrait */
    this.scene.add(pts);
    this.geo = geo;
    this.mat = mat;
    this.pts = pts;
    this.ready = true;
  }

  /*
   * Fit the portrait into whatever the column has not taken. The text can
   * never reach past COL even fully expanded, so everything right of it is
   * ours; if the viewport leaves too thin a slice, fade out rather than
   * crowd the words.
   */
  layout(w: number, h: number, dpr: number): void {
    if (!this.mat) return;
    const zone = w - COL - MARGIN;
    this.visTarget = zone >= MIN_ZONE && w >= MIN_VIEW ? 1 : 0;
    let pw = Math.max(10, Math.min(zone, 540));
    let ph = pw * this.aspect;
    const maxH = h * 0.84;
    if (ph > maxH) {
      ph = maxH;
      pw = ph / this.aspect;
    }
    const x = COL + Math.max(0, (zone - pw) / 2);
    const y = (h - ph) * 0.46;
    this.rect = { x, y, w: pw, h: ph };
    const u = this.mat.uniforms;
    (u.uOrigin.value as THREE.Vector2).set(x, y);
    (u.uSize.value as THREE.Vector2).set(pw, ph);
    u.uSpacing.value = pw / this.gridW;
    u.uDpr.value = dpr;
  }

  /* Per-frame: ease the dials, hand the shader its uniforms. */
  update(now: number, dt: number, fade: number, px: number, py: number): void {
    if (!this.ready || !this.mat) return;
    if (this.bornAt === 0) this.bornAt = now + 350;
    const u = this.mat.uniforms;
    u.uTime.value = now / 1000;
    u.uFade.value = fade;
    u.uBirth.value = clamp((now - this.bornAt) / 2300, 0, 1) * 1.6;

    const { x, y, w, h } = this.rect;
    const inside =
      px >= x - 30 && px <= x + w + 30 &&
      py >= y - 30 && py <= y + h + 30;
    this.hov += ((inside ? 1 : 0) - this.hov) * Math.min(1, dt * 5);
    this.vis += (this.visTarget - this.vis) * Math.min(1, dt * 4);
    u.uHov.value = this.hov;
    u.uVis.value = this.vis;
    (u.uPtr.value as THREE.Vector2).set(px, py);
  }

  dispose(): void {
    if (this.pts) this.scene.remove(this.pts);
    this.geo?.dispose();
    this.mat?.dispose();
    this.geo = null;
    this.mat = null;
    this.pts = null;
    this.ready = false;
  }
}
