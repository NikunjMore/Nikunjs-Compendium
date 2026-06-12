'use client';

/*
 * dock.tsx
 * The bottom-centre tab bar (video ref #3): a macOS-style dock with three
 * monotone line icons — person (the compendium), music (the cover flow),
 * pulse (Whoop recovery). Icons magnify as the pointer nears, riding the
 * pure, unit-tested dockMagnify curve, and name themselves in a tooltip
 * pill above the bar.
 */

import { useEffect, useRef, useState } from 'react';
import { Ic } from './icons';
import { dockMagnify } from '../utils.js';

export type TabId = 'person' | 'music' | 'activity';

const ITEMS: { id: TabId; icon: string; label: string }[] = [
  { id: 'person', icon: 'person', label: 'the compendium' },
  { id: 'music', icon: 'music', label: 'what I listen to' },
  { id: 'activity', icon: 'pulse', label: 'how I recover' },
];

export function Dock({ tab, onTab, show }: {
  tab: TabId;
  onTab: (t: TabId) => void;
  show: boolean;
}) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [scales, setScales] = useState<number[]>([1, 1, 1]);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const onMove = (e: React.PointerEvent) => {
    if (reduced.current || e.pointerType === 'touch') return;
    setScales(ITEMS.map((_, i) => {
      const el = btnRefs.current[i];
      if (!el) return 1;
      const r = el.getBoundingClientRect();
      return dockMagnify(e.clientX - (r.left + r.width / 2));
    }));
  };

  return (
    <nav
      className={`dock${show ? ' show' : ''}`}
      aria-label="Sections"
      onPointerMove={onMove}
      onPointerLeave={() => setScales([1, 1, 1])}
    >
      {ITEMS.map((it, i) => (
        <button
          key={it.id}
          ref={(el) => { btnRefs.current[i] = el; }}
          type="button"
          className={tab === it.id ? 'active' : ''}
          aria-pressed={tab === it.id}
          aria-label={it.label}
          style={{ transform: `translateY(${(1 - scales[i]) * 11}px) scale(${scales[i]})` }}
          onClick={() => onTab(it.id)}
        >
          <Ic n={it.icon} />
          <span className="dtip">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
