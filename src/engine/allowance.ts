/**
 * The ICHRA allowance, and whether the offer it creates is affordable.
 *
 * This is the hinge between the two views. The employer sets an allowance as a
 * share of each employee's lowest-cost silver premium; that same allowance is
 * what the employee then spends in the plan picker. One implementation, so the
 * two sides cannot drift apart.
 */

import { ICHRA_AFFORDABILITY_PCT } from './constants.js';

/** What the allowance may be spent on. */
export type AllowanceScope = 'premiums_only' | 'premiums_and_bills';

export interface AllowanceInput {
  /** The employee's lowest-cost silver plan premium, monthly. */
  readonly lowestCostSilverMonthly: number;
  /** Share of that premium the employer funds, e.g. 0.8. */
  readonly share: number;
  readonly scope: AllowanceScope;
}

export interface Allowance {
  readonly monthly: number;
  readonly annual: number;
  readonly scope: AllowanceScope;
  /**
   * Whether an allowance of this scope leaves the employee able to contribute
   * to an HSA. Reimbursing bills before the deductible is met makes the
   * arrangement "other health coverage" and blocks HSA contributions.
   * Primary: IRC s 223(c)(1)(A)(ii); Rev. Rul. 2004-45.
   */
  readonly preservesHsaEligibility: boolean;
}

/** The allowance an employer's design produces for one employee. */
export function allowanceFor(input: AllowanceInput): Allowance {
  const monthly = round2(Math.max(0, input.lowestCostSilverMonthly * input.share));
  return {
    monthly,
    annual: round2(monthly * 12),
    scope: input.scope,
    preservesHsaEligibility: input.scope === 'premiums_only',
  };
}

export interface AffordabilityInput {
  /** The employee's lowest-cost silver plan premium, monthly. */
  readonly lowestCostSilverMonthly: number;
  /** The monthly allowance offered. */
  readonly allowanceMonthly: number;
  /** The employee's annual household wages used for the test. */
  readonly annualWages: number;
  /** The required-contribution percentage for the plan year. */
  readonly percentage?: number;
}

export interface AffordabilityResult {
  readonly affordable: boolean;
  /** What the employee would have to pay monthly for the lowest-cost silver plan. */
  readonly requiredContributionMonthly: number;
  /** That contribution as a share of wages. */
  readonly contributionShareOfWages: number;
  /** The percentage tested against. */
  readonly percentage: number;
  /** The largest monthly contribution that would still be affordable. */
  readonly affordableContributionCeilingMonthly: number;
  /**
   * The smallest monthly allowance that would make this offer affordable.
   * What an employer needs when a design fails the test.
   */
  readonly minimumAffordableAllowanceMonthly: number;
}

/**
 * The ICHRA affordability test.
 *
 * An ICHRA offer is affordable when the employee's own share of the
 * LOWEST-cost silver plan in their rating area -- that is, the premium less the
 * allowance -- is at or under the required-contribution percentage of their
 * household income. An affordable offer makes the employee ineligible for the
 * premium tax credit, which is why the employer side has to get this right: an
 * unaffordable offer exposes the employer to a shared-responsibility penalty,
 * while an affordable one takes the employee's subsidy away.
 *
 * Primary: 26 CFR 54.9802-4(c)(5); IRC s 36B(c)(4); IRS Rev. Proc. 2026-26 for
 * the 2027 percentage.
 */
export function affordability(input: AffordabilityInput): AffordabilityResult {
  const percentage = input.percentage ?? ICHRA_AFFORDABILITY_PCT;
  const required = Math.max(0, input.lowestCostSilverMonthly - input.allowanceMonthly);
  const ceiling = (input.annualWages * percentage) / 12;
  const share = input.annualWages > 0 ? (required * 12) / input.annualWages : Number.POSITIVE_INFINITY;
  return {
    // Equality counts as affordable: the rule is "does not exceed".
    affordable: required <= ceiling + 1e-9,
    requiredContributionMonthly: round2(required),
    contributionShareOfWages: share,
    percentage,
    affordableContributionCeilingMonthly: round2(ceiling),
    minimumAffordableAllowanceMonthly: round2(
      Math.max(0, input.lowestCostSilverMonthly - ceiling),
    ),
  };
}

/**
 * Whether taking an affordable ICHRA offer costs the employee a premium tax
 * credit they could otherwise have claimed. True whenever the offer is
 * affordable: an employee offered affordable coverage is not PTC-eligible, and
 * an employee offered an unaffordable ICHRA may opt out and claim the credit
 * instead.
 *
 * The plan-picker prototype's single "monthly help" input treated an allowance
 * and a tax credit as interchangeable. They are mutually exclusive, and this is
 * where that shows up.
 * Primary: IRC s 36B(c)(4)(C); 26 CFR 1.36B-2(c)(5).
 */
export function blocksPremiumTaxCredit(result: AffordabilityResult): boolean {
  return result.affordable;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Solve the affordability test for wages: the lowest annual wage at which an
 * offer of this allowance, against this lowest-cost silver premium, is
 * affordable.
 *
 * This is the form the employer view needs. A class-average wage cannot
 * reproduce a per-household affordability count -- the households inside a
 * class have different premiums and different pay -- so rather than invent a
 * class wage, the employer view states the threshold the design implies:
 * "at this allowance, an employee in this class needs to earn at least $X".
 * Nothing is assumed about what anyone actually earns.
 */
export function requiredWageForAffordability(
  lowestCostSilverMonthly: number,
  allowanceMonthly: number,
  percentage: number = ICHRA_AFFORDABILITY_PCT,
): number {
  const required = Math.max(0, lowestCostSilverMonthly - allowanceMonthly);
  if (required === 0) return 0;
  // Round up, not to nearest: this is the LOWEST wage that passes, so rounding
  // down would return a wage that fails the very test it answers.
  return Math.ceil(((required * 12) / percentage) * 100) / 100;
}
