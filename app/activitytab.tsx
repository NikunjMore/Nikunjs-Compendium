'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FN_BASE } from './backend';
import { fmtDuration, fmtStrain, healthObservation, recoveryBand } from '../utils.js';

type Day = { date: string; recovery: number | null; strain: number | null; sleepMs: number | null };
type Metric = 'strain' | 'recovery' | 'sleep';
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
  const [selectedMetric, setSelectedMetric] = useState<Metric | null>(null);
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
    body = <div className="astate">the wrist didn&rsquo;t answer.{' '}<button type="button" className="linkish" onClick={load}>try again</button></div>;
  } else if (!data) {
    body = <div className="astate dim">syncing with the wrist&hellip;</div>;
  } else if (!data.connected) {
    body = (
      <div className="astate">
        <p>Whoop isn&rsquo;t wired up yet.</p>
        <p className="dim asmall">
          (Nikunj: register the redirect URI, then{' '}
          <a href={`${FN_BASE}/login`} target="_blank" rel="noopener noreferrer">authorize once</a>.
          Details in SETUP-WHOOP.md.)
        </p>
      </div>
    );
  } else {
    const r = data.recovery;
    const recovery = r.score ?? 0;
    const strain = data.strain.day ?? 0;
    const sleepPerformance = data.sleep.perf ?? 0;
    const band = recoveryBand(r.score ?? NaN);
    const observation = healthObservation(data.week);
    const minutes = Math.max(0, Math.round((Date.now() - new Date(data.fetchedAt).getTime()) / 60000));

    body = (
      <>
        <header className="aheading">
          <div className="aeyebrow">whoop · live</div>
          <h2>How I recover</h2>
          <p className="asummary">Today, at a glance. Tap a circle for the detail behind it.</p>
        </header>

        <div className="awhoop-rings" role="group" aria-label="Today’s WHOOP metrics">
          <MetricRing
            label="strain"
            value={fmtStrain(strain)}
            progress={(strain / 21) * 100}
            tone="strain"
            active={selectedMetric === 'strain'}
            onClick={() => setSelectedMetric(selectedMetric === 'strain' ? null : 'strain')}
          />
          <MetricRing
            label="recovery"
            value={r.score != null ? `${Math.round(recovery)}%` : '–'}
            progress={recovery}
            tone={`recovery ${band}`}
            active={selectedMetric === 'recovery'}
            onClick={() => setSelectedMetric(selectedMetric === 'recovery' ? null : 'recovery')}
          />
          <MetricRing
            label="sleep"
            value={data.sleep.perf != null ? `${Math.round(sleepPerformance)}%` : '–'}
            progress={sleepPerformance}
            tone="sleep"
            active={selectedMetric === 'sleep'}
            onClick={() => setSelectedMetric(selectedMetric === 'sleep' ? null : 'sleep')}
          />
        </div>

        <div className="ametric-detail" aria-live="polite">
          {selectedMetric === 'strain' && (
            <p><strong>{fmtStrain(strain)}</strong> of 21 strain so far today.</p>
          )}
          {selectedMetric === 'recovery' && (
            <p>
              <strong>{band} recovery</strong>
              {r.hrv != null && ` · ${Math.round(r.hrv)} ms HRV`}
              {r.rhr != null && ` · ${Math.round(r.rhr)} bpm resting`}
            </p>
          )}
          {selectedMetric === 'sleep' && (
            <p>
              <strong>{fmtDuration(data.sleep.durMs ?? 0)}</strong> asleep
              {data.sleep.perf != null && ` · ${Math.round(data.sleep.perf)}% of need`}
            </p>
          )}
          {selectedMetric == null && <p className="dim">strain · recovery · sleep</p>}
        </div>

        <div className="aobservation">
          <span>what stands out</span>
          <p>{observation || 'Not enough scored days yet to call out a pattern.'}</p>
        </div>
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

function MetricRing({ label, value, progress, tone, active, onClick }: {
  label: string;
  value: string;
  progress: number;
  tone: string;
  active: boolean;
  onClick: () => void;
}) {
  const filled = Math.max(0, Math.min(100, progress));
  return (
    <button
      type="button"
      className={`aring ${tone}${active ? ' active' : ''}`}
      aria-label={`${label}: ${value}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="aring-track" cx="60" cy="60" r="52" pathLength="100" />
        <circle
          className="aring-value"
          cx="60"
          cy="60"
          r="52"
          pathLength="100"
          strokeDasharray={`${filled} 100`}
        />
      </svg>
      <span className="aring-copy">
        <strong>{value}</strong>
        <span>{label}</span>
      </span>
    </button>
  );
}
