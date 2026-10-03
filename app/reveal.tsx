'use client';

/*
 * reveal.tsx
 * Things below the fold arrive as you reach them: tab bars draw out from
 * the centre, cells rise into place, numbers count up. Anything already on
 * screen at load is left alone, so nothing flashes. No JS = all visible.
 */

import { useEffect } from 'react';

function countUp(el: HTMLElement) {
  const to = Number(el.dataset.to);
  if (!Number.isFinite(to)) return;
  const pre = el.dataset.pre ?? '';
  const post = el.dataset.post ?? '';
  const fmt = (n: number) => pre + Math.round(n).toLocaleString('en-US') + post;
  const t0 = performance.now();
  const dur = 900 + Math.min(to, 400) * 1.2;
  const step = (t: number) => {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 4);            // fast start, soft landing
    el.textContent = fmt(to * e);
    if (p < 1) requestAnimationFrame(step);
  };
  el.textContent = fmt(0);
  requestAnimationFrame(step);
}

export default function Reveal() {
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const els = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];
    const vh = window.innerHeight;
    const later = els.filter((el) => el.getBoundingClientRect().top > vh * 0.92);
    later.forEach((el) => el.classList.add('pending'));

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const el = en.target as HTMLElement;
          io.unobserve(el);
          el.classList.add('in');
          el.querySelectorAll<HTMLElement>('[data-to]').forEach(countUp);
        });
      },
      { rootMargin: '0px 0px -12% 0px' },
    );
    later.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return null;
}
