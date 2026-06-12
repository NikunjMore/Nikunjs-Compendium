'use client';

/*
 * activitytab.tsx
 * The Whoop tab: recovery, sleep and strain pulled from the edge function
 * (which owns the OAuth tokens and caches for 15 minutes). Three large
 * figures, a quiet HRV/RHR line, and a 7-day recovery x strain strip —
 * all monotone, matching the rest of the page.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FN_BASE } from './backend';
import { fmtDuration, fmtStrain, recoveryBand } from '../utils.js';

type Day = {
  date: string;
  recovery: number | null;
  strain: number | null;
  sleepMs: number | null;
};

type Health =
  | { connected: false; error?: string }
  | {
      connected: true;
      fetchedAt: string;
      recovery: { score: number | null; hrv: number | null; rhr: number | null };
      sleep: { durMs: number | null; perf: number | null };
      strain: { day: number | null };
      week: Day[];
    };

const STALE_MS = 10 * 60 * 1000;

export function ActivityTab({ active }: { active: boolean }) {
  const [data, setData] = useState<Health | null>(null);
  const [err, setErr] = useState(false);
  const fetchedAt = useRef(0);

  const load = useCallback(() => {
    setErr(false);
    fetch(`${FN_BASE}/health`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Health) => { setData(d); fetchedAt.current = Date.now(); })
      .catch(() => setErr(true));
  }, []);

  useEffect(() => {
    if (active && Date.now() - fetchedAt.current > STALE_MS) load();
  }, [active, load]);

  let body: React.ReactNode;
  if (err) {
    body = (
      <div className="astate">
        the wrist didn&rsquo;t answer.{' '}
        <button type="button" className="linkish" onClick={load}>try again</button>
      </div>
    );
  } else if (!data) {
    body = <div className="astate dim">syncing with the wrist&hellip;</div>;
  } else if (!data.connected) {
    body = (
      <div className="astate">
        <p>Whoop isn&rsquo;t wired up yet.</p>
        <p className="dim asmall">
          (Nikunj: register the redirect URI, then{' '}
          <a href={`${FN_BASE}/login`} target="_blank" rel="noopener noreferrer">
            authorize once
          </a>
          . Details in SETUP-WHOOP.md.)
        </p>
      </div>
    );
  } else {
    const r = data.recovery;
    const minutes = Math.max(0, Math.round((Date.now() - new Date(data.fetchedAt).getTime()) / 60000));
    body = (
      <>
        <div className="astats">
          <div className="astat">
            <div className="abig">{r.score != null ? `${Math.round(r.score)}%` : '–'}</div>
            <div className="alab">recovery · {recoveryBand(r.score ?? NaN)}</div>
          </div>
          <div className="astat">
            <div className="abig">{fmtDuration(data.sleep.durMs ?? 0)}</div>
            <div className="alab">
              sleep{data.sleep.perf != null ? ` · ${Math.round(data.sleep.perf)}% of need` : ''}
            </div>
          </div>
          <div className="astat">
            <div className="abig">{fmtStrain(data.strain.day ?? NaN)}</div>
            <div className="alab">day strain · of 21</div>
          </div>
        </div>

        <div className="avitals">
          {r.hrv != null && <span>{Math.round(r.hrv)} ms hrv</span>}
          {r.hrv != null && r.rhr != null && <span className="msep">·</span>}
          {r.rhr != null && <span>{Math.round(r.rhr)} bpm resting</span>}
        </div>

        {data.week.length > 1 && (
          <div className="aweek" aria-label="Last seven days">
            {[...data.week].reverse().map((d) => (
              <div className="aday" key={d.date} title={
                `${d.date} · recovery ${d.recovery ?? '–'}%` +
                ` · strain ${d.strain != null ? fmtStrain(d.strain) : '–'}` +
                (d.sleepMs ? ` · slept ${fmtDuration(d.sleepMs)}` : '')
              }>
                <div className="abars">
                  <div
                    className="abar rec"
                    style={{ height: `${Math.max(4, d.recovery ?? 0)}%` }}
                  />
                  <div
                    className="abar str"
                    style={{ height: `${Math.max(4, ((d.strain ?? 0) / 21) * 100)}%` }}
                  />
                </div>
                <div className="adlab">
                  {new Date(`${d.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'narrow' })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="asynced dim">whoop · synced {minutes < 1 ? 'just now' : `${minutes}m ago`}</div>
      </>
    );
  }

  return (
    <div className={`activity${active ? '' : ' off'}`} aria-label="Recovery and strain">
      <div className="awrap">{body}</div>
    </div>
  );
}
