import { describe, expect, it } from 'vitest';
import {
  careSensitiveConditions, careTeamFor, defaultToggles, project, recentCareSummary,
} from '../src/engine/projection.js';
import { conditionCategories } from '../src/fhir/parse.js';
import { persona, PERSONA_IDS } from './fixtures.js';

describe('projecting care from a record', () => {
  it('gives everyone a check-up and about one sick visit', () => {
    for (const id of PERSONA_IDS) {
      const projection = project(persona(id));
      const baseline = projection.services.filter((s) => s.group === 'baseline');
      expect(baseline.some((s) => s.kind === 'preventive'), id).toBe(true);
      expect(baseline.some((s) => s.kind === 'pcp'), id).toBe(true);
    }
  });

  it('projects nothing but the baseline for someone with no conditions', () => {
    const projection = project(persona('healthy'));
    expect(projection.services.every((s) => s.group === 'baseline')).toBe(true);
    expect(projection.drugs).toHaveLength(0);
    expect(projection.events).toHaveLength(0);
    expect(projection.groups.map((g) => g.id)).toEqual(['baseline']);
  });

  it('projects a delivery and prenatal care from an active pregnancy', () => {
    const projection = project(persona('pregnancy'));
    expect(projection.services.some((s) => s.kind === 'delivery')).toBe(true);
    expect(projection.groups.map((g) => g.id)).toContain('delivery');
    expect(projection.groups.map((g) => g.id)).toContain('prenatal');
    // A caesarean is a possibility, not a certainty.
    const csection = projection.events.find((e) => e.label === 'C-section');
    expect(csection?.probability).toBeGreaterThan(0);
    expect(csection?.probability).toBeLessThan(1);
    expect(projection.reviewNotes.join(' ')).toMatch(/deductible/i);
  });

  it('projects transplant clinic visits, monthly labs and both drugs', () => {
    const projection = project(persona('transplant'));
    expect(projection.groups.map((g) => g.id)).toContain('transplant');
    const labs = projection.services.find((s) => s.group === 'transplant' && s.kind === 'labs');
    expect(labs?.count).toBe(12);
    expect(labs?.months).toBe('spread');
    // Both critical drugs come from the record, not from a persona file.
    expect(projection.drugs.map((d) => d.drugId)).toContain('envarsus');
    expect(projection.drugs.map((d) => d.drugId)).toContain('insulin');
    expect(projection.reviewNotes.join(' ')).toMatch(/tacrolimus levels must be rechecked/);
    expect(projection.reviewNotes.join(' ')).toMatch(/insulin costs the same on every plan/);
  });

  it('projects oncology follow-up and surveillance imaging from a cancer diagnosis', () => {
    const projection = project(persona('cancer'));
    expect(projection.groups.map((g) => g.id)).toContain('oncology');
    expect(projection.services.some((s) => s.kind === 'imaging_adv')).toBe(true);
    expect(projection.reviewNotes.join(' ')).toMatch(/diagnostic, not screening/);
  });

  it('adds high-risk pregnancy visits only where the record supports it', () => {
    const pregnancy = persona('pregnancy');
    const categories = conditionCategories(pregnancy);
    const projection = project(pregnancy);
    const hasRiskFactor = categories.has('prediabetes') || categories.has('obesity');
    expect(projection.groups.some((g) => g.id === 'highrisk_pregnancy')).toBe(hasRiskFactor);
  });

  it('scales the risk of unplanned care with age and chronic illness', () => {
    const healthy = project(persona('healthy')).rates;
    const complex = project(persona('transplant')).rates;
    expect(complex.er).toBeGreaterThan(healthy.er);
    expect(complex.admission).toBeGreaterThan(healthy.admission);
    // Rates are probabilities and rates, not certainties.
    for (const rates of [healthy, complex]) {
      expect(rates.er).toBeGreaterThan(0);
      expect(rates.major).toBeLessThan(0.1);
      expect(rates.admission).toBeLessThan(1);
    }
  });

  it('turns every group on by default', () => {
    for (const id of PERSONA_IDS) {
      const projection = project(persona(id));
      const toggles = defaultToggles(projection);
      expect(Object.keys(toggles).length, id).toBe(projection.groups.length);
      expect(Object.values(toggles).every(Boolean), id).toBe(true);
    }
  });

  it('is deterministic: the same record gives the same projection', () => {
    for (const id of PERSONA_IDS) {
      expect(JSON.stringify(project(persona(id)))).toBe(JSON.stringify(project(persona(id))));
    }
  });
});

describe('the care team', () => {
  it('is derived from conditions, not hand-assigned', () => {
    expect(careTeamFor(persona('healthy'))).toEqual([]);
    expect(careTeamFor(persona('pregnancy'))).toContain('ob');
    expect(careTeamFor(persona('pregnancy'))).toContain('hosp_ob');
    expect(careTeamFor(persona('transplant'))).toContain('transplant');
    expect(careTeamFor(persona('cancer'))).toContain('onc');
  });

  it('never lists the same provider twice', () => {
    for (const id of PERSONA_IDS) {
      const team = careTeamFor(persona(id));
      expect(new Set(team).size, id).toBe(team.length);
    }
  });
});

describe('summarising the record', () => {
  it('says so plainly when there was no care', () => {
    expect(recentCareSummary(persona('healthy'))).toBe('No visits in the past 12 months');
  });

  it('counts recent care for someone who had some', () => {
    expect(recentCareSummary(persona('pregnancy'))).toMatch(/visit/);
  });

  it('lists the conditions that matter when changing plans', () => {
    expect(careSensitiveConditions(persona('transplant')).join(' ')).toMatch(/transplant/i);
    expect(careSensitiveConditions(persona('healthy'))).toEqual([]);
  });
});
