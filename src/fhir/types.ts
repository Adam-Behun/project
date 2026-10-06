/**
 * The shape of a Synthea FHIR R4 bundle, narrowed to what the parser reads.
 *
 * These are deliberately loose: a bundle is external data, so the parser treats
 * every field as possibly absent rather than trusting a schema.
 */

export interface FhirCoding {
  readonly system?: string;
  readonly code?: string;
  readonly display?: string;
}

export interface FhirCodeableConcept {
  readonly coding?: readonly FhirCoding[];
  readonly text?: string;
}

export interface FhirReference {
  readonly reference?: string;
  readonly display?: string;
}

export interface FhirPeriod {
  readonly start?: string;
  readonly end?: string;
}

export interface FhirResource {
  readonly resourceType?: string;
  readonly id?: string;
  readonly [key: string]: unknown;
}

export interface FhirBundleEntry {
  readonly fullUrl?: string;
  readonly resource?: FhirResource;
}

export interface FhirBundle {
  readonly resourceType?: string;
  readonly type?: string;
  readonly entry?: readonly FhirBundleEntry[];
}

/** The resource types the parser reads. Everything else is counted and ignored. */
export const READ_RESOURCE_TYPES = [
  'Patient', 'Condition', 'MedicationRequest', 'Encounter', 'Observation',
  'Procedure', 'ExplanationOfBenefit',
] as const;

export type ReadResourceType = (typeof READ_RESOURCE_TYPES)[number];

// ---------------------------------------------------------------------------
// What the parser produces
// ---------------------------------------------------------------------------

/**
 * Clinical categories the engine's projection rules are keyed on. Conditions
 * are mapped to these from their SNOMED codes, so projections derive from the
 * record rather than from a hand-written list per persona.
 */
export type ConditionCategory =
  | 'pregnancy' | 'diabetes' | 'prediabetes' | 'cancer' | 'kidney_disease'
  | 'transplant' | 'hypertension' | 'asthma_copd' | 'epilepsy' | 'heart_disease'
  | 'obesity' | 'anemia' | 'chronic_pain' | 'sleep_apnea' | 'hyperlipidemia'
  | 'reproductive' | 'behavioral_health' | 'substance_use'
  | 'acute_minor' | 'dental' | 'social' | 'other';

/** Drug categories the cost-sharing engine prices differently. */
export type DrugCategory = 'insulin' | 'immunosuppressant' | 'inhaler' | 'generic' | 'brand' | 'specialty';

export interface ParsedCondition {
  readonly code: string;
  readonly display: string;
  readonly category: ConditionCategory;
  readonly onset?: string;
  readonly abated: boolean;
  /** True where this condition needs attention when changing plans. */
  readonly careSensitive: boolean;
}

export interface ParsedMedication {
  readonly code: string;
  readonly display: string;
  readonly category: DrugCategory;
  readonly active: boolean;
  /** True where stopping or switching this drug is clinically risky. */
  readonly continuityCritical: boolean;
}

export interface ParsedObservation {
  readonly code: string;
  readonly display: string;
  readonly value?: number;
  readonly unit?: string;
  readonly date?: string;
}

export interface ParsedEncounter {
  readonly date?: string;
  readonly type: string;
  /** Normalised class: ambulatory, emergency, inpatient, wellness. */
  readonly encounterClass: string;
}

export interface ParsedClaim {
  readonly date?: string;
  readonly totalAllowed?: number;
  readonly type: string;
}

/** How many of each resource type the bundle actually held. */
export type RecordCounts = Readonly<Record<string, number>>;

/**
 * Everything the engine needs about one person, derived from their bundle.
 * Nothing here is hand-authored: every field comes from parsed resources.
 */
export interface PatientProfile {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly age: number;
  readonly birthDate?: string;
  /** FHIR administrative gender, verbatim. May be 'unknown' or 'other'. */
  readonly gender: string;
  readonly state?: string;
  readonly city?: string;
  readonly postalCode?: string;
  readonly conditions: readonly ParsedCondition[];
  readonly medications: readonly ParsedMedication[];
  readonly observations: readonly ParsedObservation[];
  readonly encounters: readonly ParsedEncounter[];
  readonly claims: readonly ParsedClaim[];
  /** Counts of every resource type in the bundle, for the records screen. */
  readonly recordCounts: RecordCounts;
  readonly totalResources: number;
  /** Encounters in the last twelve months, by class. */
  readonly recentEncounters: Readonly<Record<string, number>>;
}
