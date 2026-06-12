'use client';

/*
 * compendium.tsx
 * The whole page: prose, tokens, the WebGL dot field, the click counter,
 * and the intro orchestration.
 */

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { getEngine, type DotEngine } from './engine';
import { Ctx, T, Tok, type CompendiumApi } from './content';
import { Ic } from './icons';
import { formatClicks } from '../utils.js';

const CKEY = 'nc.clicks';

export default function Compendium() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<DotEngine | null>(null);
  const introRan = useRef(false);

  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [clicks, setClicks] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const [ping, setPing] = useState(0);

  /* counter: hydrate from localStorage after mount */
  useEffect(() => {
    setMounted(true);
    try { setClicks(parseInt(localStorage.getItem(CKEY) || '0', 10) || 0); } catch { /* private mode */ }
  }, []);

  const bump = useCallback(() => {
    setClicks((c) => {
      const n = c + 1;
      try { localStorage.setItem(CKEY, String(n)); } catch { /* private mode */ }
      return n;
    });
    setPing((p) => p + 1);
  }, []);

  /*
   * Rhythm solver: spacing scales linearly with the --r variable, so two
   * instant probes (r=1, r=2) give the pixels-per-r slope. Solve for the r
   * that makes the page fill the viewport exactly, in any expansion state,
   * on any screen. Probes run with transitions suppressed inside a single
   * frame, so nothing flickers; the real change then eases in.
   */
  const fitRhythm = useCallback(() => {
    const m = rootRef.current;
    if (!m) return;
    m.classList.add('measuring');
    m.style.setProperty('--r', '1');
    const h1 = m.offsetHeight;
    m.style.setProperty('--r', '2');
    const h2 = m.offsetHeight;
    const slope = Math.max(40, h2 - h1);
    /* allow r down to 0.72 on desktop so fully-expanded page stays on screen */
    const isMobile = innerWidth <= 700 || (innerHeight <= 620 && innerWidth <= 900);
    const rMin = isMobile ? 0.9 : 0.72;
    const r = Math.max(rMin, Math.min(3.6, 1 + (innerHeight - 8 - h1) / slope));
    m.style.setProperty('--r', String(Math.round(r * 100) / 100));
    void m.offsetHeight; /* flush layout before transitions return */
    m.classList.remove('measuring');
  }, []);

  /*
   * FLIP glide for reflow: before an expansion changes the layout, snapshot
   * the position of every atomic inline piece (characters, tokens, icons)
   * plus the headers and footer. After React commits and the rhythm solver
   * settles, each displaced piece is offset back to where it was (relative
   * positioning works on inline elements where transforms do not) and then
   * eased to rest. Text slides to its new home instead of teleporting.
   */
  const flipRef = useRef<{ els: HTMLElement[]; rects: Map<HTMLElement, DOMRect> }>({
    els: [],
    rects: new Map(),
  });

  const flipSnapshot = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    /* finish any glide still running so measurements are truthful */
    for (const el of flipRef.current.els) {
      el.style.transition = 'none';
      el.style.left = '0px';
      el.style.top = '0px';
    }
    void root.offsetHeight;
    for (const el of flipRef.current.els) {
      el.style.removeProperty('position');
      el.style.removeProperty('left');
      el.style.removeProperty('top');
      el.style.removeProperty('transition');
    }
    flipRef.current.els = [];
    const rects = new Map<HTMLElement, DOMRect>();
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('.hdr, footer, .tok, .ic, span.ch'))) {
      if (el.matches('span.ch') && el.closest('.tok')) continue; /* token moves as one box */
      rects.set(el, el.getBoundingClientRect());
    }
    flipRef.current.rects = rects;
  }, []);

  const flipPlay = useCallback(() => {
    const root = rootRef.current;
    if (!root || flipRef.current.rects.size === 0) return;
    const rects = flipRef.current.rects;
    flipRef.current.rects = new Map();
    /* hidden tabs get no animation frames; never freeze offsets there */
    if (document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const moved: HTMLElement[] = [];
    rects.forEach((old, el) => {
      if (!el.isConnected || moved.length >= 900) return;
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.style.position = 'relative';
      el.style.transition = 'none';
      el.style.left = `${dx}px`;
      el.style.top = `${dy}px`;
      moved.push(el);
    });
    if (!moved.length) return;
    flipRef.current.els = moved;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const el of moved) {
        el.style.transition = 'left 0.5s cubic-bezier(0.16, 1, 0.3, 1), top 0.5s cubic-bezier(0.16, 1, 0.3, 1)';
        el.style.left = '0px';
        el.style.top = '0px';
      }
      setTimeout(() => {
        for (const el of moved) {
          el.style.removeProperty('position');
          el.style.removeProperty('left');
          el.style.removeProperty('top');
          el.style.removeProperty('transition');
        }
        if (flipRef.current.els === moved) flipRef.current.els = [];
      }, 540);
    }));
  }, []);

  /* the engine + intro sequence */
  useEffect(() => {
    if (introRan.current || !canvasRef.current || !rootRef.current) return;
    introRan.current = true;
    let cancelled = false;

    /*
     * Safety net of last resort: if any framework re-render ever re-creates
     * char spans (wiping their revealed state), reveal the newcomers after a
     * grace period. Fresh expansions animate well before 5s, so this never
     * interferes with the dots; it only guarantees text can never stay
     * invisible.
     */
    const net = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of Array.from(m.addedNodes)) {
          if (!(n instanceof HTMLElement)) continue;
          const spans = n.matches('span.ch')
            ? [n]
            : Array.from(n.querySelectorAll<HTMLElement>('span.ch:not(.on)'));
          for (const s of spans) {
            setTimeout(() => s.classList.add('on'), 5000);
          }
        }
      }
    });
    if (rootRef.current) net.observe(rootRef.current, { childList: true, subtree: true });

    const run = async () => {
      /*
       * Let hydration fully settle (double rAF) before sampling the DOM, so
       * the engine holds references to the final nodes, not ones React might
       * still replace while it boots.
       */
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      /* Inter loads via next/font; wait so glyph sampling uses the real outlines */
      try { await document.fonts.ready; } catch { /* older browsers */ }
      if (cancelled || !canvasRef.current || !rootRef.current) return;

      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.documentElement.classList.add(reduced ? 'reduced' : 'anim');
      fitRhythm(); /* settle the final layout before sampling glyph targets */
      const engine = getEngine(canvasRef.current, reduced);
      engineRef.current = engine;
      /* the portrait: same dots, own population, immune to the crowd dial */
      engine.attachPhoto('/me.jpg');

      const root = rootRef.current;
      const blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-block]'));

      const showChrome = () => setSettled(true);

      if (!engine.ok) {
        for (const b of blocks) void engine.assemble(b);
        showChrome();
        return;
      }

      const seq: Promise<void>[] = [];
      let t = 240;
      for (const b of blocks) {
        const isTitle = b.tagName === 'H1';
        seq.push(engine.assemble(b, { delay: t, perChar: isTitle ? 26 : 11 }));
        t += isTitle ? 480 : 210;
      }
      setTimeout(showChrome, Math.min(t + 250, 2400));

      const skip = () => engine.finishAll();
      addEventListener('pointerdown', skip, { once: true });
      void Promise.all(seq).then(() => removeEventListener('pointerdown', skip));
    };

    void run();
    return () => { cancelled = true; net.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRhythm]);

  const api = useMemo<CompendiumApi>(() => ({
    isOpen: (id) => open.has(id),
    expand: (id) => {
      flipSnapshot(); /* remember where everything is before the layout moves */
      bump();
      setOpen((prev) => new Set(prev).add(id));
    },
    assembleNode: (el) => {
      /* drain the field radially around the box that was clicked */
      const r = el.getBoundingClientRect();
      const origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      /*
       * One painted frame later the rhythm solver has settled and the new
       * spans sit at their final positions (the glide only moves the old
       * text), so glyph targets sampled here are exact.
       */
      setTimeout(() => {
        void engineRef.current?.assemble(el, { perChar: 13, origin });
      }, 160);
    },
  }), [open, bump, flipSnapshot]);

  /* the dot crowd thins toward silence as every token opens */
  const TOTAL_TOKENS = 17;
  const openness = Math.min(1, open.size / TOTAL_TOKENS);

  useEffect(() => {
    engineRef.current?.setCrowd(1 - openness);
  }, [openness]);

  /* refit when content unfolds, then glide everything to its new home */
  useLayoutEffect(() => {
    fitRhythm();
    flipPlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    let t = 0;
    const onResize = () => {
      clearTimeout(t);
      t = window.setTimeout(fitRhythm, 150);
    };
    addEventListener('resize', onResize);
    return () => { clearTimeout(t); removeEventListener('resize', onResize); };
  }, [fitRhythm]);

  return (
    <Ctx.Provider value={api}>
      <canvas id="dots" ref={canvasRef} aria-hidden="true" />

      <main ref={rootRef}>
        <header>
          <h1 data-block><T text="Nikunj's Compendium" /></h1>
        </header>

        <section aria-label="About">
          <p data-block>
            <T text="I like building things, especially with " />
            <Tok id="ambitious" label="ambitious people" />
            <T text=". I'm navigating the world " />
            <Tok id="oneproject" label="one project at a time" />
            <T text="." />
          </p>
        </section>

        <section aria-label="Experience">
          <h2 className={`hdr${settled ? ' show' : ''}`}>Experience</h2>
          <p data-block>
            <T text="Currently building " />
            <Tok id="insight" label="The Insight Company of California" />
            <T text="." />
          </p>
        </section>

        <section aria-label="Projects">
          <h2 className={`hdr${settled ? ' show' : ''}`}>Projects</h2>
          <p data-block>
            <T text="After hours, I'm running " />
            <Tok id="experiments" label="three experiments" />
            <T text="." />
          </p>
        </section>

        <section aria-label="School">
          <h2 className={`hdr${settled ? ' show' : ''}`}>School</h2>
          <p data-block>
            <T text="I studied at " />
            <Tok id="deanza" label="De Anza College" />
            <T text=", and now I'm headed to " />
            <Tok id="berkeley" label="UC Berkeley" />
            <T text="." />
          </p>
        </section>

        <section aria-label="Misc">
          <h2 className={`hdr${settled ? ' show' : ''}`}>Misc</h2>
          <p data-block>
            <T text="I think there is not enough " />
            <Tok id="orders" label="second and third order thinking" />
            <T text=". I love getting " />
            <Tok id="d3" label="vitamin D3" />
            <T text=". Oh, and " />
            <strong><T text="Coke Zero" /></strong>
            <Ic n="can" />
            <T text="." />
          </p>
        </section>

        <section aria-label="Contact">
          <h2 className={`hdr${settled ? ' show' : ''}`}>Contact</h2>
          <p data-block>
            <T text="You can find me in the " />
            <strong><T text="Bay Area" /></strong>
            <Ic n="pin" />
            <T text=", on " />
            <a href="https://www.linkedin.com/in/nikunj-more/" target="_blank" rel="noopener noreferrer">
              <T text="LinkedIn" />
            </a>
            <Ic n="ext" />
            <T text=", or via " />
            <Tok id="email" label="email" />
            <T text="." />
          </p>
        </section>

        <footer className={settled ? 'show' : ''}>
          <span id="counter">
            <span id="cdot" key={ping} className={ping ? 'ping' : ''} aria-hidden="true" />
            <span suppressHydrationWarning>{mounted ? formatClicks(clicks) : '· · ·'}</span>
          </span>
          <span className="links">
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); location.reload(); }}
              title="Replay the intro"
            >
              replay
            </a>
            <span className="sep">·</span>
            <a
              href="https://github.com/NikunjMore/Nikunjs-Compendium"
              target="_blank"
              rel="noopener noreferrer"
            >
              source &#x2197;
            </a>
            <span className="sep">·</span>
            <span>&#169; 2026 Nikunj More</span>
          </span>
        </footer>
      </main>
    </Ctx.Provider>
  );
}
