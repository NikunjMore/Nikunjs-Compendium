/*
 * room.ts
 * The room around the box, rebuilt from the About section of wodniack.dev.
 *
 * The section is the front of the room and the box is its back wall. Every
 * line joins a point on the section's edge to the matching point on the
 * box's edge: 12 per surface (8 on phones), plus 3 rings of depth that bunch
 * up toward the back. While the section crosses the screen, the box drifts
 * from 400px above its resting place to 400px below it (200px on phones),
 * eased 20% per frame on top of Lenis's smooth scroll. So the box slides out
 * from under the banner, the ceiling grows, and the box sinks into the floor
 * as the section leaves.
 */

const RINGS = 4;    // depth bands per surface; rings sit where they meet
const EASE = 0.2;   // share of the remaining drift covered each frame
const PHONE = 767;  // at or below this width: fewer lines, half the drift

export type RoomSize = {
  w: number;  // section, inside its borders
  h: number;
  bw: number; // box, inside its border
  bh: number;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Path data for every line in the room, with the box moved `drift` px down.
 * `reach` (0 to 1) is how far the lines have grown out from the box toward
 * the walls; the intro animates it, and it is 1 the rest of the time.
 */
export function roomPath({ w, h, bw, bh }: RoomSize, drift: number, n: number, reach = 1): string {
  const x1 = (w - bw) / 2;
  const x2 = x1 + bw;
  const y1 = (h - bh) / 2 + drift;
  const y2 = y1 + bh;
  let d = '';
  // From the box's edge (b) out toward the room's edge (a).
  const line = (ax: number, ay: number, bx: number, by: number) => {
    d += `M${r2(bx + (ax - bx) * reach)} ${r2(by + (ay - by) * reach)}L${r2(bx)} ${r2(by)}`;
  };

  // Ceiling and floor: n - 1 lines each, evenly spaced on both ends.
  for (let i = 1; i < n; i++) {
    line((w * i) / n, 0, x1 + (bw * i) / n, y1);
    line((w * i) / n, h, x1 + (bw * i) / n, y2);
  }
  // Walls: n + 1 lines each; the first and last are the room's corners.
  for (let i = 0; i <= n; i++) {
    line(0, (h * i) / n, x1, y1 + (bh * i) / n);
    line(w, (h * i) / n, x2, y1 + (bh * i) / n);
  }
  // Rings of depth: each corner line is cut 1 - (1 - k/4)^2 of the way in,
  // so the rings crowd together near the box like real perspective.
  for (let k = 1; k < RINGS; k++) {
    const t = 1 - (1 - k / RINGS) ** 2;
    if (reach < 1 - t) continue;   // the lines haven't grown out this far yet
    const l = x1 * t;
    const r = w + (x2 - w) * t;
    const top = y1 * t;
    const bot = h + (y2 - h) * t;
    d += `M${r2(l)} ${r2(top)}H${r2(r)}V${r2(bot)}H${r2(l)}Z`;
  }
  return d;
}

/** How far the section has crossed the screen: 0 as its top enters, 1 as its bottom leaves. */
export function roomProgress(scrollY: number, vh: number, top: number, h: number): number {
  return Math.min(1, Math.max(0, (scrollY + vh - top) / (h + vh)));
}

export function roomDrift(progress: number, vw: number): number {
  return (vw > PHONE ? 400 : 200) * (progress * 2 - 1);
}

export type Room = {
  tick: () => void;
  /** Grow the lines out from the box over `ms` (the intro). */
  grow: (ms: number) => void;
};

/**
 * Wires the room to the page. Call `tick` once per animation frame. With
 * `waiting`, the lines stay hidden (reach 0) until `grow` is called.
 */
export function initRoom(calm: boolean, waiting = false): Room {
  const room = document.getElementById('room');
  const box = document.getElementById('box');
  const path = room?.querySelector<SVGPathElement>('.lines path');
  if (!room || !box || !path) return { tick() {}, grow() {} };

  let size: RoomSize = { w: 0, h: 0, bw: 0, bh: 0 };
  let top = 0;
  let vw = 0;
  let eased = 0;
  let shown = NaN;
  let visible = true;
  let stale = true;
  let reach = waiting ? 0 : 1;
  let growFrom = 0;   // when the lines started growing
  let growMs = 0;     // 0 when not growing

  const progress = () => roomProgress(window.scrollY, window.innerHeight, top, size.h);

  const measure = () => {
    vw = window.innerWidth;
    size = { w: room.clientWidth, h: room.clientHeight, bw: box.clientWidth, bh: box.clientHeight };
    top = room.getBoundingClientRect().top + window.scrollY;
    stale = true;
  };

  const draw = (drift: number) => {
    shown = drift;
    stale = false;
    room.style.setProperty('--drift', `${r2(drift)}px`);
    path.setAttribute('d', roomPath(size, drift, vw > PHONE ? 12 : 8, reach));
  };

  measure();
  eased = progress();

  // Reduced motion: the box rests in the middle of the room and stays there.
  if (calm) {
    draw(0);
    new ResizeObserver(() => { measure(); draw(0); }).observe(document.body);
    return { tick() {}, grow() {} };
  }

  draw(roomDrift(eased, vw));
  new ResizeObserver(measure).observe(document.body);
  new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; }).observe(room);

  return {
    tick() {
      if (!visible) return;
      if (growMs) {
        const t = Math.min(1, (performance.now() - growFrom) / growMs);
        reach = 1 - (1 - t) ** 3;   // fast out of the box, easing into the walls
        if (t === 1) growMs = 0;
        stale = true;
      }
      eased += (progress() - eased) * EASE;
      const drift = roomDrift(eased, vw);
      if (stale || Math.abs(drift - shown) > 0.01) draw(drift);
    },
    grow(ms) {
      growFrom = performance.now();
      growMs = ms;
    },
  };
}
