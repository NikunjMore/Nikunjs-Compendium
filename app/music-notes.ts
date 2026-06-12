/*
 * music-notes.ts
 * Your ratings + thoughts for the music tab, keyed by
 * `${artist} — ${name}` (lowercased; the em dash matters).
 *
 * HOW TO FILL THIS IN: replace any placeholder with e.g.
 *   { rating: 8.5, thoughts: 'the horns on this are unreal.' }
 * Tracks without a rating show a quiet unrated state on the site, so
 * leaving entries empty is always safe. New songs you listen to do not
 * need to be added here first — the feed is live from Last.fm; this file
 * only decorates whatever shows up.
 */

export type MusicNote = { rating?: number; thoughts?: string };

export const MUSIC_NOTES: Record<string, MusicNote> = {
  'tame impala — let it happen': {},
  'mr twin sister — meet the frownies': {},
  'gigi perez — sailor song': {},
  'a$ap mob, a$ap rocky, playboi carti, big sean — frat rules (feat. a$ap rocky, playboi carti & big sean)': {},
  'tame impala — one more hour': {},
  'freddie gibbs, madlib — uno': {},
  'abba — the winner takes it all': {},
  'tomoko aran — midnight pretenders': {},
  'michael jackson — chicago': {},
  'drake, black coffee, jorja smith — get it together': {},
  'jaÿ-z — 4:44': {},
  'sean kingston — beautiful girls': {},
  'berlioz — jazz is for ordinary people': {},
  'berlioz, ted jasper — nyc in 1940': {},
  'berlioz — open this wall': {},
  'berlioz — ode to rahsaan': {},
  'berlioz — wash my sins away': {},
  'djo — end of beginning': {},
  'fakemink — blow me': {},
  'bruno mars, anderson .paak, silk sonic — leave the door open': {},
};

/* Look up a note for a track; tolerant of casing. */
export function noteFor(artist: string, name: string): MusicNote {
  return MUSIC_NOTES[`${artist} — ${name}`.toLowerCase()] ?? {};
}
