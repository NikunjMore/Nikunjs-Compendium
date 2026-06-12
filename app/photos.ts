/*
 * photos.ts
 * The card stack's deck, top card first. To add photos: drop files into
 * public/photos/ and append their paths here — the stack picks them up,
 * the neutral card backs become real photos, and dragging the front card
 * away cycles to the next one. All cards share the portrait's 887:1200
 * frame (object-fit: cover).
 */
export const PHOTOS: string[] = [
  '/me.jpg',
  '/photos/bali-gate.jpg',
  '/photos/dinner-laugh.jpg',
];

/* height / width of the card frame (matches the original portrait) */
export const PHOTO_ASPECT = 1200 / 887;
