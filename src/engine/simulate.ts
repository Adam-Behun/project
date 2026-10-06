/**
 * Build simulated plan years from a projection, and price them.
 *
 * A thousand years are drawn per person. Every plan is then tested against the
 * same thousand years, so the comparison between plans is not itself noisy:
 * the difference between two plans is the difference in their rules, not in
 * their luck.
 *
 * Ported from the plan-picker prototype so its published figures still hold.
 */

import { evaluateYear } from './cost-sharing.js';
import { lognormal, poisson, randomMonth, rngFrom, type Rng } from './random.js';
import { SEED_TYPICAL_YEAR } from './constants.js';
import type { ClaimInput } from './cost-sharing.js';
import type {
  CareProjection, DrugTable, MonthSpec, PriceTable, Plan, YearResultLike,
} from './types.js';

/** Which projection groups are switched on. A missing key counts as on. */
export type Toggles = Readonly<Record<string, boolean>>;

export interface ScenarioContext {
  readonly prices: PriceTable;
  readonly drugs: DrugTable;
}

/**
 * The months a repeated service falls in.
 *
 * - a fixed list: use it, truncated to the count
 * - 'spread': evenly through the year, as monthly labs are
 * - 'random': a Poisson count at random months, or in the typical year a
 *   rounded count placed from mid-year
 */
function monthsFor(spec: MonthSpec, count: number, rng: Rng, typical: boolean): number[] {
  if (Array.isArray(spec)) return spec.slice(0, Math.max(0, Math.round(count)));
  if (spec === 'spread') {
    const n = Math.round(count);
    return Array.from({ length: n }, (_, i) => 1 + Math.floor((i * 12) / n));
  }
  const n = typical ? Math.round(count) : poisson(rng, count);
  return Array.from({ length: n }, (_, i) => (typical ? Math.min(12, 6 + i) : randomMonth(rng)));
}

/**
 * One simulated year of care, before any plan is applied.
 *
 * `typical` builds the single most likely year rather than a random draw: every
 * probabilistic event resolves to its expected value. That is the year the
 * month-by-month chart and the benefits walkthrough show, because a chart of a
 * random draw would mislead.
 */
export function buildScenario(
  projection: CareProjection,
  context: ScenarioContext,
  rng: Rng,
  toggles: Toggles = {},
  typical = false,
): ClaimInput[] {
  const on = (group: string | null): boolean => group === null || toggles[group] !== false;
  const claims: ClaimInput[] = [];

  for (const service of projection.services) {
    if (!on(service.group)) continue;
    for (const month of monthsFor(service.months, service.count, rng, typical)) {
      claims.push({ category: service.kind, allowedAmount: context.prices[service.kind], month });
    }
  }

  for (const drug of projection.drugs) {
    if (!on(drug.group)) continue;
    const definition = context.drugs[drug.drugId];
    if (!definition) continue;
    for (let i = 0; i < drug.fills; i++) {
      claims.push({
        // The plan's formulary decides what is actually dispensed, so the
        // category and price are resolved per plan, not here.
        category: definition.kind,
        allowedAmount: definition.allowedAmount,
        month: 1 + Math.floor((i * 12) / drug.fills),
        label: definition.name,
      });
    }
  }

  for (const event of projection.events) {
    if (!on(event.group)) continue;
    const happens = typical ? event.probability >= 0.5 : rng() < event.probability;
    if (!happens) continue;
    claims.push({
      category: 'event',
      label: event.label,
      allowedAmount: typical ? event.medianAmount : lognormal(rng, event.medianAmount, event.sigma),
      month: event.month === 'random' ? (typical ? 7 : randomMonth(rng)) : event.month,
    });
  }

  const rates = projection.rates;
  const emergencies = typical ? Math.round(rates.er) : poisson(rng, rates.er);
  for (let i = 0; i < emergencies; i++) {
    claims.push({ category: 'er', allowedAmount: context.prices.er, month: typical ? 9 : randomMonth(rng) });
  }

  const admissions = typical ? Math.round(rates.admission) : poisson(rng, rates.admission);
  for (let i = 0; i < admissions; i++) {
    claims.push({
      category: 'admission',
      allowedAmount: typical ? context.prices.admission : lognormal(rng, context.prices.admission, 0.6),
      month: typical ? 10 : randomMonth(rng),
    });
  }

  if (!typical && rng() < rates.major) {
    claims.push({
      category: 'event',
      label: 'Unexpected serious illness or injury',
      allowedAmount: lognormal(rng, 45000, 0.7),
      month: randomMonth(rng),
    });
  }

  // Cost sharing is path-dependent, so the order matters.
  claims.sort((a, b) => a.month - b.month);
  return claims;
}

/**
 * Resolve a year's drug claims against one plan's formulary.
 *
 * Where a plan does not cover a drug, the plan pays for the alternative it
 * does cover, and the member's cost is the alternative's. The clinical cost of
 * that substitution is handled separately, in ranking: it is a care disruption,
 * not a saving.
 */
export function applyFormulary(
  claims: readonly ClaimInput[],
  plan: Plan,
  drugs: DrugTable,
): ClaimInput[] {
  return claims.map((claim) => {
    if (!claim.label) return claim;
    const drug = Object.values(drugs).find((d) => d.name === claim.label);
    if (!drug) return claim;
    if (plan.formulary[drug.id] === 'not_covered' && drug.alternative) {
      return {
        category: drug.alternative.kind,
        allowedAmount: drug.alternative.allowedAmount,
        month: claim.month,
        label: drug.alternative.name,
      };
    }
    return claim;
  });
}

/** The typical year: the single most likely version, deterministically built. */
export function typicalScenario(
  projection: CareProjection,
  context: ScenarioContext,
  toggles: Toggles = {},
): ClaimInput[] {
  return buildScenario(projection, context, rngFrom(SEED_TYPICAL_YEAR), toggles, true);
}

/** Draw `count` random years from one seed. */
export function drawScenarios(
  projection: CareProjection,
  context: ScenarioContext,
  toggles: Toggles,
  count: number,
  seed: number,
): ClaimInput[][] {
  const rng = rngFrom(seed);
  return Array.from({ length: count }, () => buildScenario(projection, context, rng, toggles, false));
}

/** Price one plan across a set of simulated years. */
export function priceAcrossYears(
  plan: Plan,
  scenarios: readonly (readonly ClaimInput[])[],
  drugs: DrugTable,
  state: string,
  annualPremium: number,
): { readonly sortedTotals: number[] } {
  const totals = scenarios.map((scenario) => {
    const resolved = applyFormulary(scenario, plan, drugs);
    // The hot path: a thousand years per plan, so skip the explanations.
    const year = evaluateYear(plan, resolved, state, { collectClaims: false });
    return year.outOfPocket + annualPremium;
  });
  totals.sort((a, b) => a - b);
  return { sortedTotals: totals };
}

export type { YearResultLike };
