import { describe, expect, it } from 'vitest';
import {
  comparableCoverageCheck, evaluateDesign, lowestFullyAffordableShare, outcomeKey,
  recommend, ruleChecks, type Design,
} from '../src/engine/employer.js';
import { minimumClassSize, RECOMMEND_MIN_BETTER_SHARE } from '../src/engine/constants.js';
import { classOutcomes, company } from './fixtures.js';

const C = company();
const O = classOutcomes();
const ALL = C.classes.map((c) => c.id);

const design = (over: Partial<Design> = {}): Design => ({
  movedClassIds: ALL, allowanceShare: 0.8, scope: 'premiums_only',
  purchaseMode: 'guided_best_fit', includePartTime: false, ...over,
});

describe('minimum class size', () => {
  it('is 10 under 100 employees, a tenth from 100 to 200, and 20 above', () => {
    expect(minimumClassSize(50)).toBe(10);
    expect(minimumClassSize(99)).toBe(10);
    expect(minimumClassSize(100)).toBe(10);
    expect(minimumClassSize(150)).toBe(15);
    expect(minimumClassSize(200)).toBe(20);
    expect(minimumClassSize(201)).toBe(20);
    expect(minimumClassSize(500)).toBe(20);
  });
});

describe('evaluating a design', () => {
  it('reproduces the baseline when nothing moves', () => {
    const result = evaluateDesign(C, O, design({ movedClassIds: [] }));
    expect(result.employerCost).toBe(result.baseline.employerCost);
    expect(result.totalCost).toBe(result.baseline.totalCost);
    expect(result.totalSaving).toBe(0);
    expect(result.movedEmployees).toBe(0);
    // Nobody is worse off if nothing changes.
    expect(result.allSameOrBetterOff).toBe(result.allEnrolled);
  });

  it('sums the group-plan baseline from the class data', () => {
    const result = evaluateDesign(C, O, design());
    const expected = C.classes.reduce((sum, k) => sum + k.groupPlan.totalCost, 0);
    expect(result.baseline.totalCost).toBe(expected);
  });

  it('adds up: class costs equal the company total', () => {
    const result = evaluateDesign(C, O, design({ movedClassIds: ['nj_sal', 'tx_hr'] }));
    const summed = result.classes.reduce((sum, c) => sum + c.totalCost, 0);
    expect(summed).toBe(result.totalCost);
  });

  it('counts enrolled employees in the classes that move', () => {
    const result = evaluateDesign(C, O, design({ movedClassIds: ['nj_hr'] }));
    const njhr = C.classes.find((c) => c.id === 'nj_hr');
    expect(result.movedEmployees).toBe(njhr?.enrolled);
  });

  it('leaves a class that stays unchanged', () => {
    const result = evaluateDesign(C, O, design({ movedClassIds: ['nj_sal'] }));
    const staying = result.classes.filter((c) => !c.moved);
    for (const klass of staying) {
      expect(klass.totalDelta, klass.klass.id).toBe(0);
      expect(klass.sameOrBetterShare, klass.klass.id).toBe(1);
      expect(klass.outcome, klass.klass.id).toBeNull();
    }
  });

  it('raises the allowance per household as the share rises', () => {
    const low = evaluateDesign(C, O, design({ allowanceShare: 0.6 }));
    const high = evaluateDesign(C, O, design({ allowanceShare: 1.0 }));
    for (const [i, klass] of high.classes.entries()) {
      const other = low.classes[i];
      expect(klass.allowanceMonthlyPerHousehold).toBeGreaterThan(other!.allowanceMonthlyPerHousehold);
    }
  });

  it('shifts cost from employees to the employer as the allowance rises', () => {
    const low = evaluateDesign(C, O, design({ allowanceShare: 0.6 }));
    const high = evaluateDesign(C, O, design({ allowanceShare: 1.0 }));
    expect(high.employerCost).toBeGreaterThan(low.employerCost);
    expect(high.employeeCost).toBeLessThan(low.employeeCost);
  });

  it('holds total cost flat across allowances when everyone buys the same plan', () => {
    // With the plan fixed, raising the allowance only moves cost between the
    // employer and the employee: it is the same care at the same price.
    const totals = C.allowanceShares.map((share) =>
      evaluateDesign(C, O, design({ allowanceShare: share, purchaseMode: 'lowest_cost_silver' })).totalCost);
    for (const total of totals) expect(total).toBeCloseTo(totals[0] as number, 0);
  });

  it('raises total cost at higher allowances under guided choice, because people buy better plans', () => {
    // Worth being explicit about: a more generous allowance does not just move
    // money around, it changes what employees can afford to buy. Total spend
    // goes up and so does the coverage bought with it.
    const low = evaluateDesign(C, O, design({ allowanceShare: 0.6 }));
    const high = evaluateDesign(C, O, design({ allowanceShare: 1.0 }));
    expect(high.totalCost).toBeGreaterThan(low.totalCost);
    const bronzeAtLow = low.bronzePicks;
    const bronzeAtHigh = high.bronzePicks;
    expect(bronzeAtHigh).toBeLessThanOrEqual(bronzeAtLow);
  });

  it('lowers the wage needed for affordability as the allowance rises', () => {
    const low = evaluateDesign(C, O, design({ allowanceShare: 0.6 }));
    const high = evaluateDesign(C, O, design({ allowanceShare: 0.95 }));
    for (const [i, klass] of high.classes.entries()) {
      if (!klass.moved) continue;
      expect(klass.requiredWageForAffordability)
        .toBeLessThan(low.classes[i]!.requiredWageForAffordability);
    }
  });

  it('charges for part-time coverage only when it is switched on', () => {
    const without = evaluateDesign(C, O, design({ includePartTime: false }));
    const withPt = evaluateDesign(C, O, design({ includePartTime: true }));
    const expected = C.partTime.monthlyAllowance * 12 * C.partTime.assumedTakeUp * C.partTime.employees;
    expect(without.partTimeCost).toBe(0);
    expect(withPt.partTimeCost).toBeCloseTo(expected, 6);
    // It is a new benefit, so it costs the employer money and saves nobody any.
    expect(withPt.employerCost).toBeGreaterThan(without.employerCost);
    expect(withPt.employeeCost).toBe(without.employeeCost);
  });

  it('charges administration only on employees actually offered an ICHRA', () => {
    expect(evaluateDesign(C, O, design({ movedClassIds: [] })).adminCost).toBe(0);
    const one = evaluateDesign(C, O, design({ movedClassIds: ['nj_hr'] }));
    const njhr = C.classes.find((c) => c.id === 'nj_hr')!;
    expect(one.adminCost).toBe(C.adminCostPerEmployeeMonth * 12 * njhr.employees);
  });

  it('throws rather than inventing a number for a design it has no data for', () => {
    expect(() => evaluateDesign(C, O, design({ allowanceShare: 0.42 }))).toThrow(/No precomputed outcome/);
  });

  it('builds the lookup key the dataset uses', () => {
    expect(outcomeKey(0.8, 'premiums_only', 'guided_best_fit')).toBe('0.80|premiums_only|guided_best_fit');
    expect(O.nj_sal?.[outcomeKey(0.8, 'premiums_only', 'guided_best_fit')]).toBeDefined();
  });
});

describe('the rules check', () => {
  it('says no rules apply while everyone stays on the group plan', () => {
    const checks = ruleChecks(C, evaluateDesign(C, O, design({ movedClassIds: [] })));
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe('info');
  });

  it('passes minimum class size for this company, whose classes all clear 20', () => {
    const result = evaluateDesign(C, O, design({ movedClassIds: ['nj_sal', 'ny_sal'] }));
    const check = ruleChecks(C, result).find((c) => c.id === 'min_class_size');
    expect(check?.status).toBe('pass');
    expect(check?.text).toMatch(/at least 20 employees/);
  });

  it('notes that minimum class size does not apply when every class moves', () => {
    // The minimum exists to stop an employer splitting a class between an
    // ICHRA and a group plan. With no group plan left, there is nothing to split.
    const check = ruleChecks(C, evaluateDesign(C, O, design({ movedClassIds: ALL })))
      .find((c) => c.id === 'min_class_size');
    expect(check?.status).toBe('info');
    expect(check?.text).toMatch(/no group health plan remains/);
  });

  it('fails affordability where the data says some offers are unaffordable', () => {
    // nj_hr at a 60% allowance: 44 of 61 affordable.
    const result = evaluateDesign(C, O, design({ movedClassIds: ['nj_hr'], allowanceShare: 0.6 }));
    const check = ruleChecks(C, result).find((c) => c.id === 'affordability');
    expect(check?.status).toBe('fail');
    expect(check?.text).toMatch(/17 moved employees would get an unaffordable offer/);
  });

  it('passes affordability once the allowance is high enough', () => {
    const result = evaluateDesign(C, O, design({ movedClassIds: ['nj_hr'], allowanceShare: 0.8 }));
    const check = ruleChecks(C, result).find((c) => c.id === 'affordability');
    expect(check?.status).toBe('pass');
  });

  it('states the wage an offer requires, and the tax credit trade-off', () => {
    const result = evaluateDesign(C, O, design({ allowanceShare: 0.8 }));
    const check = ruleChecks(C, result).find((c) => c.id === 'affordability_threshold');
    expect(check?.text).toMatch(/needs to earn at least \$[\d,]+/);
    expect(check?.text).toMatch(/ineligible for a\s+premium tax credit/);
  });

  it('always includes the 90-day notice requirement', () => {
    const check = ruleChecks(C, evaluateDesign(C, O, design())).find((c) => c.id === 'notice');
    expect(check?.text).toMatch(/at least 90 days/);
  });

  it('warns that reimbursing bills before the deductible blocks an HSA', () => {
    const premiumsOnly = ruleChecks(C, evaluateDesign(C, O, design({ scope: 'premiums_only' })));
    const alsoBills = ruleChecks(C, evaluateDesign(C, O, design({ scope: 'premiums_and_bills' })));
    expect(premiumsOnly.find((c) => c.id === 'hsa')).toBeUndefined();
    const hsa = alsoBills.find((c) => c.id === 'hsa');
    expect(hsa?.status).toBe('fail');
    expect(hsa?.text).toMatch(/HSA-eligible since January 2026/);
  });
});

describe('the design search', () => {
  const recommendation = recommend(C, O);

  it('finds a design', () => {
    expect(recommendation).not.toBeNull();
  });

  it('evaluates every subset of classes at every allowance share, both scopes', () => {
    // 15 non-empty subsets x 9 shares x 2 scopes.
    expect(recommendation?.designsConsidered).toBe((2 ** ALL.length - 1) * C.allowanceShares.length * 2);
  });

  it('only recommends a design that clears the better-off bar', () => {
    expect(recommendation!.result.movedSameOrBetterShare)
      .toBeGreaterThanOrEqual(RECOMMEND_MIN_BETTER_SHARE);
  });

  it('never recommends a design that saves the employer money at employees\' expense', () => {
    // The guard that stops this becoming a cost-shifting tool.
    expect(recommendation!.result.employerSaving).toBeGreaterThanOrEqual(0);
    expect(recommendation!.result.employeeSaving).toBeGreaterThanOrEqual(0);
    expect(recommendation!.result.totalSaving).toBeGreaterThan(0);
  });

  it('beats every design that also clears the bar, or shares the saving better', () => {
    const best = recommendation!.result;
    for (const share of C.allowanceShares) {
      for (const scope of ['premiums_only', 'premiums_and_bills'] as const) {
        for (let mask = 1; mask < 1 << ALL.length; mask++) {
          const candidate = evaluateDesign(C, O, design({
            movedClassIds: ALL.filter((_, i) => mask & (1 << i)), allowanceShare: share, scope,
          }));
          const qualifies = candidate.movedSameOrBetterShare >= RECOMMEND_MIN_BETTER_SHARE
            && candidate.totalSaving > 0 && candidate.employeeSaving >= 0 && candidate.employerSaving >= 0;
          if (!qualifies) continue;
          // Either it saves no more, or it is within the tie band.
          const better = candidate.totalSaving > best.totalSaving + 1000;
          expect(better, `${share} ${scope} ${mask}`).toBe(false);
        }
      }
    }
  });

  it('assumes guided choice, and keeps part-time out of the recommendation', () => {
    expect(recommendation!.design.purchaseMode).toBe('guided_best_fit');
    expect(recommendation!.design.includePartTime).toBe(false);
  });

  it('explains every class, moving or staying', () => {
    for (const id of ALL) {
      expect(recommendation!.rationale[id], id).toBeTruthy();
    }
    for (const id of recommendation!.design.movedClassIds) {
      expect(recommendation!.rationale[id]).toMatch(/Total cost down/);
    }
  });

  it('is deterministic', () => {
    expect(JSON.stringify(recommend(C, O))).toBe(JSON.stringify(recommendation));
  });

  it('recommends nothing when the bar cannot be met', () => {
    // An impossible bar must return null rather than the least-bad design.
    const impossible = { ...C, classes: C.classes.map((k) => ({ ...k, groupPlan: { employerCost: 1, employeeCost: 1, totalCost: 2 } })) };
    expect(recommend(impossible, O)).toBeNull();
  });
});

describe('the comparable-coverage check', () => {
  it('reprices the same design with everyone on the cheapest gold plan', () => {
    const base = design({ movedClassIds: ['nj_sal', 'tx_hr'] });
    const gold = comparableCoverageCheck(C, O, base);
    expect(gold.design.purchaseMode).toBe('lowest_cost_gold');
    expect(gold.design.movedClassIds).toEqual(base.movedClassIds);
    expect(gold.design.allowanceShare).toBe(base.allowanceShare);
    // Richer coverage costs more than a guided pick.
    expect(gold.totalCost).toBeGreaterThan(evaluateDesign(C, O, base).totalCost);
  });
});

describe('the lowest fully affordable allowance', () => {
  it('finds the share at which every offer in a class is affordable', () => {
    const share = lowestFullyAffordableShare(C, O, 'nj_hr', 'premiums_only', 'guided_best_fit');
    expect(share).toBe(0.8);
  });

  it('finds the lowest share for a class that is affordable throughout', () => {
    expect(lowestFullyAffordableShare(C, O, 'nj_sal', 'premiums_only', 'guided_best_fit')).toBe(0.6);
  });

  it('returns null for a class it has never heard of', () => {
    expect(lowestFullyAffordableShare(C, O, 'nope', 'premiums_only', 'guided_best_fit')).toBeNull();
  });
});
