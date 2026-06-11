'use client';

/*
 * compendium.tsx
 * The whole page: prose, tokens, the WebGL dot field, the click counter,
 * and the intro orchestration.
 */

import {
  useCallback, useEffect, useMemo, useRef, useState,
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
      const engine = getEngine(canvasRef.current, reduced);
      engineRef.current = engine;

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
  }, []);

  const api = useMemo<CompendiumApi>(() => ({
    isOpen: (id) => open.has(id),
    expand: (id) => {
      bump();
      setOpen((prev) => new Set(prev).add(id));
    },
    assembleNode: (el) => {
      void engineRef.current?.assemble(el, { perChar: 13 });
    },
  }), [open, bump]);

  /*
   * The field and the layout both respond to how unfolded the page is:
   * the dot crowd thins toward silence as every token opens, and the
   * vertical rhythm compresses from roomy (collapsed fills the screen)
   * to tight (fully expanded still fits the screen).
   */
  const TOTAL_TOKENS = 17;
  const openness = Math.min(1, open.size / TOTAL_TOKENS);
  const rhythm = 2.2 - openness * 1.25;

  useEffect(() => {
    engineRef.current?.setCrowd(1 - openness);
  }, [openness]);

  return (
    <Ctx.Provider value={api}>
      <canvas id="dots" ref={canvasRef} aria-hidden="true" />

      <main ref={rootRef} style={{ ['--r' as string]: String(rhythm) } as React.CSSProperties}>
        <header>
          <h1 data-block><T text="Nikunj’s Compendium" /></h1>
          <div data-block>
            <p className="byline"><T text="by Nikunj More · Bay Area" /></p>
          </div>
        </header>

        <section aria-label="About">
          <p data-block>
            <T text="I like building things, especially with " />
            <Tok id="ambitious" label="ambitious people" />
            <T text=". I’m navigating the world " />
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
            <T text="After hours, I’m running " />
            <Tok id="experiments" label="three experiments" />
            <T text="." />
          </p>
        </section>

        <section aria-label="School">
          <h2 className={`hdr${settled ? ' show' : ''}`}>School</h2>
          <p data-block>
            <T text="I studied at " />
            <Tok id="deanza" label="De Anza College" />
            <T text=", and now I’m headed to " />
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
              source ↗
            </a>
            <span className="sep">·</span>
            <span>© 2026 Nikunj More</span>
          </span>
        </footer>
      </main>
    </Ctx.Provider>
  );
}
