'use client';

/*
 * photostack.tsx
 * The portrait as a draggable card stack (video ref #4). The front card is
 * the real photograph — solid, 100% opacity, rounded corners — resting on
 * a small fan of card backs. Drag the front card and let go: past the
 * distance/velocity threshold it flies off along your throw and tucks to
 * the back of the deck (when photos.ts lists more than one photo);
 * otherwise it springs home. A cursor sheen brightens the surface and
 * never displaces a pixel.
 *
 * Placement (desktop): right of the text column with roughly 1/20 of the
 * screen kept clear at the right edge. On small screens it fills the
 * in-flow #photo-slot and scrolls with the page.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { stackLayout, flingOutcome } from '../utils.js';
import { PHOTOS, PHOTO_ASPECT } from './photos';

const GAP_LEFT = 36;   /* air between the text column and the deck   */
const MIN_ZONE = 160;  /* below this width the desktop deck hides    */
const MIN_VIEW = 900;  /* below this viewport, slot mode takes over  */
const BACKS = 3;       /* card backs fanned behind the front photo   */

type Rect = { x: number; y: number; w: number; h: number } | null;
type DragInfo = {
  id: number; sx: number; sy: number;
  dx: number; dy: number; vx: number; vy: number; t: number;
} | null;

export function PhotoStack({ hidden }: { hidden: boolean }) {
  const [rect, setRect] = useState<Rect>(null);
  const [order, setOrder] = useState<number[]>(() => PHOTOS.map((_, i) => i));
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [exiting, setExiting] = useState(false);
  const dragRef = useRef<DragInfo>(null);
  const frontRef = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    const w = innerWidth;
    const h = innerHeight;

    /* small screens: fill the in-flow slot under the title */
    const slot = document.getElementById('photo-slot');
    if (slot && getComputedStyle(slot).display !== 'none') {
      const r = slot.getBoundingClientRect();
      if (r.width > 40) {
        setRect({ x: r.left, y: r.top, w: r.width, h: r.height });
        return;
      }
    }

    /* desktop: the zone right of the column, 1/20 screen of air on the right */
    const main = document.querySelector('main');
    const colRight = main
      ? Math.max(520, Math.min(main.getBoundingClientRect().right, w))
      : 792;
    const foot = document.querySelector('footer');
    const fr = foot?.getBoundingClientRect();
    const footerTop = fr && fr.height > 0 ? fr.top : h;
    const gapRight = w * 0.05 + 16;
    const left = colRight + GAP_LEFT;
    const zone = w - left - gapRight;
    if (zone < MIN_ZONE || w < MIN_VIEW) { setRect(null); return; }

    const availTop = 18;
    const availBot = Math.min(h - 14, footerTop - 14);
    const availH = Math.max(60, availBot - availTop);
    let pw = Math.max(10, Math.min(zone, 760));
    let ph = pw * PHOTO_ASPECT;
    if (ph > availH) { ph = availH; pw = ph / PHOTO_ASPECT; }
    const x = Math.max(left, w - gapRight - pw);
    const y = availTop + (availH - ph) * 0.46;
    setRect({ x, y, w: pw, h: ph });
  }, []);

  useEffect(() => {
    measure();
    const onR = () => measure();
    addEventListener('resize', onR);
    addEventListener('scroll', onR, { passive: true });
    addEventListener('nc:relayout', onR);
    return () => {
      removeEventListener('resize', onR);
      removeEventListener('scroll', onR);
      removeEventListener('nc:relayout', onR);
    };
  }, [measure]);

  /* sheen follows the pointer; drag rides the same handler */
  const onPointerMove = (e: React.PointerEvent) => {
    const el = frontRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--shx', `${((e.clientX - r.left) / r.width) * 100}%`);
      el.style.setProperty('--shy', `${((e.clientY - r.top) / r.height) * 100}%`);
    }
    const d = dragRef.current;
    if (!d || e.pointerId !== d.id) return;
    const now = performance.now();
    const dt = Math.max(1, now - d.t) / 1000;
    const ndx = e.clientX - d.sx;
    const ndy = e.clientY - d.sy;
    d.vx = (ndx - d.dx) / dt;
    d.vy = (ndy - d.dy) / dt;
    d.dx = ndx; d.dy = ndy; d.t = now;
    setDrag({ dx: ndx, dy: ndy });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (exiting) return;
    e.preventDefault();
    frontRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = {
      id: e.pointerId, sx: e.clientX, sy: e.clientY,
      dx: 0, dy: 0, vx: 0, vy: 0, t: performance.now(),
    };
    setDrag({ dx: 0, dy: 0 });
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !rect) { setDrag(null); return; }
    const { dismiss, exitX, exitY } = flingOutcome(d.dx, d.dy, d.vx, d.vy);
    if (dismiss && PHOTOS.length > 1) {
      /* fly out along the throw, then tuck to the back of the deck */
      setExiting(true);
      const m = Math.max(rect.w, rect.h) * 1.45;
      setDrag({ dx: d.dx + exitX * m, dy: d.dy + exitY * m });
      setTimeout(() => {
        setOrder((o) => [...o.slice(1), o[0]]);
        setDrag(null);
        setExiting(false);
      }, 360);
    } else {
      setDrag(null); /* the CSS spring carries it home */
    }
  };

  if (!rect || PHOTOS.length === 0) return null;

  const dragging = dragRef.current !== null;
  const markLoaded = (el: HTMLImageElement | null) => {
    if (el && el.complete) el.classList.add('ld');
  };

  return (
    <div
      className={`pstack${hidden ? ' off' : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      {Array.from({ length: BACKS }, (_, j) => BACKS - j).map((depth) => {
        const pi = order.length > depth ? order[depth] : undefined;
        const fan = stackLayout(depth);
        return (
          <div
            key={`back-${depth}`}
            className="pcard back"
            style={{
              transform: `translate(${fan.dx}px, ${fan.dy}px) rotate(${fan.rot}deg)`,
              zIndex: 10 - depth,
            }}
            aria-hidden="true"
          >
            {pi !== undefined ? (
              <img
                ref={markLoaded}
                src={PHOTOS[pi]}
                alt=""
                draggable={false}
                onLoad={(e) => e.currentTarget.classList.add('ld')}
              />
            ) : null}
          </div>
        );
      })}

      <div
        ref={frontRef}
        className={`pcard front${dragging ? ' drag' : ''}`}
        style={{
          transform: drag
            ? `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx * 0.045}deg)`
            : undefined,
          zIndex: 20,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          ref={markLoaded}
          src={PHOTOS[order[0]]}
          alt="Nikunj More"
          draggable={false}
          onLoad={(e) => e.currentTarget.classList.add('ld')}
        />
        <div className="psheen" aria-hidden="true" />
      </div>
    </div>
  );
}
