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

/*
 * Copy rules (the recruiter test): every click must pay out NEW information
 * in one breath - what it is, why it matters, or how I think. A label is
 * never allowed to expand into a restatement of itself.
 */
export const EXP: Record<string, ReactNode> = {
  ambitious: (
    <>
      <Was label="ambitious people" ic="spark" />
      <T text=" (currently: " />
      <a href="https://aryasomu.com" target="_blank" rel="noopener noreferrer">
        <B text="Arya Somu" />
      </a>
      <Ic n="people" /><T text="; find the people who raise your ceiling, then build with them)" />
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
      <T text=" (the role where shipping means aligning people, not just code; I want to run that play at enterprise scale)" />
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
      <T text=" (log and rank everything you listen to, trade taste with friends, and watch your real top 100 emerge; your ranking, not the algorithm's)" />
    </>
  ),
  road: (
    <>
      <Was label="a road trip app" ic="car" />
      <T text=" (the stops, the route, and the drive itself in one place; more soon)" />
    </>
  ),
  wear: (
    <>
      <Was label="fitness wearables" ic="watch" />
      <T text=": the next generation of recovery tracking, in a form factor nobody has shipped yet" />
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
      <T text=" that reads the wall and plans your beta: the optimal path for your height and reach, not the average climber's" />
    </>
  ),
  argue: (
    <>
      <Was label="an agent that argues with you" ic="chat" />
      <T text=" to help you learn; disagreement is the feature, not the bug" />
    </>
  ),
  habit: (
    <>
      <Was label="a bad-habit breaker" ic="zap" />
      <T text=" that catches the habit the moment it starts (built on Meta’s dev tools), not in a report the next morning" />
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
      <T text=": Statistics, Economics, Business Administration, Accounting, and Applied Math (the breadth was the point)" />
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
      <Was label="Vitamin D₃" ic="sun" />
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
      <T text=" (personal) or " />
      <A text="nikunj.more@berkeley.edu" href="mailto:nikunj.more@berkeley.edu" />
      <T text=" (school); I read both daily" />
    </>
  ),
  phone: (
    <>
      <Was label="phone" ic="phone" />
      <T text=": " />
      <A text="(650) 880-9285" href="tel:+16508809285" />
      <T text=" (call or text; text gets the faster reply)" />
    </>
  ),
};
