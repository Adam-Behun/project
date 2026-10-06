/**
 * The employee view: choosing an individual plan with an ICHRA allowance.
 *
 * Ported from the plan-picker prototype. The difference is where the content
 * comes from: the prototype carried each persona's conditions, medications,
 * care team, record counts and expected care as hand-written data, and all of
 * it now comes from parsing the Synthea bundle at runtime.
 */

import { careTeamFor, defaultToggles, project, recentCareSummary, type Projection } from '../../engine/projection.js';
import { rankPlans, type RankResult } from '../../engine/ranking.js';
import { affordability } from '../../engine/allowance.js';
import { lowestCostSilverPremium } from '../../engine/premium.js';
import { ICHRA_AFFORDABILITY_PCT, SIMULATION_YEARS } from '../../engine/constants.js';
import type { DrugTable, PlanDataset, PlanOutcome, PriceTable, ProviderTable } from '../../engine/types.js';
import { parseBundle, activeMedications, displayConditions, latestObservation } from '../../fhir/parse.js';
import { shortDrugName } from '../../fhir/codes.js';
import type { FhirBundle, PatientProfile } from '../../fhir/types.js';
import {
  decapitalise, list, money, money10, MONTHS_LONG, percent2,
  pronouns, round50, would, type Pronouns,
} from '../../ui/format.js';
import { esc, loadJson, prefersReducedMotion, qs, qsa } from '../../ui/dom.js';
import { renderChart } from './chart.js';

/** Presentational data about a persona: everything clinical is parsed. */
interface PersonaManifest {
  readonly id: string;
  readonly bundle: string;
  readonly blurb: string;
  /** Default monthly allowance, from the employer side's class for this person. */
  readonly defaultAllowance: number;
}

interface PersonaFile {
  readonly asOf: string;
  readonly personas: readonly PersonaManifest[];
}

interface Data {
  readonly dataset: PlanDataset;
  readonly providers: ProviderTable;
  readonly prices: PriceTable;
  readonly drugs: DrugTable;
  readonly personas: PersonaFile;
}

interface Chosen {
  readonly manifest: PersonaManifest;
  readonly profile: PatientProfile;
  readonly projection: Projection;
  readonly careTeam: readonly string[];
  readonly pronouns: Pronouns;
}

let data: Data;
let chosen: Chosen | null = null;
let toggles: Record<string, boolean> = {};
let monthlyHelp = 0;
let helpSource: 'ichra' | 'tax_credit' = 'ichra';
let result: RankResult | null = null;

export async function renderEmployee(container: HTMLElement): Promise<void> {
  const [dataset, providers, prices, drugs, personas] = await Promise.all([
    loadJson<PlanDataset>('data/plans/houston-sample-2026.json'),
    loadJson<ProviderTable>('data/plans/providers.json'),
    loadJson<PriceTable>('data/prices.json'),
    loadJson<DrugTable>('data/drugs.json'),
    loadJson<PersonaFile>('data/personas.json'),
  ]);
  data = { dataset, providers, prices, drugs, personas };

  container.innerHTML = markup();
  renderPeople(container);
  wire(container);
  goToStep(container, 1);
}

// ---------------------------------------------------------------------------

function markup(): string {
  return `
<ol class="steps" aria-label="Progress">
  <li id="st1"><span class="dot">1</span>Choose a person</li>
  <li id="st2"><span class="dot">2</span>Connect records</li>
  <li id="st3"><span class="dot">3</span>See the best plan</li>
</ol>

<section class="step" id="s1" aria-labelledby="eh1">
  <h2 id="eh1" tabindex="-1">Pick someone to walk through.</h2>
  <div class="people" id="people"></div>
  <p class="fine" style="margin-top:18px">Each person is a synthetic patient generated with Synthea.
  Their records are read as FHIR R4, the same format a real patient-access connection returns, and
  everything shown about them &mdash; conditions, medications, visit history, record counts &mdash;
  is parsed from the bundle rather than written into this page.</p>
</section>

<section class="step" id="s2" aria-labelledby="eh2" hidden>
  <h2 id="eh2" tabindex="-1"></h2>
  <div class="consent panel" id="consent"></div>
  <div id="foundWrap" hidden>
    <div class="found" id="found"></div>
    <div class="panel" style="margin-top:14px">
      <h3 id="expectTitle">What we expect next year</h3>
      <p class="fine" style="margin-top:4px">Projected from the conditions and medications in the
      record, using the rules in <code>src/engine/projection.ts</code>. Uncheck anything that will
      not happen.</p>
      <div class="expect" id="expect"></div>
    </div>
    <div class="row" style="margin-top:22px">
      <button class="btn" id="compare">Compare plans</button>
      <button class="btn ghost" data-step="1">Choose someone else</button>
    </div>
  </div>
</section>

<section class="step" id="s3" aria-labelledby="eh3" hidden>
  <div class="verdict-block">
    <span class="who-chip" id="whoChip"></span>
    <h2 id="eh3" class="big" tabindex="-1"></h2>
    <p class="sub" id="verdictSub"></p>
    <div class="helpbox">
      <label for="help">Monthly help toward premiums</label>
      <span class="money-input">$<input id="help" type="number" inputmode="numeric" min="0" step="10" aria-describedby="helpNote"></span>
      <span class="help-source">
        <label><input type="radio" name="helpSource" value="ichra" checked> Employer ICHRA allowance</label>
        <label><input type="radio" name="helpSource" value="tax_credit"> Premium tax credit</label>
      </span>
    </div>
    <p class="fine" id="helpNote"></p>
  </div>

  <div class="chartbox panel">
    <h3>A typical year, month by month</h3>
    <p class="fine" id="chartIntro" style="margin:4px 0 14px"></p>
    <div class="legend" id="legend"></div>
    <div id="chart"></div>
    <p class="chartnote" id="chartNote"></p>
  </div>

  <div class="cols">
    <div class="panel"><h3>Why this plan</h3><ul class="why" id="why"></ul></div>
    <div class="panel"><h3>Clinical review notes</h3><ul class="notes" id="notes"></ul></div>
  </div>

  <div class="plans">
    <div class="plans-head">
      <h3 id="plansTitle"></h3>
      <span class="fine">Monthly premium is after help. The bar shows the range in 8 of 10 simulated
      years; the mark is the average.</span>
    </div>
    <ul class="plist" id="plist"></ul>
  </div>

  <div class="row" style="margin-top:26px">
    <button class="btn ghost" data-step="2">Back to records</button>
    <button class="btn ghost" data-step="1">Try another person</button>
  </div>

  ${assumptions()}
</section>
`;
}

function assumptions(): string {
  return `
<details class="assume panel">
  <summary>How this estimate works</summary>
  <ul>
    <li><strong>Plans.</strong> ${esc(data.dataset.source)}</li>
    <li><strong>People.</strong> Synthetic patients from Synthea, read from FHIR R4 bundles. Clinic
      and hospital names are fictional.</li>
    <li><strong>Next year's care</strong> is projected from each person's conditions and medications
      using clinical rules, plus random illness, injury and complications scaled by age and by how
      much chronic illness is on the record. Each plan is tested on the same
      ${SIMULATION_YEARS.toLocaleString('en-US')} simulated years, so the difference between two
      plans is the difference in their rules rather than in their luck.</li>
    <li><strong>Prices</strong> are estimated allowed amounts: ${money(data.prices.pcp)} for a
      primary care visit, ${money(data.prices.specialist)} for a specialist,
      ${money(data.prices.er)} for an emergency visit, about
      ${money(data.prices.admission)} for a hospital stay and ${money(data.prices.delivery)} for a
      delivery.</li>
    <li><strong>Total cost</strong> is premiums after help plus deductibles, copays and coinsurance,
      capped at each plan's out-of-pocket maximum. Unused help is not counted as savings.</li>
    <li><strong>Texas caps insulin cost sharing at $25 per 30-day supply</strong> in state-regulated
      plans (SB 827, Tex. Ins. Code &sect; 1358.103), so insulin is priced that way on every plan.</li>
    <li><strong>Networks and drug lists are simulated.</strong> Plan terms come from the dataset
      above, but no public plan file carries provider rosters or formularies, so the
      care-disruption check runs against a sample provider directory. It demonstrates the check; it
      is not a statement about any real insurer's network.</li>
    <li><strong>Plans that would drop a critical doctor, or stop covering a medicine someone depends
      on, are ranked after plans that do not</strong> &mdash; whatever their price.</li>
    <li><strong>An ICHRA allowance and a premium tax credit are mutually exclusive.</strong> An
      ICHRA offer that is affordable under the ${percent2(ICHRA_AFFORDABILITY_PCT)} test makes the
      employee ineligible for the credit, so the toggle above changes what the figure means.</li>
    <li>2027 rates are published in late October. This demo uses 2026-level plans.</li>
  </ul>
</details>`;
}

// ---------------------------------------------------------------------------
// Step 1
// ---------------------------------------------------------------------------

function renderPeople(root: HTMLElement): void {
  const people = qs(root, '#people');
  for (const manifest of data.personas.personas) {
    const button = document.createElement('button');
    button.className = 'person';
    button.type = 'button';
    button.innerHTML = `<span class="who"><span class="name">…</span></span>`;
    button.addEventListener('click', () => { void choose(root, manifest); });
    people.append(button);

    // The card itself is filled from the bundle, so even the name and age on
    // the chooser come from the record.
    void loadProfile(manifest).then((profile) => {
      button.innerHTML = `<span class="who"><span class="name">${esc(profile.firstName)}</span>`
        + `<span class="age">${profile.age}</span></span>`
        + `<span class="blurb">${esc(manifest.blurb)}</span>`
        + `<span class="meta">${esc(profile.city ?? '')}, ${esc(profile.state ?? '')} `
        + `${esc(profile.postalCode ?? '')} &middot; ${profile.totalResources} records</span>`;
    });
  }
}

const profileCache = new Map<string, Promise<PatientProfile>>();

function loadProfile(manifest: PersonaManifest): Promise<PatientProfile> {
  const cached = profileCache.get(manifest.id);
  if (cached) return cached;
  const asOf = new Date(data.personas.asOf);
  const promise = loadJson<FhirBundle>(manifest.bundle).then((bundle) => parseBundle(bundle, { asOf }));
  profileCache.set(manifest.id, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Step 2
// ---------------------------------------------------------------------------

async function choose(root: HTMLElement, manifest: PersonaManifest): Promise<void> {
  const consent = qs(root, '#consent');
  qs(root, '#foundWrap').setAttribute('hidden', '');
  qs(root, '#eh2').textContent = 'Connect the records';
  consent.innerHTML = '<p class="fine">Reading the bundle&hellip;</p>';
  goToStep(root, 2);

  const profile = await loadProfile(manifest);
  const projection = project(profile);
  const p = pronouns(profile.gender);
  chosen = { manifest, profile, projection, careTeam: careTeamFor(profile), pronouns: p };
  toggles = defaultToggles(projection);
  monthlyHelp = manifest.defaultAllowance;

  qs(root, '#eh2').textContent = `Connect ${profile.firstName}’s health records`;
  consent.innerHTML = `
    <p>Crosswalk will read ${p.possessive} records from:</p>
    <ul class="sources">
      <li><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>
        <span><b>${p.Possessive} doctors’ health records</b><br><span class="fine">Conditions,
        medications, visits and lab results, through a patient-access connection in FHIR R4.</span></span></li>
      <li><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/></svg>
        <span><b>${p.Possessive} insurance claims</b><br><span class="fine">What was billed and paid
        over the past year, as ExplanationOfBenefit resources.</span></span></li>
    </ul>
    <p class="fine">Used only to compare plans for ${p.object}. ${p.Possessive} employer never sees
    these records. In this demo the records are synthetic.</p>
    <div class="row"><button class="btn" id="connect">Connect records</button></div>
    <ul class="stream" id="stream" aria-live="polite"></ul>`;
  qs<HTMLButtonElement>(root, '#connect').addEventListener('click', () => connect(root));
}

/**
 * Stream the record counts.
 *
 * In the prototype this animation was decorative over numbers typed into a
 * fixture. Here each line is a real count from the parsed bundle.
 */
function connect(root: HTMLElement): void {
  if (!chosen) return;
  const { profile } = chosen;
  const button = qs<HTMLButtonElement>(root, '#connect');
  button.disabled = true;
  button.textContent = 'Connecting';

  const counts = profile.recordCounts;
  const lines: readonly (readonly [string, number])[] = [
    ['Conditions', counts.Condition ?? 0],
    ['Medication orders', counts.MedicationRequest ?? 0],
    ['Visits', counts.Encounter ?? 0],
    ['Lab results and measurements', counts.Observation ?? 0],
    ['Procedures', counts.Procedure ?? 0],
    ['Paid claims', counts.ExplanationOfBenefit ?? 0],
  ];

  const stream = qs(root, '#stream');
  stream.innerHTML = '';
  const step = prefersReducedMotion() ? 0 : 220;

  lines.forEach(([label, count], i) => {
    window.setTimeout(() => {
      const item = document.createElement('li');
      item.innerHTML = `<span>${esc(label)}</span><span class="num">${count}</span>`;
      stream.append(item);
    }, step * (i + 1));
  });

  window.setTimeout(() => {
    const item = document.createElement('li');
    item.innerHTML = `<span><b>${profile.totalResources} records parsed</b> `
      + `(${Object.keys(counts).length} resource types)</span><span class="num">Done</span>`;
    stream.append(item);
    button.textContent = 'Connected';
    showFound(root);
  }, step * (lines.length + 1));
}

function showFound(root: HTMLElement): void {
  if (!chosen) return;
  const { profile, projection, careTeam } = chosen;

  const conditions = displayConditions(profile).map((c) => c.display);
  const medications = [...new Set(activeMedications(profile).map((m) => shortDrugName(m.display)))];
  const team = careTeam
    .map((id) => data.providers[id])
    .filter((provider): provider is NonNullable<typeof provider> => provider !== undefined)
    .map((provider) => `${provider.name}, ${decapitalise(provider.role)}`);

  const a1c = latestObservation(profile, /A1c/i);
  const labNote = a1c?.value !== undefined
    ? `A1c ${a1c.value}%${a1c.date ? ` in ${formatMonth(a1c.date)}` : ''}`
      + `${a1c.value >= 5.7 && a1c.value < 6.5 ? ', just under the diabetes threshold' : ''}.`
    : '';

  qs(root, '#found').innerHTML = `
    <div class="panel"><h3>Conditions</h3>${listOrEmpty(conditions, 'None on record')}</div>
    <div class="panel"><h3>Prescriptions</h3>${listOrEmpty(medications, 'None on record')}</div>
    <div class="panel"><h3>Care team</h3>${listOrEmpty(team, 'No regular specialist on record')}</div>
    <div class="panel"><h3>Past 12 months</h3><p>${esc(recentCareSummary(profile))}</p>
      ${labNote ? `<p class="fine" style="margin-top:8px">${esc(labNote)}</p>` : ''}</div>`;

  qs(root, '#expectTitle').textContent = `What we expect in ${data.dataset.planYear + 1}`;
  qs(root, '#expect').innerHTML = projection.groups.map((group) =>
    `<label><input type="checkbox" data-group="${esc(group.id)}"${toggles[group.id] ? ' checked' : ''}>`
    + `<span>${esc(group.label)}</span></label>`).join('');
  for (const input of qsa<HTMLInputElement>(qs(root, '#expect'), 'input')) {
    input.addEventListener('change', () => {
      const group = input.dataset.group;
      if (group) toggles[group] = input.checked;
    });
  }
  qs(root, '#foundWrap').removeAttribute('hidden');
}

function listOrEmpty(items: readonly string[], empty: string): string {
  if (items.length === 0) return `<p class="empty">${esc(empty)}</p>`;
  return `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
}

function formatMonth(date: string): string {
  const month = MONTHS_LONG[Number(date.slice(5, 7)) - 1];
  return `${month} ${date.slice(0, 4)}`;
}

// ---------------------------------------------------------------------------
// Step 3
// ---------------------------------------------------------------------------

function compute(root: HTMLElement): void {
  if (!chosen) return;
  result = rankPlans({
    dataset: data.dataset,
    providers: data.providers,
    context: { prices: data.prices, drugs: data.drugs },
    projection: chosen.projection,
    careTeam: chosen.careTeam,
    age: chosen.profile.age,
    monthlyHelp,
    toggles,
  });
  renderResult(root);
}

function renderResult(root: HTMLElement): void {
  if (!chosen || !result) return;
  const { profile, projection, pronouns: p } = chosen;
  const { best, lowestPremium } = result;
  const planYear = data.dataset.planYear + 1;

  qs<HTMLInputElement>(root, '#help').value = String(monthlyHelp);
  qs(root, '#whoChip').textContent =
    `${profile.firstName}, ${profile.age}, ${decapitalise(chosen.manifest.blurb)}`;
  qs(root, '#eh3').textContent =
    `${best.plan.name}, ${best.plan.label}, is ${profile.firstName}’s best choice.`;
  qs(root, '#verdictSub').textContent = verdictText(planYear);
  qs(root, '#helpNote').textContent = helpNoteText();

  const other = best !== lowestPremium ? lowestPremium : (result.ranked.find((o) => o !== best) as PlanOutcome);
  qs(root, '#chartIntro').textContent =
    `What ${would(p)} have paid so far, premiums after help plus bills, in the most likely version of the year.`;
  qs(root, '#legend').innerHTML =
    `<span><i></i>${esc(best.plan.name)}, ${esc(best.plan.label)}</span>`
    + `<span><i class="alt"></i>${esc(other.plan.name)}, ${esc(other.plan.label)}`
    + `${other === lowestPremium ? ' (lowest premium)' : ''}</span>`;
  drawChart(root, best, other);
  qs(root, '#chartNote').textContent = chartNote(best, other);

  qs(root, '#why').innerHTML = reasons(planYear).map((text) => `<li>${esc(text)}</li>`).join('');
  const notes = projection.reviewNotes.length > 0
    ? projection.reviewNotes
    : [`Nothing in ${p.possessive} records needs clinical review. The estimate is mostly about `
       + `premiums and the risk of an unexpected bill.`];
  qs(root, '#notes').innerHTML = notes.map((text) => `<li>${esc(text)}</li>`).join('');

  qs(root, '#plansTitle').textContent = `All ${result.ranked.length} plans, ranked`;
  renderPlanList(root);
}

function renderPlanList(root: HTMLElement): void {
  if (!chosen || !result) return;
  const { pronouns: p, careTeam } = chosen;
  const { best, lowestPremium, cheapestOverall } = result;
  const widest = Math.max(...result.ranked.map((o) => o.p90)) * 1.04;

  qs(root, '#plist').innerHTML = result.ranked.map((outcome) => {
    const isBest = outcome === best;
    const isCheapPremium = outcome === lowestPremium;
    const pills = [
      isBest ? '<span class="pill best">Best choice</span>' : '',
      isCheapPremium ? '<span class="pill cheap">Lowest premium</span>' : '',
      outcome.disruptsCare ? '<span class="pill risk">Would disrupt care</span>' : '',
    ].join('');

    const high = outcome.flags.filter((f) => f.severity === 'high').length;
    const notes = outcome.flags.length - high;
    const summary = high > 0
      ? `${high} ${high === 1 ? 'problem' : 'problems'} with ${p.possessive} care`
      : `${notes} ${notes === 1 ? 'note' : 'notes'}`;
    const status = high > 0 ? ''
      : careTeam.length > 0 ? `Keeps ${p.possessive} care team` : 'No network or prescription issues';

    const link = outcome.plan.sbcUrl
      ? `<a class="plan-link" href="${esc(outcome.plan.sbcUrl)}" target="_blank" rel="noopener noreferrer">See the plan</a>`
      : '';

    const spread = round50(outcome.p90) - round50(outcome.p10) < 100
      ? `Almost certainly ${money(round50(outcome.meanTotal))}`
      : `Likely ${money(round50(outcome.p10))} to ${money(round50(outcome.p90))}`;

    return `<li class="prow${isBest ? ' best' : ''}${outcome.disruptsCare ? ' disrupts' : ''}">
      <div class="pname"><b>${esc(outcome.plan.name)}</b><span>${esc(outcome.plan.label)}</span>
        ${status ? `<span class="pstatus">${esc(status)}</span>` : ''}
        ${link}<div class="pills">${pills}</div></div>
      <div class="pstats">
        <span class="k">Monthly premium</span><span class="k">Deductible</span><span class="k">Out-of-pocket max</span>
        <span class="v">${money(outcome.netPremium)}/mo</span>
        <span class="v">${money(outcome.plan.deductible)}</span>
        <span class="v">${money(outcome.plan.outOfPocketMax)}</span>
      </div>
      <div class="pcost">
        <span class="total">${money(round50(outcome.meanTotal))}<span class="sr"> expected total</span></span>
        <div class="bar" aria-hidden="true">
          <span class="seg2" style="left:${(outcome.p10 / widest) * 100}%;width:${Math.max(1, ((outcome.p90 - outcome.p10) / widest) * 100)}%"></span>
          <span class="mid" style="left:calc(${(outcome.meanTotal / widest) * 100}% - 1px)"></span>
        </div>
        <span class="range">${esc(spread)}</span>
      </div>
      ${outcome.flags.length > 0
        ? `<details class="flags"${high > 0 && (isCheapPremium || outcome === cheapestOverall) ? ' open' : ''}>`
          + `<summary>${esc(summary)}</summary><ul>`
          + outcome.flags.map((flag) => `<li class="${flag.severity}">${esc(flag.text)}</li>`).join('')
          + `</ul></details>`
        : ''}
    </li>`;
  }).join('');
}

function verdictText(planYear: number): string {
  if (!chosen || !result) return '';
  const { pronouns: p } = chosen;
  const { best, lowestPremium, savingsOverLowestPremium, safer } = result;
  const highFlags = (outcome: PlanOutcome): string[] =>
    outcome.flags.filter((f) => f.severity === 'high').map((f) => f.short ?? f.text);

  let text = `Expected ${planYear} total: ${money(round50(best.meanTotal))}, likely between `
    + `${money(round50(best.p10))} and ${money(round50(best.p90))}. `;

  if (best === lowestPremium) {
    text += 'It is also the plan with the lowest premium, so the obvious choice is the right one.';
  } else if (savingsOverLowestPremium >= 300) {
    text += `That is ${money(round50(savingsOverLowestPremium))} less than ${lowestPremium.plan.name}, `
      + `the plan with the lowest premium.`;
    if (lowestPremium.disruptsCare) {
      text += ` That plan would also disrupt ${p.possessive} care: ${list(highFlags(lowestPremium))}.`;
    }
  } else if (savingsOverLowestPremium > -300 && lowestPremium.disruptsCare) {
    text += `About the same as ${lowestPremium.plan.name}, the plan with the lowest premium, but on `
      + `that plan ${list(highFlags(lowestPremium))}.`;
  } else if (savingsOverLowestPremium > -300) {
    text += `About the same as ${lowestPremium.plan.name}, the plan with the lowest premium. For `
      + `${p.object}, a low premium is the right call.`;
  } else {
    text += `${lowestPremium.plan.name}, the plan with the lowest premium, looks `
      + `${money(round50(-savingsOverLowestPremium))} cheaper, but ${list(highFlags(lowestPremium))}.`;
  }

  if (safer) {
    text += ` Want more protection in a bad year? ${safer.plan.name} (${safer.plan.label}) costs about `
      + `${money(round50(safer.meanTotal - best.meanTotal))} more on average but caps a bad year `
      + `around ${money(round50(safer.p90))}.`;
  }
  return text;
}

/**
 * What the "monthly help" figure means, which depends on where it comes from.
 *
 * The prototype labelled this input "from an employer ICHRA allowance or a tax
 * credit" and left it there. The two are mutually exclusive, so the note says
 * which one is assumed and what follows from it.
 */
function helpNoteText(): string {
  if (!chosen) return '';
  const silver = lowestCostSilverPremium(data.dataset, chosen.profile.age);
  if (helpSource === 'ichra') {
    const test = affordability({
      lowestCostSilverMonthly: silver,
      allowanceMonthly: monthlyHelp,
      // No wage is assumed: the threshold is reported instead.
      annualWages: 0,
    });
    const wage = (test.requiredContributionMonthly * 12) / ICHRA_AFFORDABILITY_PCT;
    if (test.requiredContributionMonthly === 0) {
      return `An allowance of ${money(monthlyHelp)} covers the whole ${money(silver)} lowest-cost `
        + `silver premium, so the offer is affordable at any wage — which also means no premium `
        + `tax credit is available.`;
    }
    return `Set by the employer as a share of the ${money(silver)} lowest-cost silver premium. `
      + `This leaves ${money(test.requiredContributionMonthly)} a month to pay, so the offer is `
      + `affordable under the ${percent2(ICHRA_AFFORDABILITY_PCT)} test for anyone earning at least `
      + `${money(wage)}. An affordable offer makes a premium tax credit unavailable; an unaffordable `
      + `one can be turned down in favour of the credit.`;
  }
  return `A premium tax credit, which is only available where no affordable employer offer exists. `
    + `The enhanced credits lapsed after 2025, so 2027 credits are smaller and the 400%-of-poverty `
    + `cliff is back. Change the source above to model an employer allowance instead.`;
}

function reasons(planYear: number): string[] {
  if (!chosen || !result) return [];
  const { pronouns: p, careTeam } = chosen;
  const { best, lowestPremium } = result;
  const out: string[] = [];

  if (best !== lowestPremium) {
    const premiumGap = best.netPremium - lowestPremium.netPremium;
    if (premiumGap > 1) {
      out.push(`Its premium is ${money(premiumGap)} a month more than ${lowestPremium.plan.name}’s `
        + `after ${p.possessive} ${money(result.monthlyHelp)} monthly help, about `
        + `${money10(premiumGap * 12)} a year.`);
    }
    if (best.plan.deductible < lowestPremium.plan.deductible) {
      out.push(`Its ${money(best.plan.deductible)} deductible is `
        + `${money(lowestPremium.plan.deductible - best.plan.deductible)} lower, and `
        + `${p.possessive} out-of-pocket limit is ${money(best.plan.outOfPocketMax)} instead of `
        + `${money(lowestPremium.plan.outOfPocketMax)}.`);
    }
  }

  const bills = best.meanTotal - best.netPremium * 12;
  out.push(`On average ${would(p)} pay about ${money(round50(bills))} in bills on this plan, on top `
    + `of premiums.`);

  if (careTeam.length > 0 && !best.disruptsCare) {
    const kept = careTeam
      .filter((id) => best.plan.network.includes(id))
      .map((id) => data.providers[id]?.name)
      .filter((name): name is string => name !== undefined);
    if (kept.length > 0) out.push(`Keeps ${list(kept)} in network.`);
  }

  for (const flag of best.flags) {
    if (flag.severity === 'note' && !/HSA/.test(flag.text)) out.push(flag.text);
  }
  if (best.plan.hsaEligible) {
    out.push('It is HSA-eligible, so the deductible can be paid with pre-tax savings. Bronze and '
      + 'catastrophic marketplace plans have qualified since January 2026.');
  }

  out.push(`In a bad year (1 in 10), ${p.possessive} total for ${planYear} would be about `
    + `${money(round50(best.p90))}.`);
  return out;
}

function drawChart(root: HTMLElement, best: PlanOutcome, other: PlanOutcome): void {
  const container = qs<HTMLElement>(root, '#chart');
  container.innerHTML = renderChart(
    container.clientWidth,
    { label: best.plan.name, cumulative: best.typicalCumulative },
    { label: other.plan.name, cumulative: other.typicalCumulative },
  );
}

function chartNote(best: PlanOutcome, other: PlanOutcome): string {
  const a = best.typicalCumulative;
  const b = other.typicalCumulative;
  const gap = (b[11] as number) - (a[11] as number);
  let crossover = -1;
  for (let i = 0; i < 12; i++) {
    if ((b[i] as number) > (a[i] as number) + 1) { crossover = i; break; }
  }

  if (gap > 50 && crossover >= 0) {
    const lead = crossover === 0
      ? `${other.plan.name} costs more from January on`
      : `${other.plan.name} starts cheaper but costs more from ${MONTHS_LONG[crossover]} on`;
    return `${lead}, and ends this typical year ${money(round50(gap))} higher.`;
  }
  if (gap < -50 && other.disruptsCare) {
    const flags = other.flags.filter((f) => f.severity === 'high').map((f) => f.short ?? f.text);
    return `${other.plan.name} comes out ${money(round50(-gap))} lower in a typical year, but `
      + `${list(flags)}.`;
  }
  if (gap < -50) {
    return `In a typical year ${other.plan.name} comes out ${money(round50(-gap))} lower, but `
      + `${best.plan.name} is cheaper on average once bad years are included.`;
  }
  return `In a typical year the two plans end up within about `
    + `${money(Math.max(50, round50(Math.abs(gap))))} of each other.`;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function wire(root: HTMLElement): void {
  qs<HTMLButtonElement>(root, '#compare').addEventListener('click', () => {
    compute(root);
    goToStep(root, 3);
  });

  const help = qs<HTMLInputElement>(root, '#help');
  help.addEventListener('change', () => {
    monthlyHelp = Math.max(0, Math.round(Number(help.value) || 0));
    help.value = String(monthlyHelp);
    compute(root);
  });

  for (const input of qsa<HTMLInputElement>(root, 'input[name=helpSource]')) {
    input.addEventListener('change', () => {
      helpSource = input.value as 'ichra' | 'tax_credit';
      qs(root, '#helpNote').textContent = helpNoteText();
    });
  }

  for (const button of qsa<HTMLButtonElement>(root, '[data-step]')) {
    button.addEventListener('click', () => {
      const step = Number(button.dataset.step);
      if (step === 1) { chosen = null; result = null; }
      goToStep(root, step);
    });
  }

  let resizeTimer: number | undefined;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!result || qs(root, '#s3').hasAttribute('hidden')) return;
      const best = result.best;
      const other = best !== result.lowestPremium
        ? result.lowestPremium
        : (result.ranked.find((o) => o !== best) as PlanOutcome);
      drawChart(root, best, other);
    }, 150);
  });
}

function goToStep(root: HTMLElement, step: number): void {
  for (const n of [1, 2, 3]) {
    const section = qs(root, `#s${n}`);
    if (n === step) section.removeAttribute('hidden');
    else section.setAttribute('hidden', '');

    const marker = qs(root, `#st${n}`);
    marker.classList.toggle('done', n < step);
    if (n === step) marker.setAttribute('aria-current', 'step');
    else marker.removeAttribute('aria-current');
  }
  const heading = qs<HTMLElement>(root, `#eh${step}`);
  heading.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}
