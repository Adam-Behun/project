/**
 * Clinical coding: SNOMED CT and RxNorm concepts to the categories the engine's
 * projection rules are keyed on.
 *
 * Why categories rather than codes: the prototypes hand-wrote each persona's
 * expected care. Here a condition is mapped to a category, and the projection
 * rules act on the category, so swapping in a different Synthea bundle produces
 * a different projection without touching any code.
 *
 * Matching is by SNOMED code where we have it, falling back to the display
 * text Synthea emits. Display matching is last-resort and deliberately narrow.
 */

import type { ConditionCategory, DrugCategory } from './types.js';

/**
 * SNOMED CT codes seen in Synthea bundles, by category. Not exhaustive: the
 * display-text patterns below catch the rest.
 */
const CONDITION_CODES: Readonly<Record<string, ConditionCategory>> = Object.freeze({
  // Pregnancy
  '72892002': 'pregnancy',      // Normal pregnancy
  '77386006': 'pregnancy',      // Pregnant
  '15938005': 'reproductive',   // Complete miscarriage
  '19169002': 'reproductive',   // Miscarriage in first trimester
  '161712005': 'reproductive',  // Past pregnancy history of miscarriage
  '198992004': 'pregnancy',     // Eclampsia in pregnancy
  // Diabetes
  '44054006': 'diabetes',       // Diabetes mellitus type 2
  '15777000': 'prediabetes',    // Prediabetes: raises risk, but does not by
                                //   itself imply diabetes care next year
  '127013003': 'kidney_disease', // Disorder of kidney due to diabetes mellitus
  '157141000119108': 'kidney_disease', // Proteinuria due to type 2 DM
  '90781000119102': 'kidney_disease',  // Microalbuminuria due to type 2 DM
  // Kidney and transplant
  '161665007': 'transplant',    // History of renal transplant
  '707577004': 'transplant',    // Awaiting transplantation of kidney
  '46177005': 'kidney_disease', // End-stage renal disease
  '431855005': 'kidney_disease', // CKD stage 1
  '431856006': 'kidney_disease', // CKD stage 2
  '433144002': 'kidney_disease', // CKD stage 3
  '431857002': 'kidney_disease', // CKD stage 4
  // Cancer
  '254837009': 'cancer',        // Malignant neoplasm of breast
  '93761005': 'cancer',         // Malignant neoplasm of colon
  '109838007': 'cancer',        // Overlapping malignant neoplasm of colon
  '254632001': 'cancer',        // Small cell carcinoma of lung
  '424132000': 'cancer',        // Non-small cell carcinoma of lung
  '92691004': 'cancer',         // Carcinoma in situ of prostate
  '91861009': 'cancer',         // Acute myeloid leukemia
  // Cardiovascular
  '59621000': 'hypertension',   // Essential hypertension
  '414545008': 'heart_disease', // Ischemic heart disease
  '88805009': 'heart_disease',  // Chronic congestive heart failure
  '22298006': 'heart_disease',  // Myocardial infarction
  '230690007': 'heart_disease', // Cerebrovascular accident
  '399211009': 'heart_disease', // History of myocardial infarction
  '55822004': 'hyperlipidemia', // Hyperlipidemia
  '302870006': 'hyperlipidemia', // Hypertriglyceridemia
  '237602007': 'hyperlipidemia', // Metabolic syndrome X
  // Respiratory
  '195967001': 'asthma_copd',   // Asthma
  '233678006': 'asthma_copd',   // Childhood asthma
  '13645005': 'asthma_copd',    // COPD
  '185086009': 'asthma_copd',   // Chronic obstructive bronchitis
  // Neurological
  '84757009': 'epilepsy',       // Epilepsy
  '128613002': 'epilepsy',      // Seizure disorder
  '703151001': 'epilepsy',      // History of seizure
  // Other chronic
  '162864005': 'obesity',       // Body mass index 30+ obesity
  '271737000': 'anemia',        // Anemia
  '82423001': 'chronic_pain',   // Chronic pain
  '279039007': 'chronic_pain',  // Chronic low back pain
  '279040009': 'chronic_pain',  // Chronic neck pain
  '95417003': 'chronic_pain',   // Fibromyalgia
  '1023001': 'sleep_apnea',     // Apnea
  '78275009': 'sleep_apnea',    // Obstructive sleep apnea syndrome
  // Categories the employer view must never surface
  '66214007': 'substance_use',  // Substance abuse
  '7200002': 'substance_use',   // Alcoholism
  '10939881000119105': 'substance_use', // Misuses drugs
  '35489007': 'behavioral_health',      // Depressive disorder
  '197480006': 'behavioral_health',     // Anxiety disorder
  '47505003': 'behavioral_health',      // Post-traumatic stress disorder
});

/**
 * Display-text patterns, applied in order, where a code is unknown. Each
 * pattern is anchored on wording Synthea actually emits.
 */
const CONDITION_PATTERNS: readonly (readonly [RegExp, ConditionCategory])[] = Object.freeze([
  // Reproductive, behavioural health and substance use come first: these are
  // the categories the employer view must never show, so a condition that
  // could match two categories must land in these.
  [/\b(miscarriage|abortion|contracept|tubal ligation|infertility|endometrios)/i, 'reproductive'],
  [/\b(depress|anxiety|bipolar|schizophren|post-traumatic|suicid|psychiatric|mental)/i, 'behavioral_health'],
  [/\b(alcohol|opioid|drug abuse|misuses drugs|substance|overdose|dependent drug|smok|tobacco|nicotine)/i, 'substance_use'],
  [/\bpregnan|gestational|eclampsia|puerper/i, 'pregnancy'],
  [/\b(transplant)/i, 'transplant'],
  [/\b(carcinoma|malignant neoplasm|neoplasm of|leukemia|lymphoma|melanoma|\bcancer)/i, 'cancer'],
  [/\b(kidney|renal|nephropath|proteinuria|microalbuminuria)/i, 'kidney_disease'],
  [/\bprediabet/i, 'prediabetes'],
  [/\bdiabet/i, 'diabetes'],
  [/\b(hypertension|blood pressure)/i, 'hypertension'],
  [/\b(myocardial|heart failure|coronary|angina|atrial fibrillation|ischemic heart|cerebrovascular|cardiac)/i, 'heart_disease'],
  [/\b(asthma|copd|emphysema|obstructive bronchitis|pulmonary disease)/i, 'asthma_copd'],
  [/\b(epilep|seizure|convulsion)/i, 'epilepsy'],
  [/\b(hyperlipidem|hypertriglycerid|hypercholesterol|metabolic syndrome)/i, 'hyperlipidemia'],
  [/\bapnea\b/i, 'sleep_apnea'],
  [/\b(obesity|body mass index 30)/i, 'obesity'],
  [/\banemia|anaemia/i, 'anemia'],
  [/\bchronic (pain|low back pain|neck pain)|fibromyalg|migraine/i, 'chronic_pain'],
  [/\b(gingiv|dental|caries|teeth|tooth|molar|filling)/i, 'dental'],
  [/\b(employment|education|labor force|social|housing|stress|criminal record|violence|risk activity|unemployed|military|victim)/i, 'social'],
  [/\b(acute|viral|infective|sinusitis|pharyngitis|bronchitis|otitis|cystitis|sprain|fracture|laceration|concussion|burn|injury|wound|cough|fever|urinary tract)/i, 'acute_minor'],
  [/medication review|history of/i, 'other'],
]);

/** The category one coded condition belongs to. */
export function conditionCategory(code: string | undefined, display: string | undefined): ConditionCategory {
  if (code) {
    const byCode = CONDITION_CODES[code];
    if (byCode) return byCode;
  }
  const text = display ?? '';
  for (const [pattern, category] of CONDITION_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return 'other';
}

/**
 * Categories that change what care someone needs next year, and so matter when
 * they change plans. Everything else is recorded but does not drive the
 * projection.
 */
const CARE_SENSITIVE: ReadonlySet<ConditionCategory> = new Set<ConditionCategory>([
  'pregnancy', 'diabetes', 'cancer', 'kidney_disease', 'transplant',
  'hypertension', 'asthma_copd', 'epilepsy', 'heart_disease',
]);

export function isCareSensitive(category: ConditionCategory): boolean {
  return CARE_SENSITIVE.has(category);
}

/**
 * Categories the employer view must never surface, at any count.
 *
 * Reproductive, behavioural health and substance use care are excluded from
 * every employer-facing figure. This is a design choice rather than a statutory
 * minimum: the ADA and GINA restrict what an employer may obtain, and HIPAA's
 * minimum necessary standard limits disclosure to what a task requires, and no
 * part of an ICHRA class decision requires any of this.
 * Primary: 45 CFR 164.502(b) (minimum necessary); 42 USC 12112(d) (ADA);
 * 42 USC 2000ff (GINA).
 */
export const EMPLOYER_EXCLUDED_CATEGORIES: readonly ConditionCategory[] = Object.freeze([
  'reproductive', 'behavioral_health', 'substance_use',
]);

// ---------------------------------------------------------------------------
// Medications
// ---------------------------------------------------------------------------

const DRUG_PATTERNS: readonly (readonly [RegExp, DrugCategory])[] = Object.freeze([
  [/\binsulin\b|\bhumulin\b|\blantus\b|\bnovolog\b|\bhumalog\b|\blevemir\b/i, 'insulin'],
  [/\btacrolimus\b|\benvarsus\b|\bprograf\b|\bcyclosporin|\bmycophenolat|\bsirolimus\b|\bazathioprine\b/i, 'immunosuppressant'],
  // "ACTUAT" alone is not enough: nitroglycerin mucosal spray is measured in
  // actuations too. Require an inhaler form or a known inhaled molecule.
  [/inhaler|metered dose|dry powder|inhalation|\bHFA\b|albuterol|beclomethasone|fluticasone|salmeterol|budesonide|ipratropium|tiotropium/i, 'inhaler'],
  // Specialty: biologics, oncology, and other high-cost categories.
  [/\bmab\b|mab\b|\btrastuzumab|\brituximab|\badalimumab|\betanercept|\binfliximab|alteplase|interferon/i, 'specialty'],
  // Branded products Synthea marks with a bracketed trade name.
  [/\[[^\]]+\]\s*$/, 'brand'],
]);

/** The pricing category one medication falls into. */
export function drugCategory(display: string | undefined): DrugCategory {
  const text = display ?? '';
  for (const [pattern, category] of DRUG_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return 'generic';
}

/**
 * Drugs where stopping or switching formulation is clinically risky, so a plan
 * that does not cover them counts as disrupting care rather than merely costing
 * more. Anti-rejection drugs are the clearest case: tacrolimus blood levels
 * have to be re-checked after any formulation change.
 */
const CONTINUITY_CRITICAL: ReadonlySet<DrugCategory> = new Set<DrugCategory>([
  'immunosuppressant', 'insulin', 'specialty',
]);

export function isContinuityCritical(category: DrugCategory): boolean {
  return CONTINUITY_CRITICAL.has(category);
}

/** Strip Synthea's dose and form noise down to something readable. */
export function shortDrugName(display: string): string {
  const branded = /\[([^\]]+)\]/.exec(display);
  if (branded?.[1]) return branded[1];
  const firstWord = display.replace(/^\d+\s*(HR|DAY|ACTUAT|ML|MG)\s*/i, '').split(/\s+\d/)[0];
  return (firstWord ?? display).trim();
}
