/**
 * Capture the README screenshots from a real build.
 *
 * These are viewport-sized crops, not full-page captures: a full-page shot of
 * either view is six to eight screens tall, which renders in the README as an
 * enormous scroll. Each shot is framed on the part of the view that carries
 * the argument, and the two sit side by side in the README.
 *
 * Run `npm run build && npx vite preview --port 4173` first, then
 * `node scripts/screenshots.mjs`. Set CHROMIUM_PATH where the installed
 * browser does not match Playwright's expected revision.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/Crosswalk/';
const OUT = resolve(import.meta.dirname, '..', 'docs', 'screenshots');
mkdirSync(OUT, { recursive: true });

/** 16:10. Renders in the README at a readable size without dominating it. */
const VIEWPORT = { width: 1440, height: 900 };

const executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const errors = [];

const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

/**
 * Scroll so `selector` sits just below the sticky header, then capture.
 * `zoom` shrinks the page first, for frames that need to hold more than one
 * viewport's worth -- the verdict and the whole chart, for instance.
 */
async function shot(name, selector, { target = page, zoom = 1 } = {}) {
  if (zoom !== 1) {
    await target.evaluate((z) => { document.documentElement.style.zoom = String(z); }, zoom);
    await target.waitForTimeout(200);
  }
  if (selector) {
    await target.$eval(selector, (el) => {
      const header = document.querySelector('header.top');
      const offset = (header?.getBoundingClientRect().height ?? 0) + 16;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: 'instant' });
    });
    await target.waitForTimeout(250);
  }
  await target.screenshot({ path: join(OUT, `${name}.png`) });
  if (zoom !== 1) {
    await target.evaluate(() => { document.documentElement.style.zoom = ''; });
  }
  console.log('  ', name);
}

console.log('Capturing:');

// Employer: the recommendation, which is the whole output of the design search.
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#recTitle');
await shot('employer', '.emp-rec');

// Employer: the controls, KPIs and rules check, further down the same view.
await shot('employer-controls', '.emp-layout');

// Employee: choosing a person.
await page.goto(`${BASE}?view=employee`, { waitUntil: 'networkidle' });
await page.waitForSelector('.person .name');
await page.waitForTimeout(1500);
await shot('employee-1-choose');

// Employee: the parsed record.
await page.click('.person:nth-child(3)');
await page.waitForSelector('#connect', { timeout: 20000 });
await page.click('#connect');
await page.waitForSelector('#foundWrap:not([hidden])', { timeout: 25000 });
await page.waitForTimeout(700);
await shot('employee-2-records', '#found');

// Employee: the verdict and the month-by-month chart -- the argument of the view.
await page.click('#compare');
await page.waitForSelector('#plist .prow', { timeout: 40000 });
await page.waitForTimeout(600);
await shot('employee-3-result', '.verdict-block', { zoom: 0.72 });

// Employee: the ranked list, where care disruption outranks price.
await shot('employee-4-ranked', '.plans');

// Narrow viewport, to show the layout holds. Capped height, not full page.
const mobile = await browser.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
await mobile.goto(BASE, { waitUntil: 'networkidle' });
await mobile.waitForSelector('#recTitle');
const overflow = await mobile.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
if (overflow > 0) errors.push(`Horizontal overflow at 390px: ${overflow}px`);
await shot('employer-mobile', null, { target: mobile });

await browser.close();

if (errors.length > 0) {
  console.error('\nProblems:\n' + errors.map((e) => `  ${e}`).join('\n'));
  process.exit(1);
}
console.log('\nNo console errors.');
