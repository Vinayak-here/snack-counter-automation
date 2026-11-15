import { describe, expect, it } from "vitest";
import { InMemoryVolunteerDirectory } from "../src/adapters/inMemoryVolunteerDirectory.js";
import { money } from "../src/domain/money.js";
import type { Volunteer } from "../src/domain/types.js";
import { AssignmentService } from "../src/services/assignmentService.js";
import { receipt, setup } from "./helpers.js";

function person(employeeId: string, extra: Partial<Volunteer> = {}): Volunteer {
  return {
    employeeId,
    name: employeeId,
    homeOffice: "OSLO",
    currentOffice: "OSLO",
    presence: "IN_OFFICE",
    active: true,
    ...extra,
  };
}

function world(people: Volunteer[]) {
  const base = setup();
  const directory = new InMemoryVolunteerDirectory(people);
  const assigner = new AssignmentService(base.service, base.repo, directory, base.clock);
  return { ...base, directory, assigner };
}

/** Run one full refill: report empty, whoever is asked accepts and buys. Returns the buyer. */
async function oneRefill(w: ReturnType<typeof world>): Promise<string> {
  const { refill, assignedTo } = await w.assigner.reportEmptyAndAssign("OSLO", "someone");
  if (!assignedTo) throw new Error("nobody assigned");
  await w.service.accept(refill.id, assignedTo);
  await w.service.recordPurchase(refill.id, assignedTo, { amount: money(400, "NOK"), items: ["chips"], receiptUrl: receipt });
  w.clock.advanceHours(24);
  return assignedTo;
}

describe("AssignmentService", () => {
  it("reporting empty asks an eligible person", async () => {
    const w = world([person("kari"), person("nils", { presence: "REMOTE" })]);
    const { refill, assignedTo } = await w.assigner.reportEmptyAndAssign("OSLO", "ola");
    expect(assignedTo).toBe("kari");
    expect(refill.status).toBe("ASSIGNED");
  });

  it("after a decline, the next person is asked and the decliner is skipped", async () => {
    const w = world([person("kari"), person("nils")]);
    const first = await w.assigner.reportEmptyAndAssign("OSLO", "ola");
    expect(first.assignedTo).toBe("kari");

    await w.service.decline(first.refill.id, "kari");
    const second = await w.assigner.assignNext(first.refill.id);
    expect(second.assignedTo).toBe("nils");
  });

  it("when nobody is available the refill stays OPEN, and a later report retries", async () => {
    const w = world([person("kari", { presence: "HOLIDAY" })]);
    const first = await w.assigner.reportEmptyAndAssign("OSLO", "ola");
    expect(first.assignedTo).toBeNull();
    expect(first.refill.status).toBe("OPEN");

    w.directory.update("kari", { presence: "IN_OFFICE" }); // back from holiday
    const retry = await w.assigner.reportEmptyAndAssign("OSLO", "ola");
    expect(retry.refill.id).toBe(first.refill.id);
    expect(retry.assignedTo).toBe("kari");
  });

  it("reporting an already-assigned box doesn't ask a second person", async () => {
    const w = world([person("kari"), person("nils")]);
    await w.assigner.reportEmptyAndAssign("OSLO", "ola");
    const again = await w.assigner.reportEmptyAndAssign("OSLO", "ola");
    expect(again.assignedTo).toBe("kari");
  });

  it("a visitor from Bengaluru can be asked to buy for Oslo", async () => {
    const w = world([person("priya", { homeOffice: "BLR", currentOffice: "OSLO" })]);
    const { assignedTo } = await w.assigner.reportEmptyAndAssign("OSLO", "ola");
    expect(assignedTo).toBe("priya");
  });

  it("over several refills the work is shared, not done by one person", async () => {
    const w = world([person("kari"), person("nils"), person("ola")]);
    const buyers: string[] = [];
    for (let i = 0; i < 6; i++) buyers.push(await oneRefill(w));
    const count = (id: string) => buyers.filter((b) => b === id).length;
    expect(count("kari")).toBe(2);
    expect(count("nils")).toBe(2);
    expect(count("ola")).toBe(2);
  });
});
