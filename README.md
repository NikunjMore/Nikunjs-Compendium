# Nikunj's Compendium

A one-page personal site where a WebGL field of dots assembles the words.

**Live:** https://nikunjs-compendium.vercel.app

Black background, white text, grey boxes. The grey boxes are clickable: each
click expands the sentence in place (Los Feliz Engineering style), and every
new word is built by the dots drifting around the page (Moment style). The
layout stays calm and one-page (Rohan Sanjay style). A click counter keeps
score in the footer.

## Stack

Next.js 15 (App Router, static export) + React 19 + Three.js. TypeScript
throughout, with the pure animation math in a plain ES module so `node --test`
can hit it with zero tooling.

| File | Role |
| --- | --- |
| `app/engine.ts` | The WebGL dot engine (see below). |
| `app/compendium.tsx` | The page: prose, intro orchestration, click counter. |
| `app/content.tsx` | `<T>` char-span text primitive, tokens, the expansion tree. |
| `app/icons.tsx` | Hand-tuned 24x24 line icons (a few adapted from Lucide, ISC). |
| `app/globals.css` | The monotone system: token, visited, reveal, reduced-motion states. |
| `utils.js` | Pure logic: curl noise, springs, scheduling, budgets. Unit tested. |
| `utils.test.mjs` | 16 tests, `npm test`. |

## The dot engine

One persistent pool of 2,500 to 16,000 GPU-rendered points (sized to the
viewport), drawn as soft additive sprites by a tiny shader, plus a separate
~400k-dot portrait layer. Free dots ride a diagonal ocean swell (waveField:
orbital wave motion, crest sparkle) layered with curl-noise eddies, four
drifting vortices, and a cursor whirlpool (radial push + tangential spin).
The portrait churns calmly in tonal waves (dots of similar brightness trade
places), hands its cells to the engine so expanding words visibly launch out
of the photo, and every few seconds spells a word with its own pixels; taken
cells always refill in under 20 s. Two core behaviors:

1. **Flow.** Free dots drift through a curl-noise field: the velocity is the
   curl of a value-noise potential, which makes it divergence-free, so the
   motion reads as fluid eddies rather than random wander. Dots twinkle on
   individual phases, and the cursor stirs the field with a velocity-aware
   push.

2. **Assembly.** When text needs to appear, each glyph is rasterized
   offscreen and sampled into target points (the sampling stride adapts to
   keep an assembly under ~9,000 dots and never drain the field). Free dots
   are claimed nearest-first, then seek their targets with damped springs
   whose stiffness ramps in over the dot's stagger window, slightly
   under-damped for a fluid catch. Launches run left to right, so each line
   reads as being typed by the field. When ~72% of a character's dots have
   settled, the real DOM character fades in underneath; its dots linger
   130ms, puff outward, and rejoin the flow. The population is constant.
   Nothing pops in or out.

Targets live in page coordinates and are re-projected against `scrollY`
every frame, so assemblies stay glued to their text while scrolling.

## Content model

The base sentences are server-rendered (full prose ships in the HTML, so
crawlers and no-JS readers get everything). Tokens are real `<button>`s.
Clicking one swaps it for its expansion via React state: the visited words
remain, dimmed with their icon, and the new words assemble from dots.
Expansions contain new tokens, so the page unfolds. `replay` in the footer
re-runs the intro; the click counter persists in `localStorage`.

## Accessibility and performance

- All text is real DOM text. The canvas is `aria-hidden`, `pointer-events: none`.
- Tokens carry pinned `aria-label`s (char-span wrapping fragments text nodes).
- `prefers-reduced-motion` (or no WebGL): instant text, becalmed field.
- Any pointer press during the intro skips to the finished page.
- Device pixel ratio capped at 2; the loop pauses when the tab is hidden;
  budgets enforced by `strideForBudget` and the free-dot count.

## Develop

```bash
npm install
npm test         # 16 unit tests on the pure engine math
npm run dev      # next dev
npm run build    # type-check + static export to out/
```

## Deploy

Vercel with the Next.js preset; `output: 'export'` produces a fully static
site. Pushes to `main` auto-deploy via the GitHub integration.

## Credits

- Interaction pattern inspired by [Los Feliz Engineering](https://losfeliz.engineering)
- Dot field inspired by Moment's landing page
- Calm one-page layout inspired by [rohansanjay.com](https://rohansanjay.com)
- A few icon outlines adapted from [Lucide](https://lucide.dev) (ISC)

MIT (c) 2026 Nikunj More
