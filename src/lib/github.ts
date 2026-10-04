/*
 * github.ts
 * Reads a user's public contribution calendar from GitHub: the same page
 * that draws the heatmap on their profile. No token needed. Runs on the
 * server only (GitHub doesn't let browsers on other sites read it).
 */

export type Day = { date: string; level: number; count: number };
export type Calendar = { total: number; weeks: Day[][] };

export async function contributions(user: string): Promise<Calendar | null> {
  try {
    const res = await fetch(`https://github.com/users/${user}/contributions`, {
      headers: { 'User-Agent': 'nikunjmore.com' },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? parseCalendar(await res.text()) : null;
  } catch {
    return null;
  }
}

const num = (s: string) => Number(s.replace(/,/g, ''));

export function parseCalendar(html: string): Calendar | null {
  // Day counts live in tooltips ("7 contributions on May 3rd."), tied to cells by id.
  const counts = new Map<string, number>();
  for (const m of html.matchAll(/<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const n = m[2].trim().match(/^([\d,]+) contributions?/);
    counts.set(m[1], n ? num(n[1]) : 0);
  }

  const days: Day[] = [];
  for (const m of html.matchAll(/<td\b[^>]*\bdata-date="(\d{4}-\d{2}-\d{2})"[^>]*>/g)) {
    const id = m[0].match(/\bid="([^"]+)"/)?.[1] ?? '';
    const level = Number(m[0].match(/\bdata-level="(\d)"/)?.[1] ?? 0);
    days.push({ date: m[1], level, count: counts.get(id) ?? 0 });
  }
  if (!days.length) return null;

  // The table runs a row per weekday; regroup into weeks that start on Sunday.
  days.sort((a, b) => a.date.localeCompare(b.date));
  const weeks: Day[][] = [];
  for (const d of days) {
    if (!weeks.length || new Date(`${d.date}T00:00:00Z`).getUTCDay() === 0) weeks.push([]);
    weeks[weeks.length - 1].push(d);
  }

  const stated = html.match(/([\d,]+)\s+contributions?\s+in the last year/);
  const total = stated ? num(stated[1]) : days.reduce((sum, d) => sum + d.count, 0);
  return { total, weeks };
}
