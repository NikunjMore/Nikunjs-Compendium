/*
 * icons.js
 * Inline SVG icon set. Hand-tuned 24x24 line icons (a few outlines adapted
 * from the open-source Lucide set, ISC license; the rest drawn for this site).
 * Monotone by design: stroke follows currentColor so icons match the text
 * around them, white on black, grey when a token has been visited.
 */

const P = {
  /* four-point spark (ambitious people) */
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  /* compass (navigating, TPM on the horizon) */
  compass: '<circle cx="12" cy="12" r="9"/><path d="M14.9 9.1l-1.8 5.5-5.5 1.8 1.8-5.5z"/>',
  /* lightbulb (The Insight Company of California) */
  bulb: '<path d="M12 3a6 6 0 0 1 3.6 10.8c-.7.5-1.1 1.3-1.1 2.2h-5c0-.9-.4-1.7-1.1-2.2A6 6 0 0 1 12 3z"/><path d="M9.5 19h5M10.5 21.5h3"/>',
  /* music note (Beli for Spotify) */
  music: '<path d="M9 18V6l10-2v11"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="15" r="2.5"/>',
  /* car (road trip app) */
  car: '<path d="M19 17h2v-4l-2.2-4.4A2 2 0 0 0 17 7.5H7a2 2 0 0 0-1.8 1.1L3 13v4h2"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/><path d="M9 17.5h6"/>',
  /* watch with pulse (fitness wearables) */
  watch: '<rect x="7" y="6.5" width="10" height="11" rx="3"/><path d="M9 6.5L9.6 3h4.8L15 6.5M9 17.5l.6 3.5h4.8l.6-3.5"/><path d="M9.5 12h1.4l1-1.6 1.4 3 1-1.4h1.2"/>',
  /* flask (three experiments) */
  flask: '<path d="M10 3h4M11 3v6.2L5.7 17.6A2 2 0 0 0 7.4 21h9.2a2 2 0 0 0 1.7-3.4L13 9.2V3"/><path d="M8.5 15h7"/>',
  /* mountain (bouldering) */
  mountain: '<path d="M3 20L9.5 8l3.9 6.6L16 11l5 9z"/>',
  /* two speech bubbles (the arguing agent) */
  chat: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 3V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-3h-6a2 2 0 0 1-2-2v-1"/>',
  /* bolt (bad-habit breaker, real time) */
  zap: '<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/>',
  /* graduation cap (De Anza) */
  cap: '<path d="M22 9L12 4 2 9l10 5 10-5z"/><path d="M6 11.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5"/><path d="M22 9v6"/>',
  /* a small bear (UC Berkeley) */
  bear: '<circle cx="12" cy="13.5" r="6.5"/><circle cx="6.5" cy="6.5" r="2.4"/><circle cx="17.5" cy="6.5" r="2.4"/><path d="M10 13h.01M14 13h.01"/><path d="M11 16.2c.6.5 1.4.5 2 0"/>',
  /* stacked layers (five associate degrees) */
  layers: '<path d="M12 2L2 7l10 5 10-5z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/>',
  /* branching paths (second and third order thinking) */
  branch: '<circle cx="4.5" cy="12" r="1.7"/><path d="M6.2 12h2.3c4 0 3-4.5 6.6-4.5M8.5 12c4 0 3 4.5 6.6 4.5"/><circle cx="17.5" cy="7.5" r="1.7"/><circle cx="17.5" cy="16.5" r="1.7"/><path d="M19.2 7.5h1.6M19.2 16.5h1.6"/>',
  /* sun (vitamin D3) */
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  /* paddle and ball (pickleball) */
  paddle: '<circle cx="11.5" cy="8" r="5.5"/><path d="M10.4 13.3L9.6 20h3.8l-.8-6.7"/><circle cx="19" cy="18" r="2"/>',
  /* soda can (Coke Zero) */
  can: '<path d="M8.5 6.5C8.5 4.8 9.6 3 12 3s3.5 1.8 3.5 3.5l-.5 12A2.5 2.5 0 0 1 12.5 21h-1a2.5 2.5 0 0 1-2.5-2.5z"/><path d="M9 8.5h6"/>',
  /* map pin (Bay Area) */
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  /* envelope (email) */
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/>',
  /* handshake-ish people (Arya) */
  people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M16 15.2c2.6.4 4.5 2.2 4.5 4.8"/>',
  /* arrow up-right (external links) */
  ext: '<path d="M7 17L17 7"/><path d="M8 7h9v9"/>',
  /* replay loop */
  replay: '<path d="M3 12a9 9 0 1 0 2.6-6.3L3 8"/><path d="M3 3v5h5"/>',
};

export const ICON_NAMES = Object.keys(P);

export function icon(name, cls = 'ic') {
  const body = P[name];
  if (!body) return '';
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
