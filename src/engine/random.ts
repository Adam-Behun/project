/**
 * Seeded, deterministic randomness. The same seed always produces the same
 * sequence, so every number this app shows is reproducible: a recruiter can
 * re-run it and get the figures in the screenshots.
 *
 * Ported unchanged from the plan-picker prototype so its published numbers hold.
 */

/** A pure random source: successive calls return values in [0, 1). */
export type Rng = () => number;

/**
 * mulberry32. Small, fast, and good enough for cost simulation; not for
 * cryptography.
 */
export function rngFrom(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Poisson draw by Knuth's method: how many independent events happen in a year
 * when they average `lambda`. Used for sick visits, ER trips and admissions.
 */
export function poisson(rng: Rng, lambda: number): number {
  if (lambda <= 0) return 0;
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > limit);
  return k - 1;
}

/**
 * Lognormal draw around a median. Medical costs are strongly right-skewed --
 * most hospital stays cost near the median, a few cost many times it -- which
 * is what makes the tail of the distribution worth simulating at all.
 */
export function lognormal(rng: Rng, median: number, sigma: number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return median * Math.exp(sigma * z);
}

/** A uniformly random plan-year month, 1-12. */
export function randomMonth(rng: Rng): number {
  return 1 + Math.floor(rng() * 12);
}

/** The p-th quantile of an already-ascending array. */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[i] as number;
}

/** Arithmetic mean. Returns 0 for an empty array. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}
