/**
 * Capture the README screenshots from a real build.
 *
 * Run `npm run build && npx vite preview --port 4173` first, then
 * `node scripts/screenshots.mjs`. Chromium comes from Playwright.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/crosswalk/';
const OUT = resolve(import.meta.dirname, '..', 'docs', 'screenshots');
mkdirSync(OUT, { recursive: true });

// CHROMIUM_PATH lets a preinstalled Chromium be used where the Playwright
// version here does not match the downloaded browser revision.
const executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const errors = [];

const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

const shot = async (name, target = page) => {
  await target.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  console.log('  ', name);
};

console.log('Capturing:');

// Employer: the default view.
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#recTitle');
await shot('employer');

// Employee: choosing a person, then the full flow for the transplant persona.
await page.goto(`${BASE}?view=employee`, { waitUntil: 'networkidle' });
await page.waitForSelector('.person .name');
await page.waitForTimeout(1500);
await shot('employee-1-choose');

await page.click('.person:nth-child(3)');
await page.waitForSelector('#connect', { timeout: 20000 });
await page.click('#connect');
await page.waitForSelector('#foundWrap:not([hidden])', { timeout: 25000 });
await page.waitForTimeout(700);
await shot('employee-2-records');

await page.click('#compare');
await page.waitForSelector('#plist .prow', { timeout: 40000 });
await page.waitForTimeout(600);
await shot('employee-3-result');

// Narrow viewport, to show the layout holds.
const mobile = await browser.newPage({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
await mobile.goto(BASE, { waitUntil: 'networkidle' });
await mobile.waitForSelector('#recTitle');
const overflow = await mobile.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
if (overflow > 0) errors.push(`Horizontal overflow at 390px: ${overflow}px`);
await shot('employer-mobile', mobile);

await browser.close();

if (errors.length > 0) {
  console.error('\nProblems:\n' + errors.map((e) => `  ${e}`).join('\n'));
  process.exit(1);
}
console.log('\nNo console errors.');
