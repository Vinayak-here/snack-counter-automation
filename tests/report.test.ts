import { describe, expect, it } from "vitest";
import { format, money, type Money } from "../src/domain/money.js";
import { formatReport, MissingExchangeRateError } from "../src/domain/report.js";
import type { OfficeId } from "../src/domain/types.js";
import type { RefillService } from "../src/services/refillService.js";
import { ReportService } from "../src/services/reportService.js";
import { OFFICES, receipt, setup } from "./helpers.js";

async function buy(service: RefillService, officeId: OfficeId, buyer: string, amount: Money, items: string[]) {
  const { refill } = await service.reportEmpty(officeId, "x");
  await service.accept(refill.id, buyer);
  return service.recordPurchase(refill.id, buyer, { amount, items, receiptUrl: receipt });
}

const RATES = { "2026-11": { INR: 0.13 } }; // 1 INR = 0.13 NOK, stored for November

describe("monthly report across both offices", () => {
  it("totals each office in its own currency and the whole company in NOK", async () => {
    const { service, repo } = setup();
    await buy(service, "OSLO", "kari", money(1200, "NOK"), ["Chips", "chocolate"]);
    await buy(service, "OSLO", "nils", money(800, "NOK"), ["chips"]);
    await buy(service, "BLR", "priya", money(3000, "INR"), ["Parle-G", "chips"]);

    const report = await new ReportService(repo, OFFICES, RATES).monthly("2026-11");
    const [oslo, blr] = report.offices;

    expect(format(oslo!.spent)).toBe("2000.00 NOK");
    expect(format(oslo!.remaining)).toBe("4000.00 NOK");
    expect(format(blr!.spent)).toBe("3000.00 INR");
    expect(format(blr!.spentConverted)).toBe("390.00 NOK"); // 3000 x 0.13
    expect(format(report.totalSpent)).toBe("2390.00 NOK");
    expect(format(report.totalBudget)).toBe("7950.00 NOK"); // 6000 + 15000 x 0.13
  });

  it("shows which snacks were bought most", async () => {
    const { service, repo } = setup();
    await buy(service, "OSLO", "kari", money(100, "NOK"), ["Chips", "chocolate"]);
    await buy(service, "OSLO", "nils", money(100, "NOK"), [" chips ", "fruit"]);
    const report = await new ReportService(repo, OFFICES, RATES).monthly("2026-11");
    expect(report.offices[0]!.topItems[0]).toEqual({ item: "chips", count: 2 });
  });

  it("counts claim states and leaves rejected claims out of spend", async () => {
    const { service, repo } = setup();
    const a = await buy(service, "OSLO", "kari", money(500, "NOK"), []);
    const b = await buy(service, "OSLO", "nils", money(300, "NOK"), []);
    await service.markClaimSubmitted(a.id, "hr-1");
    await service.markReimbursed(a.id);
    await service.markClaimSubmitted(b.id, "hr-2");
    await service.markClaimRejected(b.id, "duplicate");

    const oslo = (await new ReportService(repo, OFFICES, RATES).monthly("2026-11")).offices[0]!;
    expect(format(oslo.spent)).toBe("500.00 NOK");
    expect(oslo.reimbursed).toBe(1);
    expect(oslo.rejectedClaims).toBe(1);
    expect(oslo.purchases).toBe(1);
  });

  it("refuses to guess when the month's exchange rate is missing", async () => {
    const { repo } = setup();
    await expect(new ReportService(repo, OFFICES, RATES).monthly("2026-12")).rejects.toThrow(MissingExchangeRateError);
  });

  it("can be formatted as text for management", async () => {
    const { service, repo } = setup();
    await buy(service, "BLR", "priya", money(1000, "INR"), ["samosa"]);
    const text = formatReport(await new ReportService(repo, OFFICES, RATES).monthly("2026-11"));
    expect(text).toContain("Bengaluru: spent 1000.00 INR of 15000.00 INR (130.00 NOK)");
    expect(text).toContain("Total: 130.00 NOK of 7950.00 NOK");
  });
});
