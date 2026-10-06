import { describe, expect, it } from 'vitest';
import { careTeamFor, project } from '../src/engine/projection.js';
import { flagsFor, rankPlans } from '../src/engine/ranking.js';
import { buildScenario, typicalScenario, applyFormulary } from '../src/engine/simulate.js';
import { rngFrom } from '../src/engine/random.js';
import { SIMULATION_YEARS } from '../src/engine/constants.js';
import { context, dataset, drugs, persona, PERSONA_IDS, providers } from './fixtures.js';
import type { PlanOutcome } from '../src/engine/types.js';

const rankFor = (id: string, monthlyHelp = 0, years = 200) => {
  const profile = persona(id);
  return rankPlans({
    dataset: dataset(), providers: providers(), context: context(),
    projection: project(profile), careTeam: careTeamFor(profile),
    age: profile.age, monthlyHelp, years,
  });
};

describe('building a simulated year', () => {
  it('orders claims by month, because cost sharing is path-dependent', () => {
    const scenario = buildScenario(project(persona('transplant')), context(), rngFrom(1), {}, false);
    const months = scenario.map((c) => c.month);
    expect(months).toEqual([...months].sort((a, b) => a - b));
  });

  it('is deterministic for a given seed', () => {
    const build = () => buildScenario(project(persona('cancer')), context(), rngFrom(42), {}, false);
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it('produces different years from different seeds', () => {
    const a = buildScenario(project(persona('cancer')), context(), rngFrom(1), {}, false);
    const b = buildScenario(project(persona('cancer')), context(), rngFrom(999), {}, false);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('drops the care in a group that has been switched off', () => {
    const projection = project(persona('transplant'));
    const withClinic = typicalScenario(projection, context(), {});
    const withoutClinic = typicalScenario(projection, context(), { transplant: false });
    expect(withoutClinic.length).toBeLessThan(withClinic.length);
    expect(withoutClinic.some((c) => c.label?.includes('Envarsus'))).toBe(true);
  });

  it('resolves events to their expected value in the typical year', () => {
    // A 32% chance of a caesarean does not happen in the typical year; a
    // certainty would.
    const projection = project(persona('pregnancy'));
    const typical = typicalScenario(projection, context(), {});
    expect(typical.some((c) => c.label === 'C-section')).toBe(false);
    expect(typical.some((c) => c.category === 'delivery')).toBe(true);
  });

  it('spreads monthly labs across the whole year', () => {
    const typical = typicalScenario(project(persona('transplant')), context(), {});
    const labMonths = typical.filter((c) => c.category === 'labs').map((c) => c.month);
    expect(new Set(labMonths).size).toBeGreaterThan(6);
  });
});

describe('the formulary', () => {
  it('substitutes the covered alternative where a drug is not covered', () => {
    const plans = dataset().plans;
    const notCovered = plans.find((p) => p.formulary.envarsus === 'not_covered');
    const covered = plans.find((p) => p.formulary.envarsus === 'pa');
    expect(notCovered).toBeDefined();
    expect(covered).toBeDefined();

    const claims = [{ category: 'specialty' as const, allowedAmount: 1100, month: 1, label: 'Envarsus XR (tacrolimus, anti-rejection)' }];
    const substituted = applyFormulary(claims, notCovered!, drugs());
    const untouched = applyFormulary(claims, covered!, drugs());

    expect(substituted[0]?.allowedAmount).toBe(60);
    expect(substituted[0]?.category).toBe('generic');
    expect(untouched[0]?.allowedAmount).toBe(1100);
  });
});

describe('flagging a plan', () => {
  it('flags losing a critical provider as high severity', () => {
    const profile = persona('transplant');
    const input = { careTeam: careTeamFor(profile), providers: providers(), projection: project(profile), context: context() };
    const withoutTransplant = dataset().plans.find((p) => !p.network.includes('transplant'))!;
    const flags = flagsFor(withoutTransplant, input);
    const high = flags.filter((f) => f.severity === 'high');
    expect(high.length).toBeGreaterThan(0);
    expect(high.some((f) => /out of network/.test(f.text))).toBe(true);
  });

  it('flags an uncovered critical drug as high severity, with the cash cost', () => {
    const profile = persona('transplant');
    const input = { careTeam: careTeamFor(profile), providers: providers(), projection: project(profile), context: context() };
    const noEnvarsus = dataset().plans.find((p) => p.formulary.envarsus === 'not_covered')!;
    const flags = flagsFor(noEnvarsus, input);
    expect(flags.some((f) => f.severity === 'high' && /isn't covered/.test(f.text))).toBe(true);
    expect(flags.some((f) => /\$13,200 a year/.test(f.text))).toBe(true);
  });

  it('treats prior authorization as a note, not a disruption', () => {
    const profile = persona('transplant');
    const input = { careTeam: careTeamFor(profile), providers: providers(), projection: project(profile), context: context() };
    const withPa = dataset().plans.find((p) => p.formulary.envarsus === 'pa' && p.network.includes('transplant'))!;
    const flags = flagsFor(withPa, input);
    expect(flags.some((f) => f.severity === 'note' && /prior authorization/.test(f.text))).toBe(true);
    expect(flags.filter((f) => f.severity === 'high')).toHaveLength(0);
  });

  it('notes HSA eligibility', () => {
    const profile = persona('healthy');
    const input = { careTeam: careTeamFor(profile), providers: providers(), projection: project(profile), context: context() };
    const hsaPlan = dataset().plans.find((p) => p.hsaEligible)!;
    expect(flagsFor(hsaPlan, input).some((f) => /HSA-eligible/.test(f.text))).toBe(true);
  });

  it('flags nothing clinical for someone with no care team and no drugs', () => {
    const profile = persona('healthy');
    const input = { careTeam: careTeamFor(profile), providers: providers(), projection: project(profile), context: context() };
    for (const plan of dataset().plans) {
      expect(flagsFor(plan, input).filter((f) => f.severity === 'high'), plan.id).toHaveLength(0);
    }
  });
});

describe('ranking plans', () => {
  it('ranks every plan that would disrupt care below every plan that would not', () => {
    // The central requirement: price never promotes a plan that breaks care.
    const result = rankFor('transplant');
    const disrupting = result.ranked.findIndex((o) => o.disruptsCare);
    expect(disrupting).toBeGreaterThan(0);
    const after = result.ranked.slice(disrupting);
    expect(after.every((o) => o.disruptsCare)).toBe(true);
  });

  it('never recommends a plan that would disrupt care when another exists', () => {
    for (const id of PERSONA_IDS) {
      const result = rankFor(id);
      if (result.ranked.some((o) => !o.disruptsCare)) {
        expect(result.best.disruptsCare, id).toBe(false);
      }
    }
  });

  it('recommends a plan that costs more than the cheapest when the cheapest breaks care', () => {
    const result = rankFor('transplant');
    if (result.cheapestOverall.disruptsCare) {
      expect(result.best.meanTotal).toBeGreaterThanOrEqual(result.cheapestOverall.meanTotal);
      expect(result.best).not.toBe(result.cheapestOverall);
    }
  });

  it('orders plans by expected total within each disruption tier', () => {
    const result = rankFor('cancer');
    const tiers = [false, true].map((flag) => result.ranked.filter((o) => o.disruptsCare === flag));
    for (const tier of tiers) {
      const totals = tier.map((o) => o.meanTotal);
      expect(totals).toEqual([...totals].sort((a, b) => a - b));
    }
  });

  it('identifies the plan someone would pick on premium alone', () => {
    const result = rankFor('pregnancy');
    const cheapestPremium = Math.min(...result.ranked.map((o) => o.netPremium));
    expect(result.lowestPremium.netPremium).toBeCloseTo(cheapestPremium, 6);
  });

  it('does not recommend the lowest-premium plan', () => {
    // The entire premise of the employee view: premium is not the price.
    const result = rankFor('transplant');
    expect(result.best).not.toBe(result.lowestPremium);
  });

  it('only recommends a dearer plan than the lowest premium when that plan breaks care', () => {
    // Where the recommendation costs MORE than the cheapest premium, there has
    // to be a reason, and the only admissible reason is care disruption.
    for (const id of PERSONA_IDS) {
      const result = rankFor(id);
      if (result.savingsOverLowestPremium < 0) {
        expect(result.lowestPremium.disruptsCare, id).toBe(true);
        expect(result.best.disruptsCare, id).toBe(false);
      }
    }
  });

  it('beats the lowest-premium plan on cost whenever that plan keeps care', () => {
    for (const id of PERSONA_IDS) {
      const result = rankFor(id);
      if (!result.lowestPremium.disruptsCare) {
        expect(result.savingsOverLowestPremium, id).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('puts the quantiles in order and the mean between them', () => {
    for (const id of PERSONA_IDS) {
      for (const outcome of rankFor(id).ranked) {
        expect(outcome.p10, `${id} ${outcome.plan.id}`).toBeLessThanOrEqual(outcome.p50);
        expect(outcome.p50).toBeLessThanOrEqual(outcome.p90);
        expect(outcome.meanTotal).toBeGreaterThanOrEqual(outcome.p10 - 1e-6);
        expect(outcome.meanTotal).toBeLessThanOrEqual(outcome.p90 + 1e-6);
      }
    }
  });

  it('never exceeds the premium plus the out-of-pocket maximum', () => {
    for (const id of PERSONA_IDS) {
      for (const outcome of rankFor(id).ranked) {
        const ceiling = outcome.netPremium * 12 + outcome.plan.outOfPocketMax + 0.01;
        expect(outcome.p90, `${id} ${outcome.plan.id}`).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  it('is deterministic: the same inputs give the same ranking and the same numbers', () => {
    const a = rankFor('cancer');
    const b = rankFor('cancer');
    expect(a.ranked.map((o) => o.plan.id)).toEqual(b.ranked.map((o) => o.plan.id));
    expect(a.ranked.map((o) => o.meanTotal)).toEqual(b.ranked.map((o) => o.meanTotal));
  });

  it('is stable at a thousand years: the recommendation does not move with more draws', () => {
    const atTwoHundred = rankFor('transplant', 0, 200);
    const atOneThousand = rankFor('transplant', 0, SIMULATION_YEARS);
    expect(atOneThousand.best.plan.id).toBe(atTwoHundred.best.plan.id);
  });

  it('offers a safer alternative only when one is genuinely better in a bad year', () => {
    for (const id of PERSONA_IDS) {
      const result = rankFor(id);
      if (result.safer) {
        expect(result.safer.meanTotal - result.best.meanTotal, id).toBeLessThanOrEqual(250);
        expect(result.best.p90 - result.safer.p90, id).toBeGreaterThanOrEqual(400);
        expect(result.safer.disruptsCare, id).toBe(false);
      }
    }
  });
});

describe('an allowance applied to the ranking', () => {
  it('lowers every plan\'s expected total', () => {
    const without = rankFor('pregnancy', 0);
    const withHelp = rankFor('pregnancy', 400);
    for (const [i, outcome] of withHelp.ranked.entries()) {
      const plain = without.ranked.find((o) => o.plan.id === outcome.plan.id) as PlanOutcome;
      expect(outcome.meanTotal, `${i}`).toBeLessThan(plain.meanTotal);
    }
  });

  it('can change which plan is best, because it compresses premium differences', () => {
    // At a large enough allowance every premium is covered, so the choice is
    // driven entirely by cost sharing.
    const small = rankFor('healthy', 0);
    const large = rankFor('healthy', 3000);
    expect(large.ranked.every((o) => o.netPremium === 0)).toBe(true);
    expect(large.best.plan.id).not.toBe(small.lowestPremium.plan.id);
  });

  it('never pays out cash when the allowance exceeds the premium', () => {
    for (const outcome of rankFor('healthy', 5000).ranked) {
      expect(outcome.netPremium).toBe(0);
      expect(outcome.meanTotal).toBeGreaterThanOrEqual(0);
    }
  });
});
