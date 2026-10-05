/*
 * intro.ts
 * The room builds itself, in about two seconds:
 *   1. the ruled strips above and below the name draw out from the centre,
 *   2. each letter of the name spins like a slot-machine reel through random
 *      letters and lands, left to right; the dot pops in between the words,
 *   3. the box rises into place,
 *   4. the room's lines shoot out of the box to the walls.
 *
 * An inline script in <head> adds `intro` to <html> before the first paint
 * (unless the visitor prefers reduced motion), which holds all of this
 * hidden. Here the animations take over and drop that class. If this script
 * never runs, the inline script drops it after 4s, so the page always shows.
 */

import type { Room } from './room';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const WIPE = 'cubic-bezier(0.7, 0, 0.2, 1)';
const REEL = 'cubic-bezier(0.16, 0.84, 0.24, 1)';   // fast spin, long slow stop
const GLIDE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const POP = 'cubic-bezier(0.34, 1.7, 0.5, 1)';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const introRunning = () => document.documentElement.classList.contains('intro-on');

// Spin one letter slot: a strip of random letters, Geist and Geist Mono mixed,
// ending on the real letter, slid up through the slot.
function spin(slot: HTMLElement, i: number, delay: number) {
  const base = slot.querySelector<HTMLElement>('.base');
  if (!base) return 0;
  const target = base.textContent!.trim().toUpperCase();
  const turns = 8 + i;
  const reel = document.createElement('span');
  reel.className = 'reel';
  for (let k = 0; k <= turns; k++) {
    const face = document.createElement('span');
    let ch = target;
    if (k < turns) do ch = LETTERS[Math.floor(Math.random() * LETTERS.length)]; while (ch === target);
    face.textContent = ch;
    face.style.top = `${k * 100}%`;
    if (k < turns && k % 3 === 1) face.className = 'mono';
    reel.append(face);
  }
  base.style.visibility = 'hidden';
  slot.classList.add('rolling');
  slot.append(reel);

  const ms = 900 + i * 85;
  reel
    .animate([{ transform: 'translateY(0)' }, { transform: `translateY(-${turns * 100}%)` }], {
      duration: ms,
      delay,
      easing: REEL,
      fill: 'backwards',
    })
    .finished.then(() => {
      reel.remove();
      base.style.visibility = '';
      slot.classList.remove('rolling');
    });
  return delay + ms;
}

export async function initIntro(room: Room) {
  const html = document.documentElement;
  if (!html.classList.contains('intro')) return;

  // Wait for the name's font and Geist Mono (preloaded, so usually instant),
  // but never long.
  const cs = getComputedStyle(document.querySelector('.name') ?? html);
  await Promise.race([
    Promise.all([document.fonts.load(`${cs.fontWeight} 100px ${cs.fontFamily}`), document.fonts.load('700 100px "Geist Mono"')]),
    wait(900),
  ]);
  // Too late: the inline script's safety timer already showed the page.
  if (!html.classList.contains('intro')) return room.grow(1);

  html.classList.add('intro-on');
  let end = 0;   // ms until the last animation lands
  const until = (ms: number) => { end = Math.max(end, ms); };

  // 1. Strips draw out from the centre.
  document.querySelectorAll<HTMLElement>('.top .strip').forEach((strip, i) => {
    const delay = i * 140;
    strip.animate([{ clipPath: 'inset(0 50%)' }, { clipPath: 'inset(0 0%)' }], {
      duration: 900, delay, easing: WIPE, fill: 'backwards',
    });
    until(delay + 900);
  });

  // 2. The name spins in, left to right; the dot pops in at the gap.
  document.querySelectorAll<HTMLElement>('.name .ltr').forEach((slot, i) => {
    until(spin(slot, i, 120));
  });
  const dot = document.querySelector<HTMLElement>('.name .dot');
  dot?.animate([{ scale: '0' }, { scale: '1' }], { duration: 600, delay: 760, easing: POP, fill: 'backwards' });
  until(1360);

  // 3. The box rises into the room (the `translate` property, so the scroll
  //    drift on `transform` keeps working underneath).
  const box = document.getElementById('box');
  box?.animate([{ opacity: 0, translate: '0 90px' }, { opacity: 1, translate: '0 0' }], {
    duration: 1000, delay: 650, easing: GLIDE, fill: 'backwards',
  });
  until(1650);

  // Everything is in hand: drop the holding class.
  html.classList.remove('intro');

  // 4. The lines shoot out of the box once it has nearly landed.
  await wait(1050);
  room.grow(1000);
  until(2050);

  await wait(end - 1050);
  html.classList.remove('intro-on');
}
