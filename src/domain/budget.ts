import { subtract, sum, type Money } from "./money.js";
import type { Office, Refill } from "./types.js";

/** What to do when a purchase would go over the monthly budget. */
export type OverBudgetPolicy = "FLAG" | "BLOCK";

/**
 * "2026-11" for a moment, as seen in the office's own time zone.
 * 20:00 UTC on 30 Nov is still November in Oslo but already December in Bengaluru.
 */
export function monthKey(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(at);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}`;
}

/**
 * Does this refill's purchase count as company spend?
 * Counted at purchase time (not when HR pays), so the budget reacts at once.
 * A rejected claim is not company money, so it doesn't count.
 */
export function countsAsSpend(r: Refill): boolean {
  return r.purchase !== undefined && r.status !== "CLAIM_REJECTED";
}

/** Total spent by one office in one month, in that office's currency. */
export function spentInMonth(office: Office, refills: readonly Refill[], month: string): Money {
  const amounts = refills
    .filter((r) => r.officeId === office.id && countsAsSpend(r))
    .filter((r) => monthKey(r.purchase!.purchasedAt, office.timeZone) === month)
    .map((r) => r.purchase!.amount);
  return sum(amounts, office.currency);
}

export interface BudgetStatus {
  month: string;
  budget: Money;
  spent: Money;
  /** Can be negative when the office is over budget. */
  remaining: Money;
}

/** Budget, spend and what's left for the month that `at` falls in. */
export function budgetStatus(office: Office, refills: readonly Refill[], at: Date): BudgetStatus {
  const month = monthKey(at, office.timeZone);
  const spent = spentInMonth(office, refills, month);
  return { month, budget: office.monthlyBudget, spent, remaining: subtract(office.monthlyBudget, spent) };
}

