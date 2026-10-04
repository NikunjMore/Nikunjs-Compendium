/*
 * name.ts
 * Letters in the name roll out of their slot and another cut of Geist rolls
 * in, after the hero title on wodniack.dev. About every 1.7s one letter
 * slides up, down, left or right over 1s; the same letter in another face
 * slides in behind it. A few seconds later it rolls back. Hovering a letter
 * rolls it right away.
 *
 * The Geist letter stays in the layout the whole time (hidden while another
 * face shows), so the name never reflows. Other faces are scaled to Geist's
 * cap height and to the slot's width, and sit on Geist's baseline.
 */

import { introRunning } from './intro';

type Font = { family: string; weight: number };

// The rest of the Geist family (vercel.com/font): the five Geist Pixel
// shapes, Geist Mono at its heaviest, and Geist at its thinnest. All
// self-hosted in public/fonts and declared in global.css.
const FONTS: Font[] = [
  { family: 'Geist Pixel Square', weight: 400 },
  { family: 'Geist Pixel Grid', weight: 400 },
  { family: 'Geist Pixel Circle', weight: 400 },
  { family: 'Geist Pixel Triangle', weight: 400 },
  { family: 'Geist Pixel Line', weight: 400 },
  { family: 'Geist Mono', weight: 900 },
  { family: 'Geist', weight: 100 },
];

const EVERY = 1667;                            // mean ms between rolls (1% a frame at 60fps)
const ROLL = 1000;                             // ms per roll
const EASE = 'cubic-bezier(0.86, 0, 0.07, 1)';
const HOLD: [number, number] = [1800, 3200];   // ms before a letter rolls back to Geist
const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;

type Slot = {
  el: HTMLElement;
  base: HTMLElement;          // the Geist letter; always in the layout
  face: HTMLElement | null;   // the display letter on show, if any
  letter: string;
  font: Font | null;
  busy: boolean;
  timer: number;
};

const css = (f: Font, px: number) => `${f.weight} ${px}px "${f.family}"`;
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

export function initName(calm: boolean) {
  const name = document.querySelector<HTMLElement>('.name');
  if (calm || !name) return;

  const slots: Slot[] = [...name.querySelectorAll<HTMLElement>('.ltr')].map((el) => ({
    el,
    base: el.querySelector<HTMLElement>('.base')!,
    face: null,
    letter: el.textContent!.trim().toUpperCase(),
    font: null,
    busy: false,
    timer: 0,
  }));
  const text = [...new Set(slots.map((s) => s.letter))].join('');

  const ctx = document.createElement('canvas').getContext('2d')!;
  const capOf = (font: string) => {
    ctx.font = font;
    return ctx.measureText(text).actualBoundingBoxAscent;
  };
  const widthOf = (font: string, letter: string) => {
    ctx.font = font;
    return ctx.measureText(letter).width;
  };

  // `scale` brings a font's capitals to the height of Geist's.
  type Loaded = Font & { scale: number };
  let fonts: Loaded[] = [];
  let visible = true;
  new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; }).observe(name);

  // Size a display letter: Geist's cap height, shrunk if it would spill past the slot.
  const sizeFor = (slot: Slot, f: Loaded) => {
    const px = parseFloat(getComputedStyle(slot.el).fontSize);
    const w = (widthOf(css(f, 100), slot.letter) / 100) * f.scale * px;
    const room = slot.el.offsetWidth;
    return { em: f.scale * Math.min(1, room / w), fits: room / w >= 0.75 };
  };

  const fontFor = (slot: Slot) => {
    const fitting = fonts.filter((f) => sizeFor(slot, f).fits);
    return pick(fitting.length ? fitting : fonts);
  };

  const faceFor = (slot: Slot, f: Loaded) => {
    const face = document.createElement('span');
    face.className = 'face';
    const g = document.createElement('span');
    g.textContent = slot.letter;
    g.style.fontFamily = `"${f.family}"`;
    g.style.fontWeight = String(f.weight);
    g.style.fontSize = `${sizeFor(slot, f).em}em`;
    face.append(g);
    slot.el.append(face);
    return face;
  };

  // Roll a slot to `to` (a display font, or null for Geist).
  const roll = (slot: Slot, to: Loaded | null) => {
    if (slot.busy || introRunning() || (to === null && slot.font === null)) return;
    clearTimeout(slot.timer);
    slot.busy = true;
    slot.el.classList.add('rolling');

    const [dx, dy] = pick(DIRS);
    const away = `translate(${dx * 100}%, ${dy * 100}%)`;
    const from = `translate(${-dx * 100}%, ${-dy * 100}%)`;
    const out = slot.face ?? slot.base;
    const inn = to ? faceFor(slot, to) : slot.base;
    if (inn === slot.base) slot.base.style.visibility = '';

    const opts: KeyframeAnimationOptions = { duration: ROLL, easing: EASE, fill: 'forwards' };
    const a = out.animate([{ transform: 'none' }, { transform: away }], opts);
    const b = inn.animate([{ transform: from }, { transform: 'none' }], opts);

    a.finished.then(() => {
      if (out === slot.base) slot.base.style.visibility = 'hidden';
      else out.remove();
      a.cancel();
      b.cancel();
      slot.face = to ? inn : null;
      slot.font = to;
      slot.busy = false;
      slot.el.classList.remove('rolling');
      if (to) {
        const hold = HOLD[0] + Math.random() * (HOLD[1] - HOLD[0]);
        slot.timer = window.setTimeout(() => roll(slot, null), hold);
      }
    });
  };

  const next = () => {
    window.setTimeout(next, -Math.log(1 - Math.random()) * EVERY);
    if (!visible || document.hidden) return;
    const idle = slots.filter((s) => !s.busy && s.font === null);
    if (idle.length) {
      const slot = pick(idle);
      roll(slot, fontFor(slot));
    }
  };

  const start = async () => {
    // load() fetches each face and resolves with what it loaded: empty means
    // the font never arrived (then it's left out; with none, no rolling).
    const ok = await Promise.all(
      FONTS.map((f) => document.fonts.load(css(f, 100), text).then((got) => got.length > 0, () => false)),
    );
    await document.fonts.load('800 100px Geist', text);
    const geist = capOf('800 100px Geist');
    fonts = FONTS.filter((_, i) => ok[i]).map((f) => ({ ...f, scale: geist / capOf(css(f, 100)) }));
    if (!fonts.length) return;

    slots.forEach((slot) => {
      slot.el.addEventListener('pointerenter', () => {
        roll(slot, slot.font ? null : fontFor(slot));
      });
    });
    next();
  };

  // The other faces are extras: fetch them once the page has finished loading.
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', () => start(), { once: true });
}
