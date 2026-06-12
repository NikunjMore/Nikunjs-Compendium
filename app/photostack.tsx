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
 *   - released past the distance/velocity threshold, the card does NOT
 *     fly off-screen: it slides straight back toward the deck while its
 *     z-order drops, visibly tucking UNDER the new front card into the
 *     rearmost fan slot (~0.45 s spring), exactly like the reference
 *   - released short of the threshold, everything springs home
 *
 * Only real photos are dealt: with three photos you see the front card
 * and two backs - no empty placeholder frames. Photos render solid at
 * 100% opacity with a cursor sheen that never displaces a pixel.
 *
 * Placement (desktop): right of the text column with roughly 1/20 of the
 * screen kept clear at the right edge. On small screens it fills the
 * in-flow #photo-slot and scrolls with the page.
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
type ExitPose = { idx: number; dx: number; dy: number; rot: number } | null;

export function PhotoStack({ hidden }: { hidden: boolean }) {
  const [rect, setRect] = useState<Rect>(null);
  const [order, setOrder] = useState<number[]>(() => PHOTOS.map((_, i) => i));
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  /* the card that was just released: starts at its dragged pose, then
     transitions into the rear fan slot (the visible tuck-under) */
  const [exit, setExit] = useState<ExitPose>(null);
  const dragRef = useRef<DragInfo>(null);
  const frontRef = useRef<HTMLDivElement>(null);

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
    if (exit) return; /* let the tuck finish first */
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
    if (dismiss && PHOTOS.length > 1) {
      /*
       * The reference move: the released card heads straight back to the
       * deck while its z-order drops - it slides in UNDER the new front
       * card and lands in the rearmost fan slot. We reorder immediately,
       * pin the (now rear) card at its dragged pose for one frame, then
       * let the spring carry it home.
       */
      const front = order[0];
      setExit({ idx: front, dx: d.dx, dy: d.dy, rot: d.dx * 0.04 });
      setOrder((o) => [...o.slice(1), o[0]]);
      setDrag(null);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setExit((x) => (x && x.idx === front ? { ...x, dx: NaN, dy: NaN, rot: NaN } : x));
        setTimeout(() => setExit(null), 500);
      }));
    } else {
      setDrag(null); /* the CSS spring carries it home */
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

  /* deepest first so natural paint order matches z-index */
  const backs: { depth: number; idx: number }[] = [];
  for (let depth = nBacks; depth >= 1; depth--) {
    if (order.length > depth) backs.push({ depth, idx: order[depth] });
  }

  return (
    <div
      className={`pstack${hidden ? ' off' : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      {backs.map(({ depth, idx }) => {
        const isExiting = exit !== null && exit.idx === idx;
        let transform: string;
        let cls = 'pcard back';
        if (isExiting && Number.isFinite(exit.dx)) {
          /* pinned at the released drag pose, one frame, no transition */
          transform = `translate(${exit.dx}px, ${exit.dy}px) rotate(${exit.rot}deg)`;
          cls += ' live';
        } else {
          const p = stackPose(depth - promote);
          transform =
            `translate(${p.fx * rect.w}px, ${p.fy * rect.w}px) rotate(${p.rot}deg)`;
          if (dragging) cls += ' live'; /* promotion tracks the hand, no easing */
          if (isExiting) cls += ' tuck'; /* the springy slide-under */
        }
        return (
          <div key={`ph-${idx}`} className={cls} style={{ transform, zIndex: 10 - depth }}>
            <img
              ref={markLoaded}
              src={PHOTOS[idx]}
              alt=""
              draggable={false}
              onLoad={(e) => e.currentTarget.classList.add('ld')}
            />
          </div>
        );
      })}

      <div
        ref={frontRef}
        className={`pcard front${dragging ? ' drag' : ''}`}
        style={{
          transform: drag
            ? `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx * 0.04}deg)`
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
