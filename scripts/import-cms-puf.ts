/**
 * Build data/plans/harris-2026.json from the CMS Exchange Public Use Files.
 *
 * Runs in CI (.github/workflows/import-plans.yml), because the environment
 * this project was developed in cannot reach cms.gov -- the egress proxy
 * answers 403 -- so the PUFs are downloaded on a GitHub runner instead.
 *
 * The column names below are written against the published PUF data
 * dictionary. We could not open the dictionary while writing this, so the
 * importer PRINTS THE HEADER ROW OF EVERY FILE and fails loudly naming the
 * exact columns it could not find, rather than silently producing wrong plan
 * data. If it fails, paste the log back and the names get corrected.
 *
 * Nothing here invents a value. Every field, including every URL, is copied
 * from a PUF row.
 *
 * Usage:
 *   npm run import:plans -- --dir data/cms-puf/py2026 [--out data/plans/harris-2026.json]
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, join, resolve } from 'node:path';
import type { CostSharingRule, MetalLevel, Plan, PlanDataset, ServiceKind, DrugKind } from '../src/engine/types.js';

// --- What we are selecting ---------------------------------------------------

/** Harris County, Texas. */
const COUNTY_FIPS = '48201';
const COUNTY_NAME = 'Harris';
const STATE = 'TX';
const PLAN_YEAR = 2026;
/** The age the dataset's premiums are quoted at. */
const QUOTE_AGE = 40;
/** Roughly how many plans to ship: the cheapest per issuer per metal level. */
const TARGET_PLANS = 8;
/** At least one plan from this issuer, which the brief asks for by name. */
const REQUIRED_ISSUER_PATTERN = /blue cross|bcbs/i;

// --- PUF files and the columns we need --------------------------------------

interface FileSpec {
  readonly key: string;
  /** Matched case-insensitively against the file name. */
  readonly match: RegExp;
  /** Columns the importer cannot proceed without. */
  readonly required: readonly string[];
  /** Columns we use if present but can live without. */
  readonly optional: readonly string[];
}

const FILES: readonly FileSpec[] = [
  {
    key: 'serviceArea',
    match: /service.?area/i,
    required: ['BusinessYear', 'StateCode', 'IssuerId', 'ServiceAreaId'],
    optional: ['County', 'CoverEntireState'],
  },
  {
    key: 'planAttributes',
    match: /plan.?attributes/i,
    required: ['BusinessYear', 'StateCode', 'IssuerId', 'StandardComponentId', 'PlanMarketingName', 'MetalLevel', 'PlanType', 'ServiceAreaId'],
    optional: [
      'IsHSAEligible', 'MarketCoverage', 'DentalOnlyPlan', 'IssuerMarketPlaceMarketingName',
      'URLForSummaryofBenefitsCoverage', 'FormularyURL', 'NetworkId',
      'TEHBDedInnTier1IndividualA', 'TEHBInnTier1IndividualMOOPA',
      'TEHBDedInnTier1Individual', 'TEHBInnTier1IndividualMOOP',
    ],
  },
  {
    key: 'rate',
    match: /^(?!.*business).*rate/i,
    required: ['BusinessYear', 'StateCode', 'PlanId', 'Age', 'IndividualRate'],
    optional: ['RatingAreaId', 'Tobacco'],
  },
  {
    key: 'benefits',
    match: /benefits.?and.?cost|bencs/i,
    required: ['BusinessYear', 'StateCode', 'PlanId', 'BenefitName'],
    optional: ['CopayInnTier1', 'CoinsInnTier1', 'IsEHB'],
  },
  {
    key: 'network',
    match: /network/i,
    required: ['BusinessYear', 'StateCode', 'IssuerId', 'NetworkId'],
    optional: ['NetworkURL', 'NetworkName'],
  },
];

/** PUF benefit names mapped to the engine's service and drug categories. */
const BENEFIT_MAP: readonly (readonly [RegExp, ServiceKind | DrugKind])[] = [
  [/^Primary Care Visit to Treat an Injury or Illness$/i, 'pcp'],
  [/^Specialist Visit$/i, 'specialist'],
  [/^Emergency Room Services$/i, 'er'],
  [/^Generic Drugs$/i, 'generic'],
  [/^Preferred Brand Drugs$/i, 'brand'],
  [/^Specialty Drugs$/i, 'specialty'],
  [/^Imaging \(CT\/PET Scans, MRIs\)$/i, 'imaging_adv'],
  [/^X-rays and Diagnostic Imaging$/i, 'imaging'],
  [/^Laboratory Outpatient and Professional Services$/i, 'labs'],
  [/^Inpatient Hospital Services/i, 'admission'],
  [/^Delivery and All Inpatient Services for Maternity Care$/i, 'delivery'],
];

// --- Entry point -------------------------------------------------------------

interface SourceFile { readonly path: string; readonly sha256: string; readonly bytes: number; readonly rows: number }

async function main(): Promise<void> {
  const dir = resolve(argValue('--dir') ?? join('data', 'cms-puf', 'py2026'));
  const out = resolve(argValue('--out') ?? join('data', 'plans', 'harris-2026.json'));
  if (!existsSync(dir)) fail(`PUF directory not found: ${dir}`);

  const available = readdirSync(dir).filter((f) => /\.csv$/i.test(f));
  console.log(`Found ${available.length} CSV files in ${dir}:`);
  for (const file of available) console.log(`  ${file}`);
  console.log();

  // Resolve each spec to a file, and verify its columns before reading a row.
  const resolved = new Map<string, { spec: FileSpec; path: string; header: string[] }>();
  const problems: string[] = [];

  for (const spec of FILES) {
    const match = available.find((f) => spec.match.test(f));
    if (!match) {
      problems.push(`No file matching ${spec.match} for "${spec.key}".`);
      continue;
    }
    const path = join(dir, match);
    const header = await readHeader(path);
    // Print the header of every file: if a column name has changed, this is
    // what gets pasted back so the mapping can be corrected.
    console.log(`${spec.key}  <-  ${match}`);
    console.log(`  columns (${header.length}): ${header.join(', ')}`);
    const missing = spec.required.filter((c) => !header.includes(c));
    const missingOptional = spec.optional.filter((c) => !header.includes(c));
    if (missing.length > 0) problems.push(`${match} is missing required columns: ${missing.join(', ')}`);
    if (missingOptional.length > 0) console.log(`  (optional columns absent: ${missingOptional.join(', ')})`);
    console.log();
    resolved.set(spec.key, { spec, path, header });
  }

  if (problems.length > 0) {
    console.error('Cannot import. The PUF layout does not match what this importer expects:\n');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('\nThe full header of every file is printed above. Paste this log back so the');
    console.error('column mapping in scripts/import-cms-puf.ts can be corrected.');
    process.exit(1);
  }

  const sources: Record<string, SourceFile> = {};
  const inState = (row: Record<string, string>): boolean =>
    row.StateCode === STATE && row.BusinessYear === String(PLAN_YEAR);

  // 1. Service areas covering Harris County.
  const serviceAreaIds = new Set<string>();
  sources.serviceArea = await scan(resolved.get('serviceArea')!.path, (row) => {
    if (!inState(row)) return;
    const county = (row.County ?? '').trim();
    const everywhere = /^(yes|true|1)$/i.test(row.CoverEntireState ?? '');
    if (everywhere || county === COUNTY_FIPS || county.toLowerCase().startsWith(COUNTY_NAME.toLowerCase())) {
      serviceAreaIds.add(`${row.IssuerId}:${row.ServiceAreaId}`);
    }
  });
  console.log(`Service areas covering ${COUNTY_NAME} County: ${serviceAreaIds.size}`);
  if (serviceAreaIds.size === 0) {
    fail(`No service area matched ${COUNTY_NAME} County (FIPS ${COUNTY_FIPS}). Check the County column format in the header printed above.`);
  }

  // 2. Individual medical plans in those service areas.
  interface Candidate {
    id: string; name: string; issuerId: string; metal: string; planType: string;
    hsa: boolean; sbcUrl?: string; formularyUrl?: string; networkId?: string;
    deductible?: number; moop?: number;
  }
  const candidates = new Map<string, Candidate>();
  sources.planAttributes = await scan(resolved.get('planAttributes')!.path, (row) => {
    if (!inState(row)) return;
    if (!serviceAreaIds.has(`${row.IssuerId}:${row.ServiceAreaId}`)) return;
    if (/^(yes|true|1)$/i.test(row.DentalOnlyPlan ?? '')) return;
    const market = (row.MarketCoverage ?? 'Individual').toLowerCase();
    if (!market.includes('individual')) return;
    const metal = (row.MetalLevel ?? '').trim();
    if (!['Bronze', 'Silver', 'Gold', 'Platinum'].includes(metal)) return;
    const id = row.StandardComponentId;
    if (!id || candidates.has(id)) return;
    candidates.set(id, {
      id,
      name: row.PlanMarketingName ?? id,
      issuerId: row.IssuerId as string,
      metal,
      planType: row.PlanType ?? '',
      hsa: /^(yes|true|1)$/i.test(row.IsHSAEligible ?? ''),
      ...(row.URLForSummaryofBenefitsCoverage ? { sbcUrl: row.URLForSummaryofBenefitsCoverage } : {}),
      ...(row.FormularyURL ? { formularyUrl: row.FormularyURL } : {}),
      ...(row.NetworkId ? { networkId: row.NetworkId } : {}),
      ...(money(row.TEHBDedInnTier1IndividualA ?? row.TEHBDedInnTier1Individual) !== undefined
        ? { deductible: money(row.TEHBDedInnTier1IndividualA ?? row.TEHBDedInnTier1Individual) } : {}),
      ...(money(row.TEHBInnTier1IndividualMOOPA ?? row.TEHBInnTier1IndividualMOOP) !== undefined
        ? { moop: money(row.TEHBInnTier1IndividualMOOPA ?? row.TEHBInnTier1IndividualMOOP) } : {}),
    });
  });
  console.log(`Individual medical plans in those areas: ${candidates.size}`);

  // 3. Premiums at the quote age, non-tobacco.
  const premiums = new Map<string, number>();
  sources.rate = await scan(resolved.get('rate')!.path, (row) => {
    if (!inState(row)) return;
    const planId = (row.PlanId ?? '').slice(0, 14);
    if (!candidates.has(planId)) return;
    if (row.Age !== String(QUOTE_AGE)) return;
    if (row.Tobacco && /tobacco user/i.test(row.Tobacco)) return;
    const rate = Number(row.IndividualRate);
    if (!Number.isFinite(rate) || rate <= 0) return;
    const existing = premiums.get(planId);
    // Rate files carry one row per rating area; take the lowest for the county.
    if (existing === undefined || rate < existing) premiums.set(planId, rate);
  });
  console.log(`Plans with a ${QUOTE_AGE}-year-old premium: ${premiums.size}`);

  // 4. Cost sharing per benefit.
  const costSharing = new Map<string, Map<string, CostSharingRule>>();
  sources.benefits = await scan(resolved.get('benefits')!.path, (row) => {
    if (!inState(row)) return;
    const planId = (row.PlanId ?? '').slice(0, 14);
    if (!candidates.has(planId)) return;
    const category = BENEFIT_MAP.find(([pattern]) => pattern.test(row.BenefitName ?? ''))?.[1];
    if (!category) return;
    const rule = parseRule(row.CopayInnTier1 ?? '', row.CoinsInnTier1 ?? '');
    if (!rule) return;
    const forPlan = costSharing.get(planId) ?? new Map<string, CostSharingRule>();
    if (!forPlan.has(category)) forPlan.set(category, rule);
    costSharing.set(planId, forPlan);
  });

  // 5. Provider directory URLs.
  const networkUrls = new Map<string, string>();
  sources.network = await scan(resolved.get('network')!.path, (row) => {
    if (!inState(row)) return;
    if (row.NetworkURL) networkUrls.set(`${row.IssuerId}:${row.NetworkId}`, row.NetworkURL);
  });

  // --- Select, deterministically --------------------------------------------
  const usable = [...candidates.values()].filter(
    (c) => premiums.has(c.id) && c.deductible !== undefined && c.moop !== undefined,
  );
  console.log(`Plans with a premium, deductible and out-of-pocket maximum: ${usable.length}`);
  if (usable.length === 0) fail('No plan had all of a premium, a deductible and an out-of-pocket maximum.');

  // Cheapest plan per issuer per metal level, then the cheapest of those,
  // ties broken by plan id so the output is reproducible.
  const byIssuerMetal = new Map<string, Candidate>();
  for (const plan of usable) {
    const key = `${plan.issuerId}|${plan.metal}`;
    const held = byIssuerMetal.get(key);
    const rate = premiums.get(plan.id) as number;
    if (!held || rate < (premiums.get(held.id) as number)
      || (rate === (premiums.get(held.id) as number) && plan.id < held.id)) {
      byIssuerMetal.set(key, plan);
    }
  }
  const pool = [...byIssuerMetal.values()].sort((a, b) => {
    const rateA = premiums.get(a.id) as number;
    const rateB = premiums.get(b.id) as number;
    return rateA - rateB || a.id.localeCompare(b.id);
  });

  const selected: Candidate[] = [];
  // Spread across metal levels first, so the dataset is not all bronze.
  for (const metal of ['Bronze', 'Silver', 'Gold', 'Platinum']) {
    for (const plan of pool.filter((p) => p.metal === metal)) {
      if (selected.length >= TARGET_PLANS) break;
      if (selected.filter((s) => s.metal === metal).length >= 3) break;
      selected.push(plan);
    }
  }
  // Ensure the required issuer is represented, swapping out the dearest plan
  // of whichever metal level is most over-represented.
  if (!selected.some((s) => REQUIRED_ISSUER_PATTERN.test(s.name))) {
    const wanted = pool.find((p) => REQUIRED_ISSUER_PATTERN.test(p.name));
    if (wanted) {
      selected.pop();
      selected.push(wanted);
      console.log(`Swapped in ${wanted.name} to cover the required issuer.`);
    } else {
      console.log(`Note: no plan matching ${REQUIRED_ISSUER_PATTERN} was found in the selection pool.`);
    }
  }
  selected.sort((a, b) => (premiums.get(a.id) as number) - (premiums.get(b.id) as number));

  // --- Write -----------------------------------------------------------------
  const plans: Plan[] = selected.map((candidate) => {
    const rules: Record<string, CostSharingRule> = {};
    for (const [category, rule] of costSharing.get(candidate.id) ?? []) rules[category] = rule;
    return {
      id: candidate.id,
      name: candidate.name,
      metal: candidate.metal as MetalLevel,
      planType: candidate.planType,
      label: `${candidate.metal} ${candidate.planType}`.trim(),
      basePremium: premiums.get(candidate.id) as number,
      basePremiumAge: QUOTE_AGE,
      deductible: candidate.deductible as number,
      // The PUF carries per-benefit coinsurance but no single plan-level
      // default, so the medical default falls back to the inpatient rule.
      coinsurance: defaultCoinsurance(rules),
      outOfPocketMax: candidate.moop as number,
      hsaEligible: candidate.hsa,
      rules,
      // Simulated, as on the sample dataset: the PUFs carry no provider
      // rosters or drug lists.
      network: [],
      formulary: {},
      issuer: candidate.issuerId,
      hiosPlanId: candidate.id,
      county: `${COUNTY_NAME} County, ${STATE}`,
      ...(candidate.sbcUrl ? { sbcUrl: candidate.sbcUrl } : {}),
      ...(candidate.formularyUrl ? { formularyUrl: candidate.formularyUrl } : {}),
      ...(candidate.networkId && networkUrls.has(`${candidate.issuerId}:${candidate.networkId}`)
        ? { providerDirectoryUrl: networkUrls.get(`${candidate.issuerId}:${candidate.networkId}`) as string }
        : {}),
    };
  });

  const dataset: PlanDataset = {
    id: 'harris-county-2026',
    label: `Real ${PLAN_YEAR} marketplace plans, ${COUNTY_NAME} County, ${STATE}`,
    state: STATE,
    planYear: PLAN_YEAR,
    premiumTrend: 1.0,
    networkDataIsReal: false,
    source: `CMS Exchange Public Use Files, plan year ${PLAN_YEAR}. Plan terms, premiums and every `
      + `document URL are copied from the PUF rows. Networks and formularies are simulated: the `
      + `PUFs carry no provider rosters or drug lists.`,
    plans,
  };
  writeFileSync(out, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');

  const provenance = {
    generatedAt: new Date().toISOString(),
    planYear: PLAN_YEAR,
    county: `${COUNTY_NAME} County, ${STATE} (FIPS ${COUNTY_FIPS})`,
    quoteAge: QUOTE_AGE,
    selectionRule: 'Cheapest plan per issuer per metal level, then cheapest overall, at most three '
      + 'per metal level, ties broken by plan id. Deterministic.',
    plansSelected: plans.length,
    sourceFiles: sources,
    note: 'Networks and formularies are not in the PUFs and are simulated in the app.',
  };
  writeFileSync(out.replace(/\.json$/, '.provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');

  console.log(`\nSelected ${plans.length} plans:`);
  for (const plan of plans) {
    console.log(`  ${plan.metal.padEnd(9)} $${plan.basePremium.toFixed(0).padStart(4)}/mo  `
      + `ded $${String(plan.deductible).padStart(6)}  moop $${String(plan.outOfPocketMax).padStart(6)}  `
      + `${plan.sbcUrl ? 'SBC' : '   '}  ${plan.name}`);
  }
  console.log(`\nWrote ${out} and its provenance file.`);
}

// --- CSV reading -------------------------------------------------------------

async function readHeader(path: string): Promise<string[]> {
  const stream = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    stream.destroy();
    return parseCsvLine(line).map((c) => c.trim());
  }
  return [];
}

/** Stream a CSV, calling `onRow` for each record. Returns file provenance. */
async function scan(
  path: string,
  onRow: (row: Record<string, string>) => void,
): Promise<SourceFile> {
  const hash = createHash('sha256');
  const stream = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let header: string[] | null = null;
  let rows = 0;

  for await (const line of lines) {
    hash.update(line);
    if (header === null) {
      header = parseCsvLine(line).map((c) => c.trim());
      continue;
    }
    if (line.trim() === '') continue;
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (const [i, name] of header.entries()) row[name] = (cells[i] ?? '').trim();
    rows++;
    onRow(row);
  }
  return { path: basename(path), sha256: hash.digest('hex'), bytes: statSync(path).size, rows };
}

/** Minimal RFC 4180 CSV line parser: quoted fields, doubled quotes. */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { cells.push(cell); cell = ''; }
    else cell += char;
  }
  cells.push(cell);
  return cells;
}

// --- Value parsing -----------------------------------------------------------

/** "$7,500" -> 7500. Undefined for blanks and "Not Applicable". */
export function money(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[$,]/g, '').trim();
  if (cleaned === '' || /not applicable|n\/?a/i.test(cleaned)) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Turn the PUF's copay and coinsurance strings into a cost-sharing rule.
 *
 * The PUF expresses these as prose, e.g. "$30 Copay after deductible" or
 * "20% Coinsurance after deductible", so the qualifier decides which of the
 * engine's rules applies.
 */
export function parseRule(copay: string, coinsurance: string): CostSharingRule | undefined {
  const copayAmount = money(/^\s*\$?[\d,.]+/.exec(copay)?.[0]);
  const coinsPercent = Number(/^\s*([\d.]+)\s*%/.exec(coinsurance)?.[1]);
  const afterDeductible = /after deductible/i.test(copay) || /after deductible/i.test(coinsurance);
  const noCharge = /no charge/i.test(copay) || /no charge/i.test(coinsurance);

  // A real amount wins over "No Charge" in the other column: a row reading
  // "$30" copay and "No Charge" coinsurance is a $30 copay, not free care.
  if (copayAmount !== undefined && copayAmount > 0) {
    return afterDeductible
      ? { kind: 'copay_after_deductible', amount: copayAmount }
      : { kind: 'copay', amount: copayAmount };
  }
  if (Number.isFinite(coinsPercent) && coinsPercent > 0) {
    const rate = coinsPercent / 100;
    return afterDeductible ? { kind: 'coins_after_deductible', rate } : { kind: 'coinsurance', rate };
  }
  // Only now, with no amount anywhere, does "No Charge" mean free.
  if (noCharge && !afterDeductible) return { kind: 'copay', amount: 0 };
  if (afterDeductible) return { kind: 'deductible' };
  return undefined;
}

/** The plan's general medical coinsurance, taken from its inpatient rule. */
function defaultCoinsurance(rules: Record<string, CostSharingRule>): number {
  for (const key of ['admission', 'imaging_adv', 'imaging', 'labs']) {
    const rule = rules[key];
    if (rule?.kind === 'coins_after_deductible') return rule.rate;
    if (rule?.kind === 'coinsurance') return rule.rate;
  }
  return 0;
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

if (process.argv[1]?.includes('import-cms-puf')) await main();
