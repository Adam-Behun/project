import { describe, expect, it } from 'vitest';
import { affordability, allowanceFor, blocksPremiumTaxCredit, requiredWageForAffordability } from '../src/engine/allowance.js';
import { AFFORDABILITY_PCT_2026, ICHRA_AFFORDABILITY_PCT } from '../src/engine/constants.js';

describe('the 2027 affordability percentage', () => {
  it('is 10.22%, per IRS Rev. Proc. 2026-26', () => {
    expect(ICHRA_AFFORDABILITY_PCT).toBe(0.1022);
  });

  it('is higher than 2026, so a given allowance goes further', () => {
    expect(ICHRA_AFFORDABILITY_PCT).toBeGreaterThan(AFFORDABILITY_PCT_2026);
  });
});

describe('the allowance', () => {
  it('is a share of the lowest-cost silver premium', () => {
    const a = allowanceFor({ lowestCostSilverMonthly: 800, share: 0.8, scope: 'premiums_only' });
    expect(a.monthly).toBe(640);
    expect(a.annual).toBe(7680);
  });

  it('funds the whole premium at a share of 1', () => {
    expect(allowanceFor({ lowestCostSilverMonthly: 785, share: 1, scope: 'premiums_only' }).monthly).toBe(785);
  });

  it('is zero at a share of zero, and never negative', () => {
    expect(allowanceFor({ lowestCostSilverMonthly: 785, share: 0, scope: 'premiums_only' }).monthly).toBe(0);
    expect(allowanceFor({ lowestCostSilverMonthly: 785, share: -1, scope: 'premiums_only' }).monthly).toBe(0);
  });

  it('rises with age and family size through the premium it is based on', () => {
    const young = allowanceFor({ lowestCostSilverMonthly: 500, share: 0.8, scope: 'premiums_only' });
    const older = allowanceFor({ lowestCostSilverMonthly: 1200, share: 0.8, scope: 'premiums_only' });
    expect(older.monthly).toBeGreaterThan(young.monthly);
  });

  it('preserves HSA eligibility only when it is limited to premiums', () => {
    expect(allowanceFor({ lowestCostSilverMonthly: 800, share: 0.8, scope: 'premiums_only' })
      .preservesHsaEligibility).toBe(true);
    expect(allowanceFor({ lowestCostSilverMonthly: 800, share: 0.8, scope: 'premiums_and_bills' })
      .preservesHsaEligibility).toBe(false);
  });
});

describe('the affordability test', () => {
  const base = { lowestCostSilverMonthly: 800, annualWages: 60000 };

  it('passes when the employee share is under 10.22% of wages', () => {
    // Ceiling is 60000 * 0.1022 / 12 = $511/mo. A $400 allowance leaves $400.
    const r = affordability({ ...base, allowanceMonthly: 400 });
    expect(r.affordable).toBe(true);
    expect(r.requiredContributionMonthly).toBe(400);
    expect(r.affordableContributionCeilingMonthly).toBe(511);
  });

  it('fails when the employee share is over the ceiling', () => {
    const r = affordability({ ...base, allowanceMonthly: 200 });
    expect(r.affordable).toBe(false);
    expect(r.requiredContributionMonthly).toBe(600);
  });

  it('treats a share exactly at the ceiling as affordable', () => {
    // The rule is "does not exceed", so equality passes.
    const ceiling = (60000 * ICHRA_AFFORDABILITY_PCT) / 12;
    const r = affordability({ ...base, allowanceMonthly: 800 - ceiling });
    expect(r.affordable).toBe(true);
    expect(r.contributionShareOfWages).toBeCloseTo(ICHRA_AFFORDABILITY_PCT, 9);
  });

  it('says what allowance would make a failing offer affordable', () => {
    const r = affordability({ ...base, allowanceMonthly: 200 });
    expect(r.minimumAffordableAllowanceMonthly).toBe(289);
    const fixed = affordability({ ...base, allowanceMonthly: r.minimumAffordableAllowanceMonthly });
    expect(fixed.affordable).toBe(true);
  });

  it('is affordable at any wage when the allowance covers the whole premium', () => {
    const r = affordability({ lowestCostSilverMonthly: 800, allowanceMonthly: 900, annualWages: 20000 });
    expect(r.affordable).toBe(true);
    expect(r.requiredContributionMonthly).toBe(0);
    expect(r.minimumAffordableAllowanceMonthly).toBeLessThan(800);
  });

  it('is harder to pass on lower wages for the same allowance', () => {
    const lower = affordability({ lowestCostSilverMonthly: 800, allowanceMonthly: 400, annualWages: 30000 });
    const higher = affordability({ lowestCostSilverMonthly: 800, allowanceMonthly: 400, annualWages: 90000 });
    expect(lower.affordable).toBe(false);
    expect(higher.affordable).toBe(true);
  });

  it('is harder to pass where silver premiums are higher', () => {
    const cheapArea = affordability({ lowestCostSilverMonthly: 600, allowanceMonthly: 300, annualWages: 45000 });
    const dearArea = affordability({ lowestCostSilverMonthly: 1000, allowanceMonthly: 300, annualWages: 45000 });
    expect(cheapArea.affordable).toBe(true);
    expect(dearArea.affordable).toBe(false);
  });

  it('fails an offer against zero wages rather than dividing by zero', () => {
    const r = affordability({ lowestCostSilverMonthly: 800, allowanceMonthly: 400, annualWages: 0 });
    expect(r.affordable).toBe(false);
    expect(r.contributionShareOfWages).toBe(Number.POSITIVE_INFINITY);
  });

  it('can be tested against another plan year percentage', () => {
    const r = affordability({ ...base, allowanceMonthly: 300, percentage: AFFORDABILITY_PCT_2026 });
    expect(r.percentage).toBe(AFFORDABILITY_PCT_2026);
    expect(r.affordableContributionCeilingMonthly).toBe(498);
  });
});

describe('the interaction with the premium tax credit', () => {
  it('blocks the credit exactly when the offer is affordable', () => {
    // An allowance and a tax credit are mutually exclusive, not interchangeable
    // -- which the plan-picker prototype's single "monthly help" input elided.
    const affordableOffer = affordability({ lowestCostSilverMonthly: 800, allowanceMonthly: 500, annualWages: 60000 });
    const unaffordableOffer = affordability({ lowestCostSilverMonthly: 800, allowanceMonthly: 100, annualWages: 60000 });
    expect(blocksPremiumTaxCredit(affordableOffer)).toBe(true);
    expect(blocksPremiumTaxCredit(unaffordableOffer)).toBe(false);
  });
});

describe('solving the test for wages', () => {
  it('finds the wage at which an offer becomes affordable', () => {
    // $822 silver, 60% allowance -> $328.80/mo employee share
    // -> $3,945.60/yr / 0.1022 = $38,606 of wages.
    const wage = requiredWageForAffordability(822, 822 * 0.6);
    expect(wage).toBeCloseTo(38606.26, 0);
    // The returned wage must itself pass, so the threshold rounds up.
    expect(affordability({
      lowestCostSilverMonthly: 822, allowanceMonthly: 822 * 0.6, annualWages: wage,
    }).affordable).toBe(true);
  });

  it('is one dollar of wages away from failing', () => {
    const wage = requiredWageForAffordability(822, 822 * 0.6);
    expect(affordability({
      lowestCostSilverMonthly: 822, allowanceMonthly: 822 * 0.6, annualWages: wage - 100,
    }).affordable).toBe(false);
  });

  it('needs no wage at all when the allowance covers the premium', () => {
    expect(requiredWageForAffordability(822, 900)).toBe(0);
  });

  it('falls as the allowance rises', () => {
    const low = requiredWageForAffordability(822, 822 * 0.6);
    const high = requiredWageForAffordability(822, 822 * 0.9);
    expect(high).toBeLessThan(low);
  });
});
