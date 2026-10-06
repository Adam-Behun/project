import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBundleJson } from '../src/fhir/parse.js';
import type { PatientProfile } from '../src/fhir/types.js';
import type { DrugTable, PlanDataset, PriceTable, ProviderTable } from '../src/engine/types.js';

const ROOT = join(import.meta.dirname, '..');
const read = <T>(...parts: string[]): T => JSON.parse(readFileSync(join(ROOT, ...parts), 'utf8')) as T;

/** Every projection is made from this date, so tests are stable over time. */
export const AS_OF = new Date('2026-10-06T00:00:00Z');

export const dataset = (): PlanDataset => read('data', 'plans', 'houston-sample-2026.json');
export const providers = (): ProviderTable => read('data', 'plans', 'providers.json');
export const prices = (): PriceTable => read('data', 'prices.json');
export const drugs = (): DrugTable => read('data', 'drugs.json');
export const context = () => ({ prices: prices(), drugs: drugs() });

export const persona = (id: string): PatientProfile =>
  parseBundleJson(readFileSync(join(ROOT, 'data', 'fhir', `${id}.json`), 'utf8'), { asOf: AS_OF });

export const PERSONA_IDS = ['healthy', 'pregnancy', 'transplant', 'cancer'] as const;

export const company = () => read<import('../src/engine/employer.js').Company>('data', 'employer', 'company.json');
export const classOutcomes = () =>
  read<{ classes: import('../src/engine/employer.js').ClassOutcomes }>('data', 'employer', 'class-outcomes.json').classes;
