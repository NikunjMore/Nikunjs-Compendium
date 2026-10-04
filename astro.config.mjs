import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// The page is rendered on Vercel and cached like a static file. Once an hour
// the next visit triggers a fresh render in the background, which re-reads
// the GitHub contribution calendar.
export default defineConfig({
  site: 'https://www.nikunjmore.com',
  adapter: vercel({ isr: { expiration: 60 * 60 } }),
  // Astro's toolbar only ever shows in `npm run dev`, never on the live site;
  // it's off so the local preview matches what visitors see.
  devToolbar: { enabled: false },
});
