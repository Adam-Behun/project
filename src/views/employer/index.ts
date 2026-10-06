/**
 * The employer view: which classes to move to an ICHRA, and at what allowance.
 *
 * Ported from the dashboard prototype. The prototype read precomputed totals
 * out of a lookup table and formatted them; here the same table supplies only
 * the claims-dependent outcomes, and every other number -- savings, the
 * affordability threshold, the design search, the rules checks, suppression --
 * comes from src/engine/employer.ts.
 */

import {
  comparableCoverageCheck, evaluateDesign, recommend, ruleChecks,
  type ClassOutcomes, type Company, type Design, type DesignResult, type PurchaseMode,
} from '../../engine/employer.js';
import { excludedCategories, MINIMUM_REPORTABLE_CELL } from '../../engine/privacy.js';
import { ICHRA_AFFORDABILITY_PCT } from '../../engine/constants.js';
import type { AllowanceScope } from '../../engine/allowance.js';
import { big, money, percent, percent2, word } from '../../ui/format.js';
import { esc, icon, loadJson, qs, qsa } from '../../ui/dom.js';

interface State {
  moved: Set<string>;
  partTime: boolean;
  shareIndex: number;
  scope: AllowanceScope;
  mode: PurchaseMode;
}

export async function renderEmployer(container: HTMLElement): Promise<void> {
  const [company, outcomesFile] = await Promise.all([
    loadJson<Company>('data/employer/company.json'),
    loadJson<{ classes: ClassOutcomes }>('data/employer/class-outcomes.json'),
  ]);
  const outcomes = outcomesFile.classes;
  const recommendation = recommend(company, outcomes);

  const recommendedIds = new Set(recommendation?.design.movedClassIds ?? []);
  const state: State = {
    moved: new Set(recommendedIds),
    partTime: false,
    shareIndex: recommendation
      ? company.allowanceShares.indexOf(recommendation.design.allowanceShare)
      : Math.floor(company.allowanceShares.length / 2),
    scope: recommendation?.design.scope ?? 'premiums_only',
    mode: 'guided_best_fit',
  };

  container.innerHTML = markup(company, recommendation !== null);
  renderRecommendation(container, company, outcomes);
  wireControls(container, company, state, recommendedIds, () => render(container, company, outcomes, state, recommendedIds));
  render(container, company, outcomes, state, recommendedIds);
}

// ---------------------------------------------------------------------------

function markup(company: Company, hasRecommendation: boolean): string {
  return `
<section class="panel emp-rec" aria-labelledby="recTitle"${hasRecommendation ? '' : ' hidden'}>
  <span class="emp-rec-badge">${icon('pass')}Crosswalk recommends</span>
  <h2 id="recTitle"></h2>
  <ul class="emp-rec-classes" id="recClasses"></ul>
  <p id="recSettings"></p>
  <div class="emp-rec-nums" id="recNums"></div>
  <p id="recGold" class="fine" style="color:var(--ink)"></p>
  <p class="hint">How we choose: the design with the largest total saving where at least 8 in 10 moved
  employees come out the same or better off, every moved employee gets an affordable offer, and
  <em>both</em> you and your employees pay less overall. A design that saves you money by moving cost
  onto employees does not qualify.</p>
</section>

<div class="explore-head">
  <div>
    <h2>Explore other designs</h2>
    <p class="hint" style="margin-top:4px">Change any setting to see what happens. Recommended classes are marked.</p>
  </div>
  <button class="btn primary" id="resetRec" hidden>Back to the recommendation</button>
</div>
<p class="verdict" id="verdict" aria-live="polite"></p>

<div class="emp-layout">
  <aside class="panel controls" aria-label="Design controls">
    <fieldset>
      <legend>Move these classes to an ICHRA</legend>
      <p class="hint">Whole classes only. The rules do not let individual employees choose between an
      ICHRA and the group plan.</p>
      <div id="classToggles" style="display:grid;gap:8px"></div>
    </fieldset>
    <fieldset class="slider">
      <legend>Allowance</legend>
      <div class="srow">
        <label for="share">Share of each person&rsquo;s lowest-cost silver premium</label>
        <output id="shareOut" for="share"></output>
      </div>
      <input type="range" id="share" min="0" step="1">
      <p class="hint" id="shareHint"></p>
    </fieldset>
    <fieldset>
      <legend>The allowance pays for</legend>
      <label class="radio"><input type="radio" name="scope" value="premiums_only"> Premiums only</label>
      <label class="radio"><input type="radio" name="scope" value="premiums_and_bills"> Premiums and medical bills</label>
      <p class="hint">Either way, money employees do not use stays with you.</p>
    </fieldset>
    <fieldset>
      <legend>What employees buy</legend>
      <label class="radio"><input type="radio" name="mode" value="guided_best_fit"> Best fit, with Crosswalk guidance</label>
      <label class="radio"><input type="radio" name="mode" value="lowest_cost_silver"> Lowest-cost silver for everyone</label>
      <label class="radio"><input type="radio" name="mode" value="lowest_cost_gold"> Lowest-cost gold for everyone</label>
      <p class="hint">Gold is the closest match to a typical employer plan, so it shows whether the
      saving holds up with comparable coverage.</p>
    </fieldset>
  </aside>

  <div class="results">
    <div class="kpis" id="kpis"></div>
    <div class="panel">
      <h2 id="betterTitle"></h2>
      <div class="meter" style="margin-top:10px" aria-hidden="true"><span id="meter"></span></div>
      <p class="hint" id="betterNote" style="margin-top:10px"></p>
    </div>
    <div class="panel">
      <h2>Rules check</h2>
      <ul class="checks" id="checks"></ul>
    </div>
    <div>
      <h2 style="margin-bottom:10px">By class</h2>
      <div class="tablewrap"><table>
        <thead><tr>
          <th scope="col">Class</th><th scope="col">${company.planYear} coverage</th>
          <th scope="col">Employer cost</th><th scope="col">Employee cost</th><th scope="col">Total cost</th>
          <th scope="col">Same or better off</th>
          <th scope="col">Care checks<span class="sub">covered members</span></th>
        </tr></thead>
        <tbody id="classRows"></tbody>
      </table></div>
      <p class="hint" id="suppressionNote" style="margin-top:10px"></p>
    </div>
    ${assumptions(company)}
  </div>
</div>`;
}

function assumptions(company: Company): string {
  const trend = Math.round((company.meta.trend - 1) * 100);
  return `
<details class="assume panel">
  <summary>How these numbers work</summary>
  <ul>
    <li><strong>Company.</strong> A synthetic ${company.employees}-employee employer with offices in
      New Jersey, New York and Texas. People, conditions and claims come from Synthea, with dental
      care left out and prescriptions counted as monthly fills. Claims are scaled to 2025 state
      employer premiums (MEPS-IC via KFF) and trended 9% to ${company.planYear}.</li>
    <li><strong>Group plan.</strong> The employer pays 80% of plan cost. Employee cost is their 20%
      share plus what they pay for care under a typical plan: $1,500 deductible, 20% coinsurance,
      $5,000 out-of-pocket limit, $27 primary care and $45 specialist copays (KFF 2025 averages),
      $10/$35/$65 drug copays, and free preventive care.</li>
    <li><strong>Individual plans.</strong> The real 2026 plans sold in each employee's county: Texas
      from CMS's 2026 marketplace files, New Jersey from the state's 2026 rate filing and each
      carrier's Summary of Benefits and Coverage, New York from NY State of Health's 2026 plan
      search. Each county uses its three cheapest plans at each metal level (platinum too in New
      York), including New Jersey plans sold only off the exchange. Premiums are age-rated (New York
      uses family tiers) and raised ${trend}% for ${company.planYear}. Each plan's own deductibles,
      copays, coinsurance and out-of-pocket limits are applied to each household's claims, with
      state caps on insulin and inhaler costs. <strong>Networks and drug lists are not checked on
      this side.</strong></li>
    <li><strong>Allowances</strong> are a set share of each household's premium for the lowest-cost
      silver plan sold on the exchange in the employee's county &mdash; the plan the affordability
      test uses &mdash; with $${company.adminCostPerEmployeeMonth} per employee per month in
      administration.</li>
    <li><strong>What employees buy.</strong> Everyone on the lowest-cost silver, everyone on the
      county's cheapest gold (closest to a typical employer plan), or the best fit with Crosswalk
      guidance. Guided picks predict each household's costs from a 50/50 blend of its own past year
      and the experience of others in its class; where two plans cost the employee the same, the one
      with the lower total cost wins. Everyone then pays what their actual claims cost.</li>
    <li><strong>Same or better off.</strong> The employee's ${company.planYear} cost under an ICHRA
      is no more than $${company.betterOffMargin} above their cost on the group plan. Employees in
      classes that stay on the group plan count as unchanged.</li>
    <li><strong>Affordability.</strong> The employee's share of their own lowest-cost silver premium
      is at most ${percent2(ICHRA_AFFORDABILITY_PCT)} of household income &mdash; the IRS threshold
      for ${company.planYear}, set by Rev. Proc. 2026-26.</li>
    <li><strong>Care checks</strong> count covered members with conditions or medicines that need
      attention when changing plans, such as cancer care, kidney disease, epilepsy, insulin,
      inhalers or heart disease. Reproductive, behavioural health and substance use care are never
      shown. Counts under ${MINIMUM_REPORTABLE_CELL} are hidden.</li>
    <li><strong>Part-time staff</strong> are not on the group plan today. Offering them an ICHRA
      assumes $${company.partTime.monthlyAllowance} a month and
      ${percent(company.partTime.assumedTakeUp)} take-up.</li>
    <li><strong>What is precomputed.</strong> Each class's cost under each of the 54 designs is
      output from the household-level model above, which needs county plan data we cannot
      redistribute. Everything else on this page &mdash; the allowance arithmetic, the affordability
      threshold, the savings, the search across all 270 designs, the rules checks and the
      suppression &mdash; is computed in the browser by the same engine the employee view uses.</li>
  </ul>
</details>`;
}

// ---------------------------------------------------------------------------

function currentDesign(company: Company, state: State): Design {
  return {
    movedClassIds: company.classes.filter((c) => state.moved.has(c.id)).map((c) => c.id),
    allowanceShare: company.allowanceShares[state.shareIndex] as number,
    scope: state.scope,
    purchaseMode: state.mode,
    includePartTime: state.partTime,
  };
}

function wireControls(
  root: HTMLElement, company: Company, state: State,
  recommendedIds: ReadonlySet<string>, onChange: () => void,
): void {
  const toggles = qs(root, '#classToggles');
  for (const klass of company.classes) {
    const label = document.createElement('label');
    label.className = 'seg';
    label.innerHTML = `<input type="checkbox" value="${esc(klass.id)}"${state.moved.has(klass.id) ? ' checked' : ''}>`
      + `<span class="t"><b>${esc(klass.name)}`
      + `${recommendedIds.has(klass.id) ? '<span class="chip">Recommended</span>' : ''}</b>`
      + `<span>${klass.employees} employees, ${klass.enrolled} on the plan today</span></span>`;
    qs<HTMLInputElement>(label, 'input').addEventListener('change', (event) => {
      const input = event.target as HTMLInputElement;
      if (input.checked) state.moved.add(klass.id);
      else state.moved.delete(klass.id);
      onChange();
    });
    toggles.append(label);
  }

  const partTime = document.createElement('label');
  partTime.className = 'seg';
  partTime.innerHTML = `<input type="checkbox" id="partTime">`
    + `<span class="t"><b>${esc(company.partTime.name)}</b>`
    + `<span>${company.partTime.employees} employees, no coverage today. Adds a new benefit.</span></span>`;
  qs<HTMLInputElement>(partTime, 'input').addEventListener('change', (event) => {
    state.partTime = (event.target as HTMLInputElement).checked;
    onChange();
  });
  toggles.append(partTime);

  const share = qs<HTMLInputElement>(root, '#share');
  share.max = String(company.allowanceShares.length - 1);
  share.value = String(state.shareIndex);
  share.addEventListener('input', () => {
    state.shareIndex = Number(share.value);
    onChange();
  });

  for (const input of qsa<HTMLInputElement>(root, 'input[name=scope]')) {
    input.checked = input.value === state.scope;
    input.addEventListener('change', () => { state.scope = input.value as AllowanceScope; onChange(); });
  }
  for (const input of qsa<HTMLInputElement>(root, 'input[name=mode]')) {
    input.checked = input.value === state.mode;
    input.addEventListener('change', () => { state.mode = input.value as PurchaseMode; onChange(); });
  }

  qs<HTMLButtonElement>(root, '#resetRec').addEventListener('click', () => {
    state.moved = new Set(recommendedIds);
    state.partTime = false;
    state.shareIndex = Number(qs<HTMLButtonElement>(root, '#resetRec').dataset.shareIndex ?? state.shareIndex);
    state.scope = (qs<HTMLButtonElement>(root, '#resetRec').dataset.scope ?? 'premiums_only') as AllowanceScope;
    state.mode = 'guided_best_fit';
    syncControls(root, company, state);
    onChange();
    qs(root, '#recTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function syncControls(root: HTMLElement, company: Company, state: State): void {
  for (const input of qsa<HTMLInputElement>(root, '#classToggles input[value]')) {
    input.checked = state.moved.has(input.value);
  }
  qs<HTMLInputElement>(root, '#partTime').checked = state.partTime;
  qs<HTMLInputElement>(root, '#share').value = String(state.shareIndex);
  for (const input of qsa<HTMLInputElement>(root, 'input[name=scope]')) input.checked = input.value === state.scope;
  for (const input of qsa<HTMLInputElement>(root, 'input[name=mode]')) input.checked = input.value === state.mode;
  void company;
}

// ---------------------------------------------------------------------------

function renderRecommendation(root: HTMLElement, company: Company, outcomes: ClassOutcomes): void {
  const recommendation = recommend(company, outcomes);
  if (!recommendation) {
    qs(root, '#recTitle').textContent =
      'No design meets the bar at these assumptions. Keep the group plan for now.';
    return;
  }

  const { design, result, rationale } = recommendation;
  const moving = design.movedClassIds.length;
  const staying = company.classes.length - moving;
  qs(root, '#recTitle').textContent = staying === 0
    ? `Move all ${word(moving)} full-time classes to an ICHRA.`
    : `Move ${moving === 1 ? 'one class' : `${word(moving)} classes`} to an ICHRA. `
      + `Keep ${word(staying)} on the group plan.`;

  const movedSet = new Set(design.movedClassIds);
  qs(root, '#recClasses').innerHTML = company.classes.map((klass) => {
    const isMoving = movedSet.has(klass.id);
    return `<li class="${isMoving ? 'move' : ''}"><b>${esc(klass.name)}</b>`
      + `<span class="tag ${isMoving ? 'go' : 'keep'}">${isMoving ? 'Move to ICHRA' : 'Keep group plan'}</span>`
      + `<span class="why">${esc(rationale[klass.id] ?? '')}</span></li>`;
  }).join('') + `<li><b>${esc(company.partTime.name)}</b><span class="tag keep">Optional</span>`
    + `<span class="why">Offering an ICHRA as a new benefit would cost about `
    + `${big(company.partTime.monthlyAllowance * 12 * company.partTime.assumedTakeUp * company.partTime.employees)}`
    + ` a year.</span></li>`;

  qs(root, '#recSettings').textContent =
    `Set the allowance at ${percent(design.allowanceShare)} of each person's lowest-cost silver premium, `
    + `let it pay ${design.scope === 'premiums_and_bills' ? 'premiums and medical bills' : 'premiums only'}, `
    + `and give employees Crosswalk guidance to pick the best-fitting plan.`;

  qs(root, '#recNums').innerHTML = `
    <div><span class="v">${big(result.totalSaving)}</span><span class="l">lower total cost</span></div>
    <div><span class="v">${big(result.employerSaving)}</span><span class="l">lower employer cost</span></div>
    <div><span class="v">${big(result.employeeSaving)}</span><span class="l">lower employee cost</span></div>
    <div><span class="v plain">${result.movedSameOrBetterOff} of ${result.movedEmployees}</span>
      <span class="l">moved employees same or better off</span></div>`;

  const gold = comparableCoverageCheck(company, outcomes, design);
  const holds = gold.totalSaving >= 0;
  qs(root, '#recGold').innerHTML = `<strong>Comparable-coverage check:</strong> if everyone who moved `
    + `bought the cheapest gold plan instead, total cost would be ${big(Math.abs(gold.totalSaving))} `
    + `${holds ? 'lower' : 'higher'} than today. `
    + `${holds ? 'The saving holds up with coverage similar to a group plan.'
      : 'The saving depends on employees choosing plans that fit them.'}`;

  const reset = qs<HTMLButtonElement>(root, '#resetRec');
  reset.dataset.shareIndex = String(company.allowanceShares.indexOf(design.allowanceShare));
  reset.dataset.scope = design.scope;
}

function render(
  root: HTMLElement, company: Company, outcomes: ClassOutcomes,
  state: State, recommendedIds: ReadonlySet<string>,
): void {
  const design = currentDesign(company, state);
  const result = evaluateDesign(company, outcomes, design);
  const share = design.allowanceShare;

  qs(root, '#shareOut').textContent = percent(share);
  const averageAllowance = result.movedEmployees > 0
    ? result.allowanceTotal / result.movedEmployees / 12 : 0;
  qs(root, '#shareHint').textContent = result.movedEmployees > 0
    ? `Averages about ${money(averageAllowance)} a month per enrolled household in the classes you are `
      + `moving. Allowances rise with age and family size.`
    : 'Choose at least one class to see allowance amounts.';

  qs(root, '#kpis').innerHTML = `
    <div class="kpi"><span class="lab">Employer cost, ${company.planYear}</span>
      <span class="val">${big(result.employerCost)}</span>${delta(result.employerSaving)}</div>
    <div class="kpi"><span class="lab">Employee cost, ${company.planYear}</span>
      <span class="val">${big(result.employeeCost)}</span>${delta(result.employeeSaving)}</div>
    <div class="kpi total"><span class="lab">Total cost, employer plus employees</span>
      <span class="val">${big(result.totalCost)}</span>${delta(result.totalSaving)}</div>`;

  const betterShare = result.movedSameOrBetterShare;
  qs(root, '#betterTitle').textContent = result.movedEmployees > 0
    ? `${result.movedSameOrBetterOff} of ${result.movedEmployees} employees moved to an ICHRA come out the same or better off`
    : 'No classes are moving to an ICHRA';
  qs<HTMLElement>(root, '#meter').style.width = `${(result.movedEmployees > 0 ? betterShare : 0) * 100}%`;
  qs(root, '#betterNote').textContent = result.movedEmployees > 0
    ? `${percent(betterShare)} of moved employees. Across the whole company, ${result.allSameOrBetterOff} `
      + `of ${result.allEnrolled} enrolled employees are the same or better off`
      + `${state.partTime ? `, and ${company.partTime.employees} part-time staff gain a benefit they do not have today` : ''}.`
    : 'Everyone stays on the group plan.';

  qs(root, '#verdict').textContent = verdict(company, result, state, recommendedIds, design);
  const isRecommended = matchesRecommendation(root, state, recommendedIds, design);
  qs<HTMLButtonElement>(root, '#resetRec').hidden = isRecommended
    || qs<HTMLButtonElement>(root, '#resetRec').dataset.scope === undefined;

  qs(root, '#checks').innerHTML = ruleChecks(company, result)
    .map((check) => `<li>${icon(check.status)}<span>${esc(check.text)}</span></li>`)
    .join('');

  qs(root, '#classRows').innerHTML = result.classes.map((row) => {
    const tag = `<span class="tag ${recommendedIds.has(row.klass.id) ? 'go' : 'keep'}" style="margin-top:6px">`
      + `${recommendedIds.has(row.klass.id) ? 'Recommended: move' : 'Recommended: keep'}</span>`;
    const header = `<th scope="row">${esc(row.klass.name)}`
      + `<span class="sub">${row.klass.enrolled} enrolled &middot; ${countiesLabel(row.klass.counties)}`
      + ` &middot; ${row.klass.plansConsidered} plans compared</span>${tag}</th>`;

    if (!row.moved) {
      return `<tr>${header}<td><span class="tag plain">Group plan</span></td>`
        + `<td class="n">${big(row.employerCost)}</td><td class="n">${big(row.employeeCost)}</td>`
        + `<td class="n">${big(row.totalCost)}</td>`
        + `<td class="n">${row.klass.enrolled} of ${row.klass.enrolled}<span class="sub">unchanged</span></td>`
        + `<td class="n">${esc(row.careFlagged.display)}</td></tr>`;
    }

    const picks = row.outcome?.metalPicks ?? {};
    const picksLabel = state.mode === 'guided_best_fit'
      ? `${picks.bronze ?? 0} bronze, ${picks.silver ?? 0} silver, ${picks.gold ?? 0} gold`
        + `${picks.platinum ? `, ${picks.platinum} platinum` : ''}`
      : `all on ${state.mode === 'lowest_cost_gold' ? 'cheapest gold' : 'lowest-cost silver'}`;

    return `<tr>${header}`
      + `<td><span class="tag accent">ICHRA</span><span class="sub">${picksLabel}</span></td>`
      + `<td class="n">${big(row.employerCost)}${deltaSub(row.employerDelta)}</td>`
      + `<td class="n">${big(row.employeeCost)}${deltaSub(row.employeeDelta)}</td>`
      + `<td class="n">${big(row.totalCost)}${deltaSub(row.totalDelta)}</td>`
      + `<td class="n">${row.sameOrBetterOff} of ${row.klass.enrolled}`
      + `<span class="sub">${percent(row.sameOrBetterShare)}</span></td>`
      + `<td class="n">${esc(row.careFlagged.display)}</td></tr>`;
  }).join('') + (state.partTime
    ? `<tr><th scope="row">${esc(company.partTime.name)}<span class="sub">${company.partTime.employees} employees</span></th>`
      + `<td><span class="tag accent">ICHRA</span><span class="sub">new benefit</span></td>`
      + `<td class="n">${big(result.partTimeCost)}</td><td class="n">n/a</td>`
      + `<td class="n">${big(result.partTimeCost)}</td>`
      + `<td class="n">${company.partTime.employees} gain coverage help</td><td class="n">n/a</td></tr>`
    : '');

  qs(root, '#suppressionNote').textContent =
    `Care checks count covered members whose conditions or medicines need attention when changing `
    + `plans. Counts under ${MINIMUM_REPORTABLE_CELL} are shown as a band, and `
    + `${excludedCategories().length} categories of care — reproductive, behavioural health and `
    + `substance use — are excluded from every figure on this page.`;
}

function matchesRecommendation(
  root: HTMLElement, state: State, recommendedIds: ReadonlySet<string>, design: Design,
): boolean {
  const reset = qs<HTMLButtonElement>(root, '#resetRec');
  const recommendedShareIndex = Number(reset.dataset.shareIndex ?? -1);
  return state.mode === 'guided_best_fit'
    && !state.partTime
    && state.scope === reset.dataset.scope
    && state.shareIndex === recommendedShareIndex
    && design.movedClassIds.length === recommendedIds.size
    && design.movedClassIds.every((id) => recommendedIds.has(id));
}

function verdict(
  company: Company, result: DesignResult, state: State,
  recommendedIds: ReadonlySet<string>, design: Design,
): string {
  void company; void recommendedIds; void design;
  if (result.movedEmployees === 0) {
    return state.partTime
      ? `Keeping the group plan and adding part-time coverage costs ${big(result.partTimeCost)} more a year.`
      : 'This is today’s design. Choose classes on the left to test a move.';
  }
  const share = result.movedSameOrBetterShare;
  if (result.totalSaving > 0 && share >= 0.7) {
    return `This design lowers total cost by ${big(result.totalSaving)} and most moved employees come `
      + `out ahead. It is a strong candidate.`;
  }
  if (result.totalSaving > 0 && result.employerSaving > 0 && result.employeeSaving < 0) {
    return `Total cost falls by ${big(result.totalSaving)}, but you save ${big(result.employerSaving)} `
      + `while employees pay ${big(-result.employeeSaving)} more. Raise the allowance, or use Crosswalk `
      + `guidance, to share the saving.`;
  }
  if (result.totalSaving > 0) {
    return `Total cost falls by ${big(result.totalSaving)}, but only ${percent(share)} of moved `
      + `employees come out the same or better off.`;
  }
  return `Total cost rises by ${big(-result.totalSaving)}. Moving these classes costs more than it saves.`;
}

function delta(saving: number): string {
  if (Math.abs(saving) < 5000) return '<span class="delta neutral">About the same as today&rsquo;s plan</span>';
  const better = saving > 0;
  return `<span class="delta ${better ? 'good' : 'bad'}">${big(Math.abs(saving))} `
    + `${better ? 'lower' : 'higher'} than keeping everyone on the group plan</span>`;
}

function deltaSub(change: number): string {
  if (change === 0) return '';
  return `<span class="sub ${change < 0 ? 'good' : 'bad'}">${change < 0 ? 'down' : 'up'} `
    + `${big(Math.abs(change)).replace('−', '')}</span>`;
}

function countiesLabel(counties: Readonly<Record<string, number>>): string {
  const names = Object.keys(counties);
  if (names.length === 1) return esc(names[0] as string);
  return `${names.length} counties`;
}
