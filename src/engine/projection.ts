/**
 * What a person's records imply about next year's care.
 *
 * The prototypes hand-wrote this per persona: Bernarda got six transplant
 * visits and twelve lab draws because someone typed them in. Here the rules are
 * keyed on condition category, so the projection comes out of the parsed
 * bundle. Swap in a different Synthea patient and the projection changes with
 * no code edit.
 *
 * The clinical content of the rules is the prototypes' own, kept so their
 * published figures still hold. It is a reasonable reading of routine care for
 * each condition, not a guideline, and the README says so.
 */

import type {
  BackgroundRates, CareProjection, ProjectedDrug, ProjectedEvent, ProjectedService,
} from './types.js';
import type { ConditionCategory, PatientProfile } from '../fhir/types.js';
import { activeConditions, activeMedications, conditionCategories, latestObservation } from '../fhir/parse.js';

/**
 * A projection group: a block of care the person can switch off in the UI, as
 * the prototype's "What we expect in 2027" checkboxes did. Each is produced by
 * a condition category found in the record.
 */
export interface ProjectionGroup {
  readonly id: string;
  /** What the UI shows beside the checkbox. */
  readonly label: string;
  /** On by default. */
  readonly defaultOn: boolean;
  /** Which category in the record produced this group. */
  readonly from: ConditionCategory | 'baseline';
}

export interface Projection extends CareProjection {
  readonly groups: readonly ProjectionGroup[];
  /** Notes a clinician would add, derived from the record. */
  readonly reviewNotes: readonly string[];
}

/**
 * Everyone gets a yearly check-up and about one sick visit. This is the floor
 * the prototype's healthy persona was given, and it applies to everybody.
 */
const BASELINE_GROUP: ProjectionGroup = {
  id: 'baseline', label: 'Yearly check-up and about one sick visit', defaultOn: true, from: 'baseline',
};

const BASELINE_SERVICES: readonly ProjectedService[] = [
  { kind: 'preventive', count: 1, months: [3], group: 'baseline' },
  { kind: 'labs', count: 1, months: [3], group: 'baseline' },
  { kind: 'pcp', count: 0.8, months: 'random', group: 'baseline' },
];

/** Build a projection for one person from their parsed record. */
export function project(profile: PatientProfile): Projection {
  const categories = conditionCategories(profile);
  const groups: ProjectionGroup[] = [BASELINE_GROUP];
  const services: ProjectedService[] = [...BASELINE_SERVICES];
  const drugs: ProjectedDrug[] = [];
  const events: ProjectedEvent[] = [];
  const notes: string[] = [];

  // --- Pregnancy ---------------------------------------------------------
  if (categories.has('pregnancy')) {
    groups.push(
      { id: 'delivery', label: 'Delivery, and the hospital stay around it', defaultOn: true, from: 'pregnancy' },
      { id: 'prenatal', label: 'Remaining prenatal visits and the postpartum visit (free on every plan)', defaultOn: true, from: 'pregnancy' },
    );
    services.push(
      { kind: 'delivery', count: 1, months: [1], group: 'delivery' },
      { kind: 'preventive', count: 4, months: [1, 1, 1, 3], group: 'prenatal' },
      { kind: 'labs', count: 3, months: [1, 2, 3], group: 'prenatal' },
    );
    // A caesarean rate in line with the US average.
    events.push({ label: 'C-section', probability: 0.32, medianAmount: 6000, sigma: 0.2, month: 1, group: 'delivery' });
    notes.push('Delivery falls early in the plan year, so the whole deductible is likely to be spent in the first month.');
    notes.push(`The baby will need to be added to a plan within 60 days of birth. Those costs are not included here.`);

    // Raised risk of gestational diabetes, from the record rather than assumed.
    const a1c = latestObservation(profile, /A1c/i);
    const borderlineA1c = (a1c?.value ?? 0) >= 5.7;
    if (borderlineA1c || categories.has('prediabetes') || categories.has('obesity')) {
      groups.push({ id: 'highrisk_pregnancy', label: 'Two high-risk pregnancy visits', defaultOn: true, from: 'pregnancy' });
      services.push(
        { kind: 'specialist', count: 2, months: [1], group: 'highrisk_pregnancy' },
        { kind: 'imaging', count: 1, months: [1], group: 'highrisk_pregnancy' },
      );
      const because = [
        a1c?.value !== undefined && a1c.value >= 5.7 ? `an A1c of ${a1c.value}%` : null,
        categories.has('prediabetes') ? 'prediabetes on record' : null,
        categories.has('obesity') ? 'a BMI over 30' : null,
      ].filter(Boolean);
      notes.push(`${capitalise(joinList(because as string[]))}: plan for gestational diabetes screening and possible high-risk pregnancy visits.`);
    }
  }

  // --- Transplant --------------------------------------------------------
  if (categories.has('transplant')) {
    groups.push({ id: 'transplant', label: 'Transplant clinic every two months, with monthly drug-level labs', defaultOn: true, from: 'transplant' });
    services.push(
      { kind: 'specialist', count: 6, months: [2, 4, 6, 8, 10, 12], group: 'transplant' },
      { kind: 'labs', count: 12, months: 'spread', group: 'transplant' },
    );
    events.push({ label: 'Rejection episode or serious infection', probability: 0.06, medianAmount: 60000, sigma: 0.5, month: 'random', group: 'transplant' });
    notes.push('Never switch anti-rejection medicine formulations without the transplant team: tacrolimus levels must be rechecked.');
    notes.push('Keeping the transplant clinic in network matters more than any premium difference.');
  }

  // --- Diabetes ----------------------------------------------------------
  if (categories.has('diabetes')) {
    groups.push({ id: 'diabetes', label: 'Quarterly diabetes and blood pressure visits, yearly eye exam', defaultOn: true, from: 'diabetes' });
    services.push(
      { kind: 'pcp', count: 4, months: [1, 4, 7, 10], group: 'diabetes' },
      { kind: 'specialist', count: 1, months: [5], group: 'diabetes' },
    );
  }

  // --- Cancer ------------------------------------------------------------
  if (categories.has('cancer')) {
    groups.push(
      { id: 'oncology', label: 'Oncology follow-up every three months', defaultOn: true, from: 'cancer' },
      { id: 'surveillance', label: 'Surveillance imaging', defaultOn: true, from: 'cancer' },
    );
    services.push(
      { kind: 'specialist', count: 4, months: [2, 5, 8, 11], group: 'oncology' },
      { kind: 'labs', count: 4, months: [2, 5, 8, 11], group: 'oncology' },
      { kind: 'imaging', count: 2, months: [2, 8], group: 'surveillance' },
      { kind: 'imaging_adv', count: 1, months: [5], group: 'surveillance' },
    );
    events.push({ label: 'Workup for possible recurrence', probability: 0.08, medianAmount: 35000, sigma: 0.5, month: 'random', group: 'oncology' });
    notes.push('Continuity with the treating oncologist is the priority in the first years after treatment.');
    notes.push('Surveillance imaging is diagnostic, not screening, so it counts toward the deductible.');
  }

  // --- Kidney disease (without a transplant) -----------------------------
  if (categories.has('kidney_disease') && !categories.has('transplant')) {
    groups.push({ id: 'kidney', label: 'Kidney specialist twice a year, with labs', defaultOn: true, from: 'kidney_disease' });
    services.push(
      { kind: 'specialist', count: 2, months: [3, 9], group: 'kidney' },
      { kind: 'labs', count: 4, months: 'spread', group: 'kidney' },
    );
  }

  // --- Heart disease -----------------------------------------------------
  if (categories.has('heart_disease')) {
    groups.push({ id: 'cardiac', label: 'Cardiology follow-up twice a year', defaultOn: true, from: 'heart_disease' });
    services.push({ kind: 'specialist', count: 2, months: [4, 10], group: 'cardiac' });
  }

  // --- Asthma and COPD ---------------------------------------------------
  if (categories.has('asthma_copd')) {
    groups.push({ id: 'respiratory', label: 'Two respiratory follow-up visits', defaultOn: true, from: 'asthma_copd' });
    services.push({ kind: 'specialist', count: 2, months: [2, 8], group: 'respiratory' });
  }

  // --- Epilepsy ----------------------------------------------------------
  if (categories.has('epilepsy')) {
    groups.push({ id: 'neurology', label: 'Neurology follow-up twice a year, with drug-level labs', defaultOn: true, from: 'epilepsy' });
    services.push(
      { kind: 'specialist', count: 2, months: [3, 9], group: 'neurology' },
      { kind: 'labs', count: 2, months: [3, 9], group: 'neurology' },
    );
  }

  // --- Hypertension, where it is the only chronic problem ----------------
  if (categories.has('hypertension') && !categories.has('diabetes') && !categories.has('heart_disease')) {
    groups.push({ id: 'bp', label: 'Two blood pressure checks', defaultOn: true, from: 'hypertension' });
    services.push({ kind: 'pcp', count: 2, months: [4, 10], group: 'bp' });
  }

  // --- Medications, from the record --------------------------------------
  const medications = activeMedications(profile);
  const drugGroup: ProjectedDrug[] = [];
  const insulinCount = medications.filter((m) => m.category === 'insulin').length;
  const immunoCount = medications.filter((m) => m.category === 'immunosuppressant').length;
  const otherCount = medications.filter((m) => m.category === 'generic' || m.category === 'brand' || m.category === 'inhaler').length;

  if (immunoCount > 0) drugGroup.push({ drugId: 'envarsus', fills: 12, group: 'medications' });
  if (insulinCount > 0) drugGroup.push({ drugId: 'insulin', fills: 12, group: 'medications' });
  // Monthly fills for each ongoing non-specialty prescription.
  if (otherCount > 0) drugGroup.push({ drugId: 'generic', fills: 12 * otherCount, group: 'medications' });

  if (drugGroup.length > 0) {
    const parts = [
      immunoCount > 0 ? 'daily anti-rejection medicine' : null,
      insulinCount > 0 ? 'insulin' : null,
      otherCount > 0 ? `${otherCount} ongoing ${otherCount === 1 ? 'prescription' : 'prescriptions'}` : null,
    ].filter(Boolean) as string[];
    groups.push({ id: 'medications', label: capitalise(joinList(parts)), defaultOn: true, from: 'baseline' });
    drugs.push(...drugGroup);
  }

  if (insulinCount > 0) {
    notes.push('Texas caps insulin cost sharing at $25 a month in state-regulated plans, so insulin costs the same on every plan.');
  }

  return {
    groups,
    services,
    drugs,
    events,
    rates: backgroundRates(profile, categories),
    reviewNotes: notes,
  };
}

/**
 * Background rates for unplanned care: an emergency visit, an admission, or a
 * serious illness nobody saw coming. Scaled by age and by how much chronic
 * illness is on the record, which is the prototypes' own approach.
 */
function backgroundRates(profile: PatientProfile, categories: ReadonlySet<string>): BackgroundRates {
  const chronic = ['diabetes', 'cancer', 'kidney_disease', 'transplant', 'heart_disease',
    'asthma_copd', 'epilepsy'].filter((c) => categories.has(c)).length;
  const ageFactor = profile.age >= 55 ? 1.6 : profile.age >= 40 ? 1.2 : 1;
  const pregnant = categories.has('pregnancy') ? 1 : 0;
  return {
    er: round3(Math.min(0.9, (0.1 + chronic * 0.1 + pregnant * 0.18) * ageFactor)),
    admission: round3(Math.min(0.45, (0.025 + chronic * 0.055 + pregnant * 0.025) * ageFactor)),
    major: round3(Math.min(0.05, (0.014 + chronic * 0.004) * ageFactor)),
  };
}

/** Which projection groups are on by default. */
export function defaultToggles(projection: Projection): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const group of projection.groups) out[group.id] = group.defaultOn;
  return out;
}

/**
 * The care team a person should not lose: the provider ids whose loss counts as
 * a disruption. Derived from condition categories, mapped onto the provider
 * directory the plan data ships with.
 */
export function careTeamFor(profile: PatientProfile): readonly string[] {
  const categories = conditionCategories(profile);
  const team: string[] = [];
  if (categories.has('pregnancy')) team.push('ob', 'hosp_ob');
  if (categories.has('transplant')) team.push('transplant');
  if (categories.has('cancer')) team.push('onc', 'img');
  if (categories.has('diabetes')) team.push('im', 'eye');
  if (categories.has('kidney_disease') && !categories.has('transplant')) team.push('im');
  return [...new Set(team)];
}

/** A one-line summary of care in the last twelve months, from the record. */
export function recentCareSummary(profile: PatientProfile): string {
  const recent = profile.recentEncounters;
  const parts: string[] = [];
  const label: Record<string, [string, string]> = {
    ambulatory: ['visit', 'visits'],
    wellness: ['check-up', 'check-ups'],
    emergency: ['emergency visit', 'emergency visits'],
    inpatient: ['hospital stay', 'hospital stays'],
    urgent: ['urgent care visit', 'urgent care visits'],
  };
  for (const [key, count] of Object.entries(recent)) {
    const words = label[key];
    if (!words || count === 0) continue;
    parts.push(`${count} ${count === 1 ? words[0] : words[1]}`);
  }
  if (parts.length === 0) return 'No visits in the past 12 months';
  return joinList(parts);
}

/** Conditions worth a second look when changing plans. */
export function careSensitiveConditions(profile: PatientProfile): readonly string[] {
  return activeConditions(profile).filter((c) => c.careSensitive).map((c) => c.display);
}

function joinList(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] as string;
  if (items.length === 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
