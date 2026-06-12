/*
 * lastfm.ts
 * Recent listens for the music tab. The browser asks our edge function,
 * which holds the API key, attaches per-track play counts
 * (track.getInfo userplaycount, cached server-side) and caches the lot
 * for 60 s. The raw Last.fm payload is normalized here through the
 * pure, unit-tested helpers in utils.js, then counts are merged in.
 */
import { normalizeRecent } from '../utils.js';
import { FN_BASE } from './backend';

export type Track = {
  artist: string;
  name: string;
  album: string;
  art: string;
  url: string;
  nowPlaying: boolean;
  playedAt: number | null;
  plays: number | null;
};

const CACHE_KEY = 'nc.music.v2';
const CACHE_MS = 55_000;

/* Last.fm art ships at 300px; its CDN serves the same hash at 600px. */
export function artLarge(url: string): string {
  return url ? url.replace(/\/\d+x\d+\//, '/600x600/') : url;
}

export const trackKey = (artist: string, name: string) =>
  `${artist} — ${name}`.toLowerCase();

export async function getRecentTracks(n = 20): Promise<Track[]> {
  try {
    const hit = sessionStorage.getItem(CACHE_KEY);
    if (hit) {
      const { at, tracks } = JSON.parse(hit);
      if (Date.now() - at < CACHE_MS && Array.isArray(tracks) && tracks.length) {
        return tracks as Track[];
      }
    }
  } catch { /* private mode */ }

  const res = await fetch(`${FN_BASE}/music`);
  if (!res.ok) throw new Error(`music feed: ${res.status}`);
  const json = await res.json();
  /* enriched shape { recent, counts }; tolerate the bare legacy payload */
  const recent = json.recent ?? json;
  const counts: Record<string, number> = json.counts ?? {};
  const tracks = (normalizeRecent(recent, n) as Omit<Track, 'plays'>[]).map((t) => ({
    ...t,
    plays: counts[trackKey(t.artist, t.name)] ?? null,
  }));
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), tracks }));
  } catch { /* private mode */ }
  return tracks;
}
