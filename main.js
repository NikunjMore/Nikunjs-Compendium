/*
 * main.js
 * Content tree, token wiring, click counter, intro orchestration.
 *
 * The page starts with short base sentences (real HTML, crawlable).
 * Grey boxed words are <button class="tok"> elements. Clicking one
 * replaces it with its expansion: the visited words stay (dimmed, with
 * their icon) and the new words are assembled out of floating dots by
 * the engine in particles.js. Expansions can contain new tokens, so the
 * compendium unfolds Los Feliz style.
 */

import { DotEngine } from './particles.js';
import { icon } from './icons.js';
import { formatClicks } from './utils.js';

/* ---------------- segment builders ---------------- */

const T = (text) => ({ kind: 't', text });
const B = (text) => ({ kind: 'b', text });
const I = (name) => ({ kind: 'i', name });
const K = (label, id) => ({ kind: 'k', label, id });
const A = (text, href) => ({ kind: 'a', text, href });
const WAS = (label, ic) => ({ kind: 'was', label, ic });

/* ---------------- the expansion tree ---------------- */

const EXP = {
  ambitious: [
    WAS('ambitious people', 'spark'),
    T(' (currently: '), B('Arya Somu'), I('people'), T(')'),
  ],
  oneproject: [
    WAS('one project at a time', 'compass'),
    T('. Right now, '), K('technical product management', 'tpm'),
    T(' seems to be on my horizon'),
  ],
  tpm: [
    WAS('technical product management'),
    T(' (I hope to try it in an enterprise environment, soon)'),
  ],
  insight: [
    WAS('The Insight Company of California', 'bulb'),
    T(': useful insights for the human race. Our endeavors include '),
    K('Beli for Spotify', 'beli'), T(', '),
    K('a road trip app', 'road'), T(', and '),
    K('fitness wearables', 'wear'),
  ],
  beli: [
    WAS('Beli for Spotify', 'music'),
    T(' (Beli, but for what you listen to)'),
  ],
  road: [
    WAS('a road trip app', 'car'),
    T(' (more soon)'),
  ],
  wear: [
    WAS('fitness wearables', 'watch'),
    T(': the next generation of them, in a new form factor'),
  ],
  experiments: [
    WAS('three experiments', 'flask'),
    T(': '),
    K('a bouldering AI', 'boulder'), T(', '),
    K('an agent that argues with you', 'argue'), T(', and '),
    K('a bad-habit breaker', 'habit'),
  ],
  boulder: [
    WAS('a bouldering AI', 'mountain'),
    T(' that finds the optimal path up the wall for you, specifically'),
  ],
  argue: [
    WAS('an agent that argues with you', 'chat'),
    T(' to help you learn; disagreement is the feature'),
  ],
  habit: [
    WAS('a bad-habit breaker', 'zap'),
    T(' that runs in real time, powered by Meta’s dev tools'),
  ],
  deanza: [
    WAS('De Anza College', 'cap'),
    T(' from 2024 to 2026, where I (basically) collected '),
    K('five associate degrees', 'degrees'),
  ],
  degrees: [
    WAS('five associate degrees', 'layers'),
    T(': Statistics, Economics, Business Administration, Accounting, and Applied Math'),
  ],
  berkeley: [
    WAS('UC Berkeley', 'bear'),
    T(' as a transfer, majoring in Business Administration, Data Science, and Applied Math'),
  ],
  orders: [
    WAS('second and third order thinking', 'branch'),
    T(' in the world, so I made a program to help you with yours'),
  ],
  d3: [
    WAS('vitamin D3', 'sun'),
    T('. Right now '), B('bouldering'), I('mountain'),
    T(', '), B('pickleball'), I('paddle'),
    T(', and random endeavors with friends take the cake'),
  ],
  email: [
    WAS('email', 'mail'),
    T(': '),
    A('nikunjmore12@gmail.com', 'mailto:nikunjmore12@gmail.com'),
    T(' or '),
    A('nikunj.more@berkeley.edu', 'mailto:nikunj.more@berkeley.edu'),
  ],
};

/* ---------------- rendering ---------------- */

function renderSegs(segs) {
  const frag = document.createDocumentFragment();
  for (const s of segs) {
    if (s.kind === 't') {
      frag.appendChild(document.createTextNode(s.text));
    } else if (s.kind === 'b') {
      const b = document.createElement('strong');
      b.textContent = s.text;
      frag.appendChild(b);
    } else if (s.kind === 'i') {
      frag.appendChild(svgNode(s.name));
    } else if (s.kind === 'k') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tok';
      btn.dataset.k = s.id;
      btn.textContent = s.label;
      frag.appendChild(btn);
    } else if (s.kind === 'a') {
      const a = document.createElement('a');
      a.href = s.href;
      a.textContent = s.text;
      frag.appendChild(a);
    } else if (s.kind === 'was') {
      const sp = document.createElement('span');
      sp.className = 'was';
      sp.textContent = s.label;
      if (s.ic) sp.appendChild(svgNode(s.ic));
      frag.appendChild(sp);
    }
  }
  return frag;
}

function svgNode(name) {
  const tpl = document.createElement('template');
  tpl.innerHTML = icon(name);
  return tpl.content.firstChild;
}

/* ---------------- boot ---------------- */

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.classList.add(reduced ? 'reduced' : 'anim');

const engine = new DotEngine(document.getElementById('dots'), { reduced });

/* click counter (a personal odometer, Los Feliz style) */
const CKEY = 'nc.clicks';
let clicks = parseInt(localStorage.getItem(CKEY) || '0', 10) || 0;
const cnum = document.getElementById('cnum');
const cdot = document.getElementById('cdot');

function renderClicks() {
  cnum.textContent = formatClicks(clicks);
}

function bump() {
  clicks += 1;
  try { localStorage.setItem(CKEY, String(clicks)); } catch { /* private mode */ }
  renderClicks();
  cdot.classList.remove('ping');
  void cdot.offsetWidth; /* restart animation */
  cdot.classList.add('ping');
}

/* token expansion */
function wireTokens(scope) {
  for (const btn of scope.querySelectorAll('.tok:not([data-wired])')) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => expand(btn));
  }
}

function expand(btn) {
  const segs = EXP[btn.dataset.k];
  if (!segs) return;
  bump();
  const xp = document.createElement('span');
  xp.className = 'xp';
  xp.appendChild(renderSegs(segs));
  engine.prepare(xp);            /* wrap chars while still detached */
  btn.replaceWith(xp);
  wireTokens(xp);
  engine.assemble(xp, { perChar: 15 });
}

/* intro */
async function intro() {
  const blocks = [...document.querySelectorAll('[data-block]')];
  for (const b of blocks) engine.prepare(b);
  document.documentElement.classList.add('wrapped');
  wireTokens(document);
  renderClicks();

  const hdrs = [...document.querySelectorAll('.hdr')];
  const meta = document.getElementById('meta');

  if (reduced) {
    for (const b of blocks) engine.assemble(b); /* instant under reduced motion */
    hdrs.forEach((h) => h.classList.add('show'));
    meta.classList.add('show');
    return;
  }

  const seq = [];
  let t = 260;
  for (const b of blocks) {
    const isTitle = b.tagName === 'H1';
    seq.push(engine.assemble(b, { delay: t, perChar: isTitle ? 30 : 13 }));
    t += isTitle ? 520 : 230;
  }
  hdrs.forEach((h, i) => setTimeout(() => h.classList.add('show'), 420 + i * 230));
  setTimeout(() => meta.classList.add('show'), t + 300);

  const skip = () => {
    engine.finishAll();
    hdrs.forEach((h) => h.classList.add('show'));
    meta.classList.add('show');
  };
  addEventListener('pointerdown', skip, { once: true });
  await Promise.all(seq);
  removeEventListener('pointerdown', skip);
}

document.getElementById('replay').addEventListener('click', (e) => {
  e.preventDefault();
  location.reload();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', intro);
} else {
  intro();
}
