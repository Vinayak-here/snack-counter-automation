import { countsAsSpend, monthKey, spentInMonth } from "./budget.js";
import { format, moneyMinor, subtract, sum, type Currency, type Money } from "./money.js";
import type { Office, OfficeId, Refill } from "./types.js";

/**
 * Stored exchange rates for one month: how many units of the report
 * currency one unit of each currency is worth. One rate per month keeps
 * the report reproducible: running it again next year gives the same numbers.
 */
export type MonthlyRates = Partial<Record<Currency, number>>;

export class MissingExchangeRateError extends Error {
  constructor(month: string, currency: Currency) {
    super(`No stored exchange rate for ${currency} in ${month}`);
    this.name = "MissingExchangeRateError";
  }
}

export interface OfficeReport {
  officeId: OfficeId;
  name: string;
  budget: Money;            // office currency
  spent: Money;             // office currency
  remaining: Money;         // office currency, negative = over budget
  spentConverted: Money;    // report currency
  purchases: number;
  overBudgetPurchases: number;
  reimbursed: number;
  awaitingHr: number;
  rejectedClaims: number;
  topItems: { item: string; count: number }[];
}

export interface MonthlyReport {
  month: string;
  reportCurrency: Currency;
  ratesUsed: MonthlyRates;
  offices: OfficeReport[];
  totalSpent: Money;        // report currency
  totalBudget: Money;       // report currency
}

/** Convert with a stored rate. Rounding happens once, on the office total. */
function convert(m: Money, to: Currency, rates: MonthlyRates, month: string): Money {
  if (m.currency === to) return m;
  const rate = rates[m.currency];
  if (rate === undefined) throw new MissingExchangeRateError(month, m.currency);
  return moneyMinor(Math.round(m.amountMinor * rate), to);
}

function topItems(refills: readonly Refill[], limit = 5): { item: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of refills) {
    for (const raw of r.purchase?.items ?? []) {
      const item = raw.trim().toLowerCase();
      if (item) counts.set(item, (counts.get(item) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([item, count]) => ({ item, count }))
    .sort((a, b) => b.count - a.count || a.item.localeCompare(b.item))
    .slice(0, limit);
}

/** One report across both offices for management. Pure: same input, same report. */
export function buildMonthlyReport(
  month: string,
  offices: readonly Office[],
  refills: readonly Refill[],
  rates: MonthlyRates,
  reportCurrency: Currency,
): MonthlyReport {
  const officeReports = offices.map((office): OfficeReport => {
    const inMonth = refills.filter(
      (r) => r.officeId === office.id && r.purchase && monthKey(r.purchase.purchasedAt, office.timeZone) === month,
    );
    const counted = inMonth.filter(countsAsSpend);
    const spent = spentInMonth(office, refills, month);
    return {
      officeId: office.id,
      name: office.name,
      budget: office.monthlyBudget,
      spent,
      remaining: subtract(office.monthlyBudget, spent),
      spentConverted: convert(spent, reportCurrency, rates, month),
      purchases: counted.length,
      overBudgetPurchases: counted.filter((r) => r.purchase!.overBudget).length,
      reimbursed: inMonth.filter((r) => r.status === "REIMBURSED").length,
      awaitingHr: inMonth.filter((r) => r.status === "PURCHASED" || r.status === "CLAIM_SUBMITTED").length,
      rejectedClaims: inMonth.filter((r) => r.status === "CLAIM_REJECTED").length,
      topItems: topItems(counted),
    };
  });

  return {
    month,
    reportCurrency,
    ratesUsed: rates,
    offices: officeReports,
    totalSpent: sum(officeReports.map((o) => o.spentConverted), reportCurrency),
    totalBudget: sum(offices.map((o) => convert(o.monthlyBudget, reportCurrency, rates, month)), reportCurrency),
  };
}

/** Plain-text version for posting in chat or email. */
export function formatReport(report: MonthlyReport): string {
  const lines = [`Snack report ${report.month}`];
  for (const o of report.offices) {
    const items = o.topItems.map((t) => `${t.item} x${t.count}`).join(", ") || "none";
    lines.push(
      `${o.name}: spent ${format(o.spent)} of ${format(o.budget)} (${format(o.spentConverted)}), ` +
        `${o.purchases} purchases, ${o.overBudgetPurchases} over budget, ${o.awaitingHr} awaiting HR. Top: ${items}`,
    );
  }
  lines.push(`Total: ${format(report.totalSpent)} of ${format(report.totalBudget)}`);
  return lines.join("\n");
}
