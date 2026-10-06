/** Number and text formatting, shared by both views. */

/** `$1,234`. */
export const money = (amount: number): string =>
  `$${Math.round(amount).toLocaleString('en-US')}`;

/** `$1,230`, rounded to the nearest ten. For figures that imply false precision. */
export const money10 = (amount: number): string =>
  `$${(Math.round(amount / 10) * 10).toLocaleString('en-US')}`;

/** Round to the nearest fifty. The prototype's rounding for simulated totals. */
export const round50 = (amount: number): number => Math.round(amount / 50) * 50;

/** `$2.29M` or `$762K`, with a minus sign for negatives. Employer-scale money. */
export function big(amount: number): string {
  const absolute = Math.abs(amount);
  const sign = amount < 0 ? '−' : '';
  if (absolute >= 1e6) return `${sign}$${(absolute / 1e6).toFixed(2)}M`;
  return `${sign}$${Math.round(absolute / 1e3).toLocaleString('en-US')}K`;
}

/** `80%`. */
export const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** `10.22%`. */
export const percent2 = (share: number): string => `${(share * 100).toFixed(2)}%`;

/** "a, b, and c". */
export function list(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] as string;
  if (items.length === 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/** Numbers as words, up to six. Reads better than digits in a sentence. */
export function word(n: number): string {
  return ['no', 'one', 'two', 'three', 'four', 'five', 'six'][n] ?? String(n);
}

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'] as const;

/** Lowercase the first letter, for splicing a sentence into another. */
export const decapitalise = (text: string): string =>
  text.charAt(0).toLowerCase() + text.slice(1);

export const capitalise = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Pronouns for narrative copy.
 *
 * FHIR `Patient.gender` is an administrative code, not a statement about
 * pronouns, so anything other than male or female falls back to they/them
 * rather than being guessed at.
 */
export interface Pronouns {
  readonly subject: string; readonly object: string; readonly possessive: string;
  readonly Subject: string; readonly Possessive: string;
  /** True where the verb needs a plural form ("they have" not "she has"). */
  readonly plural: boolean;
}

export function pronouns(gender: string): Pronouns {
  if (gender === 'male') {
    return { subject: 'he', object: 'him', possessive: 'his', Subject: 'He', Possessive: 'His', plural: false };
  }
  if (gender === 'female') {
    return { subject: 'she', object: 'her', possessive: 'her', Subject: 'She', Possessive: 'Her', plural: false };
  }
  return { subject: 'they', object: 'them', possessive: 'their', Subject: 'They', Possessive: 'Their', plural: true };
}

/** "she'd" / "they'd". */
export const would = (p: Pronouns): string => `${p.subject}'d`;
/** "she has" / "they have". */
export const has = (p: Pronouns): string => (p.plural ? `${p.subject} have` : `${p.subject} has`);
