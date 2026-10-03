# nikunjmore.com

Nikunj More's personal site: one page in a 3D room, set in Geist.

- Content lives in `app/page.tsx` (the `WORK` and `PROJECTS` lists).
- Styles in `app/globals.css`; light and dark follow the system setting.
- `app/corridor.tsx` draws the room walls on a canvas (scroll + cursor perspective). `app/reveal.tsx` handles arrivals and count-ups.
- `npm run dev` to preview, `npm run build` for the static export in `out/`.
- Deploy: Vercel (Next.js preset). Pushes to `main` auto-deploy.

Version 10.x (the WebGL "Compendium" with music and Whoop tabs) is in git history.
