'use client';

/*
 * content.tsx
 * The prose primitives and the expansion tree.
 *
 * <T> renders text as pre-wrapped character spans (server-renderable, so the
 * full prose ships in the HTML for crawlers and no-JS readers). The engine
 * later reveals each span as its dots land. React never re-renders inside a
 * <T>, so the DOM stays stable under reconciliation.
 *
 * <Tok> is a grey clickable box. Clicking swaps it for its expansion via
 * context state; the freshly mounted expansion assembles itself from dots.
 */

import {
  createContext, memo, useContext, useLayoutEffect, useRef,
  type ReactNode,
} from 'react';
import { Ic } from './icons';

/* ---------------- char-span text ---------------- */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

export function chSpans(text: string): string {
  let out = '';
  for (const ch of text) {
    const ws = ch.trim() === '';
    out += `<span class="ch${ws ? ' sp on' : ''}">${ESC[ch] ?? ch}</span>`;
  }
  return out;
}

/*
 * memo is load-bearing here: with identical props React bails out before
 * touching this subtree on every re-render, so the engine's char spans (and
 * their revealed state) can never be reset by parent state changes.
 */
export const T = memo(function T({ text }: { text: string }) {
  return (
    <span
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: chSpans(text) }}
    />
  );
});

export const B = ({ text }: { text: string }) => <strong><T text={text} /></strong>;

export const A = ({ text, href }: { text: string; href: string }) => (
  <a href={href}><T text={text} /></a>
);

export const Was = ({ label, ic }: { label: string; ic?: string }) => (
  <span className="was">
    <T text={label} />
    {ic ? <Ic n={ic} /> : null}
  </span>
);

/* ---------------- token machinery ---------------- */

export type CompendiumApi = {
  isOpen: (id: string) => boolean;
  expand: (id: string) => void;
  assembleNode: (el: HTMLElement) => void;
};

export const Ctx = createContext<CompendiumApi | null>(null);

export function Tok({ id, label }: { id: string; label: string }) {
  const api = useContext(Ctx)!;
  if (api.isOpen(id)) return <Xp id={id} />;
  return (
    <button
      type="button"
      className="tok"
      aria-label={`${label} (expand)`}
      onClick={() => api.expand(id)}
    >
      <T text={label} />
    </button>
  );
}

/* A freshly opened expansion: mounts hidden (CSS), then assembles. */
function Xp({ id }: { id: string }) {
  const api = useContext(Ctx)!;
  const ref = useRef<HTMLSpanElement>(null);
  const ran = useRef(false);
  useLayoutEffect(() => {
    if (ran.current || !ref.current) return;
    ran.current = true;
    api.assembleNode(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <span className="xp" ref={ref}>{EXP[id]}</span>;
}

/* ---------------- the expansion tree ---------------- */

export const EXP: Record<string, ReactNode> = {
  ambitious: (
    <>
      <Was label="ambitious people" ic="spark" />
      <T text=" (currently: " />
      <a href="https://aryasomu.com" target="_blank" rel="noopener noreferrer">
        <B text="Arya Somu" />
      </a>
      <Ic n="people" /><T text=")" />
    </>
  ),
  oneproject: (
    <>
      <Was label="one project at a time" ic="compass" />
      <T text=". Right now, " />
      <Tok id="tpm" label="technical product management" />
      <T text=" seems to be on my horizon" />
    </>
  ),
  tpm: (
    <>
      <Was label="technical product management" />
      <T text=" (I hope to try it in an enterprise environment, soon)" />
    </>
  ),
  insight: (
    <>
      <Was label="The Insight Company of California" ic="bulb" />
      <T text=": useful insights for the human race. Our endeavors include " />
      <Tok id="beli" label="Beli for Spotify" />
      <T text=", " />
      <Tok id="road" label="a road trip app" />
      <T text=", and " />
      <Tok id="wear" label="fitness wearables" />
    </>
  ),
  beli: (
    <>
      <Was label="Beli for Spotify" ic="music" />
      <T text=" (Beli, but for what you listen to)" />
    </>
  ),
  road: (
    <>
      <Was label="a road trip app" ic="car" />
      <T text=" (more soon)" />
    </>
  ),
  wear: (
    <>
      <Was label="fitness wearables" ic="watch" />
      <T text=": the next generation of them, in a new form factor" />
    </>
  ),
  experiments: (
    <>
      <Was label="three experiments" ic="flask" />
      <T text=": " />
      <Tok id="boulder" label="a bouldering AI" />
      <T text=", " />
      <Tok id="argue" label="an agent that argues with you" />
      <T text=", and " />
      <Tok id="habit" label="a bad-habit breaker" />
    </>
  ),
  boulder: (
    <>
      <Was label="a bouldering AI" ic="mountain" />
      <T text=" that finds the optimal path up the wall for you, specifically" />
    </>
  ),
  argue: (
    <>
      <Was label="an agent that argues with you" ic="chat" />
      <T text=" to help you learn; disagreement is the feature" />
    </>
  ),
  habit: (
    <>
      <Was label="a bad-habit breaker" ic="zap" />
      <T text=" that runs in real time, powered by Meta’s dev tools" />
    </>
  ),
  deanza: (
    <>
      <Was label="De Anza College" ic="cap" />
      <T text=" from 2024 to 2026, where I (basically) collected " />
      <Tok id="degrees" label="five associate degrees" />
    </>
  ),
  degrees: (
    <>
      <Was label="five associate degrees" ic="layers" />
      <T text=": Statistics, Economics, Business Administration, Accounting, and Applied Math" />
    </>
  ),
  berkeley: (
    <>
      <Was label="UC Berkeley" ic="bear" />
      <T text=" as a transfer, majoring in Business Administration, Data Science, and Applied Math" />
    </>
  ),
  orders: (
    <>
      <Was label="second and third order thinking" ic="branch" />
      <T text=" in the world, so I made a program to help you with yours" />
    </>
  ),
  d3: (
    <>
      <Was label="vitamin D3" ic="sun" />
      <T text=". Right now " /><B text="bouldering" /><Ic n="mountain" />
      <T text=", " /><B text="pickleball" /><Ic n="paddle" />
      <T text=", and random endeavors with friends take the cake" />
    </>
  ),
  email: (
    <>
      <Was label="email" ic="mail" />
      <T text=": " />
      <A text="nikunjmore12@gmail.com" href="mailto:nikunjmore12@gmail.com" />
      <T text=" or " />
      <A text="nikunj.more@berkeley.edu" href="mailto:nikunj.more@berkeley.edu" />
      <T text=", or by phone at " />
      <A text="(650) 880-9285" href="tel:+16508809285" />
    </>
  ),
};
