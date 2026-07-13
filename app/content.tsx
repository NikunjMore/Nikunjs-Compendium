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

export const Was = ({ id, label, ic }: { id: string; label: string; ic?: string }) => {
  const api = useContext(Ctx)!;
  return (
    <button
      type="button"
      className="was collapse"
      aria-label={`${label} (collapse)`}
      aria-expanded="true"
      onClick={() => api.collapse(id)}
    >
      <T text={label} />
      {ic ? <Ic n={ic} /> : null}
    </button>
  );
};

/* ---------------- token machinery ---------------- */

export type CompendiumApi = {
  isOpen: (id: string) => boolean;
  expand: (id: string) => void;
  collapse: (id: string) => void;
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
      aria-expanded="false"
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
      <Was id="ambitious" label="ambitious people" ic="spark" />
      <T text=", the kind who make you think bigger and then actually build with you" />
    </>
  ),
  aipm: (
    <>
      <Was id="aipm" label="AI product management" ic="compass" />
      <T text=". I like figuring out what should get built, why, and how to get it into people's hands" />
    </>
  ),
  work: (
    <>
      <Was id="work" label="a few different worlds" ic="layers" />
      <T text=": " />
      <Tok id="adiom" label="Adiom" />
      <T text=", " />
      <Tok id="trees" label="Three Big Trees" />
      <T text=", " />
      <Tok id="dasg" label="De Anza Student Government" />
      <T text=", and " />
      <Tok id="peerprep" label="PeerPrep" />
    </>
  ),
  adiom: (
    <>
      <Was id="adiom" label="Adiom" ic="bulb" />
      <T text=", where I worked in business development, redesigned parts of the site, and automated outreach. That roughly doubled our qualified sales conversations each week" />
    </>
  ),
  trees: (
    <>
      <Was id="trees" label="Three Big Trees" ic="branch" />
      <T text=", where I ran operations and built a WhatsApp-based order system that cut our usual turnaround from three or four days to one" />
    </>
  ),
  dasg: (
    <>
      <Was id="dasg" label="De Anza Student Government" ic="cap" />
      <T text=", where I helped manage a $1M+ budget and got a proposal through the Board of Trustees projected to bring in about $160K a year" />
    </>
  ),
  peerprep: (
    <>
      <Was id="peerprep" label="PeerPrep" ic="people" />
      <T text=", a tutoring group I co-founded that worked with more than 175 families. We used AI for parent updates, but the teaching stayed human" />
    </>
  ),
  insight: (
    <>
      <Was id="insight" label="The Insight Company of California" ic="bulb" />
      <T text=", a suite of private productivity tools that runs on your own computer. The first is " />
      <Tok id="dictation" label="a local dictation app" />
    </>
  ),
  dictation: (
    <>
      <Was id="dictation" label="a local dictation app" ic="chat" />
      <T text=". You talk, it cleans up what you said, and the audio never leaves your machine. It is really about " />
      <Tok id="voice" label="owning your voice" />
      <T text=" and " />
      <Tok id="memory" label="picking up where you left off" />
    </>
  ),
  voice: (
    <>
      <Was id="voice" label="owning your voice" ic="music" />
      <T text=". A lot of voice tools use recordings to improve someone else's models. I think your voice should belong to you. Kind of dystopian that this needs saying, but here we are" />
    </>
  ),
  memory: (
    <>
      <Was id="memory" label="picking up where you left off" ic="compass" />
      <T text=": what you were doing, what you decided, and what needs your attention next, without sending your life to somebody else's server" />
    </>
  ),
  deanza: (
    <>
      <Was id="deanza" label="De Anza College" ic="cap" />
      <T text=" from 2024 to 2026, where I more or less collected " />
      <Tok id="degrees" label="five associate degrees" />
    </>
  ),
  degrees: (
    <>
      <Was id="degrees" label="five associate degrees" ic="layers" />
      <T text=": Statistics, Economics, Business Administration, Accounting, and Applied Math. The breadth was the point" />
    </>
  ),
  berkeley: (
    <>
      <Was id="berkeley" label="UC Berkeley" ic="bear" />
      <T text=", studying Business Administration and Statistics with a minor in EECS" />
    </>
  ),
  jepa: (
    <>
      <Was id="jepa" label="JEPA architectures" ic="branch" />
      <T text=" because I think they are the future. I am still learning, which is part of the fun" />
    </>
  ),
  d3: (
    <>
      <Was id="d3" label="Vitamin D₃" ic="sun" />
      <T text=". Right now " /><B text="bouldering" /><Ic n="mountain" />
      <T text=", " /><B text="pickleball" /><Ic n="paddle" />
      <T text=", and random endeavors with friends take the cake" />
    </>
  ),
  email: (
    <>
      <Was id="email" label="email" ic="mail" />
      <T text=": " />
      <A text="nikunjmore12@gmail.com" href="mailto:nikunjmore12@gmail.com" />
      <T text=" (personal) or " />
      <A text="nikunj.more@berkeley.edu" href="mailto:nikunj.more@berkeley.edu" />
      <T text=" (school); I read both daily" />
    </>
  ),
  phone: (
    <>
      <Was id="phone" label="phone" ic="phone" />
      <T text=": " />
      <A text="(650) 880-9285" href="tel:+16508809285" />
    </>
  ),
};

export const PARENT: Record<string, string> = {
  adiom: 'work', trees: 'work', dasg: 'work', peerprep: 'work',
  dictation: 'insight', voice: 'dictation', memory: 'dictation',
  degrees: 'deanza',
};
