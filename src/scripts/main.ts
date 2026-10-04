/*
 * main.ts
 * Smooth scroll and one frame loop, set up the way wodniack.dev does it:
 * Lenis 1.1.13 with its defaults (lerp 0.1, mouse wheel and trackpad
 * smoothed, touch left native), stepped every animation frame, and the room
 * updated in the same frame. Reduced motion keeps native scrolling.
 */

import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { initRoom } from './room';
import { initReveal } from './reveal';
import { initName } from './name';
import { initHeat } from './heat';
import { initIntro } from './intro';

const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const intro = document.documentElement.classList.contains('intro');
const room = initRoom(calm, intro);
initReveal(calm);
initName(calm);
initHeat();
initIntro(room);

if (!calm) {
  const lenis = new Lenis();
  const frame = (t: number) => {
    lenis.raf(t);
    room.tick();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
