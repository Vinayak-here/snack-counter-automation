/**
 * Money is stored as an INTEGER number of the smallest unit (minor units):
 *   NOK -> øre   (1 NOK = 100 øre)
 *   INR -> paise (1 INR = 100 paise)
 *
 * Why? Floating point numbers cannot represent most decimals exactly:
 *   0.1 + 0.2 === 0.30000000000000004
 * Integers add up exactly, so totals and budget checks are always correct.
 */

export type Currency = "NOK" | "INR";

export interface Money {
  readonly amountMinor: number; // integer, e.g. 125050 = 1250.50
  readonly currency: Currency;
}

export class CurrencyMismatchError extends Error {
  constructor(a: Currency, b: Currency) {
    super(`Cannot combine ${a} with ${b}`);
    this.name = "CurrencyMismatchError";
  }
}

/** Build Money from a normal amount like 1250.50 */
export function money(amount: number, currency: Currency): Money {
  const amountMinor = Math.round(amount * 100);
  return { amountMinor, currency };
}

/** Build Money directly from minor units (already an integer) */
export function moneyMinor(amountMinor: number, currency: Currency): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new Error(`Minor units must be an integer, got ${amountMinor}`);
  }
  return { amountMinor, currency };
}

export function zero(currency: Currency): Money {
  return { amountMinor: 0, currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

export function isGreaterThan(a: Money, b: Money): boolean {
  assertSameCurrency(a, b);
  return a.amountMinor > b.amountMinor;
}

export function sum(items: Money[], currency: Currency): Money {
  return items.reduce((total, m) => add(total, m), zero(currency));
}

/** For display only: 125050 NOK -> "1250.50 NOK" */
export function format(m: Money): string {
  return `${(m.amountMinor / 100).toFixed(2)} ${m.currency}`;
}
