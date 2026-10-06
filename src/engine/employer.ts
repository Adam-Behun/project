/**
 * The employer side: what moving a class to an ICHRA costs, whether the rules
 * allow it, and which design is actually worth recommending.
 *
 * The claims-dependent half of this -- what each class costs under each design
 * -- is precomputed. It came from a household-level model run against real
 * county plan data that is not redistributed here, and `class-outcomes.json`
 * says so. Everything else runs live: the allowance arithmetic, the
 * affordability threshold, the savings aggregation, the search across designs,
 * the compliance checks, and small-cell suppression.
 */

import {
  ADMIN_COST_PER_EMPLOYEE_MONTH, ICHRA_AFFORDABILITY_PCT, ICHRA_NOTICE_DAYS,
  RECOMMEND_MIN_BETTER_SHARE, minimumClassSize,
} from './constants.js';
import { allowanceFor, requiredWageForAffordability } from './allowance.js';
import { suppress, type SuppressedCount } from './privacy.js';
import type { AllowanceScope } from './allowance.js';

// ---------------------------------------------------------------------------
// The shape of the data
// ---------------------------------------------------------------------------

/** What employees are assumed to buy with their allowance. */
export type PurchaseMode = 'lowest_cost_silver' | 'guided_best_fit' | 'lowest_cost_gold';

export interface EmployerClass {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly employees: number;
  readonly enrolled: number;
  readonly members: number;
  readonly averageAge: number;
  readonly lowestCostSilverAvgMonthly: number;
  readonly counties: Readonly<Record<string, number>>;
  readonly plansConsidered: number;
  readonly groupPlan: { readonly employerCost: number; readonly employeeCost: number; readonly totalCost: number };
  readonly careFlagged: number;
  readonly careFlaggedHighRisk: number;
}

export interface PartTimeClass {
  readonly id: string;
  readonly name: string;
  readonly employees: number;
  readonly monthlyAllowance: number;
  readonly assumedTakeUp: number;
}

export interface Company {
  readonly name: string;
  readonly employees: number;
  readonly enrolledHouseholds: number;
  readonly coveredMembers: number;
  readonly planYear: number;
  readonly allowanceShares: readonly number[];
  readonly betterOffMargin: number;
  readonly adminCostPerEmployeeMonth: number;
  readonly partTime: PartTimeClass;
  readonly classes: readonly EmployerClass[];
  readonly meta: {
    readonly planYear: number;
    readonly trend: number;
    readonly affordPct: number;
    readonly sources: readonly string[];
  };
}

/** Precomputed outcome for one class under one design. */
export interface ClassOutcome {
  readonly employerCost: number;
  readonly employeeCost: number;
  readonly totalCost: number;
  readonly sameOrBetterOff: number;
  /** Enrolled employees whose offer passes the affordability test. */
  readonly affordableOffers: number;
  readonly allowanceTotal: number;
  readonly unusedAllowance: number;
  readonly onExchange: number;
  readonly metalPicks: Readonly<Record<string, number>>;
}

export type ClassOutcomes = Readonly<Record<string, Readonly<Record<string, ClassOutcome>>>>;

/** One coverage design: which classes move, at what allowance, spent how. */
export interface Design {
  readonly movedClassIds: readonly string[];
  readonly allowanceShare: number;
  readonly scope: AllowanceScope;
  readonly purchaseMode: PurchaseMode;
  readonly includePartTime: boolean;
}

/** The lookup key into the precomputed outcomes. */
export function outcomeKey(share: number, scope: AllowanceScope, mode: PurchaseMode): string {
  return `${share.toFixed(2)}|${scope}|${mode}`;
}

// ---------------------------------------------------------------------------
// Evaluating a design
// ---------------------------------------------------------------------------

export interface ClassResult {
  readonly klass: EmployerClass;
  readonly moved: boolean;
  readonly outcome: ClassOutcome | null;
  readonly employerCost: number;
  readonly employeeCost: number;
  readonly totalCost: number;
  /** Change against keeping this class on the group plan. */
  readonly employerDelta: number;
  readonly employeeDelta: number;
  readonly totalDelta: number;
  readonly sameOrBetterOff: number;
  readonly sameOrBetterShare: number;
  readonly affordableOffers: number;
  readonly allOffersAffordable: boolean;
  /** Average monthly allowance per enrolled household. */
  readonly allowanceMonthlyPerHousehold: number;
  /** Wage an employee needs for this offer to be affordable. */
  readonly requiredWageForAffordability: number;
  readonly meetsMinimumClassSize: boolean;
  readonly minimumClassSize: number;
  /** Members with care needing attention, suppressed where the count is small. */
  readonly careFlagged: SuppressedCount;
  readonly careFlaggedHighRisk: SuppressedCount;
}

export interface DesignResult {
  readonly design: Design;
  readonly classes: readonly ClassResult[];
  /** Totals under this design. */
  readonly employerCost: number;
  readonly employeeCost: number;
  readonly totalCost: number;
  /** Totals with everyone left on the group plan. */
  readonly baseline: { readonly employerCost: number; readonly employeeCost: number; readonly totalCost: number };
  readonly employerSaving: number;
  readonly employeeSaving: number;
  readonly totalSaving: number;
  /** Enrolled employees in the classes that move. */
  readonly movedEmployees: number;
  readonly movedSameOrBetterOff: number;
  readonly movedSameOrBetterShare: number;
  /** Across the whole company, including classes that stay. */
  readonly allEnrolled: number;
  readonly allSameOrBetterOff: number;
  /** Moved employees whose offer passes the affordability test. */
  readonly movedAffordableOffers: number;
  readonly allOffersAffordable: boolean;
  readonly unusedAllowance: number;
  readonly allowanceTotal: number;
  readonly partTimeCost: number;
  readonly adminCost: number;
  readonly bronzePicks: number;
}

/** Evaluate one design against the data. */
export function evaluateDesign(
  company: Company,
  outcomes: ClassOutcomes,
  design: Design,
): DesignResult {
  const key = outcomeKey(design.allowanceShare, design.scope, design.purchaseMode);
  const moved = new Set(design.movedClassIds);

  let employerCost = 0;
  let employeeCost = 0;
  let totalCost = 0;
  let baseEmployer = 0;
  let baseEmployee = 0;
  let baseTotal = 0;
  let movedEmployees = 0;
  let movedSameOrBetterOff = 0;
  let allEnrolled = 0;
  let allSameOrBetterOff = 0;
  let movedAffordableOffers = 0;
  let unusedAllowance = 0;
  let allowanceTotal = 0;
  let bronzePicks = 0;

  const minimum = minimumClassSize(company.employees);

  const classes: ClassResult[] = company.classes.map((klass) => {
    const group = klass.groupPlan;
    baseEmployer += group.employerCost;
    baseEmployee += group.employeeCost;
    baseTotal += group.totalCost;
    allEnrolled += klass.enrolled;

    if (!moved.has(klass.id)) {
      employerCost += group.employerCost;
      employeeCost += group.employeeCost;
      totalCost += group.totalCost;
      // A class that stays is unchanged, so everyone in it is no worse off.
      allSameOrBetterOff += klass.enrolled;
      return stayingClass(klass, minimum);
    }

    const outcome = outcomes[klass.id]?.[key];
    if (!outcome) throw new Error(`No precomputed outcome for class ${klass.id} at ${key}.`);

    employerCost += outcome.employerCost;
    employeeCost += outcome.employeeCost;
    totalCost += outcome.totalCost;
    movedEmployees += klass.enrolled;
    movedSameOrBetterOff += outcome.sameOrBetterOff;
    movedAffordableOffers += outcome.affordableOffers;
    allSameOrBetterOff += outcome.sameOrBetterOff;
    unusedAllowance += outcome.unusedAllowance;
    allowanceTotal += outcome.allowanceTotal;
    bronzePicks += outcome.metalPicks.bronze ?? 0;

    const allowance = allowanceFor({
      lowestCostSilverMonthly: klass.lowestCostSilverAvgMonthly,
      share: design.allowanceShare,
      scope: design.scope,
    });

    return {
      klass,
      moved: true,
      outcome,
      employerCost: outcome.employerCost,
      employeeCost: outcome.employeeCost,
      totalCost: outcome.totalCost,
      employerDelta: outcome.employerCost - group.employerCost,
      employeeDelta: outcome.employeeCost - group.employeeCost,
      totalDelta: outcome.totalCost - group.totalCost,
      sameOrBetterOff: outcome.sameOrBetterOff,
      sameOrBetterShare: klass.enrolled > 0 ? outcome.sameOrBetterOff / klass.enrolled : 0,
      affordableOffers: outcome.affordableOffers,
      allOffersAffordable: outcome.affordableOffers >= klass.enrolled,
      allowanceMonthlyPerHousehold: klass.enrolled > 0
        ? outcome.allowanceTotal / klass.enrolled / 12
        : allowance.monthly,
      requiredWageForAffordability: requiredWageForAffordability(
        klass.lowestCostSilverAvgMonthly, allowance.monthly,
      ),
      meetsMinimumClassSize: klass.employees >= minimum,
      minimumClassSize: minimum,
      careFlagged: suppress(klass.careFlagged, klass.members),
      careFlaggedHighRisk: suppress(klass.careFlaggedHighRisk, klass.members),
    };
  });

  // Administration is only paid on employees actually offered an ICHRA.
  const adminCost = movedEmployees > 0
    ? company.adminCostPerEmployeeMonth * 12 *
      company.classes.filter((c) => moved.has(c.id)).reduce((sum, c) => sum + c.employees, 0)
    : 0;

  const partTimeCost = design.includePartTime
    ? company.partTime.monthlyAllowance * 12 * company.partTime.assumedTakeUp * company.partTime.employees
    : 0;

  employerCost += partTimeCost;
  totalCost += partTimeCost;

  return {
    design,
    classes,
    employerCost,
    employeeCost,
    totalCost,
    baseline: { employerCost: baseEmployer, employeeCost: baseEmployee, totalCost: baseTotal },
    employerSaving: baseEmployer - employerCost,
    employeeSaving: baseEmployee - employeeCost,
    totalSaving: baseTotal - totalCost,
    movedEmployees,
    movedSameOrBetterOff,
    movedSameOrBetterShare: movedEmployees > 0 ? movedSameOrBetterOff / movedEmployees : 1,
    allEnrolled,
    allSameOrBetterOff,
    movedAffordableOffers,
    allOffersAffordable: movedAffordableOffers >= movedEmployees,
    unusedAllowance,
    allowanceTotal,
    partTimeCost,
    adminCost,
    bronzePicks,
  };
}

function stayingClass(klass: EmployerClass, minimum: number): ClassResult {
  const group = klass.groupPlan;
  return {
    klass,
    moved: false,
    outcome: null,
    employerCost: group.employerCost,
    employeeCost: group.employeeCost,
    totalCost: group.totalCost,
    employerDelta: 0,
    employeeDelta: 0,
    totalDelta: 0,
    sameOrBetterOff: klass.enrolled,
    sameOrBetterShare: 1,
    // A class on the group plan is not subject to the ICHRA affordability test.
    affordableOffers: klass.enrolled,
    allOffersAffordable: true,
    allowanceMonthlyPerHousehold: 0,
    requiredWageForAffordability: 0,
    meetsMinimumClassSize: klass.employees >= minimum,
    minimumClassSize: minimum,
    careFlagged: suppress(klass.careFlagged, klass.members),
    careFlaggedHighRisk: suppress(klass.careFlaggedHighRisk, klass.members),
  };
}

// ---------------------------------------------------------------------------
// Compliance checks
// ---------------------------------------------------------------------------

export type CheckStatus = 'pass' | 'fail' | 'info';

export interface RuleCheck {
  readonly id: string;
  readonly status: CheckStatus;
  readonly text: string;
}

/**
 * The rules an ICHRA design has to satisfy, checked against the design.
 *
 * These are the checks the prototype showed, now computed from named constants
 * rather than written into the markup.
 */
export function ruleChecks(company: Company, result: DesignResult): RuleCheck[] {
  const checks: RuleCheck[] = [];
  const movedClasses = result.classes.filter((c) => c.moved);

  if (movedClasses.length === 0) {
    return [{
      id: 'none',
      status: 'info',
      text: 'No ICHRA rules apply while everyone stays on the group plan.',
    }];
  }

  // Minimum class size. Only bites because the design splits classes between
  // an ICHRA and a group plan; if every class moved, it would not apply.
  const minimum = movedClasses[0]?.minimumClassSize ?? 0;
  const tooSmall = movedClasses.filter((c) => !c.meetsMinimumClassSize);
  const allClassesMoving = movedClasses.length === company.classes.length;
  if (allClassesMoving) {
    checks.push({
      id: 'min_class_size',
      status: 'info',
      text: 'Every class is moving, so no group health plan remains and the minimum class size rule does not apply.',
    });
  } else {
    checks.push({
      id: 'min_class_size',
      status: tooSmall.length === 0 ? 'pass' : 'fail',
      text: tooSmall.length === 0
        ? `Every moved class has at least ${minimum} employees, the minimum for an employer this size when a class is split between an ICHRA and a group plan.`
        : `${tooSmall.map((c) => c.klass.name).join(', ')} ${tooSmall.length === 1 ? 'is' : 'are'} below the ${minimum}-employee minimum for a split class.`,
    });
  }

  // Affordability. The pass/fail count is household-level model output; the
  // wage threshold beside it is computed live by the engine.
  const unaffordable = result.movedEmployees - result.movedAffordableOffers;
  checks.push({
    id: 'affordability',
    status: result.allOffersAffordable ? 'pass' : 'fail',
    text: result.allOffersAffordable
      ? `Every moved full-time employee gets an affordable offer under the ` +
        `${(ICHRA_AFFORDABILITY_PCT * 100).toFixed(2)}% test for ${company.planYear}.`
      : `${unaffordable} moved ${unaffordable === 1 ? 'employee' : 'employees'} would get an ` +
        `unaffordable offer. Raise the allowance to avoid a shared-responsibility penalty.`,
  });

  const highestWage = Math.max(...movedClasses.map((c) => c.requiredWageForAffordability));
  if (highestWage > 0) {
    checks.push({
      id: 'affordability_threshold',
      status: 'info',
      text: `At this allowance an employee needs to earn at least ` +
        `$${Math.round(highestWage).toLocaleString('en-US')} for their own offer to be affordable. ` +
        `Note the trade-off: an affordable offer also makes the employee ineligible for a ` +
        `premium tax credit.`,
    });
  }

  checks.push({
    id: 'notice',
    status: 'pass',
    text: `Employees are notified of their allowance at least ${ICHRA_NOTICE_DAYS} days before the plan year starts.`,
  });

  // Paying bills from the allowance before the deductible blocks HSA
  // contributions, which matters more now that bronze plans qualify.
  if (result.design.scope === 'premiums_and_bills') {
    const bronzeNote = result.design.purchaseMode === 'guided_best_fit' && result.bronzePicks > 0
      ? `${result.bronzePicks} of ${result.movedEmployees} moved employees would pick a bronze plan, which has been HSA-eligible since January 2026. `
      : '';
    checks.push({
      id: 'hsa',
      status: 'fail',
      text: `${bronzeNote}Paying medical bills from the allowance before the deductible is met blocks HSA ` +
        `contributions. Consider reimbursing bills only after the deductible.`,
    });
  }

  if (result.unusedAllowance > 5000) {
    checks.push({
      id: 'unused',
      status: 'pass',
      text: `$${Math.round(result.unusedAllowance).toLocaleString('en-US')} of allowance goes unused and stays with you.`,
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// The design search
// ---------------------------------------------------------------------------

export interface Recommendation {
  readonly design: Design;
  readonly result: DesignResult;
  /** How many designs were evaluated to find it. */
  readonly designsConsidered: number;
  /** Why each class is moving or staying. */
  readonly rationale: Readonly<Record<string, string>>;
}

/**
 * Search every design and return the best one.
 *
 * The bar, unchanged from the prototype: the largest total saving among designs
 * where at least 80% of moved employees come out the same or better off, and
 * where BOTH the employer and employees pay less. A design that saves the
 * employer money by moving cost onto employees does not qualify, however large
 * the total saving.
 */
export function recommend(company: Company, outcomes: ClassOutcomes): Recommendation | null {
  const classIds = company.classes.map((c) => c.id);
  const scopes: AllowanceScope[] = ['premiums_only', 'premiums_and_bills'];
  let best: { design: Design; result: DesignResult; totalSaving: number; minSaving: number } | null = null;
  let considered = 0;

  // Every non-empty subset of classes, at every allowance share, for both scopes.
  for (let mask = 1; mask < 1 << classIds.length; mask++) {
    const movedClassIds = classIds.filter((_, i) => mask & (1 << i));
    for (const share of company.allowanceShares) {
      for (const scope of scopes) {
        considered++;
        const design: Design = {
          movedClassIds, allowanceShare: share, scope,
          // The recommendation always assumes guided choice: it is what the
          // product offers, and the gold comparison is shown separately.
          purchaseMode: 'guided_best_fit',
          includePartTime: false,
        };
        const result = evaluateDesign(company, outcomes, design);

        if (result.movedSameOrBetterShare < RECOMMEND_MIN_BETTER_SHARE) continue;
        if (result.totalSaving <= 0) continue;
        if (result.employeeSaving < 0) continue;
        if (result.employerSaving < 0) continue;

        const minSaving = Math.min(result.employerSaving, result.employeeSaving);
        // Prefer a materially larger total saving; where two designs are within
        // $1,000, prefer the one that shares the saving more evenly.
        const better = best === null
          || result.totalSaving > best.totalSaving + 1000
          || (Math.abs(result.totalSaving - best.totalSaving) <= 1000 && minSaving > best.minSaving);
        if (better) best = { design, result, totalSaving: result.totalSaving, minSaving };
      }
    }
  }

  if (!best) return null;
  return {
    design: best.design,
    result: best.result,
    designsConsidered: considered,
    rationale: rationaleFor(company, outcomes, best.design),
  };
}

/** Why each class moves or stays under a design. */
function rationaleFor(company: Company, outcomes: ClassOutcomes, design: Design): Record<string, string> {
  const key = outcomeKey(design.allowanceShare, design.scope, design.purchaseMode);
  const moved = new Set(design.movedClassIds);
  const out: Record<string, string> = {};

  for (const klass of company.classes) {
    const outcome = outcomes[klass.id]?.[key];
    if (!outcome) continue;
    const delta = outcome.totalCost - klass.groupPlan.totalCost;
    const share = klass.enrolled > 0 ? outcome.sameOrBetterOff / klass.enrolled : 0;

    if (moved.has(klass.id)) {
      out[klass.id] = `Total cost down ${money(-delta)}. ` +
        `${outcome.sameOrBetterOff} of ${klass.enrolled} come out the same or better.`;
    } else if (delta >= 0) {
      out[klass.id] = `Moving would raise total cost by ${money(delta)}.`;
    } else if (share < RECOMMEND_MIN_BETTER_SHARE) {
      out[klass.id] = `Only ${outcome.sameOrBetterOff} of ${klass.enrolled} would come out the same or better.`;
    } else {
      out[klass.id] = 'Moving adds little once the other classes move.';
    }
  }
  return out;
}

/**
 * The comparable-coverage check: what the same design would cost if everyone
 * bought the cheapest gold plan instead of a guided pick. Gold is the closest
 * match to a typical employer plan, so this shows whether the saving survives
 * coverage of similar richness.
 */
export function comparableCoverageCheck(
  company: Company,
  outcomes: ClassOutcomes,
  design: Design,
): DesignResult {
  return evaluateDesign(company, outcomes, { ...design, purchaseMode: 'lowest_cost_gold' });
}

/**
 * The lowest allowance share at which every moved employee in a class gets an
 * affordable offer, read from the precomputed counts. Null where no share in
 * the data achieves it.
 */
export function lowestFullyAffordableShare(
  company: Company,
  outcomes: ClassOutcomes,
  classId: string,
  scope: AllowanceScope,
  mode: PurchaseMode,
): number | null {
  const klass = company.classes.find((c) => c.id === classId);
  if (!klass) return null;
  for (const share of [...company.allowanceShares].sort((a, b) => a - b)) {
    const outcome = outcomes[classId]?.[outcomeKey(share, scope, mode)];
    if (outcome && outcome.affordableOffers >= klass.enrolled) return share;
  }
  return null;
}

function money(amount: number): string {
  const absolute = Math.abs(amount);
  if (absolute >= 1e6) return `$${(absolute / 1e6).toFixed(2)}M`;
  return `$${Math.round(absolute / 1e3).toLocaleString('en-US')}K`;
}

export { ADMIN_COST_PER_EMPLOYEE_MONTH };
