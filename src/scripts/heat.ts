/*
 * heat.ts
 * Hovering a day in the GitHub heatmap names it above the grid
 * ("7 contributions on May 3, 2026", or the milestone on a colored day);
 * leaving the grid shows the yearly total again. Without JS the total
 * just stays.
 */

const when = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function initHeat() {
  const heat = document.querySelector<HTMLElement>('.heat');
  const days = heat?.querySelector<HTMLElement>('.days');
  const say = heat?.querySelector<HTMLElement>('.heat-day');
  if (!heat || !days || !say) return;

  days.addEventListener('pointerover', (e) => {
    const day = (e.target as HTMLElement).closest<HTMLElement>('[data-d]');
    if (!day) return;
    const n = Number(day.dataset.c);
    const date = when.format(new Date(`${day.dataset.d}T00:00:00Z`));
    say.textContent = day.dataset.e
      ? `${date}: ${day.dataset.e}`
      : `${n || 'No'} contribution${n === 1 ? '' : 's'} on ${date}`;
    heat.classList.add('reading');
  });
  days.addEventListener('pointerleave', () => heat.classList.remove('reading'));
}
