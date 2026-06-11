# Nikunj's Compendium

A one-page personal site where floating dots assemble the words.

**Live:** https://nikunjs-compendium.vercel.app

Black background, white text, grey boxes. The grey boxes are clickable: each
click expands the sentence in place (Los Feliz Engineering style), and every
new word is built out of the tiny dots drifting around the page (Moment
style). The layout stays calm and one-page (Rohan Sanjay style). A click
counter keeps score at the bottom.

## How it works

No frameworks, no build step, no dependencies. Five small ES modules served
as static files:

| File | Role |
| --- | --- |
| `index.html` | Base sentences as real, crawlable HTML. Tokens are `<button class="tok">` elements. |
| `styles.css` | The monotone system: blacks, greys, whites. Token, visited, reveal, and reduced-motion states. |
| `utils.js` | Pure logic: easing, seeded PRNG, stagger scheduling, stride budgeting, nearest-neighbor borrowing. Fully unit tested. |
| `particles.js` | The dot engine (see below). |
| `main.js` | The expansion tree, token wiring, click counter, intro orchestration. |
| `icons.js` | Hand-tuned 24x24 line icons (a few outlines adapted from Lucide, ISC license), `currentColor` strokes so they stay monotone. |

### The dot engine

One fixed full-viewport canvas runs two populations:

1. **Ambient dots.** A sparse field of roughly 1px dots (60 to 170 depending
   on viewport area) drifting slowly, twinkling, and easing away from the
   cursor. This is the Moment field: visible, never overwhelming.
2. **Flights.** When text needs to appear, every glyph is rasterized to an
   offscreen canvas and sampled into target points (sampling stride adapts so
   a whole paragraph stays under ~3,600 particles). Dots are borrowed from
   the ambient field, nearest first, topped up with dots spawned around the
   text, and each one flies to its point on a glyph with a cubic ease and a
   slight curve. Launches stagger left to right, so the line reads as being
   typed. As each character's dots land, the real DOM character fades in
   underneath and the dots dissolve; borrowed dots re-enter the field at the
   edges so the population stays constant.

Flight targets live in page coordinates and are drawn at `y - scrollY`, so
assemblies stay glued to their text if you scroll mid-animation.

### Content model

`main.js` holds an expansion tree. Clicking a token replaces it with its
expansion: the visited words remain (dimmed, with their icon) and the new
words assemble from dots. Expansions can contain new tokens, so the page
unfolds. Reloading (or the `replay` link in the footer) resets the prose;
the click counter persists in `localStorage` like a little odometer.

## Accessibility and performance

- All text is real DOM text: selectable, indexable, screen-reader friendly.
  The canvas is `aria-hidden` and `pointer-events: none`.
- Tokens are real `<button>`s: keyboard focusable, `:focus-visible` outlined.
- `prefers-reduced-motion`: no flights, instant text, becalmed dots.
- Any pointer press during the intro skips straight to the finished page.
- DPR is capped at 2; the loop pauses when the tab is hidden; particle
  budgets are enforced by `strideForBudget`.
- No JavaScript at all? A `<noscript>` block carries the full flattened text.

## Develop

```bash
npm test          # unit tests for the pure engine logic (node --test)
npx serve .       # or: python3 -m http.server
```

## Deploy

Static files, so any host works. For Vercel:

```bash
vercel deploy --prod
```

or import this repo at [vercel.com/new](https://vercel.com/new) (framework
preset: Other, no build command, output directory: root).

## Credits

- Interaction pattern inspired by [Los Feliz Engineering](https://losfeliz.engineering)
- Dot field inspired by Moment's landing page
- Calm one-page layout inspired by [rohansanjay.com](https://rohansanjay.com)
- A few icon outlines adapted from [Lucide](https://lucide.dev) (ISC)

MIT (c) 2026 Nikunj More
