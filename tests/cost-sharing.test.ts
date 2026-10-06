import { describe, expect, it } from 'vitest';
import { applyClaim, evaluateYear, ruleFor, startOfYear } from '../src/engine/cost-sharing.js';
import type { PlanDesign } from '../src/engine/types.js';

/** A plan with one rule per category, so each test can target one rule. */
const plan: PlanDesign = {
  deductible: 2000,
  coinsurance: 0.2,
  outOfPocketMax: 6000,
  hsaEligible: false,
  rules: {
    pcp: { kind: 'copay', amount: 30 },
    specialist: { kind: 'coinsurance', rate: 0.4 },
    er: { kind: 'copay_after_deductible', amount: 500 },
    generic: { kind: 'copay', amount: 10 },
    brand: { kind: 'copay_after_deductible', amount: 50 },
    specialty: { kind: 'coins_after_deductible', rate: 0.3 },
    imaging: { kind: 'deductible' },
  },
};

const claim = (category: Parameters<typeof applyClaim>[1]['category'], allowedAmount: number, month = 1) =>
  ({ category, allowedAmount, month }) as const;

describe('copay', () => {
  it('charges the flat amount and leaves the deductible untouched', () => {
    const { explanation, ytd } = applyClaim(plan, claim('pcp', 165), startOfYear(plan));
    expect(explanation.patientPaid).toBe(30);
    expect(explanation.planPaid).toBe(135);
    expect(explanation.ruleApplied).toBe('copay');
    expect(explanation.towardDeductible).toBe(0);
    expect(ytd.deductibleRemaining).toBe(2000);
  });

  it('never charges more than the allowed amount', () => {
    const { explanation } = applyClaim(plan, claim('pcp', 18), startOfYear(plan));
    expect(explanation.patientPaid).toBe(18);
    expect(explanation.planPaid).toBe(0);
  });
});

describe('deductible', () => {
  it('charges the full allowed amount while the deductible is unmet', () => {
    const { explanation, ytd } = applyClaim(plan, claim('imaging', 450), startOfYear(plan));
    expect(explanation.patientPaid).toBe(450);
    expect(explanation.towardDeductible).toBe(450);
    expect(ytd.deductibleRemaining).toBe(1550);
  });

  it('splits a claim that straddles the deductible, then applies coinsurance', () => {
    // $3,000 claim against a $2,000 deductible: $2,000 in full, then 20% of $1,000.
    const { explanation, ytd } = applyClaim(plan, claim('imaging', 3000), startOfYear(plan));
    expect(explanation.towardDeductible).toBe(2000);
    expect(explanation.patientPaid).toBe(2200);
    expect(ytd.deductibleRemaining).toBe(0);
  });

  it('applies only coinsurance once the deductible is met', () => {
    const met = { deductibleRemaining: 0, outOfPocketSoFar: 2000 };
    const { explanation } = applyClaim(plan, claim('imaging', 1000), met);
    expect(explanation.patientPaid).toBe(200);
    expect(explanation.planPaid).toBe(800);
    expect(explanation.towardDeductible).toBe(0);
  });
});

describe('coinsurance', () => {
  it('charges a fixed share without touching the deductible', () => {
    const { explanation, ytd } = applyClaim(plan, claim('specialist', 275), startOfYear(plan));
    expect(explanation.patientPaid).toBeCloseTo(110, 2);
    expect(explanation.planPaid).toBeCloseTo(165, 2);
    expect(ytd.deductibleRemaining).toBe(2000);
  });
});

describe('copay after deductible', () => {
  it('charges the deductible first', () => {
    const { explanation } = applyClaim(plan, claim('er', 2600), startOfYear(plan));
    // $2,000 deductible, then a $500 copay on the remaining $600.
    expect(explanation.towardDeductible).toBe(2000);
    expect(explanation.patientPaid).toBe(2500);
  });

  it('charges only the copay once the deductible is met', () => {
    const met = { deductibleRemaining: 0, outOfPocketSoFar: 2000 };
    const { explanation } = applyClaim(plan, claim('er', 2600), met);
    expect(explanation.patientPaid).toBe(500);
  });

  it('never charges more than the amount left after the deductible', () => {
    const met = { deductibleRemaining: 0, outOfPocketSoFar: 2000 };
    const { explanation } = applyClaim(plan, claim('brand', 30), met);
    expect(explanation.patientPaid).toBe(30);
  });
});

describe('coinsurance after deductible', () => {
  it('uses its own rate, not the plan default, past the deductible', () => {
    const met = { deductibleRemaining: 0, outOfPocketSoFar: 2000 };
    const { explanation } = applyClaim(plan, claim('specialty', 1100), met);
    // 30% specialty rate, not the plan's 20% default.
    expect(explanation.patientPaid).toBe(330);
    expect(explanation.ruleApplied).toBe('coins_after_deductible');
  });
});

describe('preventive care', () => {
  it('is free and does not touch the deductible', () => {
    const { explanation, ytd } = applyClaim(plan, claim('preventive', 400), startOfYear(plan));
    expect(explanation.patientPaid).toBe(0);
    expect(explanation.planPaid).toBe(400);
    expect(explanation.ruleApplied).toBe('preventive_no_cost');
    expect(ytd.deductibleRemaining).toBe(2000);
  });
});

describe('out-of-pocket maximum', () => {
  it('caps the member share and records the cap', () => {
    const nearly = { deductibleRemaining: 0, outOfPocketSoFar: 5800 };
    const { explanation, ytd } = applyClaim(plan, claim('imaging', 10000), nearly);
    expect(explanation.patientPaid).toBe(200);
    expect(explanation.cappedBy).toBe('oop_max');
    expect(explanation.oopRemaining).toBe(0);
    expect(ytd.outOfPocketSoFar).toBe(6000);
  });

  it('charges nothing once the maximum is reached', () => {
    const done = { deductibleRemaining: 0, outOfPocketSoFar: 6000 };
    const { explanation } = applyClaim(plan, claim('admission', 24000), done);
    expect(explanation.patientPaid).toBe(0);
    expect(explanation.planPaid).toBe(24000);
  });

  it('holds across a whole year of catastrophic care', () => {
    const year = evaluateYear(plan, [
      claim('admission', 24000, 2),
      claim('admission', 24000, 5),
      claim('er', 2600, 9),
    ]);
    expect(year.outOfPocket).toBe(6000);
  });
});

describe('state insulin caps', () => {
  const insulin = claim('insulin', 340);

  it('caps Texas insulin at $25 per 30-day fill, even before the deductible', () => {
    const { explanation } = applyClaim(plan, insulin, startOfYear(plan), 'TX');
    expect(explanation.patientPaid).toBe(25);
    expect(explanation.cappedBy).toBe('state_insulin_cap');
  });

  it('caps New Jersey insulin at $35 and exempts it from the deductible', () => {
    const { explanation, ytd } = applyClaim(plan, insulin, startOfYear(plan), 'NJ');
    expect(explanation.patientPaid).toBe(35);
    expect(explanation.towardDeductible).toBe(0);
    expect(ytd.deductibleRemaining).toBe(2000);
  });

  it('charges nothing for insulin in New York', () => {
    const { explanation } = applyClaim(plan, insulin, startOfYear(plan), 'NY');
    expect(explanation.patientPaid).toBe(0);
    expect(explanation.planPaid).toBe(340);
    expect(explanation.cappedBy).toBe('state_insulin_cap');
  });

  it('applies the plan brand rule where no state cap exists', () => {
    const met = { deductibleRemaining: 0, outOfPocketSoFar: 2000 };
    const { explanation } = applyClaim(plan, insulin, met, 'FL');
    expect(explanation.patientPaid).toBe(50);
    expect(explanation.cappedBy).toBe(null);
  });

  it('does not charge the cap when the plan would charge less', () => {
    const cheap: PlanDesign = { ...plan, rules: { ...plan.rules, brand: { kind: 'copay', amount: 5 } } };
    const { explanation } = applyClaim(cheap, insulin, startOfYear(cheap), 'TX');
    expect(explanation.patientPaid).toBe(5);
    expect(explanation.cappedBy).toBe(null);
  });

  it('prices twelve Texas fills at $300 for the year', () => {
    const fills = Array.from({ length: 12 }, (_, i) => claim('insulin', 340, i + 1));
    expect(evaluateYear(plan, fills, 'TX').outOfPocket).toBe(300);
  });
});

describe('rule selection', () => {
  it('forces the deductible for facility and diagnostic care', () => {
    for (const category of ['labs', 'imaging_adv', 'delivery', 'admission', 'event'] as const) {
      expect(ruleFor(plan, category)).toEqual({ kind: 'deductible' });
    }
  });

  it('prices insulin under the brand rule before any state cap', () => {
    expect(ruleFor(plan, 'insulin')).toEqual(plan.rules.brand);
  });

  it('falls back to the deductible for a category the plan does not price', () => {
    expect(ruleFor(plan, 'imaging_adv')).toEqual({ kind: 'deductible' });
  });
});

describe('the explanation', () => {
  it('always balances: member plus plan equals the allowed amount', () => {
    const claims = [
      claim('pcp', 165, 1), claim('specialist', 275, 2), claim('imaging', 3000, 3),
      claim('er', 2600, 4), claim('preventive', 400, 5), claim('specialty', 1100, 6),
    ];
    for (const c of evaluateYear(plan, claims).claims) {
      expect(c.patientPaid + c.planPaid).toBeCloseTo(c.allowedAmount, 2);
    }
  });

  it('reports balances that fall monotonically through the year', () => {
    const claims = Array.from({ length: 8 }, (_, i) => claim('imaging', 500, i + 1));
    const { claims: explained } = evaluateYear(plan, claims);
    const deductibles = explained.map((c) => c.deductibleRemaining);
    const oop = explained.map((c) => c.oopRemaining);
    expect(deductibles).toEqual([...deductibles].sort((a, b) => b - a));
    expect(oop).toEqual([...oop].sort((a, b) => b - a));
    expect(deductibles.at(-1)).toBe(0);
  });

  it('records the month and label it was given', () => {
    const { claims: explained } = evaluateYear(plan, [
      { category: 'event', allowedAmount: 35000, month: 7, label: 'Workup for possible recurrence' },
    ]);
    expect(explained[0]?.month).toBe(7);
    expect(explained[0]?.label).toBe('Workup for possible recurrence');
  });

  it('can be switched off for the simulation hot path', () => {
    const year = evaluateYear(plan, [claim('pcp', 165)], undefined, { collectClaims: false });
    expect(year.claims).toHaveLength(0);
    expect(year.outOfPocket).toBe(30);
  });
});

describe('path dependence', () => {
  it('costs the member more when the big claim comes first', () => {
    const early = evaluateYear(plan, [claim('delivery', 16000, 1), claim('pcp', 165, 6)]);
    const late = evaluateYear(plan, [claim('pcp', 165, 1), claim('delivery', 16000, 12)]);
    // Same care, same total -- but January's delivery front-loads the cost.
    expect(early.byMonth[0]).toBeGreaterThan(late.byMonth[0] as number);
    expect(early.outOfPocket).toBe(late.outOfPocket);
  });
});
