import { describe, expect, it } from 'vitest';
import { money, parseCsvLine, parseRule } from '../scripts/import-cms-puf.js';

describe('reading PUF CSV rows', () => {
  it('splits a plain row', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps commas inside quoted fields', () => {
    // Plan marketing names contain commas constantly.
    expect(parseCsvLine('1,"Blue Advantage Silver HMO, 005",TX'))
      .toEqual(['1', 'Blue Advantage Silver HMO, 005', 'TX']);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsvLine('a,"say ""hi""",b')).toEqual(['a', 'say "hi"', 'b']);
  });

  it('preserves empty trailing fields', () => {
    expect(parseCsvLine('a,,')).toEqual(['a', '', '']);
  });
});

describe('reading PUF money values', () => {
  it('parses a dollar amount with separators', () => {
    expect(money('$7,500')).toBe(7500);
    expect(money('1250')).toBe(1250);
  });

  it('treats blanks and "Not Applicable" as absent', () => {
    expect(money('')).toBeUndefined();
    expect(money(undefined)).toBeUndefined();
    expect(money('Not Applicable')).toBeUndefined();
    expect(money('N/A')).toBeUndefined();
  });
});

describe('turning PUF cost-sharing prose into a rule', () => {
  it('reads a flat copay, even when the coinsurance column says No Charge', () => {
    // A very common PUF shape: $30 copay and no coinsurance on top of it.
    // Reading the No Charge first would make the benefit free.
    expect(parseRule('$30', 'No Charge')).toEqual({ kind: 'copay', amount: 30 });
  });

  it('reads a copay after the deductible', () => {
    expect(parseRule('$500 Copay after deductible', ''))
      .toEqual({ kind: 'copay_after_deductible', amount: 500 });
  });

  it('reads plain coinsurance', () => {
    expect(parseRule('No Charge', '20%')).toEqual({ kind: 'coinsurance', rate: 0.2 });
  });

  it('reads coinsurance after the deductible', () => {
    expect(parseRule('', '40% Coinsurance after deductible'))
      .toEqual({ kind: 'coins_after_deductible', rate: 0.4 });
  });

  it('reads a benefit that is simply subject to the deductible', () => {
    expect(parseRule('Not Applicable', '0% Coinsurance after deductible'))
      .toEqual({ kind: 'deductible' });
  });

  it('reads no-charge care as a zero copay', () => {
    expect(parseRule('No Charge', 'No Charge')).toEqual({ kind: 'copay', amount: 0 });
  });

  it('returns nothing it cannot read, rather than guessing', () => {
    // A rule the importer cannot parse must be absent, not wrong: the engine
    // falls back to the deductible, which is the conservative reading.
    expect(parseRule('', '')).toBeUndefined();
    expect(parseRule('see plan documents', 'varies')).toBeUndefined();
  });

  it('prefers a copay over coinsurance when a benefit carries both', () => {
    expect(parseRule('$50', '20%')).toEqual({ kind: 'copay', amount: 50 });
  });
});
