/**
 * Generate the persona bundles in data/fhir/ with Synthea.
 *
 * Synthea produces random patients: you cannot ask it for "a 34-year-old due in
 * late January". So this script generates a seeded population, classifies every
 * patient by the categories the engine's projection rules use, scores each
 * against the clinical profiles the demo needs, and keeps the best match for
 * each. The seed is fixed, so the same population and the same four patients
 * come out every time.
 *
 * Usage:
 *   npm run personas -- --jar /path/to/synthea-with-dependencies.jar
 *
 * Without --jar it looks for synthea.jar beside the repo. Download it from
 * https://github.com/synthetichealth/synthea/releases (master-branch-latest,
 * asset synthea-with-dependencies.jar). Requires Java 11 or newer.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { conditionCategories, parseBundleJson } from '../src/fhir/parse.js';
import type { PatientProfile } from '../src/fhir/types.js';

// --- Generation parameters. Changing any of these changes the output. -------
const POPULATION = 400;
const SEED = 20270101;
const AGE_RANGE = '25-64';
const STATE = 'Texas';
const CITY = 'Houston';
const YEARS_OF_HISTORY = 5;

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'data', 'fhir');
const WORK_DIR = join(ROOT, '.synthea-work');

/**
 * The clinical profiles the demo needs, and how to recognise one.
 *
 * `require` must all be present, `forbid` must all be absent, and `prefer`
 * breaks ties. Reproductive, behavioural-health and substance-use categories
 * are forbidden where they are incidental to the profile: this app suppresses
 * those categories everywhere on the employer side, so a demo persona whose
 * record leads with them would display what the rest of the app hides. `maxResources` keeps the shipped bundles to a reasonable size:
 * they are fetched by the browser, and Synthea's sickest patients run to
 * several megabytes.
 */
interface ProfileSpec {
  readonly id: string;
  readonly label: string;
  readonly require: readonly string[];
  readonly forbid: readonly string[];
  readonly prefer: readonly string[];
  readonly requireActiveDrug?: RegExp;
  readonly maxResources: number;
  readonly minAge?: number;
  readonly maxAge?: number;
  /** What the equivalent prototype persona was, for the manifest. */
  readonly prototypePersona: string;
}

const PROFILES: readonly ProfileSpec[] = [
  {
    id: 'healthy',
    label: 'Healthy adult, little recent care',
    require: [],
    forbid: ['pregnancy', 'diabetes', 'cancer', 'kidney_disease', 'transplant',
      'heart_disease', 'epilepsy', 'asthma_copd', 'substance_use', 'behavioral_health'],
    prefer: [],
    maxResources: 120,
    maxAge: 35,
    prototypePersona: 'Marco, 27, healthy, no visits in the past 12 months',
  },
  {
    id: 'pregnancy',
    label: 'Expecting a baby',
    require: ['pregnancy'],
    forbid: ['cancer', 'transplant', 'substance_use', 'behavioral_health'],
    prefer: ['anemia', 'obesity', 'prediabetes'],
    maxResources: 500,
    maxAge: 42,
    prototypePersona: 'Elvira, 34, expecting a baby in late January',
  },
  {
    id: 'transplant',
    label: 'Kidney transplant and type 2 diabetes on insulin',
    require: ['transplant', 'diabetes', 'kidney_disease'],
    forbid: [],
    prefer: ['hypertension', 'anemia', 'obesity'],
    requireActiveDrug: /insulin|humulin/i,
    maxResources: 1200,
    prototypePersona: 'Bernarda, 60, kidney transplant and type 2 diabetes on insulin',
  },
  {
    id: 'cancer',
    label: 'Cancer, now in follow-up care',
    require: ['cancer'],
    forbid: ['transplant', 'pregnancy', 'substance_use', 'behavioral_health'],
    prefer: [],
    maxResources: 700,
    prototypePersona: 'Freda, 40, breast cancer, now in follow-up care',
  },
];

function main(): void {
  const jar = jarPath();
  if (!existsSync(jar)) {
    console.error(`Synthea jar not found at ${jar}.`);
    console.error('Download synthea-with-dependencies.jar from');
    console.error('https://github.com/synthetichealth/synthea/releases/tag/master-branch-latest');
    console.error('and pass it with --jar, or place it at ./synthea.jar.');
    process.exit(1);
  }

  rmSync(WORK_DIR, { recursive: true, force: true });
  mkdirSync(WORK_DIR, { recursive: true });

  const command = [
    '-jar', jar,
    '-p', String(POPULATION),
    '-s', String(SEED),
    '-a', AGE_RANGE,
    '--exporter.baseDirectory', WORK_DIR,
    '--exporter.fhir.export', 'true',
    '--exporter.hospital.fhir.export', 'false',
    '--exporter.practitioner.fhir.export', 'false',
    '--exporter.years_of_history', String(YEARS_OF_HISTORY),
    STATE, CITY,
  ];
  console.log(`Generating ${POPULATION} patients in ${CITY}, ${STATE} with seed ${SEED}...`);
  execFileSync('java', command, { stdio: 'inherit' });

  const fhirDir = join(WORK_DIR, 'fhir');
  const files = readdirSync(fhirDir).filter((f) => f.endsWith('.json'));
  console.log(`Generated ${files.length} bundles. Classifying...`);

  const candidates = files.map((file) => {
    const path = join(fhirDir, file);
    const text = readFileSync(path, 'utf8');
    const profile = parseBundleJson(text);
    return { file, path, profile, categories: conditionCategories(profile), bytes: statSync(path).size };
  });

  mkdirSync(OUT_DIR, { recursive: true });
  const selected: SelectionRecord[] = [];

  for (const spec of PROFILES) {
    const matches = candidates
      .filter((c) => !selected.some((s) => s.patientId === c.profile.id))
      .filter((c) => matchesSpec(c, spec))
      .sort((a, b) => score(b, spec) - score(a, spec));

    const best = matches[0];
    if (!best) {
      console.warn(`No match for profile "${spec.id}" in a population of ${candidates.length}.`);
      continue;
    }

    const target = `${spec.id}.json`;
    copyFileSync(best.path, join(OUT_DIR, target));
    const text = readFileSync(best.path);
    selected.push({
      profileId: spec.id,
      profileLabel: spec.label,
      prototypePersona: spec.prototypePersona,
      file: target,
      patientId: best.profile.id,
      syntheaFile: best.file,
      name: `${best.profile.firstName} ${best.profile.lastName}`,
      age: best.profile.age,
      gender: best.profile.gender,
      city: best.profile.city ?? '',
      state: best.profile.state ?? '',
      postalCode: best.profile.postalCode ?? '',
      resources: best.profile.totalResources,
      bytes: best.bytes,
      sha256: createHash('sha256').update(text).digest('hex'),
      categories: [...best.categories].sort(),
      candidatesConsidered: matches.length,
    });
    console.log(`  ${spec.id}: ${best.profile.firstName} ${best.profile.lastName}, ` +
      `${best.profile.age} ${best.profile.gender}, ${best.profile.totalResources} resources ` +
      `(${matches.length} candidates matched)`);
  }

  writeFileSync(join(OUT_DIR, 'MANIFEST.md'), manifest(selected, candidates.length), 'utf8');
  writeFileSync(join(OUT_DIR, 'selection.json'), `${JSON.stringify(selected, null, 2)}\n`, 'utf8');
  rmSync(WORK_DIR, { recursive: true, force: true });
  console.log(`\nWrote ${selected.length} bundles and a manifest to data/fhir/.`);
}

interface Candidate {
  readonly profile: PatientProfile;
  readonly categories: ReadonlySet<string>;
  readonly bytes: number;
}

interface SelectionRecord {
  profileId: string; profileLabel: string; prototypePersona: string; file: string;
  patientId: string; syntheaFile: string; name: string; age: number; gender: string;
  city: string; state: string; postalCode: string; resources: number; bytes: number;
  sha256: string; categories: string[]; candidatesConsidered: number;
}

function matchesSpec(candidate: Candidate, spec: ProfileSpec): boolean {
  const { profile, categories } = candidate;
  if (profile.totalResources > spec.maxResources) return false;
  if (spec.minAge !== undefined && profile.age < spec.minAge) return false;
  if (spec.maxAge !== undefined && profile.age > spec.maxAge) return false;
  if (!spec.require.every((c) => categories.has(c))) return false;
  if (spec.forbid.some((c) => categories.has(c))) return false;
  if (spec.requireActiveDrug) {
    const pattern = spec.requireActiveDrug;
    if (!profile.medications.some((m) => pattern.test(m.display))) return false;
  }
  return true;
}

/**
 * Rank matching candidates. Preferred categories dominate, then a mid-sized
 * bundle (rich enough to be interesting, small enough to ship), then the
 * patient id, so ties break deterministically rather than by directory order.
 */
function score(candidate: Candidate, spec: ProfileSpec): number {
  const preferred = spec.prefer.filter((c) => candidate.categories.has(c)).length * 1000;
  const size = Math.min(candidate.profile.totalResources, spec.maxResources) / spec.maxResources * 100;
  const tiebreak = parseInt(candidate.profile.id.replace(/\D/g, '').slice(0, 6) || '0', 10) / 1e7;
  return preferred + size + tiebreak;
}

function jarPath(): string {
  const index = process.argv.indexOf('--jar');
  if (index >= 0 && process.argv[index + 1]) return resolve(process.argv[index + 1] as string);
  return join(ROOT, 'synthea.jar');
}

function manifest(selected: readonly SelectionRecord[], populationSize: number): string {
  const rows = selected.map((s) =>
    `| \`${s.file}\` | ${s.name}, ${s.age} ${s.gender} | ${s.resources} | ${(s.bytes / 1024).toFixed(0)} KB | ${s.candidatesConsidered} |`,
  ).join('\n');
  const substitutions = selected.map((s) =>
    `- **\`${s.file}\`** (${s.profileLabel}) stands in for the prototype's *${s.prototypePersona}*.\n` +
    `  Synthea gave us ${s.name}, ${s.age} ${s.gender}, ${s.city}, ${s.state} ${s.postalCode}.\n` +
    `  Active condition categories: ${s.categories.join(', ') || 'none'}.`,
  ).join('\n');

  return `# Persona bundles

These are unmodified Synthea FHIR R4 bundles. Nothing in them is hand-written,
and nothing was edited after generation. The record counts the app shows are
the counts of resources in these files, read at runtime by \`src/fhir/parse.ts\`.

## How they were generated

\`\`\`
java -jar synthea-with-dependencies.jar \\
  -p ${POPULATION} -s ${SEED} -a ${AGE_RANGE} \\
  --exporter.fhir.export true \\
  --exporter.hospital.fhir.export false \\
  --exporter.practitioner.fhir.export false \\
  --exporter.years_of_history ${YEARS_OF_HISTORY} \\
  ${STATE} ${CITY}
\`\`\`

Reproduce with \`npm run personas -- --jar /path/to/synthea-with-dependencies.jar\`.
The seed is fixed, so the same population and the same patients come out again.

## Why these four

Synthea produces random patients, so you cannot ask it for a particular
clinical story. \`scripts/generate-personas.ts\` generates a population of
${POPULATION} adults aged ${AGE_RANGE} in ${CITY}, classifies each patient by the
condition categories in \`src/fhir/codes.ts\`, and keeps the best match for each
profile the demo needs. ${populationSize} living patients were classified.

| File | Patient | Resources | Size | Candidates matched |
|---|---|---|---|---|
${rows}

## Substitutions against the prototype personas

${substitutions}

## Checksums

${selected.map((s) => `- \`${s.file}\`  \`sha256:${s.sha256}\``).join('\n')}
`;
}

main();
