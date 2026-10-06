/**
 * Turn a Synthea FHIR R4 bundle into the inputs the engine uses.
 *
 * This is the only place patient records are read. It is deliberately
 * defensive: a bundle is external data, so every field is treated as possibly
 * absent, wrongly typed, or coded with something we have never seen.
 *
 * Record counts come from here, which is why the counts the records screen
 * shows are the bundle's real counts rather than figures typed into a fixture.
 */

import {
  conditionCategory, drugCategory, isCareSensitive, isContinuityCritical,
} from './codes.js';
import type {
  FhirBundle, FhirCodeableConcept, FhirResource, ParsedClaim, ParsedCondition,
  ParsedEncounter, ParsedMedication, ParsedObservation, PatientProfile, RecordCounts,
} from './types.js';

export interface ParseOptions {
  /** The date the projection is made from. Defaults to today. */
  readonly asOf?: Date;
}

/** Parse one bundle. Throws only where there is no Patient to describe. */
export function parseBundle(bundle: FhirBundle, options: ParseOptions = {}): PatientProfile {
  const asOf = options.asOf ?? new Date();
  const entries = Array.isArray(bundle.entry) ? bundle.entry : [];

  const counts: Record<string, number> = {};
  const byType = new Map<string, FhirResource[]>();
  for (const entry of entries) {
    const resource = entry?.resource;
    const type = typeof resource?.resourceType === 'string' ? resource.resourceType : 'Unknown';
    counts[type] = (counts[type] ?? 0) + 1;
    if (!resource) continue;
    const list = byType.get(type);
    if (list) list.push(resource);
    else byType.set(type, [resource]);
  }

  const patient = byType.get('Patient')?.[0];
  if (!patient) throw new Error('Bundle contains no Patient resource.');

  const conditions = (byType.get('Condition') ?? []).map(parseCondition).filter(isPresent);
  const medications = (byType.get('MedicationRequest') ?? []).map(parseMedication).filter(isPresent);
  const observations = (byType.get('Observation') ?? []).map(parseObservation).filter(isPresent);
  const encounters = (byType.get('Encounter') ?? []).map(parseEncounter).filter(isPresent);
  const claims = (byType.get('ExplanationOfBenefit') ?? []).map(parseClaim).filter(isPresent);

  const name = humanName(patient);
  const birthDate = typeof patient.birthDate === 'string' ? patient.birthDate : undefined;
  const address = firstAddress(patient);

  return {
    id: typeof patient.id === 'string' ? patient.id : 'unknown',
    firstName: name.given,
    lastName: name.family,
    age: birthDate ? ageOn(birthDate, asOf) : 0,
    ...(birthDate === undefined ? {} : { birthDate }),
    gender: typeof patient.gender === 'string' ? patient.gender : 'unknown',
    ...(address.state === undefined ? {} : { state: address.state }),
    ...(address.city === undefined ? {} : { city: address.city }),
    ...(address.postalCode === undefined ? {} : { postalCode: address.postalCode }),
    conditions,
    medications,
    observations,
    encounters,
    claims,
    recordCounts: counts as RecordCounts,
    totalResources: entries.length,
    recentEncounters: countRecent(encounters, asOf),
  };
}

/** Parse a bundle from its JSON text. */
export function parseBundleJson(text: string, options?: ParseOptions): PatientProfile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Bundle is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Bundle is not an object.');
  return parseBundle(parsed as FhirBundle, options);
}

// ---------------------------------------------------------------------------

function parseCondition(resource: FhirResource): ParsedCondition | undefined {
  const coding = firstCoding(resource.code as FhirCodeableConcept | undefined);
  const display = coding.display ?? (resource.code as FhirCodeableConcept | undefined)?.text;
  if (!display && !coding.code) return undefined;
  const category = conditionCategory(coding.code, display);
  const onset = typeof resource.onsetDateTime === 'string' ? resource.onsetDateTime.slice(0, 10) : undefined;
  return {
    code: coding.code ?? '',
    display: cleanDisplay(display ?? coding.code ?? ''),
    category,
    ...(onset === undefined ? {} : { onset }),
    // Synthea marks a resolved problem with an abatement date.
    abated: typeof resource.abatementDateTime === 'string',
    careSensitive: isCareSensitive(category),
  };
}

function parseMedication(resource: FhirResource): ParsedMedication | undefined {
  const coding = firstCoding(resource.medicationCodeableConcept as FhirCodeableConcept | undefined);
  const display = coding.display ?? (resource.medicationCodeableConcept as FhirCodeableConcept | undefined)?.text;
  if (!display) return undefined;
  const category = drugCategory(display);
  return {
    code: coding.code ?? '',
    display,
    category,
    active: resource.status === 'active',
    continuityCritical: isContinuityCritical(category),
  };
}

function parseObservation(resource: FhirResource): ParsedObservation | undefined {
  const coding = firstCoding(resource.code as FhirCodeableConcept | undefined);
  const display = coding.display ?? (resource.code as FhirCodeableConcept | undefined)?.text;
  if (!display) return undefined;
  const quantity = resource.valueQuantity as { value?: unknown; unit?: unknown } | undefined;
  const value = typeof quantity?.value === 'number' ? quantity.value : undefined;
  const unit = typeof quantity?.unit === 'string' ? quantity.unit : undefined;
  const date = typeof resource.effectiveDateTime === 'string' ? resource.effectiveDateTime.slice(0, 10) : undefined;
  return {
    code: coding.code ?? '',
    display,
    ...(value === undefined ? {} : { value }),
    ...(unit === undefined ? {} : { unit }),
    ...(date === undefined ? {} : { date }),
  };
}

function parseEncounter(resource: FhirResource): ParsedEncounter | undefined {
  const period = resource.period as { start?: unknown } | undefined;
  const date = typeof period?.start === 'string' ? period.start.slice(0, 10) : undefined;
  const typeConcept = Array.isArray(resource.type) ? (resource.type[0] as FhirCodeableConcept | undefined) : undefined;
  const typeDisplay = firstCoding(typeConcept).display ?? typeConcept?.text ?? 'Encounter';
  const encounterClass = normaliseClass(resource, typeDisplay);
  return { ...(date === undefined ? {} : { date }), type: cleanDisplay(typeDisplay), encounterClass };
}

/**
 * Normalise an encounter to one of four classes. Synthea sets Encounter.class
 * from the HL7 ActCode value set, but wellness visits arrive as ambulatory and
 * only the type says otherwise, so the type is checked too.
 */
function normaliseClass(resource: FhirResource, typeDisplay: string): string {
  if (/wellness|well child|general examination|encounter for check up/i.test(typeDisplay)) return 'wellness';
  const cls = resource.class as { code?: unknown } | undefined;
  const code = typeof cls?.code === 'string' ? cls.code : '';
  if (code === 'EMER' || /emergency/i.test(typeDisplay)) return 'emergency';
  if (code === 'IMP' || code === 'ACUTE' || code === 'NONAC' || /inpatient|admission/i.test(typeDisplay)) return 'inpatient';
  if (/urgent care/i.test(typeDisplay)) return 'urgent';
  return 'ambulatory';
}

function parseClaim(resource: FhirResource): ParsedClaim | undefined {
  const created = typeof resource.created === 'string' ? resource.created.slice(0, 10) : undefined;
  const totals = Array.isArray(resource.total) ? resource.total : [];
  let totalAllowed: number | undefined;
  for (const total of totals) {
    const amount = (total as { amount?: { value?: unknown } } | undefined)?.amount?.value;
    if (typeof amount === 'number') {
      totalAllowed = (totalAllowed ?? 0) + amount;
    }
  }
  const typeConcept = resource.type as FhirCodeableConcept | undefined;
  return {
    ...(created === undefined ? {} : { date: created }),
    ...(totalAllowed === undefined ? {} : { totalAllowed }),
    type: firstCoding(typeConcept).code ?? typeConcept?.text ?? 'claim',
  };
}

// ---------------------------------------------------------------------------

function firstCoding(concept: FhirCodeableConcept | undefined): { code?: string; display?: string } {
  const coding = concept?.coding?.[0];
  return {
    ...(typeof coding?.code === 'string' ? { code: coding.code } : {}),
    ...(typeof coding?.display === 'string' ? { display: coding.display } : {}),
  };
}

function humanName(patient: FhirResource): { given: string; family: string } {
  const names = Array.isArray(patient.name) ? patient.name : [];
  const official = (names as { use?: unknown }[]).find((n) => n?.use === 'official') ?? names[0];
  const record = official as { given?: unknown; family?: unknown } | undefined;
  const given = Array.isArray(record?.given) && typeof record.given[0] === 'string' ? record.given[0] : '';
  const family = typeof record?.family === 'string' ? record.family : '';
  // Synthea suffixes names with a numeric id, e.g. "Erica194 Homenick806".
  return { given: stripSyntheaSuffix(given) || 'Unknown', family: stripSyntheaSuffix(family) };
}

/** Synthea appends digits to every generated name. Drop them for display. */
export function stripSyntheaSuffix(name: string): string {
  return name.replace(/\d+$/, '').trim();
}

function firstAddress(patient: FhirResource): { state?: string; city?: string; postalCode?: string } {
  const addresses = Array.isArray(patient.address) ? patient.address : [];
  const address = addresses[0] as { state?: unknown; city?: unknown; postalCode?: unknown } | undefined;
  return {
    ...(typeof address?.state === 'string' ? { state: address.state } : {}),
    ...(typeof address?.city === 'string' ? { city: address.city } : {}),
    ...(typeof address?.postalCode === 'string' ? { postalCode: address.postalCode } : {}),
  };
}

/** Whole years old on a given date. */
export function ageOn(birthDate: string, asOf: Date): number {
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return 0;
  let age = asOf.getUTCFullYear() - born.getUTCFullYear();
  const monthDiff = asOf.getUTCMonth() - born.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && asOf.getUTCDate() < born.getUTCDate())) age--;
  return Math.max(0, age);
}

function countRecent(encounters: readonly ParsedEncounter[], asOf: Date): Record<string, number> {
  const cutoff = new Date(asOf);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const out: Record<string, number> = {};
  for (const encounter of encounters) {
    if (!encounter.date || encounter.date < cutoffIso) continue;
    out[encounter.encounterClass] = (out[encounter.encounterClass] ?? 0) + 1;
  }
  return out;
}

/** Drop the SNOMED qualifier Synthea leaves on display strings. */
export function cleanDisplay(display: string): string {
  return display.replace(/\s*\((disorder|finding|situation|procedure|morphologic abnormality)\)\s*$/i, '').trim();
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}

// ---------------------------------------------------------------------------
// Views over a parsed profile
// ---------------------------------------------------------------------------

/** Active, unresolved conditions that drive next year's care. */
export function activeConditions(profile: PatientProfile): readonly ParsedCondition[] {
  return profile.conditions.filter((c) => !c.abated);
}

/** Conditions worth showing on a records screen: active and clinically real. */
export function displayConditions(profile: PatientProfile): readonly ParsedCondition[] {
  return activeConditions(profile).filter(
    (c) => c.category !== 'social' && c.category !== 'dental' && c.category !== 'other',
  );
}

/** Distinct active medications, deduplicated by display name. */
export function activeMedications(profile: PatientProfile): readonly ParsedMedication[] {
  const seen = new Set<string>();
  const out: ParsedMedication[] = [];
  // An order that was never stopped is the best available signal of a current
  // prescription; Synthea leaves historical orders as 'stopped' or 'completed'.
  for (const medication of profile.medications) {
    if (!medication.active) continue;
    if (seen.has(medication.display)) continue;
    seen.add(medication.display);
    out.push(medication);
  }
  return out;
}

/** The set of condition categories a person actively has. */
export function conditionCategories(profile: PatientProfile): ReadonlySet<string> {
  return new Set(activeConditions(profile).map((c) => c.category));
}

/** The most recent observation matching a display pattern, if any. */
export function latestObservation(
  profile: PatientProfile,
  pattern: RegExp,
): ParsedObservation | undefined {
  let best: ParsedObservation | undefined;
  for (const observation of profile.observations) {
    if (!pattern.test(observation.display)) continue;
    if (!best || (observation.date ?? '') > (best.date ?? '')) best = observation;
  }
  return best;
}
