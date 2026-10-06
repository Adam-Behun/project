/**
 * Build public/ from the committed sources, and fill in each persona's default
 * allowance from the real plan data.
 *
 * data/ and assets/ are the sources of truth and live at the repo root where a
 * reviewer expects them. Vite only serves publicDir, so this mirrors both into
 * public/, which is generated and gitignored. Zero dependencies on purpose.
 */

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { grossPremium, lowestCostSilverPremium } from '../src/engine/premium.js';
import { parseBundle } from '../src/fhir/parse.js';
import type { FhirBundle } from '../src/fhir/types.js';
import type { PlanDataset } from '../src/engine/types.js';

/**
 * The allowance share the employer view recommends. Each persona's default
 * allowance is that share of their OWN lowest-cost silver premium, which is
 * how an ICHRA allowance actually works -- it rises with age and family size,
 * rather than being a flat figure typed in per person.
 */
const RECOMMENDED_SHARE = 0.85;

const ROOT = resolve(import.meta.dirname, '..');
const DATA = join(ROOT, 'data');
const ASSETS = join(ROOT, 'assets');
const PUBLIC = join(ROOT, 'public');
const PUBLIC_DATA = join(PUBLIC, 'data');

interface PersonaFile {
  asOf: string;
  _note?: string;
  personas: { id: string; bundle: string; blurb: string; defaultAllowance: number }[];
}

function main(): void {
  const dataset = readJson<PlanDataset>(join(DATA, 'plans', 'houston-sample-2026.json'));
  const personaFile = readJson<PersonaFile>(join(DATA, 'personas.json'));
  const asOf = new Date(personaFile.asOf);

  for (const persona of personaFile.personas) {
    const bundle = readJson<FhirBundle>(join(ROOT, persona.bundle));
    const profile = parseBundle(bundle, { asOf });
    const silver = lowestCostSilverPremium(dataset, profile.age);
    persona.defaultAllowance = Math.round((silver * RECOMMENDED_SHARE) / 10) * 10;
    const cheapest = Math.min(...dataset.plans.map((p) => grossPremium(p, profile.age, dataset)));
    console.log(
      `  ${persona.id.padEnd(11)} age ${String(profile.age).padStart(2)}  `
      + `lowest-cost silver $${silver.toFixed(0).padStart(4)}/mo  `
      + `allowance $${String(persona.defaultAllowance).padStart(4)}/mo  `
      + `(cheapest plan of any metal $${cheapest.toFixed(0)}/mo)`,
    );
  }
  writeFileSync(join(DATA, 'personas.json'), `${JSON.stringify(personaFile, null, 2)}\n`, 'utf8');

  // public/ is generated, so it is rebuilt from scratch every time.
  rmSync(PUBLIC, { recursive: true, force: true });
  mkdirSync(PUBLIC_DATA, { recursive: true });
  cpSync(DATA, PUBLIC_DATA, {
    recursive: true,
    // The raw PUFs are inputs to the importer, never served.
    filter: (source) => !source.includes(`${join('data', 'cms-puf')}`),
  });
  // Self-hosted fonts and anything else served verbatim.
  cpSync(ASSETS, PUBLIC, { recursive: true });
  console.log(`\nMirrored data/ and assets/ to public/.`);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

main();
