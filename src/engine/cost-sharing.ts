/**
 * How much of one claim the member pays, under one plan's rules.
 *
 * This is the single place cost sharing is implemented. Both views use it: the
 * employee view runs it over a thousand simulated years per plan, and the
 * employer view runs it for the group-plan baseline and the part-time estimate.
 *
 * Every function here is pure. `applyClaim` returns a full explanation of the
 * claim rather than a bare number, which is what the "use your benefits"
 * walkthrough reads; the simulation just sums `patientPaid`.
 */

import {
  INSULIN_CAP_PER_30_DAYS,
  INSULIN_EXEMPT_FROM_DEDUCTIBLE,
} from './constants.js';
import type {
  AppliedRule,
  ClaimExplanation,
  CostSharingRule,
  CostShareCap,
  DrugKind,
  PlanDesign,
  ServiceKind,
} from './types.js';

/** Where the member stands against their deductible and out-of-pocket max. */
export interface YearToDate {
  /** Deductible still to be met. */
  readonly deductibleRemaining: number;
  /** Member spend so far this plan year. */
  readonly outOfPocketSoFar: number;
}

export interface ClaimInput {
  readonly category: ServiceKind | DrugKind;
  readonly allowedAmount: number;
  readonly month: number;
  readonly label?: string;
}

export interface ClaimResult {
  readonly explanation: ClaimExplanation;
  readonly ytd: YearToDate;
}

/**
 * Categories the deductible always applies to, whatever the plan's rule table
 * says. These are the facility and diagnostic services that marketplace plans
 * price as "deductible then coinsurance" essentially without exception.
 */
const ALWAYS_DEDUCTIBLE: ReadonlySet<ServiceKind | DrugKind> = new Set<ServiceKind | DrugKind>([
  'labs', 'imaging', 'imaging_adv', 'delivery', 'admission', 'event',
]);

/**
 * Preventive care is covered in full with no cost sharing, before the
 * deductible. Required of all non-grandfathered plans.
 * Primary: ACA s 2713; 45 CFR 147.130.
 */
const NO_COST_SHARING: ReadonlySet<ServiceKind | DrugKind> = new Set<ServiceKind | DrugKind>(['preventive']);

/** The rule a plan applies to one category, falling back to the deductible. */
export function ruleFor(plan: PlanDesign, category: ServiceKind | DrugKind): CostSharingRule {
  if (ALWAYS_DEDUCTIBLE.has(category)) return { kind: 'deductible' };
  // Insulin is dispensed under the plan's brand-drug rule before any state cap.
  const effective = category === 'insulin' ? 'brand' : category;
  return plan.rules[effective] ?? { kind: 'deductible' };
}

/**
 * Apply one claim. Returns what the member pays, what the plan pays, which rule
 * governed it, and where the member now stands -- so a caller can replay a year
 * claim by claim without the function holding any state of its own.
 */
export function applyClaim(
  plan: PlanDesign,
  claim: ClaimInput,
  ytd: YearToDate,
  state?: string,
): ClaimResult {
  const allowed = Math.max(0, claim.allowedAmount);
  const oopRoom = Math.max(0, plan.outOfPocketMax - ytd.outOfPocketSoFar);

  // Preventive care: free, and it does not touch the deductible.
  if (NO_COST_SHARING.has(claim.category)) {
    return result(claim, allowed, 'preventive_no_cost', 0, 0, null, ytd, oopRoom);
  }

  const rule = ruleFor(plan, claim.category);
  const insulinCap = claim.category === 'insulin' && state ? INSULIN_CAP_PER_30_DAYS[state] : undefined;
  // Where a state exempts insulin from the deductible, no part of the fill
  // goes against it, so the member's share is the cap and nothing else.
  const skipDeductible =
    insulinCap !== undefined && state !== undefined && INSULIN_EXEMPT_FROM_DEDUCTIBLE.includes(state);

  let towardDeductible = 0;
  let share: number;
  let applied: AppliedRule = rule.kind;

  if (rule.kind === 'copay') {
    // A copay is flat and does not touch the deductible.
    share = Math.min(rule.amount, allowed);
  } else if (rule.kind === 'coinsurance') {
    // A fixed share, also without the deductible.
    share = rule.rate * allowed;
  } else {
    // The remaining three rules put the deductible first.
    towardDeductible = skipDeductible ? 0 : Math.min(allowed, ytd.deductibleRemaining);
    const afterDeductible = allowed - towardDeductible;
    if (rule.kind === 'copay_after_deductible') {
      share = towardDeductible + (afterDeductible > 0 ? Math.min(rule.amount, afterDeductible) : 0);
    } else if (rule.kind === 'coins_after_deductible') {
      share = towardDeductible + rule.rate * afterDeductible;
    } else {
      // 'deductible': the plan's default coinsurance applies past the deductible.
      share = towardDeductible + plan.coinsurance * afterDeductible;
    }
  }

  // A state insulin cap binds whatever the plan's own design says.
  let cappedBy: CostShareCap = null;
  if (insulinCap !== undefined && share > insulinCap) {
    share = insulinCap;
    // Nothing above the cap can count against the deductible either.
    towardDeductible = Math.min(towardDeductible, share);
    applied = 'copay';
    cappedBy = 'state_insulin_cap';
  }

  // The out-of-pocket maximum is the member's last line of defence.
  let patientPaid = Math.max(0, Math.min(share, oopRoom));
  if (patientPaid < share) {
    cappedBy = 'oop_max';
    towardDeductible = Math.min(towardDeductible, patientPaid);
  }
  patientPaid = round2(patientPaid);

  return result(claim, allowed, applied, towardDeductible, patientPaid, cappedBy, ytd, oopRoom);
}

function result(
  claim: ClaimInput,
  allowed: number,
  ruleApplied: AppliedRule,
  towardDeductible: number,
  patientPaid: number,
  cappedBy: CostShareCap,
  ytd: YearToDate,
  _oopRoom: number,
): ClaimResult {
  const deductibleRemaining = round2(Math.max(0, ytd.deductibleRemaining - towardDeductible));
  const outOfPocketSoFar = round2(ytd.outOfPocketSoFar + patientPaid);
  const explanation: ClaimExplanation = {
    category: claim.category,
    allowedAmount: round2(allowed),
    ruleApplied,
    towardDeductible: round2(towardDeductible),
    patientPaid,
    planPaid: round2(Math.max(0, allowed - patientPaid)),
    cappedBy,
    deductibleRemaining,
    oopRemaining: round2(Math.max(0, _oopRoom - patientPaid)),
    month: claim.month,
    ...(claim.label === undefined ? {} : { label: claim.label }),
  };
  return { explanation, ytd: { deductibleRemaining, outOfPocketSoFar } };
}

/** A member who has used no care yet this plan year. */
export function startOfYear(plan: PlanDesign): YearToDate {
  return { deductibleRemaining: plan.deductible, outOfPocketSoFar: 0 };
}

export interface YearResult {
  /** Total member out-of-pocket for the year, excluding premiums. */
  readonly outOfPocket: number;
  /** Member out-of-pocket by month, index 0 = January. */
  readonly byMonth: readonly number[];
  readonly claims: readonly ClaimExplanation[];
}

/**
 * Replay a whole year of claims against one plan, in order. Claims must be
 * sorted by month: cost sharing is path-dependent, so a delivery in January
 * costs the member far more than the same delivery in December.
 */
export function evaluateYear(
  plan: PlanDesign,
  claims: readonly ClaimInput[],
  state?: string,
  options?: { readonly collectClaims?: boolean },
): YearResult {
  const collect = options?.collectClaims ?? true;
  const byMonth = new Array<number>(12).fill(0);
  const explanations: ClaimExplanation[] = [];
  let ytd = startOfYear(plan);

  for (const claim of claims) {
    const { explanation, ytd: next } = applyClaim(plan, claim, ytd, state);
    ytd = next;
    const i = Math.min(11, Math.max(0, claim.month - 1));
    byMonth[i] = (byMonth[i] as number) + explanation.patientPaid;
    if (collect) explanations.push(explanation);
  }

  return {
    outOfPocket: round2(ytd.outOfPocketSoFar),
    byMonth: byMonth.map(round2),
    claims: explanations,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
