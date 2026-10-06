import { describe, expect, it } from 'vitest';
import {
  employerMaySee, excludedCategories, findMemberLevelData, MINIMUM_REPORTABLE_CELL, suppress,
} from '../src/engine/privacy.js';
import { evaluateDesign, recommend } from '../src/engine/employer.js';
import { classOutcomes, company } from './fixtures.js';

describe('small-cell suppression', () => {
  it('hides any count below eleven', () => {
    for (let n = 1; n < MINIMUM_REPORTABLE_CELL; n++) {
      const result = suppress(n, 100);
      expect(result.reportable, `count ${n}`).toBe(false);
      expect(result.value, `count ${n}`).toBeUndefined();
      expect(result.display).toBe('Fewer than 11');
    }
  });

  it('shows eleven and above', () => {
    expect(suppress(11, 100)).toEqual({ reportable: true, value: 11, display: '11 of 100' });
    expect(suppress(38, 299).display).toBe('38 of 299');
  });

  it('reports zero as none, because zero discloses nothing', () => {
    // Hiding a zero would make every empty class look like it had something
    // to hide.
    const result = suppress(0, 100);
    expect(result.reportable).toBe(true);
    expect(result.display).toBe('None');
  });

  it('never leaks the real number in the display string', () => {
    for (let n = 1; n < MINIMUM_REPORTABLE_CELL; n++) {
      expect(suppress(n, 100).display).not.toMatch(new RegExp(`\\b${n}\\b`));
    }
  });
});

describe('categories the employer never sees', () => {
  it('excludes reproductive, behavioural health and substance use', () => {
    expect(employerMaySee('reproductive')).toBe(false);
    expect(employerMaySee('behavioral_health')).toBe(false);
    expect(employerMaySee('substance_use')).toBe(false);
  });

  it('allows the categories an ICHRA class decision actually needs', () => {
    for (const category of ['diabetes', 'cancer', 'transplant', 'kidney_disease', 'epilepsy', 'heart_disease'] as const) {
      expect(employerMaySee(category), category).toBe(true);
    }
  });

  it('excludes them at every count, not just small ones', () => {
    // Suppression is about re-identification; these are excluded outright.
    expect(excludedCategories()).toHaveLength(3);
    for (const category of excludedCategories()) {
      expect(employerMaySee(category)).toBe(false);
    }
  });
});

describe('the employer dataset holds no member-level data', () => {
  it('carries no individual records at all', () => {
    // The structural guarantee: not a render-time filter, but an absence.
    expect(findMemberLevelData(company())).toEqual([]);
    expect(findMemberLevelData(classOutcomes())).toEqual([]);
  });

  it('carries no condition detail, only counts', () => {
    const serialised = JSON.stringify(company()) + JSON.stringify(classOutcomes());
    for (const word of ['diabetes', 'cancer', 'transplant', 'pregnan', 'insulin', 'diagnosis', 'icd', 'snomed']) {
      expect(serialised.toLowerCase(), word).not.toContain(word);
    }
  });

  it('keeps member-level data out of an evaluated design', () => {
    const result = evaluateDesign(company(), classOutcomes(), {
      movedClassIds: ['nj_sal', 'tx_hr'], allowanceShare: 0.8,
      scope: 'premiums_only', purchaseMode: 'guided_best_fit', includePartTime: true,
    });
    expect(findMemberLevelData(result)).toEqual([]);
  });

  it('keeps member-level data out of the recommendation', () => {
    const recommendation = recommend(company(), classOutcomes());
    expect(recommendation).not.toBeNull();
    expect(findMemberLevelData(recommendation)).toEqual([]);
  });

  it('detects member-level data when it is there', () => {
    // The guard has to be able to fail, or it guarantees nothing.
    expect(findMemberLevelData({ classes: [{ name: 'A', conditions: ['diabetes'] }] }))
      .toEqual([{ path: '$.classes[0].conditions', key: 'conditions' }]);
    expect(findMemberLevelData({ classes: [{ postalCode: '77027' }] }))
      .toEqual([{ path: '$.classes[0].postalCode', key: 'postalCode' }]);
    expect(findMemberLevelData({ a: { b: { firstName: 'Erica' } } }))
      .toEqual([{ path: '$.a.b.firstName', key: 'firstName' }]);
  });

  it('allows a plain member count, which is not member-level data', () => {
    expect(findMemberLevelData({ members: 299 })).toEqual([]);
    // A list of members is a different matter.
    expect(findMemberLevelData({ members: [{ id: 1 }] })).toHaveLength(1);
  });

  it('allows a class name, which is a label rather than a person', () => {
    expect(findMemberLevelData({ name: 'Hourly, New Jersey', averageAge: 34 })).toEqual([]);
  });
});

describe('every care count the employer view shows is suppressed', () => {
  it('suppresses the high-risk counts, which are all under eleven', () => {
    const result = evaluateDesign(company(), classOutcomes(), {
      movedClassIds: company().classes.map((c) => c.id), allowanceShare: 0.8,
      scope: 'premiums_only', purchaseMode: 'guided_best_fit', includePartTime: false,
    });
    for (const klass of result.classes) {
      // careFlaggedHighRisk is 3-7 across the classes, so all must be hidden.
      expect(klass.careFlaggedHighRisk.reportable, klass.klass.id).toBe(false);
      // careFlagged is 17-38, so all are reportable.
      expect(klass.careFlagged.reportable, klass.klass.id).toBe(true);
    }
  });
});
