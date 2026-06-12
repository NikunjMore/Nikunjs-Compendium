/*
 * compendium — the static site's one tiny backend (Supabase Edge Function).
 *
 *   GET …/compendium/music     Last.fm recent tracks (API key lives here,
 *                              never in the browser bundle), cached 60 s.
 *   GET …/compendium/health    Whoop recovery/sleep/strain summary,
 *                              cached 15 min; refreshes + rotates the
 *                              OAuth tokens stored in Postgres.
 *   GET …/compendium/login     One-time OAuth kickoff (Nikunj only).
 *   GET …/compendium/callback  OAuth redirect target; persists tokens.
 *
 * THIS REPO COPY IS SANITIZED: the deployed function carries the real
 * client credentials inline. If you redeploy, paste them back in (Whoop
 * dev dashboard + Last.fm API account) or wire Deno.env secrets.
 *
 * Deployed with verify_jwt = false on purpose: /callback must accept
 * Whoop's bare redirect, and the site reads /music + /health without
 * keys. Nothing here mutates without the service role, the tables are
 * RLS-locked, and the data returned is exactly what the site displays.
 */

const WHOOP_CLIENT_ID = Deno.env.get('WHOOP_CLIENT_ID') ?? '<whoop-client-id>';
const WHOOP_CLIENT_SECRET = Deno.env.get('WHOOP_CLIENT_SECRET') ?? '<whoop-client-secret>';
const LASTFM_KEY = Deno.env.get('LASTFM_KEY') ?? '<lastfm-api-key>';
const LASTFM_USER = 'NikunjMore';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const WHOOP_AUTH = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_TOKEN = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_API = 'https://api.prod.whoop.com/developer/v2';
const SCOPES = 'read:recovery read:cycles read:sleep read:workout read:profile offline';
const REDIRECT_URI = `${SB_URL}/functions/v1/compendium/callback`;

const HEALTH_TTL = 15 * 60 * 1000;
const MUSIC_TTL = 60 * 1000;
const COUNTS_TTL = 15 * 60 * 1000;

const CORS: HeadersInit = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  });

const page = (msg: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>Nikunj&rsquo;s Compendium</title>` +
    `<body style="background:#050505;color:#f2f2f2;font:15px/1.7 ui-monospace,Menlo,monospace;` +
    `display:grid;place-items:center;height:100vh;margin:0">` +
    `<div style="max-width:480px;text-align:center;padding:0 20px">${msg}</div>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );

/* ---------------- PostgREST (service role) ---------------- */

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!r.ok) throw new Error(`db ${path}: ${r.status} ${await r.text()}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

const kvGet = async (key: string) =>
  (await db(`kv?key=eq.${encodeURIComponent(key)}&select=payload,updated_at`))?.[0] ?? null;

const kvSet = (key: string, payload: unknown) =>
  db('kv', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, payload, updated_at: new Date().toISOString() }),
  });

const kvDel = (key: string) =>
  db(`kv?key=eq.${encodeURIComponent(key)}`, { method: 'DELETE' });

const tokensGet = async () => (await db('whoop_tokens?id=eq.1&select=*'))?.[0] ?? null;

const tokensSet = (t: { access_token: string; refresh_token: string; expires_in: number }) =>
  db('whoop_tokens', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      id: 1,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: new Date(Date.now() + Math.max(60, (t.expires_in ?? 3600) - 60) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });

/* ---------------- Whoop ---------------- */

async function tokenRequest(params: Record<string, string>) {
  const r = await fetch(WHOOP_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: WHOOP_CLIENT_ID,
      client_secret: WHOOP_CLIENT_SECRET,
      ...params,
    }),
  });
  if (!r.ok) throw new Error(`token: ${r.status} ${await r.text()}`);
  return r.json();
}

async function whoopGet(path: string, access: string) {
  const r = await fetch(`${WHOOP_API}${path}`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (!r.ok) throw new Error(`whoop ${path}: ${r.status}`);
  return r.json();
}

/*
 * Whoop rotates the refresh token on every refresh: the new pair must be
 * persisted before the old one is gone. If two invocations race, the
 * loser re-reads the row the winner just wrote.
 */
async function freshAccess(): Promise<string | null> {
  const tok = await tokensGet();
  if (!tok) return null;
  if (new Date(tok.expires_at).getTime() - Date.now() > 120_000) return tok.access_token;
  try {
    const t = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: tok.refresh_token,
      scope: 'offline',
    });
    await tokensSet(t);
    return t.access_token;
  } catch {
    const t2 = await tokensGet();
    if (t2 && t2.refresh_token !== tok.refresh_token) {
      if (new Date(t2.expires_at).getTime() > Date.now()) return t2.access_token;
      try {
        const t3 = await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: t2.refresh_token,
          scope: 'offline',
        });
        await tokensSet(t3);
        return t3.access_token;
      } catch { return null; }
    }
    return null;
  }
}

/* deno-lint-ignore-file no-explicit-any */
function asleepMs(s: any): number | null {
  const st = s?.score?.stage_summary;
  if (!st) return null;
  return Math.max(0, (st.total_in_bed_time_milli ?? 0) - (st.total_awake_time_milli ?? 0));
}

function composeHealth(rec: any, cyc: any, slp: any) {
  const r0 = rec?.records?.[0] ?? null;
  const c0 = cyc?.records?.[0] ?? null;
  const s0 = slp?.records?.[0] ?? null;
  const recByCycle = new Map<unknown, any>();
  for (const r of rec?.records ?? []) recByCycle.set(r.cycle_id, r);
  const slpById = new Map<unknown, any>();
  for (const s of slp?.records ?? []) slpById.set(s.id, s);
  const week = (cyc?.records ?? []).slice(0, 7).map((c: any) => {
    const r = recByCycle.get(c.id);
    const s = r ? slpById.get(r.sleep_id) : null;
    return {
      date: String(c.start ?? '').slice(0, 10),
      recovery: r?.score?.recovery_score ?? null,
      strain: c?.score?.strain ?? null,
      sleepMs: s ? asleepMs(s) : null,
    };
  });
  return {
    connected: true as const,
    fetchedAt: new Date().toISOString(),
    recovery: {
      score: r0?.score?.recovery_score ?? null,
      hrv: r0?.score?.hrv_rmssd_milli ?? null,
      rhr: r0?.score?.resting_heart_rate ?? null,
    },
    sleep: { durMs: asleepMs(s0), perf: s0?.score?.sleep_performance_percentage ?? null },
    strain: { day: c0?.score?.strain ?? null },
    week,
  };
}

/* ---------------- Last.fm ---------------- */

async function lastfm(params: Record<string, string>) {
  const u = new URL('https://ws.audioscrobbler.com/2.0/');
  u.searchParams.set('api_key', LASTFM_KEY);
  u.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u);
  if (!r.ok) throw new Error(`lastfm ${params.method}: ${r.status}`);
  return r.json();
}

/* The 25 most recent distinct artist+name pairs from a recenttracks payload. */
function uniqueKeys(recent: any, n = 25): { key: string; artist: string; name: string }[] {
  let list = recent?.recenttracks?.track ?? [];
  if (!Array.isArray(list)) list = [list];
  const seen = new Set<string>();
  const out: { key: string; artist: string; name: string }[] = [];
  for (const t of list) {
    const artist = t?.artist?.name ?? t?.artist?.['#text'] ?? '';
    const name = t?.name ?? '';
    if (!artist || !name) continue;
    const key = `${artist} — ${name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, artist, name });
    if (out.length >= n) break;
  }
  return out;
}

/* ---------------- routes ---------------- */

/*
 * /music returns { recent, counts }: the raw recenttracks payload plus a
 * map of `${artist} — ${name}` (lowercased) -> total user play count.
 * Counts come from track.getInfo (userplaycount), cached per track for
 * 15 minutes in kv('counts') so a refresh costs at most a few calls.
 */
async function music(): Promise<Response> {
  const cache = await kvGet('music');
  if (cache?.payload?.recent && Date.now() - new Date(cache.updated_at).getTime() < MUSIC_TTL) {
    return json(cache.payload, 200, { 'Cache-Control': 'public, max-age=30' });
  }
  let recent: any;
  try {
    recent = await lastfm({
      method: 'user.getrecenttracks', user: LASTFM_USER, limit: '60', extended: '1',
    });
  } catch {
    if (cache?.payload) return json(cache.payload); /* stale beats nothing */
    return json({ error: 'lastfm_unreachable' }, 502);
  }
  const wanted = uniqueKeys(recent, 25);
  const store = (await kvGet('counts'))?.payload ?? {};
  const now = Date.now();
  const missing = wanted.filter((w) => !store[w.key] || now - store[w.key].at > COUNTS_TTL);
  for (let i = 0; i < missing.length; i += 10) {
    await Promise.all(missing.slice(i, i + 10).map(async (w) => {
      try {
        const info = await lastfm({
          method: 'track.getInfo', artist: w.artist, track: w.name,
          username: LASTFM_USER, autocorrect: '1',
        });
        const c = parseInt(info?.track?.userplaycount ?? '', 10);
        if (Number.isFinite(c)) store[w.key] = { c, at: now };
      } catch { /* count stays unknown for this track */ }
    }));
  }
  await kvSet('counts', store);
  const counts: Record<string, number> = {};
  for (const w of wanted) if (store[w.key]) counts[w.key] = store[w.key].c;
  const payload = { recent, counts };
  await kvSet('music', payload);
  return json(payload, 200, { 'Cache-Control': 'public, max-age=30' });
}

async function health(): Promise<Response> {
  const cache = await kvGet('health');
  if (
    cache?.payload?.connected &&
    Date.now() - new Date(cache.updated_at).getTime() < HEALTH_TTL
  ) {
    return json(cache.payload);
  }
  const access = await freshAccess();
  if (!access) return json({ connected: false });
  try {
    const [rec, cyc, slp] = await Promise.all([
      whoopGet('/recovery?limit=8', access),
      whoopGet('/cycle?limit=8', access),
      whoopGet('/activity/sleep?limit=10', access),
    ]);
    const payload = composeHealth(rec, cyc, slp);
    await kvSet('health', payload);
    return json(payload);
  } catch (e) {
    if (cache?.payload?.connected) return json(cache.payload);
    return json({ connected: false, error: String(e) });
  }
}

async function login(): Promise<Response> {
  /* Whoop wants exactly eight characters of state */
  const state = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
  await kvSet('oauth_state', { state, at: Date.now() });
  const u = new URL(WHOOP_AUTH);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', WHOOP_CLIENT_ID);
  u.searchParams.set('redirect_uri', REDIRECT_URI);
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('state', state);
  return new Response(null, { status: 302, headers: { Location: u.toString(), ...CORS } });
}

async function callback(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const err = q.get('error');
  if (err) return page(`Whoop said no: ${err} — ${q.get('error_description') ?? ''}`);
  const code = q.get('code') ?? '';
  const state = q.get('state') ?? '';
  const want = await kvGet('oauth_state');
  const fresh = want?.payload?.at && Date.now() - want.payload.at < 10 * 60 * 1000;
  if (!code || !fresh || want.payload.state !== state) {
    return page('State check failed — start over from /login.');
  }
  const t = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });
  await tokensSet(t);
  await kvDel('oauth_state');
  await kvDel('health'); /* rebuild with real data on the next read */
  return page('WHOOP connected ✓ You can close this tab — the activity tab is live.');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  try {
    if (path.endsWith('/music')) return await music();
    if (path.endsWith('/health')) return await health();
    if (path.endsWith('/login')) return await login();
    if (path.endsWith('/callback')) return await callback(req);
    return json({ ok: true, endpoints: ['/music', '/health', '/login', '/callback'] });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
