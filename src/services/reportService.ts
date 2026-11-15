import type { Currency } from "../domain/money.js";
import { buildMonthlyReport, type MonthlyRates, type MonthlyReport } from "../domain/report.js";
import type { Office, OfficeId } from "../domain/types.js";
import type { RefillRepository } from "../ports/refillRepository.js";

/** Management's monthly report across both offices. */
export class ReportService {
  constructor(
    private readonly repo: RefillRepository,
    private readonly offices: Record<OfficeId, Office>,
    /** Stored rates per month, e.g. { "2026-11": { INR: 0.13 } } meaning 1 INR = 0.13 NOK. */
    private readonly ratesByMonth: Record<string, MonthlyRates>,
    private readonly reportCurrency: Currency = "NOK",
  ) {}

  async monthly(month: string): Promise<MonthlyReport> {
    return buildMonthlyReport(
      month,
      Object.values(this.offices),
      await this.repo.listAll(),
      this.ratesByMonth[month] ?? {},
      this.reportCurrency,
    );
  }
}
