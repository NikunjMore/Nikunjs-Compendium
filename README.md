# nikunjmore.com

Nikunj More's personal site: one page in a 3D room, set in Geist and Libron. Built with Astro, deployed on Vercel.

- Content and markup: `src/pages/index.astro`.
- Styles: `src/styles/global.css`. Black and white, except the milestone days in the heatmap; light and dark follow the system setting.
- `src/scripts/room.ts` draws the room around the box and drifts the box through it as you scroll. The geometry and timing follow the About section of [wodniack.dev](https://wodniack.dev/): 12 lines per surface (8 on phones), 3 rings of depth, a ±400px drift (±200px on phones), eased 20% per frame.
- `src/scripts/name.ts` rolls letters of the name up, down, left or right into other Geist faces and back, after the hero title on wodniack.dev. The face list is the `FONTS` array at the top (each needs an `@font-face` in `global.css`).
- `src/scripts/intro.ts` plays the intro on every load (about 2s): the strips draw out, the name spins in like slot-machine reels, the box rises, and the room's lines shoot out of it. Skipped for reduced motion; an inline script in `<head>` releases the page after 4s no matter what.
- `src/lib/github.ts` reads the public GitHub contribution calendar (github.com/users/NikunjMore/contributions, no token) for the heatmap section. `src/scripts/heat.ts` names the hovered day. The heatmap's start date, colored milestone days (`events`, `kinds`), the April bracket (`stretch`) and the Claude Code note (`discovered`) are set at the top of `src/pages/index.astro`.
- `src/scripts/main.ts` runs smooth scrolling (Lenis 1.1.13, default settings) and the frame loop. `src/scripts/reveal.ts` handles arrivals and count-ups.
- Type: the name is set in Geist (vercel.com/font), all other text in Libron (github.com/nicoverbruggen/libron, a serif for reading), and small uppercase labels in Geist Mono. All self-hosted in `public/fonts` (SIL Open Font License; license texts alongside). The letters that roll in the name use the rest of the Geist family: the five Geist Pixel shapes, Geist Mono at its heaviest, and Geist at its thinnest; those load after the page does.
- Icons in "Where to find me" are from Lucide (ISC License).

## Running it

- `npm run dev` to preview at http://localhost:4321 (it fetches the GitHub calendar on every load).
- `npm run build` builds for Vercel into `.vercel/output`.

## Deploying

Vercel. `vercel.json` sets the Astro preset; pushes to `main` deploy to the domain. The page is rendered by a Vercel function and cached with incremental static regeneration: visitors get the cached copy, and once it's an hour old the next visit triggers a fresh render in the background, so the heatmap is never more than about an hour behind GitHub. If GitHub doesn't answer, the section falls back to a link to the profile.

Versions 12.x (Next.js) and 10.x (the WebGL "Compendium" with music and Whoop tabs) are in git history.
