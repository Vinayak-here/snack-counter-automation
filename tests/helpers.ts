import { FakeClock } from "../src/adapters/fakeClock.js";
import { InMemoryRefillRepository } from "../src/adapters/inMemoryRefillRepository.js";
import { money } from "../src/domain/money.js";
import type { Office, OfficeId } from "../src/domain/types.js";
import { RefillService } from "../src/services/refillService.js";

export const OFFICES: Record<OfficeId, Office> = {
  OSLO: { id: "OSLO", name: "Oslo", currency: "NOK", monthlyBudget: money(6000, "NOK"), timeZone: "Europe/Oslo" },
  BLR: { id: "BLR", name: "Bengaluru", currency: "INR", monthlyBudget: money(15000, "INR"), timeZone: "Asia/Kolkata" },
};

/** A fresh, isolated world for each test: empty storage, fake clock, readable ids. */
export function setup() {
  const repo = new InMemoryRefillRepository();
  const clock = new FakeClock("2026-11-02T09:00:00Z");
  let n = 0;
  const service = new RefillService(repo, OFFICES, clock, () => `refill-${++n}`);
  return { repo, clock, service };
}

export const receipt = "https://receipts.example/r1.jpg";
