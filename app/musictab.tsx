'use client';

/*
 * musictab.tsx
 * The music tab (video ref #6): my last 20 distinct listens from Last.fm
 * as an edge-to-edge louvered row of album covers. Every card shares one
 * tilt; the pointer's x position drives the scroll (wheel and touch-drag
 * work too); whichever cover reaches the screen centre eases flat,
 * face-on, and its name / artist / rating / thoughts rise beneath it.
 * Geometry comes from the pure, unit-tested coverTransform family.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRecentTracks, artLarge, type Track } from './lastfm';
import { noteFor } from './music-notes';
import {
  clamp, coverTransform, scrollFromPointer, centerIndex, lerpExp,
} from '../utils.js';

const N = 20;
const SKELETON = 9;

export function MusicTab({ active }: { active: boolean }) {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [err, setErr] = useState(false);
  const [center, setCenter] = useState(0);
  const [dim, setDim] = useState({ w: 1200, h: 800 });
  const [reduced, setReduced] = useState(false);

  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollCur = useRef(0);
  const scrollTgt = useRef(0);
  const raf = useRef(0);
  const lastT = useRef(0);
  const touch = useRef<{ id: number; x: number; vx: number; t: number } | null>(null);
  const fetched = useRef(false);

  const load = useCallback(() => {
    setErr(false);
    getRecentTracks(N).then(setTracks).catch(() => setErr(true));
  }, []);

  useEffect(() => {
    if (active && !fetched.current) { fetched.current = true; load(); }
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
  const spacing = Math.max(92, cardW * 0.42);
  const opts = useMemo(() => ({
    spacing,
    tilt: 56,
    lift: cardW * 0.42,
    spread: cardW * 0.3,
    window: 1.45,
  }), [spacing, cardW]);

  const items: (Track | null)[] = tracks ?? Array.from({ length: SKELETON }, () => null);
  const n = items.length;

  /* ---- the scroll loop: pointer-linked, smoothed, imperative ---- */
  useEffect(() => {
    if (!active || reduced || n === 0) return;
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - (lastT.current || now)) / 1000);
      lastT.current = now;
      const max = (n - 1) * spacing;
      scrollTgt.current = clamp(scrollTgt.current, 0, max);
      scrollCur.current = lerpExp(scrollCur.current, scrollTgt.current, dt, 7);
      for (let i = 0; i < n; i++) {
        const el = cardRefs.current[i];
        if (!el) continue;
        const c = coverTransform(i, scrollCur.current, n, opts);
        el.style.transform =
          `translate3d(${c.x - cardW / 2}px, ${-cardW / 2}px, ${c.z}px) ` +
          `rotateY(${c.ry}deg) scale(${c.s})`;
        el.style.zIndex = String(c.zi);
        el.style.setProperty('--focus', c.focus.toFixed(3));
      }
      setCenter((p) => {
        const ci = centerIndex(scrollCur.current, spacing, n);
        return p === ci ? p : ci;
      });
      raf.current = requestAnimationFrame(step);
    };
    lastT.current = 0;
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [active, reduced, n, spacing, cardW, opts]);

  /* mouse position drives the row (the video's signature move) */
  useEffect(() => {
    if (!active || reduced) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || touch.current) return;
      scrollTgt.current = scrollFromPointer(e.clientX, innerWidth, n, spacing);
    };
    addEventListener('pointermove', onMove, { passive: true });
    return () => removeEventListener('pointermove', onMove);
  }, [active, reduced, n, spacing]);

  const onWheel = (e: React.WheelEvent) => {
    scrollTgt.current += (e.deltaY + e.deltaX) * 0.9;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    touch.current = { id: e.pointerId, x: e.clientX, vx: 0, t: performance.now() };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const t = touch.current;
    if (!t || e.pointerId !== t.id) return;
    const now = performance.now();
    const dx = e.clientX - t.x;
    t.vx = dx / Math.max(0.001, (now - t.t) / 1000);
    t.x = e.clientX; t.t = now;
    scrollTgt.current -= dx * 1.7;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const t = touch.current;
    if (!t || e.pointerId !== t.id) return;
    scrollTgt.current -= t.vx * 0.18; /* a flick keeps gliding */
    touch.current = null;
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
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="mrow" style={{ perspective: '1500px' }}>
        {items.map((t, i) => {
          const c = coverTransform(i, scrollCur.current, n, opts);
          return (
            <div
              key={t ? `${t.artist}-${t.name}` : `skel-${i}`}
              ref={(el) => { cardRefs.current[i] = el; }}
              className={`mcard${t ? '' : ' skel'}`}
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
                <img
                  src={artLarge(t.art) || t.art}
                  alt={`${t.name} — ${t.artist}`}
                  draggable={false}
                  loading={i < 8 ? 'eager' : 'lazy'}
                  onError={(e) => {
                    /* the 600px guess can miss; fall back to the real URL */
                    if (t.art && e.currentTarget.src !== t.art) e.currentTarget.src = t.art;
                  }}
                />
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
