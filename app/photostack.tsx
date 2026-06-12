'use client';

/*
 * photostack.tsx
 * The portrait as a draggable card deck, animated 1:1 with the reference
 * recording (video #4), which was read frame by frame at 30 fps:
 *
 *   - the deck fans in ONE direction: every deeper card rotates further
 *     clockwise and peeks out toward the top-right (stackPose)
 *   - while the front card is dragged, the cards beneath glide one slot
 *     forward in step with the drag distance (dragPromote) - the next
 *     photo is already sitting straight before you let go
 *   - released past the distance/velocity threshold, the card slides
 *     from your hand straight back into the deck, dropping under the
 *     new front card on the way to the rearmost fan slot - like taking
 *     the top photo off a real stack and sliding it underneath
 *   - released short of the threshold, everything springs home
 *
 * The trick that makes the slide real: every photo owns ONE DOM element
 * for life (keyed by photo index). A release just re-ranks the depths,
 * so each element transitions from wherever it is to its new pose - the
 * released card from your hand to the back, the promoted card from its
 * almost-straight pose to dead centre. Nothing remounts, nothing can
 * teleport.
 *
 * Only real photos are dealt: with three photos you see the front card
 * and two backs - no empty placeholder frames. Photos render solid at
 * 100% opacity with a cursor sheen that never displaces a pixel.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { stackPose, dragPromote, flingOutcome } from '../utils.js';
import { PHOTOS, PHOTO_ASPECT } from './photos';

const GAP_LEFT = 36;   /* air between the text column and the deck   */
const MIN_ZONE = 160;  /* below this width the desktop deck hides    */
const MIN_VIEW = 900;  /* below this viewport, slot mode takes over  */
const MAX_BACKS = 3;

type Rect = { x: number; y: number; w: number; h: number } | null;
type DragInfo = {
  id: number; sx: number; sy: number;
  dx: number; dy: number; vx: number; vy: number; t: number;
} | null;

export function PhotoStack({ hidden }: { hidden: boolean }) {
  const [rect, setRect] = useState<Rect>(null);
  const [order, setOrder] = useState<number[]>(() => PHOTOS.map((_, i) => i));
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const dragRef = useRef<DragInfo>(null);
  const frontRef = useRef<HTMLDivElement | null>(null);

  const nBacks = Math.min(PHOTOS.length - 1, MAX_BACKS);

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
    if (!d) { setDrag(null); return; }
    const { dismiss } = flingOutcome(d.dx, d.dy, d.vx, d.vy);
    setDrag(null);
    if (dismiss && PHOTOS.length > 1) {
      /* re-rank: the front card's own element glides from the hand to
         the rear slot; the promoted card settles into the centre */
      setOrder((o) => [...o.slice(1), o[0]]);
    }
  };

  if (!rect || PHOTOS.length === 0) return null;

  const dragging = dragRef.current !== null;
  const dist = drag ? Math.hypot(drag.dx, drag.dy) : 0;
  /* the deck glides one slot forward in step with the drag */
  const promote = dragging ? dragPromote(dist) : 0;

  const markLoaded = (el: HTMLImageElement | null) => {
    if (el && el.complete) el.classList.add('ld');
  };

  /*
   * One element per photo, for life. Depth = current position in the
   * deck; the element's key never changes, so every role change is a
   * pure CSS transition from wherever the card currently is.
   */
  const cards = PHOTOS.map((src, idx) => {
    const depth = order.indexOf(idx);
    if (depth < 0 || depth > nBacks) return null;
    const isFront = depth === 0;

    let transform: string | undefined;
    let cls = `pcard ${isFront ? 'front' : 'back'}`;
    if (isFront && drag) {
      transform = `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx * 0.04}deg)`;
      if (dragging) cls += ' drag'; /* live under the hand, no easing */
    } else if (!isFront) {
      const p = stackPose(depth - promote);
      transform =
        `translate(${p.fx * rect.w}px, ${p.fy * rect.w}px) rotate(${p.rot}deg)`;
      if (dragging) cls += ' live'; /* promotion tracks the hand */
    }

    return (
      <div
        key={`ph-${idx}`}
        ref={isFront ? (el) => { frontRef.current = el; } : undefined}
        className={cls}
        style={{ transform, zIndex: 20 - depth }}
        onPointerDown={isFront ? onPointerDown : undefined}
        onPointerMove={isFront ? onPointerMove : undefined}
        onPointerUp={isFront ? onPointerUp : undefined}
        onPointerCancel={isFront ? onPointerUp : undefined}
      >
        <img
          ref={markLoaded}
          src={src}
          alt={isFront ? 'Nikunj More' : ''}
          draggable={false}
          onLoad={(e) => e.currentTarget.classList.add('ld')}
        />
        {isFront && <div className="psheen" aria-hidden="true" />}
      </div>
    );
  });

  return (
    <div
      className={`pstack${hidden ? ' off' : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      {cards}
    </div>
  );
}
