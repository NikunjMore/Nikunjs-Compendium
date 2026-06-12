# Wiring up Whoop (one-time, ~2 minutes)

The activity tab reads from the `compendium` edge function on the
`nikunjs-compendium-api` Supabase project. Music already works; Whoop
needs you to do two things it cannot do for itself:

## 1. Register the redirect URI

In the [Whoop developer dashboard](https://developer-dashboard.whoop.com),
open your app ("Personal Website") and add this exact Redirect URL:

```
https://ymzycrhupsjtkqcjpkmr.supabase.co/functions/v1/compendium/callback
```

Make sure these scopes are enabled for the app: `read:recovery`,
`read:cycles`, `read:sleep`, `read:workout`, `read:profile`, `offline`.

## 2. Authorize once

Visit:

```
https://ymzycrhupsjtkqcjpkmr.supabase.co/functions/v1/compendium/login
```

Log in with your Whoop account and approve. You'll land on a
"WHOOP connected" page; the activity tab on the site goes live on its
next load. (The same link is shown inside the activity tab until this
is done.)

## How it stays alive

Whoop rotates the refresh token on every refresh. The edge function
persists each new pair in the RLS-locked `whoop_tokens` table before the
old one dies, refreshes ~2 minutes before expiry, caches the composed
summary for 15 minutes in `kv`, and serves stale data rather than
nothing if Whoop ever hiccups. No cron, no env vars on Vercel, nothing
to babysit.

If you ever revoke access in Whoop, just visit `/login` again.
