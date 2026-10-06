/**
 * What the employer is allowed to see.
 *
 * The two views have deliberately opposite postures. The employee view shows a
 * person their whole record, because it is theirs. The employer view shows
 * class aggregates and nothing else: no individual, no name, no diagnosis, and
 * no count small enough to re-identify someone.
 *
 * This module is the enforcement point, and the employer data layer passes
 * every count through it.
 */

import { EMPLOYER_EXCLUDED_CATEGORIES } from '../fhir/codes.js';
import type { ConditionCategory } from '../fhir/types.js';

/**
 * Counts below this are reported as a band rather than a number.
 *
 * Eleven is the threshold HHS adopted for de-identified public health
 * reporting and the one CMS uses for its own public use files, so it is the
 * convention a benefits team will recognise. HIPAA's de-identification rule
 * sets no fixed cell size, so this is a defensible convention rather than a
 * statutory minimum.
 * Primary: 45 CFR 164.514(b) (de-identification); CMS cell-size suppression
 * policy for public use files.
 */
export const MINIMUM_REPORTABLE_CELL = 11;

/** A count that is safe to show, or a band that is safe to show instead. */
export interface SuppressedCount {
  /** True where the real number is shown. */
  readonly reportable: boolean;
  /** The number, where it is reportable. Absent otherwise. */
  readonly value?: number;
  /** What to display either way. */
  readonly display: string;
}

/**
 * Apply small-cell suppression to one count.
 *
 * Zero is reported as zero: "none" discloses nothing about an individual, and
 * hiding it would make every empty class look like it had something to hide.
 */
export function suppress(count: number, denominator?: number): SuppressedCount {
  if (count === 0) return { reportable: true, value: 0, display: 'None' };
  if (count < MINIMUM_REPORTABLE_CELL) {
    return { reportable: false, display: `Fewer than ${MINIMUM_REPORTABLE_CELL}` };
  }
  return {
    reportable: true,
    value: count,
    display: denominator === undefined ? String(count) : `${count} of ${denominator}`,
  };
}

/**
 * Whether a condition category may appear in anything the employer sees.
 *
 * Reproductive, behavioural health and substance use care are excluded at every
 * count, including aggregates large enough to pass suppression. No part of an
 * ICHRA class decision needs them, and the ADA and GINA both restrict what an
 * employer may obtain about its employees' health.
 * Primary: 45 CFR 164.502(b); 42 USC 12112(d); 42 USC 2000ff.
 */
export function employerMaySee(category: ConditionCategory): boolean {
  return !EMPLOYER_EXCLUDED_CATEGORIES.includes(category);
}

/** The categories withheld from the employer view, for the UI to disclose. */
export function excludedCategories(): readonly ConditionCategory[] {
  return EMPLOYER_EXCLUDED_CATEGORIES;
}

/**
 * Assert that a value carries no member-level data before it reaches the
 * employer view. A structural guard: it is cheap, and it fails loudly in tests
 * if someone later adds a field that should not be there.
 */
const MEMBER_LEVEL_KEYS: readonly string[] = [
  // Identifiers. Note that a bare `name` is NOT here: a class name ("Hourly,
  // New Jersey") and the company name are labels, not people.
  'patient', 'patientId', 'memberName', 'patientName', 'firstName', 'lastName',
  'birthDate', 'dob', 'ssn', 'mrn', 'email', 'phone',
  // Clinical and financial detail about individuals.
  'conditions', 'medications', 'diagnoses', 'claims', 'observations',
  'encounters', 'procedures', 'prescriptions',
  // Demography precise enough to re-identify someone within a class.
  'gender', 'address', 'postalCode', 'zip', 'age',
  // Allowed as a plain count, never as a list.
  'members',
];

export interface PrivacyViolation {
  readonly path: string;
  readonly key: string;
}

/**
 * Walk a value and report any key that looks like member-level data.
 *
 * `members` as a plain count is fine -- the employer legitimately knows how
 * many people a class covers -- so a numeric value under an allowed key is not
 * a violation. An array or object there is.
 */
export function findMemberLevelData(value: unknown, path = '$'): PrivacyViolation[] {
  const violations: PrivacyViolation[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => violations.push(...findMemberLevelData(item, `${path}[${i}]`)));
    return violations;
  }
  if (value === null || typeof value !== 'object') return violations;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (MEMBER_LEVEL_KEYS.includes(key) && typeof child !== 'number') {
      violations.push({ path: `${path}.${key}`, key });
    }
    violations.push(...findMemberLevelData(child, `${path}.${key}`));
  }
  return violations;
}
