'use client';

/*
 * musictab.tsx
 * The music tab (video ref #6): my last 25 distinct listens from Last.fm
 * as an edge-to-edge louvered row of album covers, repainted live as I
 * listen (the feed re-polls every minute while the tab is open and the
 * centred track is followed across updates by key, not index).
 *
 * The row is an endless loop: past the 25th cover the 1st comes around
 * again, in both directions (wrapDelta does the shortest-way maths).
 *
 * Interaction, by design calm:
 *   - the wheel is quantized: one notch advances exactly one album
 *     (trackpad travel accumulates into the same steps); touch drags
 *     free-scroll and snap to the nearest cover a moment after release
 *   - clicking anywhere glides the nearest cover to the centre
 *   - the centred cover shows name / artist / play count / when I last
 *     heard it / my rating and thoughts
 *
 * Covers are fully opaque and composited in painter's order (a z pyramid:
 * centre on top, both sides cascading down symmetrically) so cards can
 * never slice into one another; the dot field lives BEHIND this layer
 * and keeps simulating while hidden.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRecentTracks, artLarge, trackKey, type Track } from './lastfm';
import { noteFor } from './music-notes';
import {
  clamp, coverTransform, wrapDelta, normalizeWheel, wheelSteps, centerIndex,
  nearestCover, lerpExp, timeAgo, cardTilt, glarePos, centerCloseness,
} from '../utils.js';

const N = 25;
const SKELETON = 9;
const POLL_MS = 30_000;   /* fresh fetch twice a minute while the tab is open */
const SNAP_AFTER_MS = 260; /* idle this long -> settle on the nearest card */
const TILT_MAX = 11;      /* degrees, the centred card's parallax (ref #7) */

export function MusicTab({ active }: { active: boolean }) {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [err, setErr] = useState(false);
  const [center, setCenter] = useState(0);
  const [dim, setDim] = useState({ w: 1200, h: 800 });
  const [reduced, setReduced] = useState(false);
  const [, setTick] = useState(0); /* refreshes the "Xm ago" line */

  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const shineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollCur = useRef(0);
  const scrollTgt = useRef(0);
  const raf = useRef(0);
  const lastT = useRef(0);
  const touch = useRef<{ id: number; x: number; vx: number; t: number; moved: number } | null>(null);
  const suppressClick = useRef(false);
  const tracksRef = useRef<Track[] | null>(null);
  const inputAt = useRef(0); /* last wheel/drag timestamp, for the snap */
  const wheelAcc = useRef(0); /* partial wheel travel toward the next step */
  const mouse = useRef({ x: -1e4, y: -1e4, over: false }); /* parallax driver */
  const tilt = useRef({ rx: 0, ry: 0 }); /* the centred card's eased lean */

  /* ---- data: fetch now, then keep fetching while the tab is open ---- */
  const load = useCallback(async (revalidate = false) => {
    if (document.hidden) return; /* a hidden tab can wait for fresh data */
    setErr(false);
    try {
      const fresh = await getRecentTracks(N, { fresh: revalidate });
      /* keep the listener's place: follow the centred track by key */
      setTracks((old) => {
        if (old?.length) {
          const sp = spacingRef.current;
          const oi = Math.min(old.length - 1, Math.max(0, Math.round(scrollTgt.current / sp)));
          const key = trackKey(old[oi].artist, old[oi].name);
          const ni = fresh.findIndex((t) => trackKey(t.artist, t.name) === key);
          if (ni >= 0) {
            scrollTgt.current += wrapDelta(ni * sp - scrollTgt.current, fresh.length * sp);
            scrollCur.current = scrollTgt.current;
          }
        }
        return fresh;
      });
      tracksRef.current = fresh;
    } catch {
      if (!tracksRef.current) setErr(true);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    mouse.current.over = false; /* stale hover from the last visit dies here */
    void load();
    /* live, not just on reload: re-poll past every cache while you watch,
       and revalidate the moment the OS tab becomes visible again */
    const poll = setInterval(() => void load(true), POLL_MS);
    const tick = setInterval(() => setTick((t) => t + 1), 30_000);
    const onVis = () => { if (!document.hidden) void load(true); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [active, load]);

  useEffect(() => {
    setReduced(matchMedia('(prefers-reduced-motion: reduce)').matches);
    const m = () => setDim({ w: innerWidth, h: innerHeight });
    m();
    addEventListener('resize', m);
    return () => removeEventListener('resize', m);
  }, []);

  /* ---- geometry ---- */
  const cardW = clamp(Math.min(dim.h * 0.46, dim.w * 0.36), 170, 430);
  const spacing = Math.max(104, cardW * 0.5);
  const spacingRef = useRef(spacing);
  spacingRef.current = spacing;
  const opts = useMemo(() => ({
    spacing,
    tilt: 56,
    lift: cardW * 0.42,
    spread: cardW * 0.34,
    window: 1.45,
    loop: true,
  }), [spacing, cardW]);

  const items: (Track | null)[] = tracks ?? Array.from({ length: SKELETON }, () => null);
  const n = items.length;

  /* ---- the scroll loop: wheel-driven, smoothed, imperative ---- */
  useEffect(() => {
    if (!active || reduced || n === 0) return;
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - (lastT.current || now)) / 1000);
      lastT.current = now;
      /* settle: a beat after the last input, glide to the nearest card so
         something always sits flat, front and centre */
      if (!touch.current && now - inputAt.current > SNAP_AFTER_MS) {
        scrollTgt.current = Math.round(scrollTgt.current / spacing) * spacing;
      }
      scrollCur.current = lerpExp(scrollCur.current, scrollTgt.current, dt, 7);

      /*
       * Parallax (video ref #7): the centred card leans toward the cursor
       * and carries a light sheen that tracks it. Everything scales with
       * centerCloseness, so the lean and the light melt away the moment
       * the row starts sliding, and no other card ever tilts. The card's
       * screen position is derived from the same maths that places it
       * (coverTransform), never measured, so there is no feedback loop.
       */
      const ci = centerIndex(scrollCur.current, spacing, n, true);
      const close = centerCloseness(scrollCur.current, ci, spacing, n);
      const cc = coverTransform(ci, scrollCur.current, n, opts);
      const cx = innerWidth / 2 + cc.x;
      const cy = innerHeight * 0.44;
      const m = mouse.current;
      let trx = 0;
      let trry = 0;
      if (m.over && tracksRef.current?.length) {
        const lean = cardTilt(
          (m.x - cx) / (cardW * 0.85),
          (m.y - cy) / (cardW * 0.85),
          TILT_MAX,
        );
        trx = lean.rx * close;
        trry = lean.ry * close;
      }
      tilt.current.rx = lerpExp(tilt.current.rx, trx, dt, 10);
      tilt.current.ry = lerpExp(tilt.current.ry, trry, dt, 10);

      for (let i = 0; i < n; i++) {
        const el = cardRefs.current[i];
        if (!el) continue;
        const c = coverTransform(i, scrollCur.current, n, opts);
        const isC = i === ci;
        const rx = isC ? tilt.current.rx : 0;
        const ry = c.ry + (isC ? tilt.current.ry : 0);
        el.style.transform =
          `translate3d(${c.x - cardW / 2}px, ${-cardW / 2}px, ${c.z}px) ` +
          `rotateY(${ry}deg) rotateX(${rx}deg) scale(${c.s})`;
        el.style.zIndex = String(c.zi);
        const sh = shineRefs.current[i];
        if (sh) {
          if (isC && m.over) {
            const g = glarePos(m.x, m.y, cx - cardW / 2, cy - cardW / 2, cardW, cardW);
            sh.style.opacity = String(0.85 * close);
            sh.style.setProperty('--gx', `${g.gx}%`);
            sh.style.setProperty('--gy', `${g.gy}%`);
          } else {
            sh.style.opacity = '0';
          }
        }
      }
      setCenter((p) => (p === ci ? p : ci));
      raf.current = requestAnimationFrame(step);
    };
    lastT.current = 0;
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [active, reduced, n, spacing, cardW, opts]);

  /* wheel / trackpad: quantized - one notch moves exactly one album */
  const onWheel = (e: React.WheelEvent) => {
    const now = performance.now();
    if (now - inputAt.current > 400) wheelAcc.current = 0; /* stale partials die */
    const px = normalizeWheel(e.deltaY, e.deltaX, e.deltaMode);
    const { steps, rest } = wheelSteps(wheelAcc.current, px);
    wheelAcc.current = rest;
    if (steps !== 0) {
      scrollTgt.current =
        (Math.round(scrollTgt.current / spacing) + steps) * spacing;
    }
    inputAt.current = now;
  };

  /* touch drag (with a flick of momentum) */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    touch.current = { id: e.pointerId, x: e.clientX, vx: 0, t: performance.now(), moved: 0 };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    /* the parallax rides every mouse move; touch never tilts the card */
    if (e.pointerType === 'mouse') {
      mouse.current.x = e.clientX;
      mouse.current.y = e.clientY;
      mouse.current.over = true;
    }
    const t = touch.current;
    if (!t || e.pointerId !== t.id) return;
    const now = performance.now();
    const dx = e.clientX - t.x;
    t.vx = dx / Math.max(0.001, (now - t.t) / 1000);
    t.x = e.clientX; t.t = now; t.moved += Math.abs(dx);
    scrollTgt.current -= dx * 1.7;
    inputAt.current = now;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const t = touch.current;
    if (!t || e.pointerId !== t.id) return;
    scrollTgt.current -= t.vx * 0.18;
    inputAt.current = performance.now() - SNAP_AFTER_MS + 320; /* let the flick breathe, then snap */
    suppressClick.current = t.moved > 10;
    touch.current = null;
    setTimeout(() => { suppressClick.current = false; }, 80);
  };

  /* click any cover - or the air between covers - to centre the nearest
     one: the whole layer is a forgiving hit target (the calm way) */
  const centerOn = (i: number) => {
    if (suppressClick.current) return;
    /* shortest way around the loop */
    scrollTgt.current += wrapDelta(i * spacing - scrollTgt.current, n * spacing);
    inputAt.current = 0; /* a click is a destination: no snap fight */
  };
  const onLayerClick = (e: React.MouseEvent) => {
    if (suppressClick.current || !tracks?.length) return;
    centerOn(nearestCover(e.clientX, scrollCur.current, n, innerWidth, opts));
  };

  const tr = tracks?.[center] ?? null;
  const note = tr ? noteFor(tr.artist, tr.name) : {};

  /* ---- reduced motion: an honest flat strip ---- */
  if (reduced) {
    return (
      <div className={`music flat${active ? '' : ' off'}`} aria-label="Recent listens">
        {err && <Retry onRetry={load} />}
        <div className="mstrip">
          {(tracks ?? []).map((t, i) => (
            <figure key={`${t.artist}-${t.name}-${i}`} className="mflat">
              <img src={artLarge(t.art) || t.art} alt={`${t.name} cover`} loading="lazy" />
              <figcaption>
                <strong>{t.name}</strong> · {t.artist}
                {t.plays != null && t.plays > 0 && <> · {t.plays} plays</>}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`music${active ? '' : ' off'}`}
      aria-label="Recent listens"
      onWheel={onWheel}
      onClick={onLayerClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => { mouse.current.over = false; }}
    >
      <div className="mrow" style={{ perspective: '1500px' }}>
        {items.map((t, i) => {
          const c = coverTransform(i, scrollCur.current, n, opts);
          return (
            <div
              key={t ? `${t.artist}-${t.name}` : `skel-${i}`}
              ref={(el) => { cardRefs.current[i] = el; }}
              className={`mcard${t ? '' : ' skel'}`}
              role={t ? 'button' : undefined}
              tabIndex={t && i !== center ? 0 : -1}
              aria-label={t ? `Centre ${t.name} by ${t.artist}` : undefined}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); centerOn(i); } }}
              style={{
                width: cardW,
                height: cardW,
                transform:
                  `translate3d(${c.x - cardW / 2}px, ${-cardW / 2}px, ${c.z}px) ` +
                  `rotateY(${c.ry}deg) scale(${c.s})`,
                zIndex: c.zi,
              }}
            >
              {t ? (
                <>
                  <img
                    src={artLarge(t.art) || t.art}
                    alt={`${t.name} — ${t.artist}`}
                    draggable={false}
                    loading={i < 8 ? 'eager' : 'lazy'}
                    onError={(e) => {
                      if (t.art && e.currentTarget.src !== t.art) e.currentTarget.src = t.art;
                    }}
                  />
                  {/* the light: a sheen riding the cursor on the centred card */}
                  <div
                    ref={(el) => { shineRefs.current[i] = el; }}
                    className="mshine"
                    aria-hidden="true"
                  />
                </>
              ) : null}
            </div>
          );
        })}
      </div>

      {err && <Retry onRetry={load} />}

      {tr && (
        <div className="minfo" key={center}>
          <div className="mname">
            {tr.name}
            {tr.nowPlaying && <span className="mnow">now playing</span>}
          </div>
          <div className="martist">{tr.artist}{tr.album ? ` · ${tr.album}` : ''}</div>
          <div className="mmeta">
            {tr.plays != null && tr.plays > 0 && (
              <>{tr.plays} {tr.plays === 1 ? 'play' : 'plays'}<span className="msep">·</span></>
            )}
            {tr.nowPlaying
              ? <span className="live">listening right now</span>
              : (tr.playedAt ? timeAgo(tr.playedAt) : '')}
          </div>
          <div className="mnote">
            <span className="mrate">
              {note.rating != null ? `${note.rating.toFixed(1)} / 10` : 'unrated'}
            </span>
            <span className="msep">·</span>
            <span className="mthought">
              {note.thoughts ?? 'thoughts to come'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Retry({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mstate">
      the record crate didn&rsquo;t open.{' '}
      <button type="button" className="linkish" onClick={onRetry}>try again</button>
    </div>
  );
}
