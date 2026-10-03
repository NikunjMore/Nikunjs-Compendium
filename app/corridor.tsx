'use client';

/*
 * corridor.tsx
 * Draws the room around the content column on one fixed canvas.
 *
 * The column is the back wall. Every wall line is a point on that back wall
 * projected toward the camera: p(s) = c + (p - c) * s, where c is the
 * vanishing point and s grows from 1 (back wall) to S (front opening).
 * Rails are pinned to the column in page space, so scrolling swings them
 * through the eye line. The vanishing point leans toward the cursor.
 */

import { useEffect, useRef } from 'react';

const RAIL_STEP = 168;           // px between wall rails, in page space
const DEPTHS = [0.18, 0.4, 0.66]; // evenly spaced slices of real depth
const SLATS = 6;                 // lines running back-to-front on ceiling and floor
const LEAN = 0.045;              // how far the vanishing point follows the cursor

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '').trim();
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export default function Corridor() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    const room = document.getElementById('room')!;
    const col = document.getElementById('col')!;
    const calm = matchMedia('(prefers-reduced-motion: reduce)');
    const dark = matchMedia('(prefers-color-scheme: dark)');

    let ink: [number, number, number] = [21, 23, 42];
    let vw = 0, vh = 0, dpr = 1;
    const lean = { x: 0, y: 0, tx: 0, ty: 0 };
    let raf = 0;

    const readInk = () => {
      ink = rgb(getComputedStyle(document.documentElement).getPropertyValue('--ink') || '#15172a');
    };

    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      vw = window.innerWidth;
      vh = window.innerHeight;
      cv.width = Math.round(vw * dpr);
      cv.height = Math.round(vh * dpr);
    };

    // A line from the back wall toward the camera. It runs on past the front
    // opening (to the clip edge) but reaches full strength at the opening.
    const line = (x1: number, y1: number, x2: number, y2: number, a1: number, a2: number, at = 1) => {
      const g = ctx.createLinearGradient(x1, y1, x2, y2);
      g.addColorStop(0, `rgba(${ink[0]},${ink[1]},${ink[2]},${a1})`);
      g.addColorStop(at, `rgba(${ink[0]},${ink[1]},${ink[2]},${a2})`);
      g.addColorStop(1, `rgba(${ink[0]},${ink[1]},${ink[2]},${a2})`);
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, vw, vh);

      const R = room.getBoundingClientRect();
      if (R.bottom < 0 || R.top > vh) return;
      const B = col.getBoundingClientRect();

      ctx.save();
      ctx.beginPath();
      ctx.rect(R.left, R.top, R.width, R.height);
      ctx.clip();
      ctx.lineWidth = 1;

      const cx = vw / 2 + lean.x;
      const cy = vh / 2 + lean.y;
      // Front opening sits just past the room's frame, so walls fill it.
      const S = ((vw / 2 - R.left) / Math.max(vw / 2 - B.left, 1)) * 1.12;
      const s = (u: number) => 1 / (1 + u * (1 / S - 1)); // depth slice -> scale
      const px = (x: number, k: number) => cx + (x - cx) * k;
      const py = (y: number, k: number) => cy + (y - cy) * k;
      const back = 0.36, front = 0.95; // lines darken as they come toward you
      const FAR = S * 3;                 // long enough to reach any clip edge
      const at = (S - 1) / (FAR - 1);

      // Rails on both side walls, pinned to the column in page space.
      for (let y = B.top; y <= B.bottom + 0.5; y += RAIL_STEP) {
        const fy = py(y, FAR);
        if (Math.max(y, fy) < -40 || Math.min(y, fy) > vh + 40) continue;
        line(B.left, y, px(B.left, FAR), fy, back, front, at);
        line(B.right, y, px(B.right, FAR), fy, back, front, at);
      }

      // Corner seams where walls meet ceiling and floor.
      for (const y of [B.top, B.bottom]) {
        line(B.left, y, px(B.left, FAR), py(y, FAR), back, front, at);
        line(B.right, y, px(B.right, FAR), py(y, FAR), back, front, at);
      }

      // Depth slices: vertical on the walls, horizontal across ceiling and floor.
      for (const u of DEPTHS) {
        const k = s(u);
        const a = back + (front - back) * u;
        const xl = px(B.left, k), xr = px(B.right, k);
        const yt = py(B.top, k), yb = py(B.bottom, k);
        ctx.strokeStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},${a})`;
        ctx.beginPath();
        ctx.moveTo(xl, yt); ctx.lineTo(xl, yb);
        ctx.moveTo(xr, yt); ctx.lineTo(xr, yb);
        ctx.moveTo(xl, yt); ctx.lineTo(xr, yt);
        ctx.moveTo(xl, yb); ctx.lineTo(xr, yb);
        ctx.stroke();
      }

      // Slats on ceiling and floor, running from the back wall to the opening.
      for (let j = 1; j < SLATS; j++) {
        const x = B.left + (B.width * j) / SLATS;
        line(x, B.top, px(x, FAR), py(B.top, FAR), back, front, at);
        line(x, B.bottom, px(x, FAR), py(B.bottom, FAR), back, front, at);
      }

      ctx.restore();
    };

    const tick = () => {
      raf = 0;
      lean.x += (lean.tx - lean.x) * 0.08;
      lean.y += (lean.ty - lean.y) * 0.08;
      draw();
      if (Math.abs(lean.tx - lean.x) > 0.1 || Math.abs(lean.ty - lean.y) > 0.1) {
        raf = requestAnimationFrame(tick);
      }
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

    const onMove = (e: PointerEvent) => {
      if (calm.matches || e.pointerType !== 'mouse') return;
      lean.tx = (e.clientX / vw - 0.5) * vw * LEAN;
      lean.ty = (e.clientY / vh - 0.5) * vh * LEAN;
      kick();
    };
    const onLeave = () => { lean.tx = 0; lean.ty = 0; kick(); };
    const onResize = () => { size(); kick(); };
    const onTheme = () => { readInk(); kick(); };

    readInk();
    size();
    draw();
    window.addEventListener('scroll', kick, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    dark.addEventListener('change', onTheme);
    const ro = new ResizeObserver(kick);
    ro.observe(col);
    document.fonts?.ready.then(kick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', kick);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      dark.removeEventListener('change', onTheme);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="walls" aria-hidden="true" />;
}
