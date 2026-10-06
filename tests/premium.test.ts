import { describe, expect, it } from 'vitest';
import {
  ageFactor, allowanceUsed, benchmarkSilverPremium, grossPremium,
  lowestCostSilverPremium, netPremium, premiumForAge, respectsAgeRatingLimit,
} from '../src/engine/premium.js';
import {
  AGE_CURVE_MAX, AGE_RATING_MAX_RATIO, FEDERAL_AGE_CURVE,
} from '../src/engine/constants.js';
import type { Plan, PlanDataset } from '../src/engine/types.js';

const plan = (id: string, metal: Plan['metal'], basePremium: number): Plan => ({
  id, name: `Plan ${id}`, metal, planType: 'HMO', label: `${metal} HMO`,
  basePremium, basePremiumAge: 40, deductible: 2000, coinsurance: 0.2,
  outOfPocketMax: 8000, hsaEligible: false, rules: {}, network: [], formulary: {},
});

const dataset: PlanDataset = {
  id: 'test', label: 'Test', state: 'TX', planYear: 2027, premiumTrend: 1,
  networkDataIsReal: false, source: 'test',
  plans: [plan('A', 'Bronze', 426), plan('C', 'Silver', 651), plan('D', 'Silver', 661), plan('F', 'Gold', 570)],
};

describe('the federal age curve', () => {
  it('matches the values we could confirm against a source', () => {
    expect(ageFactor(0)).toBe(0.765);
    expect(ageFactor(14)).toBe(0.765);
    expect(ageFactor(21)).toBe(1.0);
    expect(ageFactor(24)).toBe(1.0);
    expect(ageFactor(25)).toBe(1.004);
    expect(ageFactor(40)).toBe(1.278);
    expect(ageFactor(64)).toBe(3.0);
  });

  it('returns a finite factor for every age 0 to 64', () => {
    // The prototype's curve jumped from 14 to 21, so a 17-year-old dependent
    // produced NaN. This is the regression test for that.
    for (let age = 0; age <= AGE_CURVE_MAX; age++) {
      expect(Number.isFinite(ageFactor(age)), `age ${age}`).toBe(true);
      expect(ageFactor(age)).toBeGreaterThan(0);
    }
  });

  it('never decreases with age', () => {
    for (let age = 1; age <= AGE_CURVE_MAX; age++) {
      expect(ageFactor(age), `age ${age}`).toBeGreaterThanOrEqual(ageFactor(age - 1));
    }
  });

  it('keeps ages 15 to 20 between the child band and the adult base', () => {
    // These six factors are unconfirmed, so we assert only that they are
    // plausible and ordered, not their exact values.
    for (let age = 15; age <= 20; age++) {
      expect(ageFactor(age)).toBeGreaterThan(0.765);
      expect(ageFactor(age)).toBeLessThan(1.0);
    }
  });

  it('honours the 3:1 limit on adult age rating', () => {
    expect(respectsAgeRatingLimit()).toBe(true);
    expect(ageFactor(64) / ageFactor(21)).toBeLessThanOrEqual(AGE_RATING_MAX_RATIO + 1e-9);
  });

  it('rejects a curve that breaks the 3:1 limit', () => {
    expect(respectsAgeRatingLimit({ ...FEDERAL_AGE_CURVE, 64: 4 })).toBe(false);
  });

  it('clamps ages beyond the curve to its top and bottom bands', () => {
    expect(ageFactor(80)).toBe(ageFactor(64));
    expect(ageFactor(-3)).toBe(ageFactor(0));
  });

  it('throws rather than returning NaN when a curve has a hole', () => {
    const gappy: Record<number, number> = { ...FEDERAL_AGE_CURVE };
    delete gappy[17];
    expect(() => ageFactor(17, gappy)).toThrow(/incomplete/);
  });
});

describe('re-basing a premium to another age', () => {
  it('leaves the premium alone at its own quoted age', () => {
    expect(premiumForAge(651, 40, 40)).toBeCloseTo(651, 6);
  });

  it('prices a 60-year-old above a 40-year-old on the same plan', () => {
    // 2.714 / 1.278 = 2.123x
    expect(premiumForAge(651, 40, 60)).toBeCloseTo(651 * (2.714 / 1.278), 6);
  });

  it('reproduces the prototype premium for each persona age', () => {
    // The plan-picker prototype's own arithmetic, so its figures still hold.
    expect(premiumForAge(426, 40, 27)).toBeCloseTo(426 * (1.048 / 1.278), 6);
    expect(premiumForAge(651, 40, 34)).toBeCloseTo(651 * (1.214 / 1.278), 6);
    expect(premiumForAge(570, 40, 60)).toBeCloseTo(570 * (2.714 / 1.278), 6);
  });

  it('is symmetric: there and back is the original', () => {
    expect(premiumForAge(premiumForAge(500, 30, 55), 55, 30)).toBeCloseTo(500, 6);
  });
});

describe('the dataset trend', () => {
  it('applies the trend to the plan year', () => {
    const trended: PlanDataset = { ...dataset, premiumTrend: 1.15 };
    expect(grossPremium(plan('C', 'Silver', 651), 40, trended)).toBeCloseTo(651 * 1.15, 6);
  });

  it('leaves an untrended dataset untouched', () => {
    expect(grossPremium(plan('C', 'Silver', 651), 40, dataset)).toBeCloseTo(651, 6);
  });
});

describe('an allowance against a premium', () => {
  it('reduces the premium', () => {
    expect(netPremium(651, 400)).toBe(251);
  });

  it('never pays cash when it exceeds the premium', () => {
    expect(netPremium(300, 500)).toBe(0);
    expect(allowanceUsed(300, 500)).toBe(300);
  });

  it('is fully used when the premium exceeds it', () => {
    expect(allowanceUsed(651, 400)).toBe(400);
  });
});

describe('silver plan benchmarks', () => {
  it('uses the lowest-cost silver plan for affordability', () => {
    expect(lowestCostSilverPremium(dataset, 40)).toBeCloseTo(651, 6);
  });

  it('uses the second-lowest-cost silver plan for the tax credit benchmark', () => {
    // These are different plans, and conflating them is the mistake the
    // prototypes made by calling both "benchmark silver".
    expect(benchmarkSilverPremium(dataset, 40)).toBeCloseTo(661, 6);
  });

  it('falls back to the only silver plan where there is just one', () => {
    const thin: PlanDataset = { ...dataset, plans: [plan('A', 'Bronze', 426), plan('C', 'Silver', 651)] };
    expect(benchmarkSilverPremium(thin, 40)).toBeCloseTo(651, 6);
  });

  it('throws where a dataset sells no silver plan at all', () => {
    const noSilver: PlanDataset = { ...dataset, plans: [plan('A', 'Bronze', 426)] };
    expect(() => lowestCostSilverPremium(noSilver, 40)).toThrow(/no silver plan/);
  });
});
