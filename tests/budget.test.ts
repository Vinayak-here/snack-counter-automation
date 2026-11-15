import { describe, expect, it } from "vitest";
import { FakeClock } from "../src/adapters/fakeClock.js";
import { InMemoryRefillRepository } from "../src/adapters/inMemoryRefillRepository.js";
import { budgetStatus, monthKey } from "../src/domain/budget.js";
import { BudgetExceededError } from "../src/domain/error.js";
import { CurrencyMismatchError, format, money, type Money } from "../src/domain/money.js";
import type { OfficeId } from "../src/domain/types.js";
import { BudgetService } from "../src/services/budgetService.js";
import { RefillService } from "../src/services/refillService.js";
import { OFFICES, receipt, setup } from "./helpers.js";

/** Report empty, accept and buy in one go. Returns the stored refill. */
async function buy(service: RefillService, officeId: OfficeId, buyer: string, amount: Money) {
  const { refill } = await service.reportEmpty(officeId, "someone");
  await service.accept(refill.id, buyer);
  return service.recordPurchase(refill.id, buyer, { amount, items: ["snacks"], receiptUrl: receipt });
}

describe("monthKey (which month a purchase belongs to)", () => {
  it("uses the office's own time zone", () => {
    const at = new Date("2026-11-30T20:00:00Z"); // 21:00 in Oslo, 01:30 next day in Bengaluru
    expect(monthKey(at, "Europe/Oslo")).toBe("2026-11");
    expect(monthKey(at, "Asia/Kolkata")).toBe("2026-12");
  });
});

describe("budgets and totals are correct across both currencies", () => {
  it("each office is totalled separately, in its own currency", async () => {
    const { service, repo, clock } = setup();
    await buy(service, "OSLO", "kari", money(1200.5, "NOK"));
    await buy(service, "BLR", "priya", money(2999.99, "INR"));
    await buy(service, "OSLO", "nils", money(799.5, "NOK"));
    await buy(service, "BLR", "arjun", money(500.01, "INR"));

    const budgets = new BudgetService(repo, OFFICES, clock);
    const oslo = await budgets.status("OSLO");
    const blr = await budgets.status("BLR");

    expect(format(oslo.spent)).toBe("2000.00 NOK");
    expect(format(oslo.remaining)).toBe("4000.00 NOK");
    expect(format(blr.spent)).toBe("3500.00 INR");
    expect(format(blr.remaining)).toBe("11500.00 INR");
  });

  it("totals are exact to the øre, with no floating-point drift", async () => {
    const { service, repo, clock } = setup();
    for (let i = 0; i < 10; i++) await buy(service, "OSLO", `p${i}`, money(0.1, "NOK"));
    const status = await new BudgetService(repo, OFFICES, clock).status("OSLO");
    expect(status.spent.amountMinor).toBe(100); // 10 x 0.10 = exactly 1.00
  });

  it("a new month starts from zero", async () => {
    const { service, repo, clock } = setup(); // 2 Nov
    await buy(service, "OSLO", "kari", money(5000, "NOK"));
    clock.set("2026-12-01T08:00:00Z");
    const december = await new BudgetService(repo, OFFICES, clock).status("OSLO");
    expect(december.month).toBe("2026-12");
    expect(format(december.spent)).toBe("0.00 NOK");
  });

  it("a rejected claim doesn't count as company spend", async () => {
    const { service, repo, clock } = setup();
    const r = await buy(service, "OSLO", "kari", money(1000, "NOK"));
    await service.markClaimSubmitted(r.id, "hr-1");
    await service.markClaimRejected(r.id, "no receipt");
    const status = await new BudgetService(repo, OFFICES, clock).status("OSLO");
    expect(format(status.spent)).toBe("0.00 NOK");
  });

  it("an unfinished refill (accepted, not bought) doesn't count yet", async () => {
    const { service, repo, clock } = setup();
    const { refill } = await service.reportEmpty("OSLO", "x");
    await service.accept(refill.id, "kari");
    const status = await new BudgetService(repo, OFFICES, clock).status("OSLO");
    expect(status.spent.amountMinor).toBe(0);
  });

  it("budgetStatus never mixes currencies: the result is always the office's currency", () => {
    const status = budgetStatus(OFFICES.BLR, [], new Date("2026-11-02T09:00:00Z"));
    expect(status.remaining.currency).toBe("INR");
    expect(format(status.remaining)).toBe("15000.00 INR");
  });

  it("an Oslo purchase in INR is rejected before it can pollute the totals", async () => {
    const { service } = setup();
    await expect(buy(service, "OSLO", "kari", money(500, "INR"))).rejects.toThrow(CurrencyMismatchError);
  });
});

describe("over-budget purchases", () => {
  it("spending exactly the budget is fine", async () => {
    const { service } = setup();
    const r = await buy(service, "OSLO", "kari", money(6000, "NOK"));
    expect(r.purchase?.overBudget).toBe(false);
  });

  it("by default the purchase is recorded but flagged (the money is already spent)", async () => {
    const { service, repo, clock } = setup();
    await buy(service, "OSLO", "kari", money(5500, "NOK"));
    const r = await buy(service, "OSLO", "nils", money(800, "NOK"));

    expect(r.status).toBe("PURCHASED");
    expect(r.purchase?.overBudget).toBe(true);
    const status = await new BudgetService(repo, OFFICES, clock).status("OSLO");
    expect(format(status.remaining)).toBe("-300.00 NOK");
  });

  it("with the BLOCK policy the purchase is refused and the refill stays ACCEPTED", async () => {
    const repo = new InMemoryRefillRepository();
    const service = new RefillService(repo, OFFICES, new FakeClock(), undefined, "BLOCK");
    await buy(service, "OSLO", "kari", money(5500, "NOK"));

    const { refill } = await service.reportEmpty("OSLO", "x");
    await service.accept(refill.id, "nils");
    await expect(
      service.recordPurchase(refill.id, "nils", { amount: money(800, "NOK"), items: [], receiptUrl: receipt }),
    ).rejects.toThrow(BudgetExceededError);
    expect((await service.get(refill.id)).status).toBe("ACCEPTED");
  });

  it("one office going over budget doesn't affect the other", async () => {
    const { service } = setup();
    await buy(service, "OSLO", "kari", money(7000, "NOK"));
    const blr = await buy(service, "BLR", "priya", money(3000, "INR"));
    expect(blr.purchase?.overBudget).toBe(false);
  });
});
