/**
 * Fetch every plan-document URL in the plan datasets and report its status.
 *
 * Phase B ships real Harris County plans whose Summary of Benefits and
 * Coverage, formulary and provider-directory URLs come from the CMS Public Use
 * Files. Those URLs are published by the issuers, so they can rot. This checks
 * them, and the workflow runs it on GitHub's runners because the environment
 * this was built in cannot reach insurer domains.
 *
 * Exits non-zero if any URL fails, so the workflow goes red.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PlanDataset } from '../src/engine/types.js';

const PLANS_DIR = resolve(import.meta.dirname, '..', 'data', 'plans');
const TIMEOUT_MS = 20_000;

interface Check {
  readonly planId: string;
  readonly kind: string;
  readonly url: string;
  status: number | string;
  ok: boolean;
}

async function main(): Promise<void> {
  const checks: Check[] = [];

  for (const file of readdirSync(PLANS_DIR).filter((f) => f.endsWith('.json'))) {
    const parsed = JSON.parse(readFileSync(join(PLANS_DIR, file), 'utf8')) as Partial<PlanDataset>;
    if (!Array.isArray(parsed.plans)) continue;
    for (const plan of parsed.plans) {
      for (const kind of ['sbcUrl', 'formularyUrl', 'providerDirectoryUrl'] as const) {
        const url = plan[kind];
        if (url) checks.push({ planId: `${file}:${plan.id}`, kind, url, status: '', ok: false });
      }
    }
  }

  if (checks.length === 0) {
    console.log('No plan document URLs to check yet. Phase B adds them.');
    return;
  }

  console.log(`Checking ${checks.length} URLs...\n`);
  // Modest concurrency: issuer sites throttle, and a false red is worse than
  // a slow green.
  const queue = [...checks];
  const workers = Array.from({ length: 6 }, async () => {
    for (let next = queue.pop(); next; next = queue.pop()) await check(next);
  });
  await Promise.all(workers);

  for (const result of checks) {
    console.log(`  ${result.ok ? 'ok  ' : 'FAIL'}  ${String(result.status).padEnd(7)} ${result.planId} ${result.kind}`);
    if (!result.ok) console.log(`        ${result.url}`);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} reachable.`);
  if (failed.length > 0) process.exit(1);
}

async function check(result: Check): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // HEAD first; some issuer sites reject it, so fall back to a ranged GET.
    let response = await fetch(result.url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    if (response.status === 405 || response.status === 403 || response.status === 501) {
      response = await fetch(result.url, {
        method: 'GET', redirect: 'follow', signal: controller.signal,
        headers: { Range: 'bytes=0-2048' },
      });
    }
    result.status = response.status;
    result.ok = response.status >= 200 && response.status < 400;
  } catch (error) {
    result.status = error instanceof Error ? error.name : 'error';
    result.ok = false;
  } finally {
    clearTimeout(timer);
  }
}

await main();
