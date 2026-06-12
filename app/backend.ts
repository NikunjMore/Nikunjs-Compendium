/*
 * backend.ts
 * The site is a pure static export; everything dynamic (Last.fm proxy,
 * Whoop OAuth + cache) lives in one Supabase Edge Function. Source:
 * supabase/functions/compendium/index.ts (deployed with real credentials;
 * the repo copy carries placeholders).
 */
export const FN_BASE =
  'https://ymzycrhupsjtkqcjpkmr.supabase.co/functions/v1/compendium';
