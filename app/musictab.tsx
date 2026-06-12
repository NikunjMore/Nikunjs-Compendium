'use client';

/*
 * musictab.tsx
 * The music tab (video ref #6): my last 20 distinct listens from Last.fm
 * as an edge-to-edge louvered row of album covers, repainted live as I
 * listen (the feed re-polls every minute while the tab is open and the
 * centred track is followed across updates by key, not index).
 *
 * Interaction, by design calm:
 *   - the scroll wheel / trackpad (and touch-drag) moves the row
 *   - clicking any off-centre cover glides it to the centre
 *   - the centred cover eases flat, face-on, and shows name / artist /
 *     play count / when I last heard it / my rating and thoughts
 *
 * Covers are fully opaque and composited in painter's order (left over
 * right, centre on top) so cards can never slice into one another; the
 * dot field lives BEHIND this layer and keeps simulating while hidden.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRecentTracks, artLarge, trackKey, type Track } from './lastfm';
import { noteFor } from './music-notes';
import {
  clamp, coverTransform, normalizeWheel, centerIndex, lerpExp, timeAgo,
} from '../utils.js';

const N = 20;
const SKELETON = 9;
const POLL_MS = 60_000;

export function MusicTab({ active }: { active: boolean }) {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [err, setErr] = useState(false);
  const [center, setCenter] = useState(0);
  const [dim, setDim] = useState({ w: 1200, h: 800 });
  const [reduced, setReduced] = useState(false);
  const [, setTick] = useState(0); /* refreshes the "Xm ago" line */

  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollCur = useRef(0);
  const scrollTgt = useRef(0);
  const raf = useRef(0);
  const lastT = useRef(0);
  const touch = useRef<{ id: number; x: number; vx: number; t: number; moved: number } | null>(null);
  const suppressClick = useRef(false);
  const tracksRef = useRef<Track[] | null>(null);

  /* ---- data: fetch now, then keep fetching while the tab is open ---- */
  const load = useCallback(async () => {
    setErr(false);
    try {
      const fresh = await getRecentTracks(N);
      /* keep the listener's place: follow the centred track by key */
      setTracks((old) => {
        if (old?.length) {
          const sp = spacingRef.current;
          const oi = Math.min(old.length - 1, Math.max(0, Math.round(scrollTgt.current / sp)));
          const key = trackKey(old[oi].artist, old[oi].name);
          const ni = fresh.findIndex((t) => trackKey(t.artist, t.name) === key);
          if (ni >= 0) {
            scrollTgt.current = ni * sp;
            scrollCur.current = scrollTgt.current;
          } else {
            scrollTgt.current = clamp(scrollTgt.current, 0, (fresh.length - 1) * sp);
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
    void load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => { clearInterval(poll); clearInterval(tick); };
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
  }), [spacing, cardW]);

  const items: (Track | null)[] = tracks ?? Array.from({ length: SKELETON }, () => null);
  const n = items.length;

  /* ---- the scroll loop: wheel-driven, smoothed, imperative ---- */
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

  /* wheel / trackpad drives the row */
  const onWheel = (e: React.WheelEvent) => {
    scrollTgt.current += normalizeWheel(e.deltaY, e.deltaX, e.deltaMode);
  };

  /* touch drag (with a flick of momentum) */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    touch.current = { id: e.pointerId, x: e.clientX, vx: 0, t: performance.now(), moved: 0 };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const t = touch.current;
    if (!t || e.pointerId !== t.id) return;
    const now = performance.now();
    const dx = e.clientX - t.x;
    t.vx = dx / Math.max(0.001, (now - t.t) / 1000);
    t.x = e.clientX; t.t = now; t.moved += Math.abs(dx);
    scrollTgt.current -= dx * 1.7;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const t = touch.current;
    if (!t || e.pointerId !== t.id) return;
    scrollTgt.current -= t.vx * 0.18;
    suppressClick.current = t.moved > 10;
    touch.current = null;
    setTimeout(() => { suppressClick.current = false; }, 80);
  };

  /* click any cover: bring it to the centre (the calm way to browse) */
  const centerOn = (i: number) => {
    if (suppressClick.current) return;
    scrollTgt.current = i * spacing;
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
              role={t ? 'button' : undefined}
              tabIndex={t && i !== center ? 0 : -1}
              aria-label={t ? `Centre ${t.name} by ${t.artist}` : undefined}
              onClick={() => centerOn(i)}
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
                <img
                  src={artLarge(t.art) || t.art}
                  alt={`${t.name} — ${t.artist}`}
                  draggable={false}
                  loading={i < 8 ? 'eager' : 'lazy'}
                  onError={(e) => {
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
