/**
 * The month-by-month cumulative cost chart, as SVG.
 *
 * Two lines: the recommended plan and the plan someone would pick on premium
 * alone. It shows the thing a table cannot -- that a plan can be cheaper every
 * month until the month it is not.
 *
 * Ported from the plan-picker prototype.
 */

import { money, MONTHS_SHORT } from '../../ui/format.js';

export interface ChartSeries {
  readonly label: string;
  /** Cumulative member cost at the end of each month, twelve values. */
  readonly cumulative: readonly number[];
}

/** Render the chart at a given pixel width. */
export function renderChart(width: number, best: ChartSeries, other: ChartSeries): string {
  const w = Math.round(Math.max(300, Math.min(720, width || 720)));
  const narrow = w < 520;
  const h = narrow ? 250 : 300;
  const left = narrow ? 52 : 64;
  const right = narrow ? 70 : 92;
  const top = 16;
  const bottom = 36;

  const a = [0, ...best.cumulative];
  const b = [0, ...other.cumulative];
  const peak = Math.max(...a, ...b, 1);
  const step = peak > 12000 ? 4000 : peak > 6000 ? 2000 : peak > 2500 ? 1000 : 500;
  const ceiling = Math.ceil(peak / step) * step;

  const x = (i: number): number => left + ((w - left - right) * i) / 12;
  const y = (value: number): number => top + (h - top - bottom) * (1 - value / ceiling);

  let grid = '';
  for (let value = 0; value <= ceiling; value += step) {
    grid += `<line x1="${left}" x2="${w - right}" y1="${y(value)}" y2="${y(value)}" stroke="var(--line)" stroke-width="1"/>`;
    const label = narrow && value >= 1000 ? `$${value / 1000}k` : money(value);
    grid += `<text x="${left - 8}" y="${y(value) + 4}" text-anchor="end">${label}</text>`;
  }
  MONTHS_SHORT.forEach((month, i) => {
    if (narrow && i % 2 !== 0) return;
    grid += `<text x="${(x(i) + x(i + 1)) / 2}" y="${h - 12}" text-anchor="middle">${month}</text>`;
  });

  const path = (values: readonly number[]): string =>
    values.map((value, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(' ');

  const endA = y(a[12] as number);
  const endB = y(b[12] as number);
  // Nudge the end labels apart where the two lines finish close together.
  const offset = Math.abs(endA - endB) < 18 ? (endA < endB ? -9 : 9) : 0;

  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Cumulative cost by month. `
    + `${best.label} ends the year at ${money(a[12] as number)}; ${other.label} ends at ${money(b[12] as number)}.">
    ${grid}
    <path d="${path(b)}" fill="none" stroke="var(--warm-line)" stroke-width="3" stroke-dasharray="7 6" stroke-linejoin="round"/>
    <path d="${path(a)}" fill="none" stroke="var(--accent)" stroke-width="3.5" stroke-linejoin="round"/>
    <circle cx="${x(12)}" cy="${endA}" r="4.5" fill="var(--accent)"/>
    <circle cx="${x(12)}" cy="${endB}" r="4.5" fill="var(--warm-line)"/>
    <text class="end" x="${x(12) + 12}" y="${endA + 5 + offset}" style="fill:var(--accent)">${money(a[12] as number)}</text>
    <text class="end" x="${x(12) + 12}" y="${endB + 5 - offset}" style="fill:var(--warm)">${money(b[12] as number)}</text>
  </svg>`;
}
