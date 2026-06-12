/*
 * lastfm.ts
 * Recent listens for the music tab. The browser asks our edge function
 * (which holds the API key and caches for 60 s); the raw Last.fm payload
 * is normalized here through the pure, unit-tested helpers in utils.js.
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
};

const CACHE_KEY = 'nc.music.v1';
const CACHE_MS = 90_000;

/* Last.fm art ships at 300px; its CDN serves the same hash at 600px. */
export function artLarge(url: string): string {
  return url ? url.replace(/\/\d+x\d+\//, '/600x600/') : url;
}

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
  const tracks = normalizeRecent(json, n) as Track[];
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), tracks }));
  } catch { /* private mode */ }
  return tracks;
}
