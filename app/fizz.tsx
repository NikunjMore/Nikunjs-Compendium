'use client';

/*
 * fizz.tsx
 * Moving the mouse through the room lets off a few bubbles that rise,
 * wobble and fade. It is the Coke Zero. Off for touch and reduced motion.
 */

import { useEffect, useRef } from 'react';

type Bubble = { x: number; y: number; r: number; vy: number; ph: number; born: number; life: number };

const SPACING = 26;   // px of cursor travel per bubble
const MAX = 36;

export default function Fizz() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!matchMedia('(pointer: fine)').matches) return;

    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    const room = document.getElementById('room')!;
    const bubbles: Bubble[] = [];
    let raf = 0, dpr = 1, vw = 0, vh = 0;
    let last: { x: number; y: number } | null = null;
    let ink = '#15172a';

    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      vw = window.innerWidth; vh = window.innerHeight;
      cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
      ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || ink;
    };

    const frame = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, vw, vh);
      ctx.strokeStyle = ink;
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        const age = (t - b.born) / b.life;
        if (age >= 1) { bubbles.splice(i, 1); continue; }
        const y = b.y - b.vy * age * b.life * 0.06;
        const x = b.x + Math.sin(b.ph + age * 9) * 3 * age;
        const r = b.r * (0.6 + age * 0.6);           // bubbles grow as they rise
        ctx.globalAlpha = Math.min(1, age * 6) * (1 - age) * 0.9;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        if (b.r > 3.2) {                              // a glint on the bigger ones
          ctx.beginPath();
          ctx.arc(x - r * 0.35, y - r * 0.35, Math.max(0.6, r * 0.18), 0, Math.PI * 2);
          ctx.fillStyle = ink;
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      raf = bubbles.length ? requestAnimationFrame(frame) : 0;
    };

    const onMove = (e: PointerEvent) => {
      const R = room.getBoundingClientRect();
      const inside = e.clientY > R.top && e.clientY < R.bottom;
      if (!inside) { last = null; return; }
      if (!last) { last = { x: e.clientX, y: e.clientY }; return; }
      const d = Math.hypot(e.clientX - last.x, e.clientY - last.y);
      if (d < SPACING) return;
      last = { x: e.clientX, y: e.clientY };
      const n = d > SPACING * 3 ? 2 : 1;
      for (let i = 0; i < n && bubbles.length < MAX; i++) {
        bubbles.push({
          x: e.clientX + (Math.random() - 0.5) * 14,
          y: e.clientY + (Math.random() - 0.5) * 10,
          r: 1.6 + Math.random() * 3.8,
          vy: 0.6 + Math.random() * 0.9,
          ph: Math.random() * Math.PI * 2,
          born: performance.now(),
          life: 900 + Math.random() * 700,
        });
      }
      if (!raf) raf = requestAnimationFrame(frame);
    };

    size();
    window.addEventListener('resize', size);
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  return <canvas ref={ref} className="fizz" aria-hidden="true" />;
}
