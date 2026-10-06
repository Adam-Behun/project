/**
 * Rank plans by expected total cost, with plans that would disrupt care last.
 *
 * This is the whole argument of the employee view: the cheapest premium is
 * usually not the cheapest plan, and a plan that drops the oncologist is not a
 * candidate at any price. Both of those are decided here.
 */

import { evaluateYear } from './cost-sharing.js';
import {
  SAFER_ALT_MEAN_TOLERANCE, SAFER_ALT_P90_GAIN, SEED_SIMULATION, SIMULATION_YEARS,
} from './constants.js';
import { grossPremium, netPremium } from './premium.js';
import { mean, quantile } from './random.js';
import { applyFormulary, drawScenarios, typicalScenario } from './simulate.js';
import type { ScenarioContext, Toggles } from './simulate.js';
import type { CareProjection, DrugTable, Plan, PlanDataset, PlanFlag, PlanOutcome, ProviderTable } from './types.js';

export interface RankInput {
  readonly dataset: PlanDataset;
  readonly projection: CareProjection;
  readonly context: ScenarioContext;
  readonly providers: ProviderTable;
  /** Provider ids the person should not lose. */
  readonly careTeam: readonly string[];
  readonly age: number;
  /** Monthly ICHRA allowance or tax credit applied to the premium. */
  readonly monthlyHelp: number;
  readonly toggles?: Toggles;
  readonly years?: number;
  readonly seed?: number;
}

export interface RankResult {
  /** Every plan, ranked: disrupting plans last, then by expected total. */
  readonly ranked: readonly PlanOutcome[];
  /** The recommendation: cheapest expected total among plans that keep care. */
  readonly best: PlanOutcome;
  /** The plan someone would pick on premium alone. */
  readonly lowestPremium: PlanOutcome;
  /** Cheapest expected total overall, even if it disrupts care. */
  readonly cheapestOverall: PlanOutcome;
  /** A plan worth a little more for a much better bad year, if one exists. */
  readonly safer: PlanOutcome | null;
  /** What choosing `best` over `lowestPremium` is worth. */
  readonly savingsOverLowestPremium: number;
  readonly monthlyHelp: number;
  readonly years: number;
}

/**
 * What is wrong with a plan for this person: a lost provider, a drug off
 * formulary, a prior authorisation to file, or an HSA worth knowing about.
 *
 * 'high' severity means the plan would break care the person depends on. Those
 * plans rank last whatever they cost.
 */
export function flagsFor(
  plan: Plan,
  input: Pick<RankInput, 'careTeam' | 'providers' | 'projection' | 'context'>,
): PlanFlag[] {
  const flags: PlanFlag[] = [];

  for (const providerId of input.careTeam) {
    if (plan.network.includes(providerId)) continue;
    const provider = input.providers[providerId];
    if (!provider) continue;
    flags.push({
      severity: provider.critical ? 'high' : 'note',
      short: `${provider.name} is out of network`,
      text: `${provider.name} (${provider.role.toLowerCase()}) is out of network.`,
    });
  }

  for (const projected of input.projection.drugs) {
    const drug = input.context.drugs[projected.drugId];
    if (!drug) continue;
    const status = plan.formulary[drug.id];
    if (status === 'not_covered') {
      const cashCost = Math.round(drug.allowedAmount * 12).toLocaleString('en-US');
      const substitute = drug.alternative
        ? ` The plan would pay for ${drug.alternative.name} instead, and switching needs close monitoring.`
        : '';
      flags.push({
        severity: 'high',
        short: `${drug.name.split(' (')[0]} isn't covered`,
        text: `${drug.name} isn't covered.${substitute} Paying cash instead would cost about $${cashCost} a year.`,
      });
    } else if (status === 'pa') {
      flags.push({
        severity: 'note',
        text: `${drug.name} needs prior authorization. File it before January 1 so there's no gap.`,
      });
    }
  }

  if (plan.hsaEligible) {
    flags.push({
      severity: 'note',
      text: 'HSA-eligible, so you can set aside pre-tax money for the deductible.',
    });
  }

  return flags;
}

/** Price and rank every plan in a dataset for one person. */
export function rankPlans(input: RankInput): RankResult {
  const years = input.years ?? SIMULATION_YEARS;
  const seed = input.seed ?? SEED_SIMULATION;
  const toggles = input.toggles ?? {};
  const state = input.dataset.state;

  const scenarios = drawScenarios(input.projection, input.context, toggles, years, seed);
  const typical = typicalScenario(input.projection, input.context, toggles);

  const outcomes: PlanOutcome[] = input.dataset.plans.map((plan) => {
    const gross = grossPremium(plan, input.age, input.dataset);
    const net = netPremium(gross, input.monthlyHelp);
    const annualPremium = net * 12;

    const totals = scenarios
      .map((scenario) => {
        const resolved = applyFormulary(scenario, plan, input.context.drugs);
        return evaluateYear(plan, resolved, state, { collectClaims: false }).outOfPocket + annualPremium;
      })
      .sort((a, b) => a - b);

    const typicalResolved = applyFormulary(typical, plan, input.context.drugs);
    const typicalYear = evaluateYear(plan, typicalResolved, state);
    let running = 0;
    const typicalCumulative = typicalYear.byMonth.map((amount) => (running += amount + net));

    const flags = flagsFor(plan, input);
    return {
      plan,
      grossPremium: gross,
      netPremium: net,
      meanTotal: mean(totals),
      p10: quantile(totals, 0.1),
      p50: quantile(totals, 0.5),
      p90: quantile(totals, 0.9),
      typicalCumulative,
      typicalOutOfPocket: typicalYear.outOfPocket,
      typicalClaims: typicalYear.claims,
      flags,
      disruptsCare: flags.some((flag) => flag.severity === 'high'),
    };
  });

  // Plans that keep care are the only real candidates. If every plan would
  // disrupt care, we rank them all rather than recommending nothing.
  const keepsCare = outcomes.filter((outcome) => !outcome.disruptsCare);
  const pool = keepsCare.length > 0 ? keepsCare : outcomes;

  const best = pool.reduce((a, b) => (b.meanTotal < a.meanTotal ? b : a));
  const cheapestOverall = outcomes.reduce((a, b) => (b.meanTotal < a.meanTotal ? b : a));
  const lowestPremium = outcomes.reduce((a, b) => {
    if (b.netPremium < a.netPremium - 0.5) return b;
    // Where an allowance covers both premiums entirely, the cheaper gross
    // premium is still the one someone shopping on price would land on.
    if (Math.abs(b.netPremium - a.netPremium) <= 0.5 && b.plan.basePremium < a.plan.basePremium) return b;
    return a;
  });

  const saferCandidates = pool.filter(
    (outcome) =>
      outcome !== best &&
      outcome.meanTotal - best.meanTotal <= SAFER_ALT_MEAN_TOLERANCE &&
      best.p90 - outcome.p90 >= SAFER_ALT_P90_GAIN,
  );
  const safer = saferCandidates.length > 0
    ? saferCandidates.reduce((a, b) => (b.p90 < a.p90 ? b : a))
    : null;

  const ranked = [...outcomes].sort(
    (a, b) => Number(a.disruptsCare) - Number(b.disruptsCare) || a.meanTotal - b.meanTotal,
  );

  return {
    ranked,
    best,
    lowestPremium,
    cheapestOverall,
    safer,
    savingsOverLowestPremium: lowestPremium.meanTotal - best.meanTotal,
    monthlyHelp: input.monthlyHelp,
    years,
  };
}

/** The drugs in a projection, resolved against the drug table. */
export function projectedDrugs(projection: CareProjection, drugs: DrugTable) {
  return projection.drugs
    .map((projected) => drugs[projected.drugId])
    .filter((drug): drug is NonNullable<typeof drug> => drug !== undefined);
}
