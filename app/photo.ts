/*
 * photo.ts  v9 - the solid portrait.
 *
 * The photograph is now rendered as an actual image (a textured quad in
 * the same WebGL scene as the dots), not as dot-art: solid, faithful,
 * professional.  Rounded corners, a gentle one-time fade/settle on load,
 * and a very subtle cursor sheen that brightens - never displaces -
 * anything.  The swirling background dots pass in front of it, which keeps
 * the page feeling alive while the portrait itself holds perfectly still.
 *
 * Layout: on desktop the portrait anchors close to the RIGHT edge of the
 * screen (the text column uses the freed space), sized to fit between the
 * top of the viewport and the footer rule on any aspect ratio.  On small
 * screens it fills the in-flow #photo-slot and scrolls with the page.
 */

import * as THREE from 'three';
import { clamp } from '../utils.js';

const GAP_RIGHT = 20;   /* distance from the right screen edge            */
const GAP_LEFT  = 36;   /* minimum air between the text column and photo  */
const MIN_ZONE  = 160;
const MIN_VIEW  = 900;  /* below this, zone mode hides (slot takes over)  */

export type SlotRect   = { x: number; y: number; w: number; h: number } | null;
export type LayoutOpts = { colRight: number; footerTop: number };

/* ------------------------------------------------------------------ shaders */

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vScr;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vScr = wp.xy;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  varying vec2 vScr;
  uniform sampler2D uMap;
  uniform float uAlpha, uHov, uTime;
  uniform vec2  uSizePx, uPtr;

  void main() {
    vec3 col = texture2D(uMap, vUv).rgb;

    /* rounded-corner mask with a soft 1.5 px edge */
    float rad   = 14.0;
    vec2  px    = vUv * uSizePx;
    vec2  halfS = uSizePx * 0.5;
    vec2  cp    = abs(px - halfS) - (halfS - vec2(rad));
    float dist  = length(max(cp, vec2(0.0))) - rad;
    float mask  = 1.0 - smoothstep(-1.5, 0.5, dist);
    if (mask < 0.004) discard;

    /* cursor sheen: a faint light that follows the pointer, zero movement */
    vec2  d    = vScr - uPtr;
    float fall = exp(-dot(d, d) / 26000.0);
    col *= 1.0 + 0.10 * fall * uHov;

    gl_FragColor = vec4(col, uAlpha * mask);
  }
`;

/* ============================================================ PhotoLayer */

export class PhotoLayer {
  private scene: THREE.Scene;
  private mesh:  THREE.Mesh | null = null;
  private mat:   THREE.ShaderMaterial | null = null;
  private tex:   THREE.Texture | null = null;

  private aspect  = 4 / 3;
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
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter  = THREE.LinearMipmapLinearFilter;
    tex.magFilter  = THREE.LinearFilter;
    this.tex = tex;
    const img = tex.image as HTMLImageElement;
    this.aspect = img.naturalHeight / img.naturalWidth;

    const mat = new THREE.ShaderMaterial({
      vertexShader:   VERT,
      fragmentShader: FRAG,
      uniforms: {
        uMap:    { value: tex },
        uAlpha:  { value: 0 },
        uHov:    { value: 0 },
        uTime:   { value: 0 },
        uSizePx: { value: new THREE.Vector2(1, 1) },
        uPtr:    { value: new THREE.Vector2(-1e4, -1e4) },
      },
      transparent: true,
      depthTest:   false,
      depthWrite:  false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.renderOrder = -1;   /* behind the dot field */
    this.scene.add(mesh);
    this.mesh = mesh;
    this.mat  = mat;
    this.ready = true;
    this.applyRect();
  }

  /* --------------------------------------------------------------- layout */

  /*
   * Desktop: anchor near the right edge of the screen, sized to fit above
   * the footer; the text column keeps the rest.  Mobile: fill the in-flow
   * #photo-slot.  Scales with the viewport in both modes.
   */
  layout(
    w: number, h: number, dpr: number,
    slot: SlotRect = null,
    opts: LayoutOpts = { colRight: 792, footerTop: h },
  ): void {
    void dpr;
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
      const left = opts.colRight + GAP_LEFT;
      const zone = w - left - GAP_RIGHT;
      this.visTarget = zone >= MIN_ZONE && w >= MIN_VIEW ? 1 : 0;

      const availTop = 18;
      const availBot = Math.min(h - 14, opts.footerTop - 14);
      const availH   = Math.max(60, availBot - availTop);

      let pw = Math.max(10, Math.min(zone, 760));
      let ph = pw * this.aspect;
      if (ph > availH) { ph = availH; pw = ph / this.aspect; }

      /* hug the right edge; the text column enjoys the freed space */
      const x = Math.max(left, w - GAP_RIGHT - pw);
      const y = availTop + (availH - ph) * 0.46;
      this.rect = { x, y, w: pw, h: ph };
    }
    this.applyRect();
  }

  private applyRect(): void {
    if (!this.mesh || !this.mat) return;
    const yOff = this.mode === 'slot' ? this.sy : 0;
    const { x, y, w, h } = this.rect;
    this.mesh.position.set(x + w / 2, y - yOff + h / 2, 0);
    /*
     * The orthographic camera runs y-down (top=0); a negative y scale
     * keeps the image upright in that frame.
     */
    this.mesh.scale.set(w, -h, 1);
    (this.mat.uniforms.uSizePx.value as THREE.Vector2).set(w, h);
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
    this.applyRect();

    const u = this.mat.uniforms;
    u.uTime.value = now / 1000;

    const r = this.screenRect();
    const inside =
      px >= r.x - 40 && px <= r.x + r.w + 40 &&
      py >= r.y - 40 && py <= r.y + r.h + 40;
    this.hov += ((inside ? 1 : 0) - this.hov) * Math.min(1, dt * 5);
    this.vis += (this.visTarget - this.vis)   * Math.min(1, dt * 4);
    u.uHov.value = this.hov;
    (u.uPtr.value as THREE.Vector2).set(px, py);

    /* one-time gentle fade-in, then rock steady */
    const birth = clamp((now - this.bornAt) / 1100, 0, 1);
    const eased = 1 - Math.pow(1 - birth, 3);
    u.uAlpha.value = eased * fade * this.vis;
  }

  /* --------------------------------------------------------------- dispose */

  dispose(): void {
    if (this.mesh) this.scene.remove(this.mesh);
    this.mesh?.geometry.dispose();
    this.mat?.dispose();
    this.tex?.dispose();
    this.mesh = null; this.mat = null; this.tex = null;
    this.ready = false;
  }
}
