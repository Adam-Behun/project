import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  activeConditions, activeMedications, ageOn, cleanDisplay, conditionCategories,
  displayConditions, latestObservation, parseBundle, parseBundleJson, stripSyntheaSuffix,
} from '../src/fhir/parse.js';
import {
  conditionCategory, drugCategory, EMPLOYER_EXCLUDED_CATEGORIES, isCareSensitive,
  isContinuityCritical, shortDrugName,
} from '../src/fhir/codes.js';
import type { PatientProfile } from '../src/fhir/types.js';

const FHIR_DIR = join(import.meta.dirname, '..', 'data', 'fhir');
/** Every projection is made from this date, so ages and recency are stable. */
const AS_OF = new Date('2026-10-06T00:00:00Z');

const load = (id: string): PatientProfile =>
  parseBundleJson(readFileSync(join(FHIR_DIR, `${id}.json`), 'utf8'), { asOf: AS_OF });

describe('coding conditions', () => {
  it('maps the SNOMED codes Synthea emits', () => {
    expect(conditionCategory('44054006', 'Diabetes mellitus type 2 (disorder)')).toBe('diabetes');
    expect(conditionCategory('161665007', 'History of renal transplant (situation)')).toBe('transplant');
    expect(conditionCategory('254837009', 'Malignant neoplasm of breast (disorder)')).toBe('cancer');
    expect(conditionCategory('72892002', 'Normal pregnancy (finding)')).toBe('pregnancy');
    expect(conditionCategory('59621000', 'Essential hypertension (disorder)')).toBe('hypertension');
  });

  it('separates prediabetes from diabetes', () => {
    // Prediabetes raises risk but does not imply diabetes care next year, and
    // the two must not share a projection.
    expect(conditionCategory('15777000', 'Prediabetes (finding)')).toBe('prediabetes');
    expect(conditionCategory(undefined, 'Prediabetes (finding)')).toBe('prediabetes');
  });

  it('falls back to display text for a code it has never seen', () => {
    expect(conditionCategory('999999999', 'Asthma (disorder)')).toBe('asthma_copd');
    expect(conditionCategory(undefined, 'Chronic kidney disease stage 3 (disorder)')).toBe('kidney_disease');
  });

  it('returns "other" rather than guessing', () => {
    expect(conditionCategory(undefined, 'Something nobody has coded')).toBe('other');
    expect(conditionCategory(undefined, undefined)).toBe('other');
  });

  it('routes sensitive care to the excluded categories, not a clinical one', () => {
    // These must not be reachable by a pattern that would also match a
    // category the employer view is allowed to show.
    expect(conditionCategory(undefined, 'Miscarriage in first trimester (disorder)')).toBe('reproductive');
    expect(conditionCategory(undefined, 'Major depressive disorder (disorder)')).toBe('behavioral_health');
    expect(conditionCategory(undefined, 'Opioid abuse (disorder)')).toBe('substance_use');
    expect(conditionCategory(undefined, 'Unhealthy alcohol drinking behavior (finding)')).toBe('substance_use');
    for (const category of EMPLOYER_EXCLUDED_CATEGORIES) {
      expect(isCareSensitive(category)).toBe(false);
    }
  });

  it('marks the categories that change next year\'s care', () => {
    expect(isCareSensitive('transplant')).toBe(true);
    expect(isCareSensitive('pregnancy')).toBe(true);
    expect(isCareSensitive('dental')).toBe(false);
    expect(isCareSensitive('social')).toBe(false);
  });
});

describe('coding medications', () => {
  it('recognises insulin and anti-rejection drugs', () => {
    expect(drugCategory('insulin isophane, human 70 UNT/ML [Humulin]')).toBe('insulin');
    expect(drugCategory('24 HR tacrolimus 1 MG Extended Release Oral Tablet [Envarsus]')).toBe('immunosuppressant');
  });

  it('recognises inhalers without catching other metered sprays', () => {
    expect(drugCategory('60 ACTUAT Fluticasone propionate / salmeterol Dry Powder Inhaler')).toBe('inhaler');
    expect(drugCategory('albuterol 0.83 MG/ML Inhalation Solution')).toBe('inhaler');
    // Nitroglycerin is dosed in actuations too, and is not an inhaler.
    expect(drugCategory('Nitroglycerin 0.4 MG/ACTUAT Mucosal Spray')).toBe('generic');
  });

  it('treats a plain generic as generic and a trade name as brand', () => {
    expect(drugCategory('lisinopril 10 MG Oral Tablet')).toBe('generic');
    expect(drugCategory('Acetaminophen 325 MG Oral Tablet [Tylenol]')).toBe('brand');
  });

  it('flags the drugs that cannot be switched casually', () => {
    expect(isContinuityCritical('immunosuppressant')).toBe(true);
    expect(isContinuityCritical('insulin')).toBe(true);
    expect(isContinuityCritical('generic')).toBe(false);
  });

  it('shortens a Synthea drug string to something readable', () => {
    expect(shortDrugName('24 HR tacrolimus 1 MG Extended Release Oral Tablet [Envarsus]')).toBe('Envarsus');
    expect(shortDrugName('lisinopril 10 MG Oral Tablet')).toBe('lisinopril');
  });
});

describe('parsing a bundle', () => {
  it('rejects input that is not a bundle', () => {
    expect(() => parseBundleJson('not json')).toThrow(/valid JSON/);
    expect(() => parseBundleJson('null')).toThrow(/not an object/);
    expect(() => parseBundle({ resourceType: 'Bundle', entry: [] })).toThrow(/no Patient/);
  });

  it('survives a bundle full of malformed resources', () => {
    // External data: a missing code, a wrongly typed field or an unknown
    // resource type must not throw.
    const profile = parseBundle({
      resourceType: 'Bundle',
      entry: [
        { resource: { resourceType: 'Patient', id: 'p1', birthDate: '1990-05-05', name: [{ use: 'official', given: ['Ada7'], family: 'Byron3' }] } },
        { resource: { resourceType: 'Condition' } },
        { resource: { resourceType: 'Condition', code: { coding: [] } } },
        { resource: { resourceType: 'MedicationRequest', medicationCodeableConcept: { text: 'Aspirin' }, status: 'active' } },
        { resource: { resourceType: 'Observation', code: { coding: [{ display: 'Body Weight' }] }, valueQuantity: { value: 'heavy' } } },
        { resource: { resourceType: 'Whatever' } },
        { resource: undefined },
        {},
      ],
    }, { asOf: AS_OF });
    expect(profile.firstName).toBe('Ada');
    expect(profile.lastName).toBe('Byron');
    expect(profile.conditions).toHaveLength(0);
    expect(profile.medications).toHaveLength(1);
    expect(profile.observations[0]?.value).toBeUndefined();
    expect(profile.recordCounts.Unknown).toBe(2);
  });

  it('counts every resource type in the bundle', () => {
    const profile = parseBundle({
      resourceType: 'Bundle',
      entry: [
        { resource: { resourceType: 'Patient', id: 'p', birthDate: '1980-01-01' } },
        { resource: { resourceType: 'Encounter' } },
        { resource: { resourceType: 'Encounter' } },
      ],
    }, { asOf: AS_OF });
    expect(profile.recordCounts).toEqual({ Patient: 1, Encounter: 2 });
    expect(profile.totalResources).toBe(3);
  });

  it('computes age on the projection date, not today', () => {
    expect(ageOn('1990-05-05', AS_OF)).toBe(36);
    // A birthday later in the year has not happened yet.
    expect(ageOn('1990-12-25', AS_OF)).toBe(35);
    expect(ageOn('not-a-date', AS_OF)).toBe(0);
  });

  it('strips the numeric suffix Synthea puts on every name', () => {
    expect(stripSyntheaSuffix('Erica194')).toBe('Erica');
    expect(stripSyntheaSuffix('Homenick806')).toBe('Homenick');
    expect(stripSyntheaSuffix('Smith')).toBe('Smith');
  });

  it('strips the SNOMED qualifier from a display string', () => {
    expect(cleanDisplay('Diabetes mellitus type 2 (disorder)')).toBe('Diabetes mellitus type 2');
    expect(cleanDisplay('Normal pregnancy (finding)')).toBe('Normal pregnancy');
    expect(cleanDisplay('Anemia')).toBe('Anemia');
  });

  it('treats a condition with an abatement date as resolved', () => {
    const profile = parseBundle({
      resourceType: 'Bundle',
      entry: [
        { resource: { resourceType: 'Patient', id: 'p', birthDate: '1980-01-01' } },
        { resource: { resourceType: 'Condition', code: { coding: [{ code: '195967001', display: 'Asthma (disorder)' }] } } },
        { resource: { resourceType: 'Condition', code: { coding: [{ code: '10509002', display: 'Acute bronchitis (disorder)' }] }, abatementDateTime: '2025-01-01' } },
      ],
    }, { asOf: AS_OF });
    expect(profile.conditions).toHaveLength(2);
    expect(activeConditions(profile)).toHaveLength(1);
    expect(activeConditions(profile)[0]?.category).toBe('asthma_copd');
  });

  it('normalises encounter classes, including wellness visits', () => {
    const profile = parseBundle({
      resourceType: 'Bundle',
      entry: [
        { resource: { resourceType: 'Patient', id: 'p', birthDate: '1980-01-01' } },
        { resource: { resourceType: 'Encounter', class: { code: 'EMER' }, period: { start: '2026-05-01T00:00:00Z' }, type: [{ coding: [{ display: 'Emergency room admission' }] }] } },
        { resource: { resourceType: 'Encounter', class: { code: 'AMB' }, period: { start: '2026-06-01T00:00:00Z' }, type: [{ coding: [{ display: 'General examination of patient (procedure)' }] }] } },
        { resource: { resourceType: 'Encounter', class: { code: 'IMP' }, period: { start: '2020-01-01T00:00:00Z' }, type: [{ coding: [{ display: 'Inpatient stay' }] }] } },
      ],
    }, { asOf: AS_OF });
    expect(profile.encounters.map((e) => e.encounterClass)).toEqual(['emergency', 'wellness', 'inpatient']);
    // Only the two in the last twelve months count as recent.
    expect(profile.recentEncounters).toEqual({ emergency: 1, wellness: 1 });
  });

  it('sums the totals on an ExplanationOfBenefit', () => {
    const profile = parseBundle({
      resourceType: 'Bundle',
      entry: [
        { resource: { resourceType: 'Patient', id: 'p', birthDate: '1980-01-01' } },
        { resource: { resourceType: 'ExplanationOfBenefit', created: '2026-03-04T00:00:00Z', type: { coding: [{ code: 'institutional' }] }, total: [{ amount: { value: 120.5 } }, { amount: { value: 80 } }] } },
      ],
    }, { asOf: AS_OF });
    expect(profile.claims[0]?.totalAllowed).toBe(200.5);
    expect(profile.claims[0]?.date).toBe('2026-03-04');
    expect(profile.claims[0]?.type).toBe('institutional');
  });

  it('deduplicates active medications and drops inactive orders', () => {
    const profile = parseBundle({
      resourceType: 'Bundle',
      entry: [
        { resource: { resourceType: 'Patient', id: 'p', birthDate: '1980-01-01' } },
        { resource: { resourceType: 'MedicationRequest', status: 'active', medicationCodeableConcept: { coding: [{ display: 'lisinopril 10 MG Oral Tablet' }] } } },
        { resource: { resourceType: 'MedicationRequest', status: 'active', medicationCodeableConcept: { coding: [{ display: 'lisinopril 10 MG Oral Tablet' }] } } },
        { resource: { resourceType: 'MedicationRequest', status: 'stopped', medicationCodeableConcept: { coding: [{ display: 'Something discontinued' }] } } },
      ],
    }, { asOf: AS_OF });
    expect(profile.medications).toHaveLength(3);
    expect(activeMedications(profile)).toHaveLength(1);
  });

  it('finds the most recent matching observation', () => {
    const profile = parseBundle({
      resourceType: 'Bundle',
      entry: [
        { resource: { resourceType: 'Patient', id: 'p', birthDate: '1980-01-01' } },
        { resource: { resourceType: 'Observation', code: { coding: [{ display: 'Hemoglobin A1c/Hemoglobin.total in Blood' }] }, valueQuantity: { value: 6.1, unit: '%' }, effectiveDateTime: '2024-04-01T00:00:00Z' } },
        { resource: { resourceType: 'Observation', code: { coding: [{ display: 'Hemoglobin A1c/Hemoglobin.total in Blood' }] }, valueQuantity: { value: 6.4, unit: '%' }, effectiveDateTime: '2026-04-01T00:00:00Z' } },
      ],
    }, { asOf: AS_OF });
    const a1c = latestObservation(profile, /A1c/i);
    expect(a1c?.value).toBe(6.4);
    expect(a1c?.unit).toBe('%');
    expect(latestObservation(profile, /nothing/i)).toBeUndefined();
  });
});

describe('the shipped persona bundles', () => {
  let profiles: Record<string, PatientProfile>;

  beforeAll(() => {
    profiles = Object.fromEntries(
      ['healthy', 'pregnancy', 'transplant', 'cancer'].map((id) => [id, load(id)]),
    );
  });

  it('parses every bundle we ship', () => {
    for (const [id, profile] of Object.entries(profiles)) {
      expect(profile.id, id).toBeTruthy();
      expect(profile.firstName, id).toBeTruthy();
      expect(profile.age, id).toBeGreaterThan(18);
      expect(profile.age, id).toBeLessThan(90);
      expect(profile.totalResources, id).toBeGreaterThan(50);
      expect(profile.state, id).toBe('TX');
      expect(profile.city, id).toBe('Houston');
    }
  });

  it('reports record counts that add up to the bundle size', () => {
    // This is the guarantee behind the records screen: the counts shown are
    // the bundle's own counts, not figures typed into a fixture.
    for (const [id, profile] of Object.entries(profiles)) {
      const summed = Object.values(profile.recordCounts).reduce((a, b) => a + b, 0);
      expect(summed, id).toBe(profile.totalResources);
      expect(profile.recordCounts.Patient, id).toBe(1);
    }
  });

  it('finds no conditions and no recent care for the healthy persona', () => {
    const profile = profiles.healthy as PatientProfile;
    expect(displayConditions(profile)).toHaveLength(0);
    expect(Object.keys(profile.recentEncounters)).toHaveLength(0);
  });

  it('finds an active pregnancy for the pregnancy persona', () => {
    const profile = profiles.pregnancy as PatientProfile;
    expect(conditionCategories(profile).has('pregnancy')).toBe(true);
    expect(activeConditions(profile).some((c) => c.category === 'pregnancy' && c.careSensitive)).toBe(true);
  });

  it('finds the transplant, the diabetes and both critical drugs', () => {
    const profile = profiles.transplant as PatientProfile;
    const categories = conditionCategories(profile);
    expect(categories.has('transplant')).toBe(true);
    expect(categories.has('diabetes')).toBe(true);
    expect(categories.has('kidney_disease')).toBe(true);
    const critical = activeMedications(profile).filter((m) => m.continuityCritical);
    expect(critical.some((m) => m.category === 'insulin')).toBe(true);
    expect(critical.some((m) => m.category === 'immunosuppressant')).toBe(true);
  });

  it('finds the cancer for the cancer persona', () => {
    expect(conditionCategories(profiles.cancer as PatientProfile).has('cancer')).toBe(true);
  });

  it('parses deterministically: the same bundle gives the same profile', () => {
    for (const id of Object.keys(profiles)) {
      expect(JSON.stringify(load(id))).toBe(JSON.stringify(profiles[id]));
    }
  });
});
