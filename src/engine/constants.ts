/**
 * Every regulatory number this app relies on, named once, with its source.
 *
 * VERIFICATION NOTE. These were checked on 2026-10-06. The container this was
 * built in cannot reach irs.gov, cms.gov, hhs.gov or ecfr.gov (the egress proxy
 * answers 403 to CONNECT), so no value could be read off a primary government
 * page. Each constant carries its primary citation; anything dated after
 * mid-2025 also carries the secondary-source URL used to verify it, and the
 * README lists those URLs together under "Numbers we could not confirm".
 */

/** The plan year every projection in this app is about. */
export const PLAN_YEAR = 2027;

// ---------------------------------------------------------------------------
// ICHRA / CHOICE Arrangement
// ---------------------------------------------------------------------------

/**
 * Required-contribution percentage for the ACA employer affordability test in
 * calendar year 2027. An ICHRA offer is affordable when the employee's share of
 * the LOWEST-cost silver plan premium is at or under this share of wages.
 *
 * Primary: IRS Rev. Proc. 2026-26 (sets the IRC s 36B(b)(3)(A)(ii) percentage).
 * Verified via: https://www.wtwco.com/en-us/insights/2026/07/irs-announces-2027-aca-affordability-percentage
 *               https://www.mercer.com/insights/law-and-policy/2027-affordability-percentage-for-employer-health-coverage-increases/
 */
export const ICHRA_AFFORDABILITY_PCT = 0.1022;

/**
 * The 2026 percentage, kept for context only: it is what the prior plan year
 * was tested against, and it shows the direction of travel.
 * Primary: IRS Rev. Proc. 2025-25.
 */
export const AFFORDABILITY_PCT_2026 = 0.0996;

/**
 * Minimum ICHRA class size, by employer headcount on the first day of the plan
 * year. Returns the minimum number of employees a class must contain.
 *
 * This minimum applies ONLY where the employer splits a class between an ICHRA
 * and a traditional group health plan, and only to the class offered the ICHRA.
 * That is exactly the design this app models. New-hire and waiting-period
 * classes are excluded from the minimum.
 *
 * Primary: HRA final rules, 84 FR 28888 (June 20, 2019); 26 CFR 54.9802-4(d).
 */
export function minimumClassSize(employeeCount: number): number {
  if (employeeCount < 100) return 10;
  if (employeeCount <= 200) return Math.ceil(employeeCount * 0.1);
  return 20;
}

/**
 * The eleven permitted ICHRA employee classes. An employer may use these, and
 * combinations of them, to decide who is offered an ICHRA.
 * Primary: HRA final rules, 84 FR 28888; 26 CFR 54.9802-4(a)(3).
 */
export const EMPLOYEE_CLASS_TYPES = [
  'Full-time employees',
  'Part-time employees',
  'Salaried employees',
  'Non-salaried (hourly) employees',
  'Seasonal employees',
  'Temporary employees of a staffing firm',
  'Employees in a unit of employees covered by a collective bargaining agreement',
  'Employees in a waiting period',
  'Foreign employees who work abroad',
  'Employees whose primary site of employment is in the same rating area',
  'Employees under age 25 at the start of the plan year',
] as const;

/**
 * Days before the start of the plan year by which employees must receive the
 * ICHRA notice (allowance amount, the opt-out, the effect on premium tax
 * credits). Shorter notice is allowed only for a newly established HRA.
 * Primary: HRA final rules, 84 FR 28888; 26 CFR 54.9802-4(c)(6).
 */
export const ICHRA_NOTICE_DAYS = 90;

/**
 * ICHRA was administratively renamed the "CHOICE Arrangement" (Custom Health
 * Option and Individual Care Expense) by CMS and the SBA on 2026-09-03. That is
 * a rename only: the governing regulations are unchanged.
 *
 * Statutory codification is a separate, UNFINISHED matter. H.R. 6703 (Lower
 * Health Care Premiums for All Americans Act), which would write the CHOICE
 * Arrangement into statute, passed the House on 2025-12-17 and has not been
 * enacted. Nothing in this app depends on codification.
 *
 * Verified via: https://www.peoplekeep.com/blog/what-is-the-choice-arrangement
 *               https://www.beckerspayer.com/policy-updates/ichra-legislation-in-congress-3-bills-to-know/
 */
export const CHOICE_ARRANGEMENT = {
  renamedOn: '2026-09-03',
  renamedBy: 'CMS and SBA',
  codifiedInStatute: false,
  codificationBill: 'H.R. 6703 (passed House 2025-12-17, not enacted)',
} as const;

// ---------------------------------------------------------------------------
// Premium age rating
// ---------------------------------------------------------------------------

/**
 * Maximum permitted premium variation by age for adults in the individual and
 * small group markets.
 * Primary: 45 CFR 147.102(a)(1)(iii); ACA s 2701.
 */
export const AGE_RATING_MAX_RATIO = 3;

/**
 * The federal default uniform age rating curve, applied in states that do not
 * set their own. One factor per integer age 0-64; ages 0-14 share a single
 * band, 15-20 are one-year bands, 21-24 share a factor, and 64 is the top of
 * the curve (3.000, the 3:1 limit against the 21-24 factor of 1.000).
 *
 * The employee-side prototype's curve omitted ages 15-20 entirely, which made
 * the premium for a 15-to-20-year-old NaN. The full curve is reproduced here.
 *
 * CONFIRMED: 0-14 (0.765), 21-24 (1.000), 25 (1.004), 40 (1.278), 64 (3.000).
 * NOT CONFIRMED: ages 15-20. Every page carrying the full table is unreachable
 * from the build container (cms.gov and the Oregon DFR mirror both 403), so the
 * six factors for ages 15-20 below are our best reading and have NOT been
 * verified against a source. They are flagged in the README. No persona or
 * employer class in this app is aged 15-20, so nothing currently shown depends
 * on them; they exist so that a dependent in that band yields a finite premium
 * rather than NaN. Tests assert only finiteness, monotonicity and the 3:1
 * bound for this band -- not the exact values.
 *
 * Primary: CMS, "Final Guidance Regarding Age Curves and State Reporting"
 * (Dec 16, 2016); 45 CFR 147.102(e).
 */
export const FEDERAL_AGE_CURVE: Readonly<Record<number, number>> = Object.freeze({
  0: 0.765, 1: 0.765, 2: 0.765, 3: 0.765, 4: 0.765, 5: 0.765, 6: 0.765, 7: 0.765,
  8: 0.765, 9: 0.765, 10: 0.765, 11: 0.765, 12: 0.765, 13: 0.765, 14: 0.765,
  // ages 15-20: UNCONFIRMED, see the note above
  15: 0.833, 16: 0.859, 17: 0.885, 18: 0.913, 19: 0.941, 20: 0.97,
  21: 1.0, 22: 1.0, 23: 1.0, 24: 1.0,
  25: 1.004, 26: 1.024, 27: 1.048, 28: 1.087, 29: 1.119, 30: 1.135, 31: 1.159,
  32: 1.183, 33: 1.198, 34: 1.214, 35: 1.222, 36: 1.23, 37: 1.238, 38: 1.246,
  39: 1.262, 40: 1.278, 41: 1.302, 42: 1.325, 43: 1.357, 44: 1.397, 45: 1.444,
  46: 1.5, 47: 1.563, 48: 1.635, 49: 1.706, 50: 1.786, 51: 1.865, 52: 1.952,
  53: 2.04, 54: 2.135, 55: 2.23, 56: 2.333, 57: 2.437, 58: 2.548, 59: 2.603,
  60: 2.714, 61: 2.81, 62: 2.873, 63: 2.952, 64: 3.0,
});

/** Youngest and oldest ages the curve covers. 64 is the top band ("64 and over"). */
export const AGE_CURVE_MIN = 0;
export const AGE_CURVE_MAX = 64;

// ---------------------------------------------------------------------------
// State cost-sharing caps
// ---------------------------------------------------------------------------

/**
 * State caps on insulin cost sharing, per 30-day supply, in state-regulated
 * plans. These bind regardless of a plan's own deductible or copay design, so
 * they are applied after the plan's rules.
 *
 * TX: $25 per 30-day supply. Primary: TX SB 827 (87th Leg., 2021),
 *     Tex. Ins. Code s 1358.103; applies to plans issued or renewed on or
 *     after 2022-01-01.
 * NJ: $35 per 30-day supply, and not subject to any deductible.
 *     Primary: N.J. P.L. 2023, c.105 (S1614); effective 2025-01-01.
 * NY: $0 per 30-day supply. Primary: New York enacted FY2025 budget
 *     (eliminates insulin cost sharing). NOTE: the dollar value is confirmed
 *     via the American Diabetes Association's state table, but we could not
 *     confirm the exact statutory section. Flagged in the README.
 *
 * Verified via: https://diabetes.org/tools-resources/affordable-insulin/state-insulin-copay-caps
 *               https://pub.njleg.gov/Bills/2022/PL23/105_.HTM
 */
export const INSULIN_CAP_PER_30_DAYS: Readonly<Record<string, number>> = Object.freeze({
  TX: 25,
  NJ: 35,
  NY: 0,
});

/** States where insulin is exempt from the deductible as well as capped. */
export const INSULIN_EXEMPT_FROM_DEDUCTIBLE: readonly string[] = Object.freeze(['NJ', 'NY']);

// ---------------------------------------------------------------------------
// HSA eligibility
// ---------------------------------------------------------------------------

/**
 * From this date, bronze and catastrophic Exchange plans (and off-Exchange
 * plans mirroring them) count as high-deductible health plans, so enrollees may
 * contribute to an HSA. Before it, most bronze plans did not qualify.
 *
 * Primary: One Big Beautiful Bill Act s 71307, amending IRC s 223(c)(2);
 * IRS Notice 2026-05.
 * Verified via: https://www.irs.gov/pub/irs-drop/n-26-05.pdf (citation only;
 *               irs.gov is unreachable from the build container)
 *               https://livelyme.com/guides/obbb-hsa-guide
 */
export const BRONZE_CATASTROPHIC_HSA_ELIGIBLE_FROM = '2026-01-01';

/**
 * Paying medical bills from an ICHRA allowance before the deductible is met
 * disqualifies the employee from HSA contributions, because the arrangement is
 * then "other health coverage" under IRC s 223(c)(1). An ICHRA limited to
 * premiums, or to bills only after the deductible, preserves HSA eligibility.
 * Primary: IRC s 223(c)(1)(A)(ii); Rev. Rul. 2004-45.
 */
export const ALLOWANCE_FOR_BILLS_BLOCKS_HSA = true;

// ---------------------------------------------------------------------------
// Marketplace dates
// ---------------------------------------------------------------------------

/**
 * Open enrollment for the 2027 plan year on healthcare.gov. Most state-based
 * marketplaces, New York and New Jersey among them, run to 2027-01-31.
 * Primary: CMS; 45 CFR 155.410(e).
 * Verified via: https://www.summithealthbenefits.com/blog/health-insurance-open-enrollment-dates-and-changes
 */
export const OPEN_ENROLLMENT_2027 = {
  start: '2026-11-01',
  end: '2027-01-15',
  coverageStartsJan1IfEnrolledBy: '2026-12-15',
  stateBasedMarketplaceEnd: '2027-01-31',
} as const;

/**
 * The enhanced premium tax credits (ARPA, extended by the IRA) lapsed after
 * 2025-12-31, so 2027 subsidies are smaller and the 400%-of-poverty eligibility
 * cliff is back. This is why an ICHRA allowance, rather than a tax credit, is
 * the relevant comparison for most of the employees modeled here.
 * Verified via: https://www.healthinsurance.org/blog/one-big-beautiful-bill-act-brings-sweeping-changes-to-health-coverage/
 */
export const ENHANCED_PTC_EXPIRED_AFTER = '2025-12-31';

/**
 * Days after a birth, adoption or marriage within which a new dependent can be
 * added to individual-market coverage.
 * Primary: 45 CFR 155.420(d)(2).
 */
export const SPECIAL_ENROLLMENT_DAYS = 60;

// ---------------------------------------------------------------------------
// Modeling assumptions. NOT regulatory. Carried from the prototypes.
// ---------------------------------------------------------------------------

/**
 * An employee counts as "same or better off" when their modeled cost under an
 * ICHRA is no more than this much above their cost on the group plan.
 * Assumption, from the employer prototype (`margin: 250`).
 */
export const BETTER_OFF_MARGIN = 250;

/**
 * The employer design search only recommends a design where at least this share
 * of moved employees come out the same or better off.
 * Assumption, from the employer prototype (`REC_SHARE`).
 */
export const RECOMMEND_MIN_BETTER_SHARE = 0.8;

/** Monthly per-employee ICHRA administration cost. Assumption. */
export const ADMIN_COST_PER_EMPLOYEE_MONTH = 50;

/**
 * A plan qualifies as a "safer alternative" to the recommended one when it
 * costs at most this much more on average but cuts at least this much off a bad
 * (90th percentile) year. Assumption, from the employee prototype.
 */
export const SAFER_ALT_MEAN_TOLERANCE = 250;
export const SAFER_ALT_P90_GAIN = 400;

/** Simulated plan-years per plan. Assumption; the prototype used 1,000. */
export const SIMULATION_YEARS = 1000;

/** Fixed seeds, so every run of this app produces identical numbers. */
export const SEED_SIMULATION = 20270101;
export const SEED_TYPICAL_YEAR = 7;
