/**
 * Age-rated premiums.
 *
 * In the individual market a plan files one rate and the premium a person
 * actually pays is that rate times an age factor. Both views use this: the
 * employee view to price eight or so plans for one person, the employer view to
 * price each class's lowest-cost silver plan.
 */

import {
  AGE_CURVE_MAX,
  AGE_CURVE_MIN,
  AGE_RATING_MAX_RATIO,
  FEDERAL_AGE_CURVE,
} from './constants.js';
import type { Plan, PlanDataset } from './types.js';

/**
 * The age factor for one age. Ages below the curve clamp to the child band and
 * ages above 64 clamp to the top band, which is how the curve is written: 64 is
 * "64 and over".
 */
export function ageFactor(age: number, curve: Readonly<Record<number, number>> = FEDERAL_AGE_CURVE): number {
  const clamped = Math.min(Math.max(Math.floor(age), AGE_CURVE_MIN), AGE_CURVE_MAX);
  const factor = curve[clamped];
  if (factor === undefined) {
    throw new Error(`No age factor for age ${clamped}: the curve is incomplete.`);
  }
  return factor;
}

/**
 * Re-base a premium quoted at one age to another age.
 *
 * Plan data rarely quotes the curve's own base. The CMS Rate PUF quotes by age
 * directly, while the sample Houston dataset is anchored to a published
 * 40-year-old premium, so both are expressed as "this premium, at this age" and
 * re-based here.
 */
export function premiumForAge(
  basePremium: number,
  basePremiumAge: number,
  age: number,
  curve: Readonly<Record<number, number>> = FEDERAL_AGE_CURVE,
): number {
  return (basePremium * ageFactor(age, curve)) / ageFactor(basePremiumAge, curve);
}

/**
 * The monthly premium one person would pay for one plan, before any allowance,
 * including the dataset's trend to the modeled plan year.
 */
export function grossPremium(plan: Plan, age: number, dataset: PlanDataset): number {
  return premiumForAge(plan.basePremium, plan.basePremiumAge, age) * dataset.premiumTrend;
}

/**
 * The premium left after an allowance or credit is applied. Never negative:
 * an allowance larger than the premium does not pay cash, it simply goes
 * unused -- which is why the employer view counts unused allowance as savings
 * retained by the employer.
 */
export function netPremium(gross: number, monthlyHelp: number): number {
  return Math.max(0, gross - monthlyHelp);
}

/** How much of a monthly allowance a given premium actually consumes. */
export function allowanceUsed(gross: number, monthlyHelp: number): number {
  return Math.min(monthlyHelp, gross);
}

/**
 * Whether a curve honours the 3:1 limit on adult age rating. The ACA caps the
 * spread between the oldest and youngest adult rates; a curve that breaks it
 * would not be filed.
 * Primary: 45 CFR 147.102(a)(1)(iii).
 */
export function respectsAgeRatingLimit(
  curve: Readonly<Record<number, number>> = FEDERAL_AGE_CURVE,
): boolean {
  const adults: number[] = [];
  for (let age = 21; age <= AGE_CURVE_MAX; age++) {
    const f = curve[age];
    if (f !== undefined) adults.push(f);
  }
  if (adults.length === 0) return false;
  const lowest = Math.min(...adults);
  const highest = Math.max(...adults);
  return highest / lowest <= AGE_RATING_MAX_RATIO + 1e-9;
}

/**
 * The lowest-cost silver plan premium for one person: the figure ICHRA
 * affordability is measured against, and the base the employer's allowance is
 * set as a share of.
 *
 * Note this is the LOWEST-cost silver plan (LCSP), not the second-lowest-cost
 * silver plan (SLCSP). SLCSP is the "benchmark" that sets the premium tax
 * credit; the two are often confused, and the prototypes used "benchmark
 * silver" for both.
 * Primary: 26 CFR 54.9802-4(c)(5) (ICHRA affordability uses the lowest-cost
 * silver plan in the employee's rating area).
 */
export function lowestCostSilverPremium(dataset: PlanDataset, age: number): number {
  const silver = dataset.plans.filter((p) => p.metal === 'Silver');
  if (silver.length === 0) throw new Error(`Dataset ${dataset.id} has no silver plan.`);
  return Math.min(...silver.map((p) => grossPremium(p, age, dataset)));
}

/**
 * The second-lowest-cost silver plan premium: the ACA benchmark that sets the
 * premium tax credit. Provided so the two are never conflated again. Falls back
 * to the lowest where only one silver plan is sold.
 * Primary: IRC s 36B(b)(3)(B).
 */
export function benchmarkSilverPremium(dataset: PlanDataset, age: number): number {
  const silver = dataset.plans
    .filter((p) => p.metal === 'Silver')
    .map((p) => grossPremium(p, age, dataset))
    .sort((a, b) => a - b);
  if (silver.length === 0) throw new Error(`Dataset ${dataset.id} has no silver plan.`);
  return (silver[1] ?? silver[0]) as number;
}
